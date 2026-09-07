import { db, ensureColumns, NOT_SET_ASIDE_BARE } from './db.js';
import { log } from './logger.js';

/**
 * Reminders about the user's own tasks, and the follow-up ladder that keeps
 * asking while a task is past its deadline and still not done. There is no
 * concept here of chasing anybody else - a follow-up is the app chasing the
 * user about their own work.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL DEFAULT 'pre_due',
    round          INTEGER NOT NULL DEFAULT 0,
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
    reminder_id   INTEGER REFERENCES reminders(id) ON DELETE SET NULL,
    read_at       TEXT,
    dismissed_at  TEXT
  );

  -- One briefing per day. The unique day is the claim: a restart, a retry or a
  -- second worker finds the row already there and sends nothing.
  CREATE TABLE IF NOT EXISTS briefings (
    day        TEXT PRIMARY KEY,
    claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at    TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    task_count INTEGER,
    error      TEXT
  );
`);

/*
 * An earlier design hung reminders off follow-up records rather than tasks, so
 * a database from that version has a `reminders` table with no `kind` and no
 * `round`. The CREATE above leaves such a table exactly as it found it, and the
 * index below then fails on a column that is not there - which is precisely how
 * the deployed service came to refuse to start. Add what is missing first.
 */
const addedToReminders = ensureColumns('reminders', [
  ['kind', "ALTER TABLE reminders ADD COLUMN kind TEXT NOT NULL DEFAULT 'pre_due'"],
  ['round', 'ALTER TABLE reminders ADD COLUMN round INTEGER NOT NULL DEFAULT 0'],
]);

ensureColumns('notifications', [
  ['task_id', 'ALTER TABLE notifications ADD COLUMN task_id INTEGER'],
  ['reminder_id', 'ALTER TABLE notifications ADD COLUMN reminder_id INTEGER'],
  ['read_at', 'ALTER TABLE notifications ADD COLUMN read_at TEXT'],
  ['dismissed_at', 'ALTER TABLE notifications ADD COLUMN dismissed_at TEXT'],
]);

if (addedToReminders.includes('kind')) {
  // Those rows were scheduled by the removed follow-up engine, against records
  // this app no longer has. Giving them a default kind would make them look
  // like rungs of a ladder nobody built. Reminders are derived state - the
  // engine rebuilds them from each task's deadline on its next pass - so
  // clearing them is a rebuild, not a loss. Tasks and history are untouched.
  const cleared = db.prepare(`DELETE FROM reminders`).run().changes;
  if (cleared) log.warn(`Cleared ${cleared} reminder(s) from the previous design; they will be rescheduled.`);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_rem_due   ON reminders(status, fire_at);
  CREATE INDEX IF NOT EXISTS idx_rem_task  ON reminders(task_id, status);
  CREATE INDEX IF NOT EXISTS idx_notif_at  ON notifications(at DESC);

  -- Two reminders of the same kind and round for one task are the same
  -- reminder. The database refuses the second, so no code path - a retry, a
  -- restart, a repeated message - can produce a duplicate.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rem_once
    ON reminders(task_id, kind, round)
    WHERE status IN ('scheduled', 'snoozed', 'triggered', 'acknowledged');
`);

const ACTIVE = `status IN ('scheduled', 'snoozed')`;

/* ---------------- settings ---------------- */

const DEFAULTS = {
  // Before the deadline.
  defaultReminderOffset: 60,        // minutes before due_at; null disables it
  remindAtDue: true,                // one notification at the deadline itself
  // After the deadline, while the task is still not done.
  followUpEnabled: true,
  followUpOffsets: [30, 120, 960],  // minutes after due_at, one per round
  followUpMax: 3,
  // Housekeeping.
  defaultDueTime: '18:00',          // used when a task has a date but no time
  missedAfterHours: 24,
  businessHoursEnabled: false,
  businessStart: '09:00',
  businessEnd: '19:00',
  skipWeekends: false,
  notifyBrowser: true,
  // Every WhatsApp message this app sends goes to the linked account's own
  // chat. There is no path that messages a contact, and these switches only
  // decide whether the user hears from themselves.
  notifyWhatsApp: false,            // per-reminder messages before the deadline
  whatsappFollowUps: false,         // per-reminder messages after it
  dailyBriefing: false,             // one morning message listing the day
  briefingTime: '09:00',            // in the configured timezone
  // One review of the week just finished. Sunday evening by default: the week
  // is over, and it is when there is time to read it.
  weeklySummary: false,
  weeklyDay: 0,                     // 0 = Sunday, matching localParts()
  weeklyTime: '20:00',
  // Claude reads photos as well as text. Off by default: a picture costs
  // roughly a page of tokens, and most photos in a personal chat are forwards.
  readImages: false,            // in the configured timezone
};

export function getSettings() {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'scheduling_settings'`).get();
  if (!row) return { ...DEFAULTS };
  try {
    const saved = JSON.parse(row.value);
    return {
      ...DEFAULTS,
      ...saved,
      followUpOffsets: Array.isArray(saved.followUpOffsets) && saved.followUpOffsets.length
        ? saved.followUpOffsets.map(Number).filter(Number.isFinite)
        : DEFAULTS.followUpOffsets,
    };
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

/* ---------------- quiet hours ---------------- */

const MIN = 60_000;

const parseHm = (hm) => {
  const [h, m] = String(hm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? { h, m } : null;
};

/** Hour, minute and weekday of an instant, read in the given timezone. */
export function localParts(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday] ?? 1,
  };
}

function setLocalTime(date, timezone, hour, minute) {
  const current = localParts(date, timezone);
  const delta = (hour * 60 + minute) - (current.hour * 60 + current.minute);
  return new Date(date.getTime() + delta * MIN);
}

/** Moves a firing time into the working window, when that is switched on. */
export function applyQuietHours(date, settings, timezone) {
  if (!settings.businessHoursEnabled && !settings.skipWeekends) return date;

  const start = parseHm(settings.businessStart) || { h: 9, m: 0 };
  const end = parseHm(settings.businessEnd) || { h: 19, m: 0 };
  let at = new Date(date);

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

/* ---------------- reminders ---------------- */

export const getReminder = (id) =>
  db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) || null;

export const remindersForTask = (taskId) =>
  db.prepare(`SELECT * FROM reminders WHERE task_id = ? ORDER BY fire_at ASC`).all(taskId);

export const activeRemindersForTask = (taskId) =>
  db.prepare(`SELECT * FROM reminders WHERE task_id = ? AND ${ACTIVE} ORDER BY fire_at ASC`).all(taskId);

/**
 * The next scheduled reminder and follow-up for many tasks, in one query.
 *
 * The task list used to call remindersForTask() per row - three hundred tasks
 * meant three hundred queries and a quarter of a megabyte of reminder rows the
 * list never reads, on a poll that runs every thirty seconds.
 */
export function nextRemindersFor(taskIds) {
  const out = new Map();
  if (!taskIds.length) return out;
  const marks = taskIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT task_id, kind, fire_at FROM reminders
       WHERE task_id IN (${marks}) AND ${ACTIVE}
       ORDER BY fire_at ASC`
    )
    .all(...taskIds);

  for (const row of rows) {
    const entry = out.get(row.task_id) || { next: null, followUp: null };
    if (!entry.next) entry.next = row.fire_at;
    if (!entry.followUp && row.kind === 'follow_up') entry.followUp = row.fire_at;
    out.set(row.task_id, entry);
  }
  return out;
}

/**
 * Schedules one reminder for a task. `kind` and `round` together identify it,
 * so asking for the same one twice returns what is already there instead of
 * arranging a second alarm.
 */
export function scheduleReminder({ taskId, fireAt, kind = 'custom', round = 0, offsetMinutes = null }) {
  if (!taskId) throw new Error('a reminder needs a task');
  const at = new Date(fireAt);
  if (Number.isNaN(at.getTime())) throw new Error('fireAt is not a date');

  const existing = db
    .prepare(
      `SELECT * FROM reminders
       WHERE task_id = ? AND kind = ? AND round = ?
         AND status IN ('scheduled', 'snoozed', 'triggered', 'acknowledged')`
    )
    .get(taskId, kind, round);
  if (existing) return existing;

  const info = db
    .prepare(
      `INSERT INTO reminders (task_id, kind, round, fire_at, offset_minutes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(taskId, kind, round, at.toISOString(), offsetMinutes);
  return getReminder(info.lastInsertRowid);
}

/** A custom reminder the user added by hand; rounds keep them distinct. */
export function scheduleCustomReminder(taskId, fireAt, offsetMinutes = null) {
  const next = db
    .prepare(`SELECT COALESCE(MAX(round), 0) + 1 AS n FROM reminders WHERE task_id = ? AND kind = 'custom'`)
    .get(taskId).n;

  // Asking for a moment that is already covered is not a second reminder.
  const clash = db
    .prepare(
      `SELECT * FROM reminders WHERE task_id = ? AND fire_at = ?
         AND status IN ('scheduled', 'snoozed', 'triggered', 'acknowledged')`
    )
    .get(taskId, new Date(fireAt).toISOString());
  if (clash) return clash;

  return scheduleReminder({ taskId, fireAt, kind: 'custom', round: next, offsetMinutes });
}

export const dueReminders = (nowIso) =>
  db.prepare(`SELECT * FROM reminders WHERE ${ACTIVE} AND fire_at <= ? ORDER BY fire_at ASC`).all(nowIso);

/**
 * Claims a reminder for delivery. Exactly one caller can move a row out of the
 * active states, so a second tick, a restart mid-send, or a retry finds nothing
 * to claim and sends nothing.
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

export function markMissed(id) {
  db.prepare(`UPDATE reminders SET status = 'missed', updated_at = datetime('now')
              WHERE id = ? AND ${ACTIVE}`).run(id);
  return getReminder(id);
}

export function acknowledgeReminder(id) {
  db.prepare(`UPDATE reminders SET status = 'acknowledged', acknowledged_at = datetime('now'),
              updated_at = datetime('now') WHERE id = ?`).run(id);
  return getReminder(id);
}

/** Snooze moves the row it was given; it never adds one. */
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

export function cancelReminder(id) {
  db.prepare(`UPDATE reminders SET status = 'cancelled', updated_at = datetime('now')
              WHERE id = ? AND ${ACTIVE}`).run(id);
  return getReminder(id);
}

/** A finished task has nothing left to be reminded or chased about. */
export function cancelRemindersForTask(taskId) {
  return db
    .prepare(`UPDATE reminders SET status = 'cancelled', updated_at = datetime('now')
              WHERE task_id = ? AND ${ACTIVE}`)
    .run(taskId).changes;
}

/**
 * Clears the whole schedule so it can be rebuilt - used when the deadline
 * moves. Triggered rows are wiped too, otherwise the unique index would refuse
 * to arrange the first round again after a reschedule.
 */
export function resetSchedule(taskId) {
  return db.prepare(`DELETE FROM reminders WHERE task_id = ? AND kind != 'custom'`).run(taskId).changes;
}

export const nextReminderFor = (taskId) =>
  db.prepare(`SELECT fire_at FROM reminders WHERE task_id = ? AND ${ACTIVE}
              ORDER BY fire_at ASC LIMIT 1`).get(taskId)?.fire_at ?? null;

/* ---------------- notifications ---------------- */

export function addNotification(row) {
  const info = db
    .prepare(
      `INSERT INTO notifications (kind, title, body, task_id, reminder_id)
       VALUES (@kind, @title, @body, @task_id, @reminder_id)`
    )
    .run({
      kind: row.kind || 'reminder',
      title: String(row.title || '').slice(0, 200),
      body: row.body ? String(row.body).slice(0, 500) : null,
      task_id: row.task_id ?? null,
      reminder_id: row.reminder_id ?? null,
    });
  return db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(info.lastInsertRowid);
}

export const listNotifications = ({ limit = 40 } = {}) =>
  db
    .prepare(`SELECT * FROM notifications WHERE dismissed_at IS NULL
              ORDER BY at DESC, id DESC LIMIT ?`)
    .all(Math.min(Number(limit) || 40, 200));

export const unreadNotificationCount = () =>
  db.prepare(`SELECT COUNT(*) AS n FROM notifications
              WHERE read_at IS NULL AND dismissed_at IS NULL`).get().n;

export const markNotificationRead = (id) =>
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL`)
    .run(id).changes > 0;

export const markAllNotificationsRead = () =>
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL`).run().changes;

export const dismissNotification = (id) =>
  db.prepare(`UPDATE notifications SET dismissed_at = datetime('now') WHERE id = ?`).run(id).changes > 0;

/* ---------------- daily briefing ---------------- */

/**
 * Claims today's briefing. The insert is the claim - a primary key on the day
 * means exactly one caller can take it, whatever restarts or retries happen.
 * Returns null when somebody already has it and there is nothing left to do.
 */
export function claimBriefing(day, { maxAttempts = 3 } = {}) {
  const inserted = db.prepare(`INSERT OR IGNORE INTO briefings (day) VALUES (?)`).run(day);
  if (inserted.changes === 1) {
    db.prepare(`UPDATE briefings SET attempts = 1 WHERE day = ?`).run(day);
    return { day, attempt: 1 };
  }

  // Already claimed. Retry only a delivery that never succeeded, and only a
  // bounded number of times - a send that may have gone out is not repeated
  // indefinitely just because the confirmation was lost.
  const row = db.prepare(`SELECT * FROM briefings WHERE day = ?`).get(day);
  if (!row || row.sent_at || row.attempts >= maxAttempts) return null;
  db.prepare(`UPDATE briefings SET attempts = attempts + 1 WHERE day = ?`).run(day);
  return { day, attempt: row.attempts + 1 };
}

export function recordBriefingSent(day, taskCount) {
  // A "send now" from Settings never went through claimBriefing, so the row may
  // not exist yet. Marking it sent either way is what stops the scheduled run
  // from delivering a second copy the same morning.
  db.prepare(`INSERT OR IGNORE INTO briefings (day) VALUES (?)`).run(day);
  db.prepare(
    `UPDATE briefings SET sent_at = datetime('now'), task_count = ?, error = NULL WHERE day = ?`
  ).run(taskCount, day);
}

export function recordBriefingFailed(day, error) {
  db.prepare(`UPDATE briefings SET error = ? WHERE day = ?`).run(String(error).slice(0, 300), day);
}

export const briefingFor = (day) =>
  db.prepare(`SELECT * FROM briefings WHERE day = ?`).get(day) || null;

export const recentBriefings = (limit = 14) =>
  db.prepare(`SELECT * FROM briefings ORDER BY day DESC LIMIT ?`).all(Math.min(Number(limit) || 14, 60));

log.info('Scheduling tables ready (reminders, notifications, briefings).');


/* ---------------- the engine, as something you can look at ---------------- */

/**
 * What the reminder engine has lined up, what it has already done, and what it
 * has given up on - joined to the tasks they belong to.
 *
 * The settings page said how the engine is configured; nothing said what it is
 * actually doing. A schedule you cannot see is a schedule you cannot trust.
 */
/**
 * Each task the engine is chasing, with every rung of its ladder.
 *
 * Two queries and a group rather than one row per reminder: a task is the unit
 * you think in, and the rungs are only meaningful read in order against it.
 * Finished and archived work is left out — the engine is not chasing it, so it
 * is not in flight.
 */
function laddersInFlight() {
  const tasks = db
    .prepare(
      `SELECT DISTINCT t.id, t.title, t.priority, t.status, t.due_at, t.due_date,
              t.chat_name, t.assigned_to, t.stage, t.needs_attention, t.follow_up_count
       FROM tasks t
       JOIN reminders r ON r.task_id = t.id
       WHERE t.status != 'done' AND t.archived_at IS NULL
       ORDER BY t.due_at IS NULL, t.due_at ASC
       LIMIT 100`
    )
    .all();

  if (!tasks.length) return [];

  const marks = tasks.map(() => '?').join(',');
  const rungs = db
    .prepare(
      `SELECT id, task_id, kind, round, fire_at, status, triggered_at, snooze_count
       FROM reminders WHERE task_id IN (${marks})
       ORDER BY fire_at ASC, id ASC`
    )
    .all(...tasks.map((t) => t.id));

  const byId = new Map();
  for (const rung of rungs) {
    if (!byId.has(rung.task_id)) byId.set(rung.task_id, []);
    byId.get(rung.task_id).push(rung);
  }

  return tasks.map((task) => {
    const ladder = byId.get(task.id) || [];
    return {
      ...task,
      ladder,
      // Only one rung is ever scheduled ahead, so "the next one" is a fact
      // rather than a guess about which of several will win.
      next: ladder.find((r) => r.status === 'scheduled' || r.status === 'snoozed') || null,
      sent: ladder.filter((r) => r.status === 'triggered').length,
    };
  });
}

export function engineOverview({ upcoming = 50, recent = 50 } = {}) {
  const JOIN = `
    FROM reminders r
    JOIN tasks t ON t.id = r.task_id
    WHERE t.archived_at IS NULL`;

  const shape = `
    r.id, r.task_id, r.kind, r.round, r.fire_at, r.status,
    r.triggered_at, r.offset_minutes, r.snooze_count,
    t.title, t.priority, t.status AS task_status, t.due_at, t.due_date,
    t.chat_name, t.needs_attention, t.follow_up_count, t.assigned_to`;

  return {
    upcoming: db
      .prepare(
        `SELECT ${shape} ${JOIN} AND r.status IN ('scheduled','snoozed') AND t.status != 'done'
         ORDER BY r.fire_at ASC LIMIT ?`
      )
      .all(Math.min(Number(upcoming) || 50, 200)),

    recent: db
      .prepare(
        `SELECT ${shape} ${JOIN} AND r.triggered_at IS NOT NULL
         ORDER BY r.triggered_at DESC LIMIT ?`
      )
      .all(Math.min(Number(recent) || 50, 200)),

    missed: db
      .prepare(
        `SELECT ${shape} ${JOIN} AND r.status = 'missed' AND t.status != 'done'
         ORDER BY r.fire_at DESC LIMIT 25`
      )
      .all(),

    counts: db
      .prepare(
        `SELECT
           SUM(CASE WHEN r.status IN ('scheduled','snoozed') AND t.status != 'done' THEN 1 ELSE 0 END) AS scheduled,
           SUM(CASE WHEN r.kind = 'follow_up' AND r.status IN ('scheduled','snoozed') AND t.status != 'done' THEN 1 ELSE 0 END) AS follow_ups,
           SUM(CASE WHEN r.status = 'triggered' THEN 1 ELSE 0 END) AS triggered,
           SUM(CASE WHEN r.status = 'missed' THEN 1 ELSE 0 END) AS missed
         ${JOIN}`
      )
      .get(),

    // Every task the engine is currently working on, with its whole ladder.
    //
    // The flat lists answer "what fires next"; this answers the question
    // actually asked of a follow-up engine — "is task pe kitni baar poocha,
    // aur ab kab poochega". Read off a flat list of reminders that takes
    // counting on your fingers.
    byTask: laddersInFlight(),

    // Tasks the engine has stopped chasing: the cap did its job and now a
    // person has to decide what happens.
    attention: db
      .prepare(
        `SELECT id, title, priority, status, due_at, due_date, chat_name,
                follow_up_count, assigned_to
         FROM tasks
         WHERE needs_attention = 1 AND status != 'done' AND archived_at IS NULL
           AND ${NOT_SET_ASIDE_BARE}
         ORDER BY due_at IS NULL, due_at ASC`
      )
      .all(),
  };
}
