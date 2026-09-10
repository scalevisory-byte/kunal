import { db, listTasks, getTask } from './db.js';
import { dueMoment } from './task-lifecycle.js';
import { getSettings } from './scheduling.js';

/**
 * The popup that says a task has come due.
 *
 * The list already shows what is late, and a list is exactly what you do not
 * read when you are in the middle of something else - which is why a hundred
 * tasks reached their deadline without anyone noticing. A deadline arriving is
 * worth interrupting for once; after that it is a row in a list again.
 *
 * Dismissal is recorded on the server, not in the browser, for the same reason
 * the monthly notices are: "I have seen this" is a fact about the person, not
 * about the tab. Dismissed on the phone, it stays dismissed on the laptop; a
 * refresh does not bring it back, and clearing a browser does not resurrect it.
 *
 * Keyed on the deadline it was for, so moving a task to Friday produces a new
 * notice on Friday rather than inheriting the silence of the old one.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS task_notices (
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    due_key      TEXT NOT NULL,
    seen_at      TEXT,
    snooze_until TEXT,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (task_id, due_key)
  );
`);

/** The deadline as a stable string, so a rescheduled task gets its own notice. */
const keyOf = (at) => at.toISOString();

const noticeFor = (taskId, dueKey) =>
  db.prepare(`SELECT * FROM task_notices WHERE task_id = ? AND due_key = ?`).get(taskId, dueKey);

/**
 * Tasks whose deadline has passed and which have not been answered yet.
 *
 * Deliberately narrow. Work held for confirmation is not chased at all, and a
 * set-aside folder is not the day's work - interrupting for either would be
 * the app talking about something the user has already said is not urgent.
 */
export function dueNow({ now = new Date(), limit = 5 } = {}) {
  const settings = getSettings();
  const nowIso = now.toISOString();

  return listTasks({ status: 'pending', limit: 500 })
    .filter((task) => !task.needs_confirmation)
    .map((task) => ({ task, at: dueMoment(task, settings) }))
    .filter(({ at }) => at && at <= now)
    .map(({ task, at }) => ({ task, at, notice: noticeFor(task.id, keyOf(at)) }))
    .filter(({ notice }) => {
      if (!notice) return true;
      if (notice.seen_at) return false;
      return !(notice.snooze_until && notice.snooze_until > nowIso);
    })
    // Most overdue first: the oldest broken promise is the one to answer.
    .sort((a, b) => a.at - b.at)
    .slice(0, Math.max(1, Number(limit) || 5))
    .map(({ task, at }) => ({
      id: task.id,
      title: task.title,
      due_at: at.toISOString(),
      due_key: keyOf(at),
      chat_name: task.chat_name,
      group_name: task.group_name,
      priority: task.priority,
      follow_up_count: task.follow_up_count,
    }));
}

/** How many are waiting, for a badge that does not need the whole list. */
export const dueNowCount = (opts = {}) => dueNow({ ...opts, limit: 500 }).length;

/**
 * What was done with a notice: closed, or put off for a while.
 *
 * "Later" does not touch the task - the deadline stands and the reminder
 * ladder is untouched. It only quiets this popup, because being asked again in
 * five minutes is how a popup teaches you to dismiss it without reading it.
 */
export function setTaskNotice(taskId, dueKey, action, minutes = 60) {
  const task = getTask(taskId);
  if (!task) return null;

  const now = new Date();
  const snoozeUntil = action === 'later'
    ? new Date(now.getTime() + Math.max(1, Number(minutes) || 60) * 60_000).toISOString()
    : null;

  db.prepare(
    `INSERT INTO task_notices (task_id, due_key, seen_at, snooze_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(task_id, due_key) DO UPDATE
       SET seen_at = excluded.seen_at,
           snooze_until = excluded.snooze_until,
           updated_at = datetime('now')`
  ).run(taskId, String(dueKey), action === 'later' ? null : now.toISOString(), snoozeUntil);

  return noticeFor(taskId, String(dueKey));
}
