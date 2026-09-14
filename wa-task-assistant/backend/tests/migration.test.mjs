/**
 * Upgrading a database that already exists.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that is already there,
 * so a schema change in code reaches a fresh database and no other. Every test
 * in the other suites starts from an empty directory, which is exactly why this
 * went unnoticed until the deployed service stopped starting with
 * "no such column: kind".
 *
 * These cases build databases in the older shapes and then load the current
 * code against them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

let passed = 0;
let failed = 0;
const run = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const dirs = [];

/** A data directory holding a database built to the given DDL, plus one task. */
function seed(ddl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-migrate-'));
  dirs.push(dir);
  const db = new Database(path.join(dir, 'tasks.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON'); // as the app runs, so a bad fixture fails here
  db.exec(ddl);
  db.close();
  return dir;
}

/** Loads the current schema modules against that directory, in a clean process. */
async function loadCurrentCodeAgainst(dir) {
  const { execFileSync } = await import('node:child_process');
  const script = `
    const run = async () => {
      const dbm = await import('./src/db.js');
      await import('./src/scheduling.js');
      await import('./src/task-events.js');
      await import('./src/task-lifecycle.js');
      const { runReminderEngine } = await import('./src/reminders.js');
      await runReminderEngine();
      const tasks = dbm.listTasks({ status: 'all', limit: 50 });
      const reminders = dbm.db.prepare('SELECT COUNT(*) n FROM reminders').get().n;
      process.stdout.write(JSON.stringify({
        tasks: tasks.map((t) => t.title),
        // The whole row for the cases that are about what a task says it came
        // from, rather than about the table still being readable.
        rows: tasks.map(({ title, chat_name, contact, is_group }) =>
          ({ title, chat_name, contact, is_group })),
        reminders,
      }));
    };
    run().then(() => process.exit(0)).catch((e) => { process.stderr.write(e.message); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, EXTRACTION_MODE: 'manual', TIMEZONE: 'Asia/Kolkata' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out.slice(out.indexOf('{')));
}

/*
 * A deadline that is still ahead, whenever this suite is run.
 *
 * It used to be the literal '2026-09-10', which was days away when it was
 * written and is today as this is read: the ladder builds one rung before the
 * deadline, one at it and one after, so a deadline that has already gone by
 * leaves a single rung and three cases fail for the calendar rather than for
 * the migration they are about. The date has to move with the clock.
 */
const AHEAD = new Date(Date.now() + 5 * 86400000)
  .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** The tasks table as the earliest deployed versions had it. */
const OLD_TASKS = `
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    contact TEXT,
    chat_name TEXT,
    chat_id TEXT,
    message_id INTEGER,
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    source TEXT NOT NULL DEFAULT 'whatsapp',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  INSERT INTO tasks (title, due_date, status, source) VALUES ('Old task', '${AHEAD}', 'open', 'manual');
`;

console.log('\nupgrading a database that already exists');

await run('the reminders table from the follow-up design gains kind and round', async () => {
  // This is the exact shape that stopped the deployed service starting: the
  // table hung off follow_ups, and had neither of the columns the index needs.
  const dir = seed(`
    ${OLD_TASKS}
    CREATE TABLE follow_ups (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
    INSERT INTO follow_ups (title) VALUES ('chase somebody, from the removed design');
    CREATE TABLE reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      follow_up_id INTEGER REFERENCES follow_ups(id) ON DELETE CASCADE,
      fire_at TEXT NOT NULL,
      offset_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'scheduled',
      triggered_at TEXT,
      acknowledged_at TEXT,
      snooze_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO reminders (follow_up_id, fire_at) VALUES (1, '2026-09-01T00:00:00.000Z');
  `);

  const result = await loadCurrentCodeAgainst(dir);
  assert.deepEqual(result.tasks, ['Old task'], 'the task survives the upgrade');
  // The orphaned row from the removed design is gone, and a real ladder -
  // one before the deadline, one at it, one after - stands in its place.
  assert.equal(result.reminders, 3, 'the ladder is rebuilt from the deadline');
});

await run('a database with no reminders table at all is simply created', async () => {
  const dir = seed(OLD_TASKS);
  const result = await loadCurrentCodeAgainst(dir);
  assert.deepEqual(result.tasks, ['Old task']);
  assert.equal(result.reminders, 3);
});

await run('a current-shape database is left alone', async () => {
  // Nothing to migrate: the same load must not clear reminders it did not add
  // a column to, or every restart would throw the schedule away.
  const dir = seed(OLD_TASKS);
  const first = await loadCurrentCodeAgainst(dir);
  assert.equal(first.reminders, 3);
  const second = await loadCurrentCodeAgainst(dir);
  assert.equal(second.reminders, 3, 'a second start keeps the same reminders');
});

await run('the notifications table from the follow-up design still accepts rows', async () => {
  const dir = seed(`
    ${OLD_TASKS}
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      task_id INTEGER,
      follow_up_id INTEGER,
      reminder_id INTEGER,
      read_at TEXT,
      dismissed_at TEXT
    );
  `);
  const result = await loadCurrentCodeAgainst(dir);
  assert.deepEqual(result.tasks, ['Old task']);
});

console.log('\nwhat a stored task says it came from');

await run('a task whose chat name is really the sender is given its group back', async () => {
  /*
   * The shape on the deployed service. The extractor used to take the model's
   * answer to "which chat?" ahead of the message's own, and the model answers
   * with the person who wrote it - so the task had "Preeti Khandelwal" as both
   * the sender and the chat, the row printed the one name, and the group the
   * work came from was nowhere on it.
   *
   * The message is still there and still knows, so the repair is a join.
   */
  const dir = seed(`
    ${OLD_TASKS}
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT UNIQUE,
      chat_id TEXT NOT NULL,
      chat_name TEXT,
      contact_name TEXT,
      contact_number TEXT,
      body TEXT NOT NULL,
      is_group INTEGER NOT NULL DEFAULT 0,
      from_me INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO messages (id, chat_id, chat_name, contact_name, body, is_group, sent_at)
    VALUES (1, 'g-vikas@g.us', 'Vikas Travel | Pinetree accounting services',
            'Preeti Khandelwal', 'check the formalities', 1, '2026-09-08T00:00:00Z');

    INSERT INTO tasks (title, chat_name, contact, chat_id, message_id, status, source)
    VALUES ('Check with your China contact about rep office formalities',
            'Preeti Khandelwal', 'Preeti Khandelwal', 'g-vikas@g.us', 1, 'open', 'whatsapp');
  `);

  const { rows } = await loadCurrentCodeAgainst(dir);
  const task = rows.find((t) => t.title.startsWith('Check with your China'));

  assert.equal(task.chat_name, 'Vikas Travel | Pinetree accounting services',
    'the group it came from');
  assert.equal(task.contact, 'Preeti Khandelwal', 'and the person who wrote it');
  assert.equal(task.is_group, 1);
  assert.notEqual(task.chat_name, task.contact,
    'two different facts, so the row can print both');
});

await run('a one-to-one task is left exactly as it is', async () => {
  const dir = seed(`
    ${OLD_TASKS}
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT UNIQUE,
      chat_id TEXT NOT NULL,
      chat_name TEXT,
      contact_name TEXT,
      contact_number TEXT,
      body TEXT NOT NULL,
      is_group INTEGER NOT NULL DEFAULT 0,
      from_me INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO messages (id, chat_id, chat_name, contact_name, body, is_group, sent_at)
    VALUES (1, '9198@c.us', 'Meera Jariwala', 'Meera Jariwala', 'bhej dena', 0, '2026-09-08T00:00:00Z');

    INSERT INTO tasks (title, chat_name, contact, chat_id, message_id, status, source)
    VALUES ('Send the list', 'Ajay at IDMC', 'Ajay at IDMC', '9198@c.us', 1, 'open', 'whatsapp');
  `);

  const { rows } = await loadCurrentCodeAgainst(dir);
  const task = rows.find((t) => t.title === 'Send the list');
  // In a private chat the model may have named somebody the message only
  // mentions, and that is more useful than the chat's own name. Only groups
  // are repaired.
  assert.equal(task.chat_name, 'Ajay at IDMC');
  assert.equal(task.is_group, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
