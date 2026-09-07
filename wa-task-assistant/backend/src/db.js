import Database from 'better-sqlite3';
import { config } from './config.js';
import { unshout } from './titlecase.js';
import { log } from './logger.js';
import { numberOrNull } from './dates.js';

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
    original_due_at  TEXT,
    notes            TEXT,
    waiting_for      TEXT,
    archived_at      TEXT,
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

  -- A checklist inside one task. Ticking every box does NOT finish the parent:
  -- completing a task cancels its whole reminder ladder, and that is too
  -- consequential to happen as a side effect of ticking a box.
  CREATE TABLE IF NOT EXISTS subtasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    done         INTEGER NOT NULL DEFAULT 0,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  -- "This cannot start until that is finished." One row per edge; the primary
  -- key makes the same dependency twice impossible, and cycles are refused in
  -- code before the row is written.
  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (task_id, depends_on_id)
  );

  -- A shape of work that recurs: the title, the usual priority, the offsets,
  -- and the checklist that goes with it.
  CREATE TABLE IF NOT EXISTS task_templates (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL UNIQUE,
    title             TEXT NOT NULL,
    description       TEXT,
    priority          TEXT NOT NULL DEFAULT 'medium',
    reminder_offset   INTEGER,
    follow_up_offset  INTEGER,
    due_in_days       INTEGER,
    due_time          TEXT,
    subtasks          TEXT NOT NULL DEFAULT '[]',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    used_count        INTEGER NOT NULL DEFAULT 0
  );

  -- Files kept beside a task. The bytes live on disk under DATA_DIR, not in
  -- here: a database that has to be read into memory is the wrong place for a
  -- 5 MB scan, and the volume is bounded (see attachments.js).
  CREATE TABLE IF NOT EXISTS attachments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    mime         TEXT NOT NULL,
    bytes        INTEGER NOT NULL,
    stored_name  TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_day ON api_usage(day);
  CREATE INDEX IF NOT EXISTS idx_messages_processed ON messages(processed);
  CREATE INDEX IF NOT EXISTS idx_tasks_status_due   ON tasks(status, due_date);
  CREATE INDEX IF NOT EXISTS idx_subtasks_task      ON subtasks(task_id, position);
  CREATE INDEX IF NOT EXISTS idx_dep_blocker        ON task_dependencies(depends_on_id);
  -- One per business. Tasks for the same company arrive from several different
  -- chats and some are typed by hand, so which company a task belongs to cannot
  -- be read off the chat it came from - it is its own thing.
  CREATE TABLE IF NOT EXISTS task_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    colour     TEXT NOT NULL DEFAULT 'teal',
    keywords   TEXT NOT NULL DEFAULT '[]',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_attach_task        ON attachments(task_id);

`);

// Databases created before reminders repeated have `reminder_sent` instead.
// Carry it over as a count of 1 so already-reminded tasks are not double-counted.
/**
 * Add any column a table is missing.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op against a table that already exists,
 * so changing a table's definition in code changes nothing on a database that
 * predates the change - and the first query naming the new column fails with
 * "no such column". That is what took the deployed service down: the reminders
 * table was rebuilt around `kind` and `round`, while the live volume still held
 * the older shape.
 *
 * Returns the names actually added, so a caller can act on having migrated.
 */
export function ensureColumns(table, columns) {
  const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const added = [];
  for (const [name, ddl] of columns) {
    if (present.has(name)) continue;
    db.exec(ddl);
    added.push(name);
  }
  if (added.length) log.info(`Migrated ${table} table: added ${added.join(', ')}.`);
  return added;
}

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
  ['notes', 'ALTER TABLE tasks ADD COLUMN notes TEXT'],
  ['waiting_for', 'ALTER TABLE tasks ADD COLUMN waiting_for TEXT'],
  ['archived_at', 'ALTER TABLE tasks ADD COLUMN archived_at TEXT'],
  ['original_due_at', 'ALTER TABLE tasks ADD COLUMN original_due_at TEXT'],
  ['follow_up_count', 'ALTER TABLE tasks ADD COLUMN follow_up_count INTEGER NOT NULL DEFAULT 0'],
  ['needs_attention', 'ALTER TABLE tasks ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0'],
  ['remind_at', 'ALTER TABLE tasks ADD COLUMN remind_at TEXT'],
  ['remind_at_sent', 'ALTER TABLE tasks ADD COLUMN remind_at_sent INTEGER NOT NULL DEFAULT 0'],
  ['digest_pos', 'ALTER TABLE tasks ADD COLUMN digest_pos INTEGER'],
  // The extractor's own report of how sure it was. Not a measurement - the
  // model says it, and the app labels it that way wherever it is shown.
  ['ai_confidence', 'ALTER TABLE tasks ADD COLUMN ai_confidence TEXT'],
  // A task the extractor was unsure about waits to be confirmed. Until then it
  // is not chased: reminders, follow-ups and the briefing all skip it.
  ['needs_confirmation', 'ALTER TABLE tasks ADD COLUMN needs_confirmation INTEGER NOT NULL DEFAULT 0'],
  // Which business this belongs to. Nullable: a task need not have one.
  ['group_id', 'ALTER TABLE tasks ADD COLUMN group_id INTEGER REFERENCES task_groups(id) ON DELETE SET NULL'],
  /*
   * Who is meant to do this. NULL means the user - the overwhelming majority of
   * tasks, and the shape every existing row already has, so no back-fill and no
   * change to what any current query returns.
   *
   * The wid is WhatsApp's own id for the person, kept only so a follow-up the
   * user explicitly asks to send has somewhere to go. It is never used to send
   * anything on its own.
   */
  ['assigned_to', 'ALTER TABLE tasks ADD COLUMN assigned_to TEXT'],
  ['assigned_to_wid', 'ALTER TABLE tasks ADD COLUMN assigned_to_wid TEXT'],
  ['assigned_at', 'ALTER TABLE tasks ADD COLUMN assigned_at TEXT'],

  /*
   * The other direction: who asked him for this.
   *
   * Stored rather than derived from the source message, because the message is
   * the thing that can go away - pruned, or never kept at all in manual mode -
   * and the task still has to be able to say who it came from. NULL is a note
   * he made himself, which is what every row written before this says.
   */
  ['requested_by', 'ALTER TABLE tasks ADD COLUMN requested_by TEXT'],
  ['requested_by_wid', 'ALTER TABLE tasks ADD COLUMN requested_by_wid TEXT'],

  /*
   * Whether the message arrived in a group.
   *
   * Stored rather than guessed at from the names, because in a group the row
   * has to say both who wrote it and where - "Hasmukh · BOOK N FLY LEGAL TEAM"
   * - and in a one-to-one chat those two are the same person said twice.
   * Nothing existing has it, and 0 is the safe reading of that: a task with no
   * recorded group shows exactly what it showed before.
   */
  ['is_group', 'ALTER TABLE tasks ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0'],
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
const STATUSES = new Set(['open', 'in_progress', 'waiting', 'done']);
/** Everything still owed. Used wherever "not finished" is what matters. */
const OPEN_STATUSES = "status != 'done'";

const ORIGINS = new Set(['ai', 'manual']);
export const CONFIDENCE = new Set(['high', 'medium', 'low']);

const insertTaskStmt = db.prepare(`
  INSERT INTO tasks
    (title, description, notes, contact, chat_name, chat_id, message_id, source, origin,
     due_date, due_at, original_due_at, waiting_for, remind_at, priority, status,
     ai_confidence, needs_confirmation, group_id,
     assigned_to, assigned_to_wid, assigned_at, requested_by, requested_by_wid, is_group)
  VALUES
    (@title, @description, @notes, @contact, @chat_name, @chat_id, @message_id, @source, @origin,
     @due_date, @due_at, @original_due_at, @waiting_for, @remind_at, @priority, @status,
     @ai_confidence, @needs_confirmation, @group_id,
     @assigned_to, @assigned_to_wid, @assigned_at, @requested_by, @requested_by_wid, @is_group)
`);

/**
 * Tasks always carry the one message they came from, and never any other. The
 * join is a single row by id, so no other chat content can reach the client.
 */
const TASK_SELECT = `
  SELECT t.*, m.body AS source_message, m.sent_at AS source_message_at,
         g.name AS group_name, g.colour AS group_colour, g.separate AS group_separate
  FROM tasks t
  LEFT JOIN messages m ON m.id = t.message_id
  LEFT JOIN task_groups g ON g.id = t.group_id`;

/**
 * The calendar day an exact deadline falls on, read in the user's timezone.
 *
 * `due_at` is the deadline and `due_date` is the day it belongs to, and the two
 * have to agree: the list groups and labels rows by the day, while the calendar
 * places them by the moment. A task given only a `due_at` was landing on a day
 * in the calendar while its own row read "No date". The dashboard sends both,
 * so this only ever mattered to a direct API call - which is exactly the caller
 * that should not have to know the rule.
 */
function dayOfInstant(iso, tz = config.timezone) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

export function createTask(input) {
  const row = {
    // A shouted title is put into readable case here rather than at each caller,
    // so the hand-typed form, a quickparse and a monthly rule all get it. See
    // titlecase.js for why only the case is touched and not the spelling.
    title: unshout(input.title),
    description: input.description ?? null,
    contact: input.contact ?? null,
    chat_name: input.chat_name ?? null,
    chat_id: input.chat_id ?? null,
    message_id: input.message_id ?? null,
    source: input.source || 'manual',
    origin: ORIGINS.has(input.origin) ? input.origin : (input.message_id ? 'ai' : 'manual'),
    due_at: input.due_at || input.remind_at || null,
    // Derived when a moment was given without a day, so the two never disagree.
    due_date: input.due_date || dayOfInstant(input.due_at || input.remind_at),
    original_due_at: input.due_at || input.remind_at || null,
    notes: input.notes ?? null,
    waiting_for: input.waiting_for ?? null,
    remind_at: input.remind_at || null,
    priority: PRIORITIES.has(input.priority) ? input.priority : 'medium',
    status: STATUSES.has(input.status) ? input.status : 'open',
    ai_confidence: CONFIDENCE.has(input.ai_confidence) ? input.ai_confidence : null,
    needs_confirmation: input.needs_confirmation ? 1 : 0,
    group_id: numberOrNull(input.group_id),
    assigned_to: input.assigned_to ? String(input.assigned_to).trim().slice(0, 80) : null,
    assigned_to_wid: input.assigned_to_wid || null,
    assigned_at: input.assigned_to ? new Date().toISOString() : null,
    requested_by: input.requested_by ? String(input.requested_by).trim().slice(0, 80) : null,
    requested_by_wid: input.requested_by_wid || null,
    is_group: input.is_group ? 1 : 0,
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
/**
 * `includeSetAside` is what a group's own page passes: everywhere else the
 * question being asked is "what do I owe", and work deliberately set aside is
 * not an answer to it.
 */
export function listTasks({ status, limit = 500, includeSetAside = false, order } = {}) {
  let where = '';
  const params = [];
  if (status === 'pending') {
    where = `WHERE t.${OPEN_STATUSES} AND t.archived_at IS NULL`;
  } else if (STATUSES.has(status)) {
    where = 'WHERE t.status = ? AND t.archived_at IS NULL';
    params.push(status);
  } else {
    where = 'WHERE t.archived_at IS NULL';
  }
  if (!includeSetAside) where += ` AND ${NOT_SET_ASIDE}`;

  // "Recent" is the one view that asks a different question: not what is most
  // pressing, but what has just arrived.
  const sort = order === 'recent'
    ? 't.created_at DESC, t.id DESC'
    : `CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
         t.due_date IS NULL, t.due_date ASC,
         CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         t.id DESC`;

  const sql = `${TASK_SELECT}
       ${where}
       ORDER BY ${sort}
       LIMIT ?`;
  params.push(Math.min(Number(limit) || 500, 1000));
  return db.prepare(sql).all(...params);
}

// Created after the migration above, since it names a column that database may
// only just have been given.
db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_requested ON tasks(requested_by)`);

/*
 * Tasks made before the column existed still know where they came from.
 *
 * `is_group` was added late, so every task already on the list has 0 - and a
 * group task with 0 shows only the group, never who in it wrote the message.
 * The message it came from has the answer, and tasks keep that link, so the
 * backfill is a join rather than a guess. Runs once: after it, there is nothing
 * left with a message that disagrees.
 */
{
  const fixed = db
    .prepare(
      `UPDATE tasks SET is_group = 1
       WHERE is_group = 0
         AND message_id IN (SELECT id FROM messages WHERE is_group = 1)`
    )
    .run().changes;

  /*
   * The sender's name, for the same reason: without it there is nothing to put
   * beside the group.
   *
   * Also replaced where it merely repeats the group - the extractor used to
   * take the model's guess ahead of the message's own sender, and the guess was
   * often the group's name, which left the row with the same text twice and no
   * sender at all.
   */
  const named = db
    .prepare(
      `UPDATE tasks SET contact = (SELECT contact_name FROM messages WHERE id = tasks.message_id)
       WHERE message_id IN (SELECT id FROM messages WHERE contact_name IS NOT NULL AND is_group = 1)
         AND (contact IS NULL OR contact = '' OR contact = chat_name)`
    )
    .run().changes;

  if (fixed || named) {
    log.info(`Backfilled from stored messages: ${fixed} task(s) marked as from a group, ${named} given a sender.`);
  }
}

/*
 * Group names are unique regardless of case. SQLite's UNIQUE is case-sensitive,
 * so "BNF" and "bnf" were two different groups - and since both would match the
 * same keyword, routing saw a tie and filed the task under neither. An index
 * rather than a column type, so a database that already has the table gets it.
 */
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_group_name ON task_groups(name COLLATE NOCASE)`);

/*
 * A group that is kept out of the main list.
 *
 * Some work arrives in bulk and is not the day's work: vacancies coming into a
 * recruitment desk, dozens a week, each a real thing to act on but none of it
 * belonging beside "Pay TDS today". Mixed in, they bury everything else; thrown
 * away, they are lost. So they are captured, grouped and set aside — its own
 * section in the sidebar, and out of every view that answers "what do I owe
 * today". 0 for every group that already exists, so nothing moves on upgrade.
 */
ensureColumns('task_groups', [
  ['separate', 'ALTER TABLE task_groups ADD COLUMN separate INTEGER NOT NULL DEFAULT 0'],
]);

/**
 * Tasks in a set-aside group, as a SQL fragment.
 *
 * Written as NOT IN rather than a join so it can be dropped into any existing
 * query without changing its shape. An empty set is the common case and costs
 * nothing: SQLite folds `NOT IN (SELECT ... WHERE separate = 1)` away.
 */
const notSetAside = (alias = 't.') =>
  `(${alias}group_id IS NULL OR ${alias}group_id NOT IN` +
  ` (SELECT id FROM task_groups WHERE separate = 1))`;
const NOT_SET_ASIDE = notSetAside('t.');
/** The same condition for a query that does not alias the table. */
export const NOT_SET_ASIDE_BARE = notSetAside('');
export const setAsideGroupIds = () =>
  db.prepare(`SELECT id FROM task_groups WHERE separate = 1`).all().map((r) => r.id);

const UPDATABLE = [
  'title', 'description', 'notes', 'contact', 'chat_name', 'due_date', 'due_at',
  'priority', 'status', 'remind_at', 'follow_up_count', 'needs_attention',
  'waiting_for', 'archived_at', 'needs_confirmation', 'ai_confidence', 'group_id',
  'assigned_to', 'assigned_to_wid', 'requested_by',
];

export function updateTask(id, patch) {
  // Moving the moment moves the day with it, unless the caller set one itself.
  if ('due_at' in patch && !('due_date' in patch)) {
    patch = { ...patch, due_date: dayOfInstant(patch.due_at) };
  }
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
       WHERE ${OPEN_STATUSES} AND needs_confirmation = 0
         AND archived_at IS NULL
         AND ${NOT_SET_ASIDE_BARE}
         AND (due_date IS NULL OR due_date <= ?)
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
         COALESCE(SUM(status = 'waiting'), 0)                          AS waiting,
         COALESCE(SUM(status = 'done'), 0)                            AS done,
         COALESCE(SUM(status != 'done' AND priority = 'high'), 0)     AS high_open
       FROM tasks WHERE archived_at IS NULL AND ${NOT_SET_ASIDE_BARE}`
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
       WHERE ${OPEN_STATUSES} AND remind_at_sent = 0 AND archived_at IS NULL
         AND ${NOT_SET_ASIDE_BARE}
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
