import { db } from './db.js';
import { log } from './logger.js';
import { config } from './config.js';
import {
  scheduleReminder, cancelRemindersForTask, nextReminderFor, getSettings, applyQuietHours,
} from './scheduling.js';

/**
 * `tasks.remind_at` predates the reminders table and is still what the
 * extractor, quickparse and the older API write. It stays as the task's *next*
 * reminder - a denormalised convenience for display and for the digest - while
 * the reminders table is what the engine actually reads. These helpers keep the
 * two in step so there is never a second source of truth about when to fire.
 */

/** Copies any pending `remind_at` into the reminders table, once. */
export function migrateLegacyReminders() {
  const already = db.prepare(`SELECT value FROM meta WHERE key = 'reminders_migrated'`).get();
  if (already) return 0;

  const rows = db
    .prepare(
      `SELECT id, remind_at FROM tasks
       WHERE remind_at IS NOT NULL AND remind_at_sent = 0 AND status != 'done'`
    )
    .all();

  let moved = 0;
  for (const row of rows) {
    try {
      scheduleReminder({ taskId: row.id, fireAt: row.remind_at });
      moved += 1;
    } catch (err) {
      log.warn(`Could not migrate reminder for task ${row.id}:`, err?.message || err);
    }
  }

  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('reminders_migrated', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(new Date().toISOString());

  if (moved) log.info(`Migrated ${moved} existing task reminder(s) into the reminders table.`);
  return moved;
}

/** Writes the task's next pending reminder back onto the task row. */
export function syncTaskRemindAt(taskId) {
  const next = nextReminderFor(taskId);
  db.prepare(
    `UPDATE tasks SET remind_at = ?, remind_at_sent = 0, updated_at = datetime('now') WHERE id = ?`
  ).run(next, taskId);
  return next;
}

/**
 * Adds a reminder to a task, shifted out of quiet hours if the user asked for
 * that. Repeat calls for the same moment are a no-op, not a second alarm.
 */
export function addTaskReminder(taskId, fireAt, offsetMinutes = null) {
  const settings = getSettings();
  const at = applyQuietHours(new Date(fireAt), settings, config.timezone);
  const reminder = scheduleReminder({ taskId, fireAt: at.toISOString(), offsetMinutes });
  syncTaskRemindAt(taskId);
  return reminder;
}

/** A reminder expressed against the task's own due time. */
export function addTaskReminderOffset(task, offsetMinutes) {
  const base = task.remind_at
    ? new Date(task.remind_at)
    : task.due_date
      ? new Date(`${task.due_date}T09:00:00`)
      : null;
  if (!base) return null;
  return addTaskReminder(task.id, new Date(base.getTime() - offsetMinutes * 60000), offsetMinutes);
}

/** Called when a task is completed or deleted: nothing left to be reminded of. */
export function clearTaskReminders(taskId) {
  const cancelled = cancelRemindersForTask(taskId);
  syncTaskRemindAt(taskId);
  return cancelled;
}
