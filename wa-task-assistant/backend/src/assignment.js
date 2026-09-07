import { db } from './db.js';
import { config } from './config.js';

/**
 * Work given to somebody else.
 *
 * A delegated task is an ordinary task with `assigned_to` set - the same row,
 * the same lifecycle, the same reminder ladder. NULL means the user, which is
 * what every existing row already says, so nothing had to be back-filled and no
 * existing query changed meaning.
 *
 * The rule that shapes everything here: **the app never messages anybody but
 * the user on its own.** A follow-up for a delegated task notifies the user,
 * who can then choose to send a nudge. Nothing reaches the assignee without an
 * explicit press.
 */

export const isDelegated = (task) => Boolean(task?.assigned_to);
export const wasRequested = (task) => Boolean(task?.requested_by);

/*
 * Three kinds of task, told apart by two columns rather than by guesswork:
 *
 *   allotted  - he gave it to somebody. `assigned_to` names them.
 *   received  - somebody asked him for it. `requested_by` names them.
 *   own       - neither; a note he made himself.
 *
 * A task can be both: a request that came in and was then passed on. It shows
 * in both lists, which is correct - he is answerable for it and somebody else
 * is doing it.
 */
export function directionOf(task) {
  if (task?.assigned_to) return 'allotted';
  if (task?.requested_by) return 'received';
  return 'own';
}

/** Everyone the user has given work to, with what is still outstanding. */
export function delegates() {
  return db
    .prepare(
      `SELECT assigned_to AS name,
              MAX(assigned_to_wid) AS wid,
              SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open,
              COUNT(*) AS total,
              MAX(assigned_at) AS last_at
       FROM tasks
       WHERE assigned_to IS NOT NULL AND archived_at IS NULL
       GROUP BY assigned_to
       ORDER BY open DESC, assigned_to`
    )
    .all();
}

/** Everyone who has given the user work, with what is still outstanding. */
export function requesters() {
  return db
    .prepare(
      `SELECT requested_by AS name,
              MAX(requested_by_wid) AS wid,
              SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open,
              COUNT(*) AS total,
              MAX(created_at) AS last_at
       FROM tasks
       WHERE requested_by IS NOT NULL AND archived_at IS NULL
       GROUP BY requested_by
       ORDER BY open DESC, requested_by`
    )
    .all();
}

/**
 * The two counts the sidebar shows. Open only: a delegation everybody has
 * finished with is history, not something to badge.
 */
export function delegationCounts() {
  const one = (column) =>
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
         WHERE ${column} IS NOT NULL AND status != 'done' AND archived_at IS NULL`
      )
      .get().n;
  return { allotted: one('assigned_to'), received: one('requested_by') };
}

/**
 * Assign or unassign. Passing nothing for `name` gives the task back to the
 * user, which is the same thing as never having delegated it.
 */
export function assignTask(taskId, name, wid = null) {
  const clean = String(name ?? '').trim().slice(0, 80);
  if (!clean) {
    db.prepare(
      `UPDATE tasks SET assigned_to = NULL, assigned_to_wid = NULL, assigned_at = NULL,
                        updated_at = datetime('now')
       WHERE id = ?`
    ).run(taskId);
    return null;
  }
  db.prepare(
    `UPDATE tasks SET assigned_to = ?, assigned_to_wid = ?, assigned_at = datetime('now'),
                      updated_at = datetime('now')
     WHERE id = ?`
  ).run(clean, wid || null, taskId);
  return clean;
}

/**
 * The open task most likely to be the one an assignee's reply is about.
 *
 * Deliberately narrow: only tasks assigned to that person, and only when there
 * is exactly one still open. Two candidates means no answer - marking the wrong
 * person's work done is worse than asking.
 */
export function openTaskFor(name) {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE assigned_to IS NOT NULL AND LOWER(assigned_to) = LOWER(?)
         AND status != 'done' AND archived_at IS NULL
       ORDER BY id DESC`
    )
    .all(String(name || '').trim());
  return rows.length === 1 ? rows[0] : null;
}

/** Every task given to one person, newest first. */
export const tasksFor = (name) =>
  db
    .prepare(
      `SELECT * FROM tasks
       WHERE assigned_to IS NOT NULL AND LOWER(assigned_to) = LOWER(?) AND archived_at IS NULL
       ORDER BY id DESC`
    )
    .all(String(name || '').trim());

/**
 * The message a nudge would say, built but never sent from here.
 *
 * Composed in one place so the text the user is shown before sending is exactly
 * the text that goes out - a preview that differs from the message is a lie.
 */
export function followUpText(task) {
  const who = task.assigned_to || 'there';
  const lines = [`${who}, a quick update on *${task.title}* please.`];

  const iso = task.due_at || task.due_date;
  if (iso) {
    const at = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (!Number.isNaN(at.getTime())) {
      const when = new Intl.DateTimeFormat('en-IN', {
        timeZone: config.timezone,
        day: 'numeric',
        month: 'short',
        ...(task.due_at ? { hour: 'numeric', minute: '2-digit' } : {}),
      }).format(at);
      // Past or future, said correctly. "It was due next Thursday" reads as a
      // reproach for something that has not happened yet.
      lines.push('', at.getTime() < Date.now() ? `_It was due ${when}._` : `_It is due ${when}._`);
    }
  }
  return lines.join('\n');
}
