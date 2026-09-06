/**
 * Work history: the lifecycle a task leaves behind, and whether it beat its
 * deadline. History is only useful if it is never rewritten, so the cases here
 * lean on that - a deadline moved twice must show both moves.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-hist-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const db = await import('../src/db.js');
const S = await import('../src/scheduling.js');
const L = await import('../src/task-lifecycle.js');
const E = await import('../src/task-events.js');
const engine = await import('../src/reminders.js');

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

const iso = (ms) => new Date(Date.now() + ms).toISOString();
const HOUR = 3600_000;
const kindsOf = (id) => E.eventsForTask(id).map((e) => e.kind);

console.log('\nactivity log');

await run('a task records its creation and its deadline', () => {
  const t = db.createTask({ title: 'Audit review', due_at: iso(3 * HOUR) });
  E.recordEvent(t.id, E.EVENT.created, 'added by hand');
  E.recordEvent(t.id, E.EVENT.deadlineSet, t.due_at);
  assert.deepEqual(kindsOf(t.id), ['created', 'deadline set']);
});

await run('scheduling and firing a reminder are both recorded', async () => {
  const t = db.createTask({ title: 'Recorded reminder', due_at: iso(-30 * 60_000) });
  L.planTask(t);
  await engine.runReminderEngine();
  const kinds = kindsOf(t.id);
  assert.ok(kinds.includes('follow-up scheduled'), `missing schedule event: ${kinds}`);
  assert.ok(kinds.includes('follow-up triggered'), `missing trigger event: ${kinds}`);
});

await run('every deadline move is kept, not just the last one', () => {
  const t = db.createTask({ title: 'Moved twice', due_at: iso(2 * HOUR) });
  L.rescheduleTask(t.id, { due_at: iso(24 * HOUR) });
  L.rescheduleTask(t.id, { due_at: iso(48 * HOUR) });
  const moves = E.eventsForTask(t.id).filter((e) => e.kind === 'deadline changed');
  assert.equal(moves.length, 2, 'both moves should survive');
  assert.ok(moves[0].meta.from, 'the previous deadline is recorded with the move');
});

await run('the original deadline is preserved on the task', () => {
  const first = iso(2 * HOUR);
  const t = db.createTask({ title: 'Keeps its first date', due_at: first });
  L.rescheduleTask(t.id, { due_at: iso(72 * HOUR) });
  const after = db.getTask(t.id);
  assert.equal(after.original_due_at, new Date(first).toISOString());
  assert.notEqual(after.due_at, after.original_due_at);
});

await run('completion is recorded with whether it was on time', () => {
  const t = db.createTask({ title: 'Beat the clock', due_at: iso(2 * HOUR) });
  db.updateTask(t.id, { status: 'done' });
  L.completeTask(t.id);
  const completed = E.eventsForTask(t.id).find((e) => e.kind === 'completed');
  assert.ok(completed);
  assert.equal(completed.detail, 'on time');
});

await run('a late finish is recorded as late', () => {
  const t = db.createTask({ title: 'Missed the clock', due_at: iso(-5 * HOUR) });
  db.updateTask(t.id, { status: 'done' });
  L.completeTask(t.id);
  assert.equal(E.eventsForTask(t.id).find((e) => e.kind === 'completed').detail, 'late');
});

await run('a task with no deadline is neither on time nor late', () => {
  const t = db.createTask({ title: 'Undated' });
  db.updateTask(t.id, { status: 'done' });
  assert.equal(L.onTimeLabel(db.getTask(t.id)), 'no deadline');
});

await run('counts reflect what actually happened', async () => {
  const t = db.createTask({ title: 'Counted', due_at: iso(-40 * 60_000) });
  L.planTask(t);
  await engine.runReminderEngine();
  const counts = E.eventCounts(t.id);
  assert.equal(counts.follow_ups, 1);
  assert.equal(counts.reschedules, 0);
});

console.log('\nwaiting');

await run('waiting is a real status and is not done', () => {
  const t = db.createTask({ title: 'GST documents from client' });
  const updated = db.updateTask(t.id, { status: 'waiting', waiting_for: 'ABC Pvt Ltd' });
  assert.equal(updated.status, 'waiting');
  assert.equal(updated.waiting_for, 'ABC Pvt Ltd');
  assert.equal(updated.completed_at, null);
});

await run('a waiting task still counts as owed', () => {
  const before = db.taskStats().open + db.taskStats().in_progress + db.taskStats().waiting;
  const t = db.createTask({ title: 'Waiting on vendor' });
  db.updateTask(t.id, { status: 'waiting' });
  const stats = db.taskStats();
  assert.ok(stats.waiting >= 1);
  assert.ok(stats.open + stats.in_progress + stats.waiting > before);
});

await run('a waiting task keeps being reminded about', () => {
  const t = db.createTask({ title: 'Waiting but dated', due_at: iso(3 * HOUR) });
  db.updateTask(t.id, { status: 'waiting' });
  L.planTask(db.getTask(t.id));
  const active = S.remindersForTask(t.id).filter((r) => r.status === 'scheduled');
  assert.ok(active.length > 0, 'waiting is not finished, so it is still chased');
});

console.log('\narchive');

await run('archiving keeps the row and its history', () => {
  const t = db.createTask({ title: 'Archive me', due_at: iso(2 * HOUR) });
  E.recordEvent(t.id, E.EVENT.created);
  db.updateTask(t.id, { archived_at: new Date().toISOString() });
  E.recordEvent(t.id, E.EVENT.archived);

  const after = db.getTask(t.id);
  assert.ok(after, 'the task still exists');
  assert.ok(after.archived_at);
  assert.ok(kindsOf(t.id).includes('archived'));
});

await run('an archived task leaves the active list', () => {
  const t = db.createTask({ title: 'Hidden from the board' });
  db.updateTask(t.id, { archived_at: new Date().toISOString() });
  const open = db.listTasks({ status: 'pending' });
  assert.ok(!open.some((x) => x.id === t.id));
});

await run('restoring clears the archive flag', () => {
  const t = db.createTask({ title: 'Back again' });
  db.updateTask(t.id, { archived_at: new Date().toISOString() });
  db.updateTask(t.id, { archived_at: '' });
  assert.equal(db.getTask(t.id).archived_at, null);
  assert.ok(db.listTasks({ status: 'pending' }).some((x) => x.id === t.id));
});

console.log('\nhistory view');

await run('a finished task carries its whole lifecycle', () => {
  const t = db.createTask({ title: 'Full story', due_at: iso(2 * HOUR) });
  E.recordEvent(t.id, E.EVENT.created);
  L.rescheduleTask(t.id, { due_at: iso(4 * HOUR) });
  db.updateTask(t.id, { status: 'done' });
  L.completeTask(t.id);

  const history = L.taskHistory(db.getTask(t.id));
  assert.ok(history.events.length >= 3);
  assert.ok(history.counts);
  assert.equal(history.on_time, 'on time');
  assert.ok(history.events.some((e) => e.kind === 'deadline changed'));
  assert.ok(history.events.some((e) => e.kind === 'completed'));
});

await run('history covers AI-created tasks the same way', () => {
  const t = db.createTask({ title: 'From WhatsApp', origin: 'ai', source: 'whatsapp', chat_name: 'ZyntaJobs', due_at: iso(HOUR) });
  E.recordEvent(t.id, E.EVENT.created, 'AI, from ZyntaJobs');
  db.updateTask(t.id, { status: 'done' });
  L.completeTask(t.id);
  const history = L.taskHistory(db.getTask(t.id));
  assert.equal(history.origin, 'ai');
  assert.equal(history.chat_name, 'ZyntaJobs');
  assert.ok(history.events.some((e) => e.detail?.includes('ZyntaJobs')));
});

await run('recent activity spans tasks and names them', () => {
  const rows = E.recentEvents(5);
  assert.ok(rows.length > 0);
  assert.ok(rows[0].task_title, 'each event knows which task it belongs to');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
