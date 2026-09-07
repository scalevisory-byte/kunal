/**
 * A task nobody got to must still stop being chased.
 *
 * This is the case the audit found. A task whose deadline is long past - a
 * holiday, a week off, a server that was down - has follow-ups that are already
 * older than `missedAfterHours` by the time the engine sees them. Those were
 * marked missed and skipped, which meant the follow-up count never moved, the
 * cap was never reached, and planOpenTasks scheduled the rung again on the very
 * next tick: a fresh row and a fresh notification every five minutes, forever.
 *
 * The cap is the difference between reminding and spamming, so it has to hold
 * for work that was missed as much as for work that was refused.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-runaway-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const S = await import('../src/scheduling.js');
const R = await import('../src/reminders.js');

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

const countFor = (taskId) =>
  DB.db.prepare(`SELECT COUNT(*) AS n FROM reminders WHERE task_id = ?`).get(taskId).n;
const notificationsFor = (taskId) =>
  DB.db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE task_id = ?`).get(taskId).n;

console.log('\na long-overdue task does not grow without limit');

await run('forty engine ticks do not produce forty follow-ups', async () => {
  S.saveSettings({ followUpEnabled: true, followUpMax: 3, notifyWhatsApp: false, notifyBrowser: false });

  // Deadline years in the past: every rung is already "missed" on sight.
  const task = DB.createTask({
    title: 'Forgotten over a long holiday',
    status: 'open',
    source: 'manual',
    due_at: '2020-01-01T12:30:00.000Z',
  });

  for (let tick = 0; tick < 40; tick += 1) {
    await R.runReminderEngine({ now: new Date() });
  }

  const rows = countFor(task.id);
  const notes = notificationsFor(task.id);
  // Three rungs plus the pre-due and at-due reminders is the whole ladder.
  assert.ok(rows <= 6, `${rows} reminder rows were created; the ladder is at most 3 follow-ups`);
  assert.ok(notes <= 8, `${notes} notifications were raised for one task`);
});

await run('and it ends up flagged, not silently looping', () => {
  const task = DB.db.prepare(`SELECT * FROM tasks WHERE title = ?`).get('Forgotten over a long holiday');
  assert.equal(task.needs_attention, 1, 'the task is flagged for attention');
  assert.equal(task.follow_up_count, 3, 'all three rungs were counted, missed or not');
});

await run('a flagged task is left alone by later ticks', async () => {
  const task = DB.db.prepare(`SELECT * FROM tasks WHERE title = ?`).get('Forgotten over a long holiday');
  const before = countFor(task.id);
  for (let tick = 0; tick < 10; tick += 1) await R.runReminderEngine({ now: new Date() });
  assert.equal(countFor(task.id), before, 'nothing new was scheduled after the cap');
});

await run('completing it stops everything, however overdue it was', async () => {
  const task = DB.db.prepare(`SELECT * FROM tasks WHERE title = ?`).get('Forgotten over a long holiday');
  DB.updateTask(task.id, { status: 'done' });
  const { completeTask } = await import('../src/task-lifecycle.js');
  completeTask(task.id);

  const active = DB.db
    .prepare(`SELECT COUNT(*) AS n FROM reminders WHERE task_id = ? AND status IN ('scheduled','snoozed')`)
    .get(task.id).n;
  assert.equal(active, 0);

  const before = countFor(task.id);
  for (let tick = 0; tick < 5; tick += 1) await R.runReminderEngine({ now: new Date() });
  assert.equal(countFor(task.id), before, 'a finished task is never scheduled again');
});

console.log('\na task due in the future is untouched by all of this');

await run('a normal task still gets its full ladder, once', async () => {
  const soon = new Date(Date.now() + 3 * 3600_000).toISOString();
  const task = DB.createTask({ title: 'Due in three hours', status: 'open', source: 'manual', due_at: soon });

  for (let tick = 0; tick < 5; tick += 1) await R.runReminderEngine({ now: new Date() });

  const rows = DB.db.prepare(`SELECT kind, round, status FROM reminders WHERE task_id = ?`).all(task.id);
  const scheduled = rows.filter((r) => r.status === 'scheduled');
  assert.ok(scheduled.length >= 1 && scheduled.length <= 3, `${scheduled.length} scheduled`);
  // No kind/round pair appears twice.
  const keys = rows.map((r) => `${r.kind}:${r.round}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate rung');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
