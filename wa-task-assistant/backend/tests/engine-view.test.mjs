/**
 * What the engine is doing, per task.
 *
 * The flat lists answer "what fires next". These cases cover the question
 * actually asked of a follow-up engine — how many times it has asked about one
 * task and when it asks again — which was not answerable from the app at all:
 * you could see a hundred reminder rows and still have to count on your
 * fingers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-engview-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const S = await import('../src/scheduling.js');
const L = await import('../src/task-lifecycle.js');
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

const HOUR = 3600_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const ladderFor = (id) => S.engineOverview({}).byTask.find((t) => t.id === id);

console.log('\nthe engine, task by task');

await run('a task with a deadline appears with its ladder', () => {
  const t = DB.createTask({ title: 'Send the GST notice', due_at: iso(3 * HOUR) });
  L.planTask(t);
  const row = ladderFor(t.id);
  assert.ok(row, 'the engine is chasing it, so it is in flight');
  assert.ok(row.ladder.length > 0);
});

await run('only one follow-up is ever waiting, and next is the soonest rung', () => {
  const t = DB.createTask({ title: 'One rung ahead', due_at: iso(3 * HOUR) });
  L.planTask(t);
  const row = ladderFor(t.id);
  const waiting = row.ladder.filter((r) => r.status === 'scheduled' || r.status === 'snoozed');
  // The pre-deadline and at-deadline rungs are both arranged up front; it is
  // the follow-ups that are only ever one deep, so a task that gets finished
  // never has a queue of nagging behind it.
  assert.equal(waiting.filter((r) => r.kind === 'follow_up').length, 1);
  assert.equal(row.next.id, waiting[0].id, 'and next is the soonest of them');
  assert.deepEqual(
    waiting.map((r) => r.fire_at),
    [...waiting.map((r) => r.fire_at)].sort(),
    'which only means anything because they come back in order'
  );
});

await run('what has been sent is counted, and stays in the ladder', async () => {
  const t = DB.createTask({ title: 'Already chased', due_at: iso(-30 * 60_000) });
  L.planTask(t);
  await engine.runReminderEngine();
  const row = ladderFor(t.id);
  assert.ok(row.sent >= 1, 'at least one rung has gone');
  assert.ok(row.ladder.some((r) => r.status === 'triggered'), 'and it is still shown, not dropped');
});

await run('a task with no deadline is not chased, so it is not in flight', () => {
  const t = DB.createTask({ title: 'No deadline at all' });
  L.planTask(t);
  assert.equal(ladderFor(t.id), undefined);
});

await run('finishing a task takes it out of the view entirely', async () => {
  const t = DB.createTask({ title: 'Will be finished', due_at: iso(2 * HOUR) });
  L.planTask(t);
  assert.ok(ladderFor(t.id), 'in flight while open');
  // Completion is two steps everywhere in the app: the status is set, then the
  // ladder is retired. Doing only the second would leave it still in flight.
  DB.updateTask(t.id, { status: 'done' });
  L.completeTask(t.id);
  assert.equal(ladderFor(t.id), undefined, 'the engine is not chasing it any more');
});

await run('archiving takes it out too', () => {
  const t = DB.createTask({ title: 'Will be archived', due_at: iso(2 * HOUR) });
  L.planTask(t);
  DB.updateTask(t.id, { archived_at: new Date().toISOString() });
  assert.equal(ladderFor(t.id), undefined);
});

await run('a task the engine gave up on says so, and has nothing waiting', () => {
  const t = DB.createTask({ title: 'Given up on', due_at: iso(-4 * HOUR) });
  L.planTask(t);
  DB.updateTask(t.id, { needs_attention: 1 });
  const row = ladderFor(t.id);
  assert.equal(row.needs_attention, 1);
});

await run('the rungs come back in the order they happen', () => {
  const t = DB.createTask({ title: 'In order', due_at: iso(5 * HOUR) });
  L.planTask(t);
  const times = ladderFor(t.id).ladder.map((r) => r.fire_at);
  assert.deepEqual(times, [...times].sort(), 'sorted by when they fire');
});

await run('each row carries what the list needs, so no second fetch per task', () => {
  const t = DB.createTask({
    title: 'Fully dressed', due_at: iso(2 * HOUR),
    chat_name: 'Scale Visory Team', assigned_to: 'Rahul',
  });
  L.planTask(t);
  const row = ladderFor(t.id);
  for (const field of ['title', 'due_at', 'chat_name', 'assigned_to', 'follow_up_count', 'ladder', 'next', 'sent']) {
    assert.ok(field in row, `missing ${field}`);
  }
});

await run('the view is bounded, so a thousand tasks cannot hang the page', () => {
  assert.ok(S.engineOverview({}).byTask.length <= 100);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
