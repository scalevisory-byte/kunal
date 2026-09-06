import { db } from './db.js';
import { log } from './logger.js';

/* ---------------- schema ---------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS follow_ups (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    reason         TEXT,
    task_id        INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    message_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    chat_id        TEXT,
    chat_name      TEXT,
    contact        TEXT,
    due_at         TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'waiting',
    origin         TEXT NOT NULL DEFAULT 'manual',
    interval_days  INTEGER,
    max_follow_ups INTEGER,
    follow_up_count INTEGER NOT NULL DEFAULT 0,
    responded_at   TEXT,
    last_activity_at TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS follow_up_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    follow_up_id  INTEGER NOT NULL REFERENCES follow_ups(id) ON DELETE CASCADE,
    at            TEXT NOT NULL DEFAULT (datetime('now')),
    kind          TEXT NOT NULL,
    detail        TEXT
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id        INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    follow_up_id   INTEGER REFERENCES follow_ups(id) ON DELETE CASCADE,
    fire_at        TEXT NOT NULL,
    offset_minutes INTEGER,
    status         TEXT NOT NULL DEFAULT 'scheduled',
    triggered_at   TEXT,
    acknowledged_at TEXT,
    snooze_count   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL DEFAULT (datetime('now')),
    kind          TEXT NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT,
    task_id       INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    follow_up_id  INTEGER REFERENCES follow_ups(id) ON DELETE CASCADE,
    reminder_id   INTEGER REFERENCES reminders(id) ON DELETE SET NULL,
    read_at       TEXT,
    dismissed_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_rem_due    ON reminders(status, fire_at);
  CREATE INDEX IF NOT EXISTS idx_rem_task   ON reminders(task_id);
  CREATE INDEX IF NOT EXISTS idx_rem_fu     ON reminders(follow_up_id);
  CREATE INDEX IF NOT EXISTS idx_fu_status  ON follow_ups(status, due_at);
  CREATE INDEX IF NOT EXISTS idx_fu_chat    ON follow_ups(chat_id);
  CREATE INDEX IF NOT EXISTS idx_fu_task    ON follow_ups(task_id);
  CREATE INDEX IF NOT EXISTS idx_fue_fu     ON follow_up_events(follow_up_id, at);
  CREATE INDEX IF NOT EXISTS idx_notif_at   ON notifications(at DESC);

  -- Two reminders for the same thing at the same moment are the same reminder.
  -- Enforced by the database so no code path can produce a duplicate.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rem_unique
    ON reminders(COALESCE(task_id, 0), COALESCE(follow_up_id, 0), fire_at)
    WHERE status IN ('scheduled', 'snoozed');
`);

const ACTIVE = `status IN ('scheduled', 'snoozed')`;

/* ---------------- settings ---------------- */

const DEFAULTS = {
  defaultReminderOffset: 60,      // minutes before the due time
  businessHoursEnabled: false,
  businessStart: '09:00',
  businessEnd: '19:00',
  skipWeekends: false,
  missedAfterHours: 24,           // older than this is missed, not fired late
  followUpIntervalDays: 3,
  followUpMax: 3,
  escalation: true,
  notifyInApp: true,
  notifyBrowser: true,
  notifyWhatsApp: false,          // outbound messages stay off unless asked for
};

export function getSettings() {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'scheduling_settings'`).get();
  if (!row) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings() };
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in DEFAULTS) next[key] = value;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('scheduling_settings', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(next));
  return next;
}

/* ---------------- reminder scheduling ---------------- */

const MIN = 60_000;

const parseHm = (hm) => {
  const [h, m] = String(hm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? { h, m } : null;
};

/**
 * Moves a firing time into the working window, if the user asked for that.
 * Times are compared in the configured timezone, not the server's.
 */
export function applyQuietHours(date, settings, timezone) {
  if (!settings.businessHoursEnabled && !settings.skipWeekends) return date;

  const start = parseHm(settings.businessStart) || { h: 9, m: 0 };
  const end = parseHm(settings.businessEnd) || { h: 19, m: 0 };
  let at = new Date(date);

  // Guard against a pathological config sending this into an endless walk.
  for (let step = 0; step < 14; step += 1) {
    const local = localParts(at, timezone);

    if (settings.skipWeekends && (local.weekday === 6 || local.weekday === 0)) {
      at = setLocalTime(at, timezone, start.h, start.m);
      at = new Date(at.getTime() + 24 * 60 * MIN);
      continue;
    }

    if (settings.businessHoursEnabled) {
      const minutes = local.hour * 60 + local.minute;
      if (minutes < start.h * 60 + start.m) {
        at = setLocalTime(at, timezone, start.h, start.m);
        continue;
      }
      if (minutes > end.h * 60 + end.m) {
        at = setLocalTime(at, timezone, start.h, start.m);
        at = new Date(at.getTime() + 24 * 60 * MIN);
        continue;
      }
    }
    return at;
  }
  return at;
}

/** Hour, minute and weekday of an instant, read in the given timezone. */
export function localParts(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday] ?? 1,
  };
}

/** The same calendar day as `date`, at the given local wall-clock time. */
function setLocalTime(date, timezone, hour, minute) {
  const current = localParts(date, timezone);
  const delta = (hour * 60 + minute) - (current.hour * 60 + current.minute);
  return new Date(date.getTime() + delta * MIN);
}

/**
 * Schedules one reminder. The unique index makes a repeat call for the same
 * moment a no-op rather than a second alarm, so callers can be careless.
 */
export function scheduleReminder({ taskId = null, followUpId = null, fireAt, offsetMinutes = null }) {
  if (!fireAt) throw new Error('fireAt is required');
  if (!taskId && !followUpId) throw new Error('a reminder needs a task or a follow-up');

  const at = new Date(fireAt);
  if (Number.isNaN(at.getTime())) throw new Error('fireAt is not a date');

  const info = db
    .prepare(
      `INSERT OR IGNORE INTO reminders (task_id, follow_up_id, fire_at, offset_minutes)
       VALUES (?, ?, ?, ?)`
    )
    .run(taskId, followUpId, at.toISOString(), offsetMinutes);

  if (!info.changes) {
    return db
      .prepare(
        `SELECT * FROM reminders
         WHERE COALESCE(task_id, 0) = COALESCE(?, 0)
           AND COALESCE(follow_up_id, 0) = COALESCE(?, 0)
           AND fire_at = ? AND ${ACTIVE}`
      )
      .get(taskId, followUpId, at.toISOString());
  }
  return getReminder(info.lastInsertRowid);
}

export const getReminder = (id) =>
  db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) || null;

export const remindersForTask = (taskId) =>
  db.prepare(`SELECT * FROM reminders WHERE task_id = ? ORDER BY fire_at ASC`).all(taskId);

export const remindersForFollowUp = (followUpId) =>
  db.prepare(`SELECT * FROM reminders WHERE follow_up_id = ? ORDER BY fire_at ASC`).all(followUpId);

/** Reminders whose moment has passed and that nothing has claimed yet. */
export const dueReminders = (nowIso) =>
  db
    .prepare(`SELECT * FROM reminders WHERE ${ACTIVE} AND fire_at <= ? ORDER BY fire_at ASC`)
    .all(nowIso);

/**
 * Claims a reminder for delivery. The conditional UPDATE is the whole
 * duplicate-protection story: exactly one caller can move a row out of the
 * active states, so a second scheduler tick, a restart mid-send, or a retry
 * finds nothing left to claim and does nothing.
 */
export function claimReminder(id) {
  const info = db
    .prepare(
      `UPDATE reminders
       SET status = 'triggered', triggered_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND ${ACTIVE}`
    )
    .run(id);
  return info.changes === 1 ? getReminder(id) : null;
}

/** Too old to be worth firing late; the user reschedules it instead. */
export function markMissed(id) {
  db.prepare(
    `UPDATE reminders SET status = 'missed', updated_at = datetime('now')
     WHERE id = ? AND ${ACTIVE}`
  ).run(id);
  return getReminder(id);
}

export function acknowledgeReminder(id) {
  db.prepare(
    `UPDATE reminders
     SET status = 'acknowledged', acknowledged_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  ).run(id);
  return getReminder(id);
}

/**
 * Snooze moves the existing row rather than adding another one, so the count of
 * reminders on a task never grows just because it was put off.
 */
export function snoozeReminder(id, minutes) {
  const reminder = getReminder(id);
  if (!reminder) return null;
  const fireAt = new Date(Date.now() + Number(minutes) * MIN).toISOString();
  db.prepare(
    `UPDATE reminders
     SET fire_at = ?, status = 'snoozed', snooze_count = snooze_count + 1,
         triggered_at = NULL, updated_at = datetime('now')
     WHERE id = ?`
  ).run(fireAt, id);
  return getReminder(id);
}

export function rescheduleReminder(id, fireAt) {
  const at = new Date(fireAt);
  if (Number.isNaN(at.getTime())) throw new Error('fireAt is not a date');
  db.prepare(
    `UPDATE reminders
     SET fire_at = ?, status = 'scheduled', triggered_at = NULL, updated_at = datetime('now')
     WHERE id = ?`
  ).run(at.toISOString(), id);
  return getReminder(id);
}

export function cancelReminder(id) {
  db.prepare(
    `UPDATE reminders SET status = 'cancelled', updated_at = datetime('now')
     WHERE id = ? AND ${ACTIVE}`
  ).run(id);
  return getReminder(id);
}

export function deleteReminder(id) {
  return db.prepare(`DELETE FROM reminders WHERE id = ?`).run(id).changes > 0;
}

/** A finished task has nothing left to be reminded about. */
export function cancelRemindersForTask(taskId) {
  const info = db
    .prepare(
      `UPDATE reminders SET status = 'cancelled', updated_at = datetime('now')
       WHERE task_id = ? AND ${ACTIVE}`
    )
    .run(taskId);
  return info.changes;
}

export function cancelRemindersForFollowUp(followUpId) {
  const info = db
    .prepare(
      `UPDATE reminders SET status = 'cancelled', updated_at = datetime('now')
       WHERE follow_up_id = ? AND ${ACTIVE}`
    )
    .run(followUpId);
  return info.changes;
}

/** The next moment a task will be reminded about, for display on the task. */
export const nextReminderFor = (taskId) =>
  db
    .prepare(`SELECT fire_at FROM reminders WHERE task_id = ? AND ${ACTIVE} ORDER BY fire_at ASC LIMIT 1`)
    .get(taskId)?.fire_at ?? null;

log.info('Scheduling tables ready (reminders, follow-ups, notifications).');

/* ---------------- follow-ups ---------------- */

const FU_STATUSES = new Set([
  'waiting', 'due', 'overdue', 'snoozed', 'completed', 'cancelled', 'needs_attention',
]);
const FU_OPEN = `status IN ('waiting', 'due', 'overdue', 'snoozed', 'needs_attention')`;

const withEvents = (row) =>
  row ? { ...row, events: followUpEvents(row.id), reminders: remindersForFollowUp(row.id) } : null;

export const getFollowUp = (id) =>
  withEvents(db.prepare(`SELECT * FROM follow_ups WHERE id = ?`).get(id) || null);

export function logFollowUpEvent(followUpId, kind, detail = null) {
  db.prepare(`INSERT INTO follow_up_events (follow_up_id, kind, detail) VALUES (?, ?, ?)`)
    .run(followUpId, kind, detail);
}

export const followUpEvents = (followUpId) =>
  db
    .prepare(`SELECT * FROM follow_up_events WHERE follow_up_id = ? ORDER BY at ASC, id ASC`)
    .all(followUpId);

export function createFollowUp(input) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title is required');
  const dueAt = new Date(input.due_at);
  if (Number.isNaN(dueAt.getTime())) throw new Error('due_at is not a date');

  const info = db
    .prepare(
      `INSERT INTO follow_ups
        (title, reason, task_id, message_id, chat_id, chat_name, contact, due_at,
         status, origin, interval_days, max_follow_ups)
       VALUES (@title, @reason, @task_id, @message_id, @chat_id, @chat_name, @contact, @due_at,
               @status, @origin, @interval_days, @max_follow_ups)`
    )
    .run({
      title,
      reason: input.reason || null,
      task_id: input.task_id ?? null,
      message_id: input.message_id ?? null,
      chat_id: input.chat_id ?? null,
      chat_name: input.chat_name ?? null,
      contact: input.contact ?? null,
      due_at: dueAt.toISOString(),
      status: FU_STATUSES.has(input.status) ? input.status : 'waiting',
      origin: input.origin === 'ai' ? 'ai' : 'manual',
      interval_days: input.interval_days ?? null,
      max_follow_ups: input.max_follow_ups ?? null,
    });

  logFollowUpEvent(info.lastInsertRowid, 'created', input.reason || null);
  return getFollowUp(info.lastInsertRowid);
}

const FU_UPDATABLE = [
  'title', 'reason', 'chat_id', 'chat_name', 'contact', 'due_at',
  'status', 'interval_days', 'max_follow_ups',
];

export function updateFollowUp(id, patch) {
  const current = db.prepare(`SELECT * FROM follow_ups WHERE id = ?`).get(id);
  if (!current) return null;

  const fields = [];
  const values = [];
  for (const key of FU_UPDATABLE) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'status' && !FU_STATUSES.has(value)) continue;
    if (key === 'due_at' && value) {
      const at = new Date(value);
      if (Number.isNaN(at.getTime())) continue;
      value = at.toISOString();
    }
    if (value === '') value = null;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (!fields.length) return getFollowUp(id);

  fields.push(`updated_at = datetime('now')`);
  if (patch.status === 'completed' && current.status !== 'completed') {
    fields.push(`completed_at = datetime('now')`);
  }
  if (patch.status && patch.status !== 'completed' && current.completed_at) {
    fields.push(`completed_at = NULL`);
  }

  db.prepare(`UPDATE follow_ups SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);

  // A closed follow-up has nothing left to chase.
  if (patch.status === 'completed' || patch.status === 'cancelled') {
    cancelRemindersForFollowUp(id);
    logFollowUpEvent(id, patch.status);
  } else if (patch.status && patch.status !== current.status) {
    logFollowUpEvent(id, `status: ${patch.status}`);
  }
  if (patch.due_at && patch.due_at !== current.due_at) {
    logFollowUpEvent(id, 'rescheduled', new Date(patch.due_at).toISOString());
  }
  return getFollowUp(id);
}

export function deleteFollowUp(id) {
  return db.prepare(`DELETE FROM follow_ups WHERE id = ?`).run(id).changes > 0;
}

export function listFollowUps({ status, limit = 300 } = {}) {
  const capped = Math.min(Number(limit) || 300, 1000);
  let where = '';
  const params = [];
  if (status === 'open') where = `WHERE ${FU_OPEN}`;
  else if (FU_STATUSES.has(status)) {
    where = 'WHERE status = ?';
    params.push(status);
  }
  params.push(capped);
  return db
    .prepare(
      `SELECT * FROM follow_ups ${where}
       ORDER BY CASE status
                  WHEN 'overdue' THEN 0 WHEN 'needs_attention' THEN 1
                  WHEN 'due' THEN 2 WHEN 'waiting' THEN 3
                  WHEN 'snoozed' THEN 4 ELSE 5 END,
                due_at ASC
       LIMIT ?`
    )
    .all(...params)
    // History travels with the row: a follow-up without its record of what has
    // already been tried is not much use for chasing anybody.
    .map((row) => ({
      ...row,
      reminders: remindersForFollowUp(row.id),
      events: followUpEvents(row.id),
    }));
}

/**
 * Moves waiting follow-ups to due, and due ones to overdue once their day has
 * passed. Status is derived here rather than computed in the UI so the engine
 * and the dashboard always agree.
 */
export function refreshFollowUpStatuses(nowIso = new Date().toISOString()) {
  const dayAgo = new Date(Date.parse(nowIso) - 86400000).toISOString();
  const toDue = db
    .prepare(`UPDATE follow_ups SET status = 'due', updated_at = datetime('now')
              WHERE status IN ('waiting', 'snoozed') AND due_at <= ?`)
    .run(nowIso).changes;
  const toOverdue = db
    .prepare(`UPDATE follow_ups SET status = 'overdue', updated_at = datetime('now')
              WHERE status = 'due' AND due_at <= ?`)
    .run(dayAgo).changes;
  return { toDue, toOverdue };
}

/**
 * Records that the other side said something. It deliberately does NOT close
 * the follow-up: only the user knows whether the reply actually answered it.
 * Further chasing stops until they decide.
 */
export function recordReply(chatId, detail) {
  if (!chatId) return 0;
  const open = db
    .prepare(`SELECT id FROM follow_ups WHERE chat_id = ? AND ${FU_OPEN} AND responded_at IS NULL`)
    .all(chatId);
  for (const row of open) {
    db.prepare(
      `UPDATE follow_ups
       SET responded_at = datetime('now'), last_activity_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(row.id);
    logFollowUpEvent(row.id, 'reply received', detail ? String(detail).slice(0, 160) : null);
    cancelRemindersForFollowUp(row.id);
  }
  return open.length;
}

/**
 * After a follow-up's moment passes, either schedule the next one in the chain
 * or stop and flag it. Returns what it decided, for the caller to log.
 */
export function advanceFollowUp(followUp, settings) {
  const max = followUp.max_follow_ups ?? settings.followUpMax;
  const interval = followUp.interval_days ?? null;
  const count = followUp.follow_up_count + 1;

  db.prepare(`UPDATE follow_ups SET follow_up_count = ?, last_activity_at = datetime('now'),
              updated_at = datetime('now') WHERE id = ?`).run(count, followUp.id);

  if (!interval) return { repeated: false, reason: 'not recurring' };
  if (settings.escalation && max && count >= max) {
    db.prepare(`UPDATE follow_ups SET status = 'needs_attention', updated_at = datetime('now')
                WHERE id = ?`).run(followUp.id);
    logFollowUpEvent(followUp.id, 'needs attention', `${count} follow-ups with no reply`);
    return { repeated: false, reason: 'maximum reached' };
  }

  const next = new Date(Date.now() + interval * 86400000).toISOString();
  db.prepare(`UPDATE follow_ups SET due_at = ?, status = 'waiting', updated_at = datetime('now')
              WHERE id = ?`).run(next, followUp.id);
  logFollowUpEvent(followUp.id, 'next follow-up scheduled', next);
  return { repeated: true, nextAt: next };
}

export function followUpStats() {
  return db
    .prepare(
      `SELECT
         COALESCE(SUM(status = 'due'), 0)             AS due,
         COALESCE(SUM(status = 'overdue'), 0)         AS overdue,
         COALESCE(SUM(status = 'waiting'), 0)         AS waiting,
         COALESCE(SUM(status = 'needs_attention'), 0) AS needs_attention,
         COALESCE(SUM(status = 'completed'), 0)       AS completed,
         COUNT(*)                                     AS total
       FROM follow_ups`
    )
    .get();
}

/* ---------------- notifications ---------------- */

export function addNotification(row) {
  const info = db
    .prepare(
      `INSERT INTO notifications (kind, title, body, task_id, follow_up_id, reminder_id)
       VALUES (@kind, @title, @body, @task_id, @follow_up_id, @reminder_id)`
    )
    .run({
      kind: row.kind || 'reminder',
      title: String(row.title || '').slice(0, 200),
      body: row.body ? String(row.body).slice(0, 500) : null,
      task_id: row.task_id ?? null,
      follow_up_id: row.follow_up_id ?? null,
      reminder_id: row.reminder_id ?? null,
    });
  return db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(info.lastInsertRowid);
}

export const listNotifications = ({ limit = 40 } = {}) =>
  db
    .prepare(
      `SELECT * FROM notifications WHERE dismissed_at IS NULL
       ORDER BY at DESC, id DESC LIMIT ?`
    )
    .all(Math.min(Number(limit) || 40, 200));

export const unreadNotificationCount = () =>
  db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL`)
    .get().n;

export const markNotificationRead = (id) =>
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL`)
    .run(id).changes > 0;

export const markAllNotificationsRead = () =>
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL`).run().changes;

export const dismissNotification = (id) =>
  db.prepare(`UPDATE notifications SET dismissed_at = datetime('now') WHERE id = ?`).run(id).changes > 0;
