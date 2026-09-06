import Database from 'better-sqlite3';
import { config } from './config.js';
import { log } from './logger.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_message_id  TEXT UNIQUE,
    chat_id        TEXT NOT NULL,
    chat_name      TEXT,
    contact_name   TEXT,
    contact_number TEXT,
    body           TEXT NOT NULL,
    is_group       INTEGER NOT NULL DEFAULT 0,
    from_me        INTEGER NOT NULL DEFAULT 0,
    sent_at        TEXT NOT NULL,
    processed      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    description   TEXT,
    contact       TEXT,
    chat_name     TEXT,
    chat_id       TEXT,
    message_id    INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    source        TEXT NOT NULL DEFAULT 'whatsapp',
    origin        TEXT NOT NULL DEFAULT 'manual',
    due_date      TEXT,
    priority      TEXT NOT NULL DEFAULT 'medium',
    status        TEXT NOT NULL DEFAULT 'open',
    reminder_count   INTEGER NOT NULL DEFAULT 0,
    last_reminded_at TEXT,
    due_at           TEXT,
    remind_at        TEXT,
    remind_at_sent   INTEGER NOT NULL DEFAULT 0,
    digest_pos       INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blocked_chats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern    TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    at             TEXT NOT NULL DEFAULT (datetime('now')),
    day            TEXT NOT NULL,
    model          TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_read     INTEGER NOT NULL DEFAULT 0,
    cache_write    INTEGER NOT NULL DEFAULT 0,
    messages       INTEGER NOT NULL DEFAULT 0,
    tasks          INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_usage_day ON api_usage(day);
  CREATE INDEX IF NOT EXISTS idx_messages_processed ON messages(processed);
  CREATE INDEX IF NOT EXISTS idx_tasks_status_due   ON tasks(status, due_date);
`);

// Databases created before reminders repeated have `reminder_sent` instead.
// Carry it over as a count of 1 so already-reminded tasks are not double-counted.
const taskColumns = new Set(db.prepare(`PRAGMA table_info(tasks)`).all().map((c) => c.name));
if (!taskColumns.has('reminder_count')) {
  db.exec(`ALTER TABLE tasks ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0`);
  if (taskColumns.has('reminder_sent')) {
    db.exec(`UPDATE tasks SET reminder_count = reminder_sent`);
  }
  log.info('Migrated tasks table: added reminder_count.');
}
if (!taskColumns.has('last_reminded_at')) {
  db.exec(`ALTER TABLE tasks ADD COLUMN last_reminded_at TEXT`);
  log.info('Migrated tasks table: added last_reminded_at.');
}
for (const [name, ddl] of [
  ['origin', "ALTER TABLE tasks ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'"],
  ['due_at', 'ALTER TABLE tasks ADD COLUMN due_at TEXT'],
  ['follow_up_count', 'ALTER TABLE tasks ADD COLUMN follow_up_count INTEGER NOT NULL DEFAULT 0'],
  ['needs_attention', 'ALTER TABLE tasks ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0'],
  ['remind_at', 'ALTER TABLE tasks ADD COLUMN remind_at TEXT'],
  ['remind_at_sent', 'ALTER TABLE tasks ADD COLUMN remind_at_sent INTEGER NOT NULL DEFAULT 0'],
  ['digest_pos', 'ALTER TABLE tasks ADD COLUMN digest_pos INTEGER'],
]) {
  if (!taskColumns.has(name)) {
    db.exec(ddl);
    log.info(`Migrated tasks table: added ${name}.`);
  }
}

if (!taskColumns.has('origin')) {
  // Anything captured from WhatsApp was created by the extractor, not by hand.
  db.exec(`UPDATE tasks SET origin = CASE WHEN source = 'whatsapp' THEN 'ai' ELSE 'manual' END`);
  log.info('Migrated tasks table: backfilled origin from source.');
}

// `remind_at` was carrying the clock time parsed out of a message - which is the
// deadline, not the moment to be reminded. Move it to due_at once.
if (!taskColumns.has('due_at')) {
  db.exec(`UPDATE tasks SET due_at = remind_at WHERE remind_at IS NOT NULL`);
  log.info('Migrated tasks table: remind_at times carried over to due_at.');
}

log.info(`SQLite ready at ${config.dbPath}`);

/* ---------------- api usage ---------------- */

const insertUsageStmt = db.prepare(`
  INSERT INTO api_usage (day, model, input_tokens, output_tokens, cache_read, cache_write, messages, tasks)
  VALUES (@day, @model, @input_tokens, @output_tokens, @cache_read, @cache_write, @messages, @tasks)
`);

/** One row per call to the extractor, with the token counts the API reported. */
export function recordUsage(row) {
  insertUsageStmt.run({
    day: new Date().toISOString().slice(0, 10),
    model: row.model || 'unknown',
    input_tokens: row.input_tokens || 0,
    output_tokens: row.output_tokens || 0,
    cache_read: row.cache_read || 0,
    cache_write: row.cache_write || 0,
    messages: row.messages || 0,
    tasks: row.tasks || 0,
  });
}

/** Per-day totals, newest first, for the last `days` days. */
export function usageByDay(days = 30) {
  return db
    .prepare(
      `SELECT day, model,
              SUM(input_tokens)  AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cache_read)    AS cache_read,
              SUM(cache_write)   AS cache_write,
              SUM(messages)      AS messages,
              SUM(tasks)         AS tasks,
              COUNT(*)           AS calls
       FROM api_usage
       WHERE day >= date('now', ?)
       GROUP BY day, model
       ORDER BY day DESC`
    )
    .all(`-${Math.min(Number(days) || 30, 365)} days`);
}

/** Everything ever recorded, and when recording started. */
export function usageTotals() {
  return db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens), 0)  AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cache_read), 0)    AS cache_read,
              COALESCE(SUM(cache_write), 0)   AS cache_write,
              COALESCE(SUM(messages), 0)      AS messages,
              COALESCE(SUM(tasks), 0)         AS tasks,
              COUNT(*)                        AS calls,
              MIN(day)                        AS since
       FROM api_usage`
    )
    .get();
}

/* ---------------- meta ---------------- */

export function getMeta(key) {
  return db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key)?.value ?? null;
}

export function setMeta(key, value) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

/**
 * Counts starts of the process against the database file. If the count keeps
 * resetting to 1, the database is not on a volume that survives a restart -
 * which is also why a linked WhatsApp session would keep disappearing.
 */
export function recordBoot() {
  const boots = Number(getMeta('boot_count') || 0) + 1;
  setMeta('boot_count', boots);
  if (!getMeta('first_boot_at')) setMeta('first_boot_at', new Date().toISOString());
  setMeta('last_boot_at', new Date().toISOString());
  return { boots, firstBootAt: getMeta('first_boot_at') };
}

/* ---------------- messages ---------------- */

const insertMessageStmt = db.prepare(`
  INSERT OR IGNORE INTO messages
    (wa_message_id, chat_id, chat_name, contact_name, contact_number, body, is_group, from_me, sent_at)
  VALUES
    (@wa_message_id, @chat_id, @chat_name, @contact_name, @contact_number, @body, @is_group, @from_me, @sent_at)
`);

export function insertMessage(msg) {
  const info = insertMessageStmt.run(msg);
  if (info.changes === 0) return null; // duplicate wa_message_id
  return info.lastInsertRowid;
}

export function markMessagesProcessed(ids) {
  if (!ids.length) return;
  const stmt = db.prepare(`UPDATE messages SET processed = 1 WHERE id = ?`);
  db.transaction((list) => list.forEach((id) => stmt.run(id)))(ids);
}

export function listMessages({ limit = 100 } = {}) {
  return db
    .prepare(`SELECT * FROM messages ORDER BY id DESC LIMIT ?`)
    .all(Math.min(Number(limit) || 100, 500));
}

/* ---------------- tasks ---------------- */

const PRIORITIES = new Set(['high', 'medium', 'low']);
const STATUSES = new Set(['open', 'in_progress', 'done']);
/** Everything still owed. Used wherever "not finished" is what matters. */
const OPEN_STATUSES = "status != 'done'";

const ORIGINS = new Set(['ai', 'manual']);

const insertTaskStmt = db.prepare(`
  INSERT INTO tasks (title, description, contact, chat_name, chat_id, message_id, source, origin, due_date, due_at, remind_at, priority, status)
  VALUES (@title, @description, @contact, @chat_name, @chat_id, @message_id, @source, @origin, @due_date, @due_at, @remind_at, @priority, @status)
`);

/**
 * Tasks always carry the one message they came from, and never any other. The
 * join is a single row by id, so no other chat content can reach the client.
 */
const TASK_SELECT = `
  SELECT t.*, m.body AS source_message, m.sent_at AS source_message_at
  FROM tasks t
  LEFT JOIN messages m ON m.id = t.message_id`;

export function createTask(input) {
  const row = {
    title: String(input.title || '').trim(),
    description: input.description ?? null,
    contact: input.contact ?? null,
    chat_name: input.chat_name ?? null,
    chat_id: input.chat_id ?? null,
    message_id: input.message_id ?? null,
    source: input.source || 'manual',
    origin: ORIGINS.has(input.origin) ? input.origin : (input.message_id ? 'ai' : 'manual'),
    due_date: input.due_date || null,
    due_at: input.due_at || input.remind_at || null,
    remind_at: input.remind_at || null,
    priority: PRIORITIES.has(input.priority) ? input.priority : 'medium',
    status: STATUSES.has(input.status) ? input.status : 'open',
  };
  if (!row.title) throw new Error('title is required');
  const info = insertTaskStmt.run(row);
  return getTask(info.lastInsertRowid);
}

export function getTask(id) {
  return db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) || null;
}

/**
 * `status` takes one of the three statuses, or "open" as a shorthand for
 * everything unfinished - which is what the dashboard's Open tab means now
 * that a task can sit in progress.
 */
export function listTasks({ status, limit = 500 } = {}) {
  let where = '';
  const params = [];
  if (status === 'pending') {
    where = `WHERE t.${OPEN_STATUSES}`;
  } else if (STATUSES.has(status)) {
    where = 'WHERE t.status = ?';
    params.push(status);
  }
  const sql = `${TASK_SELECT}
       ${where}
       ORDER BY
         CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
         t.due_date IS NULL, t.due_date ASC,
         CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         t.id DESC
       LIMIT ?`;
  params.push(Math.min(Number(limit) || 500, 1000));
  return db.prepare(sql).all(...params);
}

const UPDATABLE = [
  'title', 'description', 'contact', 'chat_name', 'due_date', 'due_at',
  'priority', 'status', 'remind_at', 'follow_up_count', 'needs_attention',
];

export function updateTask(id, patch) {
  const current = getTask(id);
  if (!current) return null;

  const fields = [];
  const values = [];
  for (const key of UPDATABLE) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'priority' && !PRIORITIES.has(value)) continue;
    if (key === 'status' && !STATUSES.has(value)) continue;
    if (value === '') value = null;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (!fields.length) return current;

  fields.push(`updated_at = datetime('now')`);
  // Moving the exact time re-arms it, otherwise a rescheduled task never fires.
  if ('remind_at' in patch && patch.remind_at !== current.remind_at) {
    fields.push(`remind_at_sent = 0`);
  }
  if (patch.status === 'done' && current.status !== 'done') {
    fields.push(`completed_at = datetime('now')`);
  }
  if (('due_at' in patch || 'due_date' in patch) && !('follow_up_count' in patch)) {
    fields.push(`follow_up_count = 0`, `needs_attention = 0`);
  }
  if (patch.status !== 'done' && current.status === 'done') {
    fields.push(`completed_at = NULL`, `reminder_count = 0`, `last_reminded_at = NULL`, `remind_at_sent = 0`);
  }

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getTask(id);
}

export function deleteTask(id) {
  return db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id).changes > 0;
}

/**
 * Everything that should appear in a reminder digest: open tasks that are due,
 * overdue, or have no date at all. There is deliberately no "already reminded"
 * filter - a task keeps being reminded about until it is marked done.
 * `today` is a YYYY-MM-DD string in the configured timezone.
 */
export function pendingReminders(today) {
  return db
    .prepare(
      `SELECT * FROM tasks
       WHERE ${OPEN_STATUSES} AND (due_date IS NULL OR due_date <= ?)
       ORDER BY
         due_date IS NULL,
         due_date ASC,
         CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         id ASC`
    )
    .all(today);
}

export function recordReminders(ids) {
  if (!ids.length) return;
  const stmt = db.prepare(
    `UPDATE tasks
     SET reminder_count = reminder_count + 1,
         last_reminded_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`
  );
  db.transaction((list) => list.forEach((id) => stmt.run(id)))(ids);
}

export function taskStats() {
  return db
    .prepare(
      `SELECT
         COUNT(*)                                                     AS total,
         COALESCE(SUM(status = 'open'), 0)                            AS open,
         COALESCE(SUM(status = 'in_progress'), 0)                      AS in_progress,
         COALESCE(SUM(status = 'done'), 0)                            AS done,
         COALESCE(SUM(status != 'done' AND priority = 'high'), 0)     AS high_open
       FROM tasks`
    )
    .get();
}

/* ---------------- push subscriptions ---------------- */

export function savePushSubscription(sub) {
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

export function listPushSubscriptions() {
  return db.prepare(`SELECT * FROM push_subscriptions`).all();
}

export function deletePushSubscription(endpoint) {
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
}

/* ---------------- exact-time reminders ---------------- */

/** Open tasks whose specific reminder time has arrived and not yet been sent. */
export function dueExactReminders(nowIso) {
  return db
    .prepare(
      `SELECT * FROM tasks
       WHERE ${OPEN_STATUSES} AND remind_at_sent = 0
         AND remind_at IS NOT NULL AND remind_at <= ?
       ORDER BY remind_at ASC`
    )
    .all(nowIso);
}

export function markExactRemindersSent(ids) {
  if (!ids.length) return;
  const stmt = db.prepare(`UPDATE tasks SET remind_at_sent = 1 WHERE id = ?`);
  db.transaction((list) => list.forEach((id) => stmt.run(id)))(ids);
}

/* ---------------- digest numbering ---------------- */

/**
 * Number the tasks that just went out in a digest, so a "done 2" reply can be
 * resolved back to a task. Any task not in this digest loses its number.
 */
export function setDigestPositions(orderedIds) {
  const clear = db.prepare(`UPDATE tasks SET digest_pos = NULL WHERE digest_pos IS NOT NULL`);
  const set = db.prepare(`UPDATE tasks SET digest_pos = ? WHERE id = ?`);
  db.transaction((ids) => {
    clear.run();
    ids.forEach((id, i) => set.run(i + 1, id));
  })(orderedIds);
}

export function taskByDigestPos(pos) {
  return db.prepare(`SELECT * FROM tasks WHERE digest_pos = ?`).get(pos) || null;
}

export function tasksInLastDigest() {
  return db
    .prepare(`SELECT * FROM tasks WHERE digest_pos IS NOT NULL ORDER BY digest_pos ASC`)
    .all();
}

/* ---------------- blocked chats ---------------- */

export function listBlockedChats() {
  return db.prepare(`SELECT * FROM blocked_chats ORDER BY pattern COLLATE NOCASE`).all();
}

export function blockChat(pattern) {
  const value = String(pattern || '').trim();
  if (!value) throw new Error('pattern is required');
  db.prepare(`INSERT OR IGNORE INTO blocked_chats (pattern) VALUES (?)`).run(value);
  return listBlockedChats();
}

export function unblockChat(id) {
  return db.prepare(`DELETE FROM blocked_chats WHERE id = ?`).run(id).changes > 0;
}

/** Distinct chats seen recently, so the dashboard can offer them for blocking. */
export function recentChats(limit = 40) {
  return db
    .prepare(
      `SELECT chat_name, chat_id, is_group, MAX(sent_at) AS last_seen, COUNT(*) AS messages
       FROM messages
       WHERE chat_name IS NOT NULL AND chat_name != ''
       GROUP BY chat_id
       ORDER BY last_seen DESC
       LIMIT ?`
    )
    .all(Math.min(Number(limit) || 40, 100));
}
