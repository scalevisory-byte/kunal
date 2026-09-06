import { db } from './db.js';

/**
 * A task's lifecycle, recorded as it happens. The task row holds the current
 * state; this holds how it got there - and nothing here is ever rewritten, so
 * a deadline that moved twice shows both moves rather than only the last one.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS task_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at       TEXT NOT NULL DEFAULT (datetime('now')),
    kind     TEXT NOT NULL,
    detail   TEXT,
    meta     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, at);
  CREATE INDEX IF NOT EXISTS idx_events_kind ON task_events(kind, at);
`);

const insert = db.prepare(
  `INSERT INTO task_events (task_id, kind, detail, meta) VALUES (?, ?, ?, ?)`
);

/** Every lifecycle moment worth being able to look back at. */
export const EVENT = {
  created: 'created',
  edited: 'edited',
  deadlineSet: 'deadline set',
  deadlineChanged: 'deadline changed',
  reminderCreated: 'reminder created',
  reminderTriggered: 'reminder triggered',
  reminderSnoozed: 'reminder snoozed',
  reminderCancelled: 'reminder cancelled',
  followUpScheduled: 'follow-up scheduled',
  followUpTriggered: 'follow-up triggered',
  needsAttention: 'needs attention',
  statusChanged: 'status changed',
  completed: 'completed',
  reopened: 'reopened',
  archived: 'archived',
  noteAdded: 'note added',
};

export function recordEvent(taskId, kind, detail = null, meta = null) {
  if (!taskId || !kind) return null;
  insert.run(taskId, kind, detail ? String(detail).slice(0, 300) : null, meta ? JSON.stringify(meta) : null);
  return true;
}

export const eventsForTask = (taskId) =>
  db
    .prepare(`SELECT * FROM task_events WHERE task_id = ? ORDER BY at ASC, id ASC`)
    .all(taskId)
    .map((row) => ({ ...row, meta: row.meta ? JSON.parse(row.meta) : null }));

/** The most recent events across all tasks, for the dashboard's activity list. */
export const recentEvents = (limit = 12) =>
  db
    .prepare(
      `SELECT e.*, t.title AS task_title
       FROM task_events e JOIN tasks t ON t.id = e.task_id
       ORDER BY e.at DESC, e.id DESC LIMIT ?`
    )
    .all(Math.min(Number(limit) || 12, 100));

/** How many reminders and follow-ups a task actually received. */
export const eventCounts = (taskId) =>
  db
    .prepare(
      `SELECT
         COALESCE(SUM(kind = 'reminder triggered'), 0)  AS reminders,
         COALESCE(SUM(kind = 'follow-up triggered'), 0) AS follow_ups,
         COALESCE(SUM(kind = 'reminder snoozed'), 0)    AS snoozes,
         COALESCE(SUM(kind = 'deadline changed'), 0)    AS reschedules
       FROM task_events WHERE task_id = ?`
    )
    .get(taskId);
