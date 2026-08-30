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
    due_date      TEXT,
    priority      TEXT NOT NULL DEFAULT 'medium',
    status        TEXT NOT NULL DEFAULT 'open',
    reminder_count   INTEGER NOT NULL DEFAULT 0,
    last_reminded_at TEXT,
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

log.info(`SQLite ready at ${config.dbPath}`);

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
const STATUSES = new Set(['open', 'done']);

const insertTaskStmt = db.prepare(`
  INSERT INTO tasks (title, description, contact, chat_name, chat_id, message_id, source, due_date, priority, status)
  VALUES (@title, @description, @contact, @chat_name, @chat_id, @message_id, @source, @due_date, @priority, @status)
`);

export function createTask(input) {
  const row = {
    title: String(input.title || '').trim(),
    description: input.description ?? null,
    contact: input.contact ?? null,
    chat_name: input.chat_name ?? null,
    chat_id: input.chat_id ?? null,
    message_id: input.message_id ?? null,
    source: input.source || 'manual',
    due_date: input.due_date || null,
    priority: PRIORITIES.has(input.priority) ? input.priority : 'medium',
    status: STATUSES.has(input.status) ? input.status : 'open',
  };
  if (!row.title) throw new Error('title is required');
  const info = insertTaskStmt.run(row);
  return getTask(info.lastInsertRowid);
}

export function getTask(id) {
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) || null;
}

export function listTasks({ status, limit = 500 } = {}) {
  const filtered = STATUSES.has(status);
  const sql = `SELECT * FROM tasks
       ${filtered ? 'WHERE status = ?' : ''}
       ORDER BY
         CASE status WHEN 'open' THEN 0 ELSE 1 END,
         due_date IS NULL, due_date ASC,
         CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         id DESC
       LIMIT ?`;
  const capped = Math.min(Number(limit) || 500, 1000);
  return filtered ? db.prepare(sql).all(status, capped) : db.prepare(sql).all(capped);
}

const UPDATABLE = ['title', 'description', 'contact', 'chat_name', 'due_date', 'priority', 'status'];

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
  if (patch.status === 'done' && current.status !== 'done') {
    fields.push(`completed_at = datetime('now')`);
  }
  if (patch.status === 'open' && current.status === 'done') {
    fields.push(`completed_at = NULL`, `reminder_count = 0`, `last_reminded_at = NULL`);
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
       WHERE status = 'open' AND (due_date IS NULL OR due_date <= ?)
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
         COALESCE(SUM(status = 'done'), 0)                            AS done,
         COALESCE(SUM(status = 'open' AND priority = 'high'), 0)      AS high_open
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
