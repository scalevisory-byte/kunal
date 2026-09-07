/**
 * What is happening on a task.
 *
 * Three questions were being asked of one field: whether work is owed
 * (status), how far along it is (stage), and what was last said about it (the
 * update). The cases here pin down that they stay three — in particular that
 * writing an update never touches the deadline or the reminder ladder, because
 * saying where something has got to is not the same as changing when it is
 * due, and a note that quietly reschedules is worse than no note.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-prog-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';
delete process.env.DASHBOARD_PASSWORD;

const DB = await import('../src/db.js');
const P = await import('../src/progress.js');
const E = await import('../src/task-events.js');
const R = await import('../src/reminders.js');
const B = await import('../src/briefing.js');
const { createServer } = await import('../src/server.js');

const server = await new Promise((resolve) => {
  const s = createServer().listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

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

console.log('\nprogress on a task');

await run('an update is written down and read back', () => {
  const t = DB.createTask({ title: 'GST notice reply' });
  P.addUpdate(t.id, { body: 'CA ko documents bhej diye' });
  const [latest] = P.updatesFor(t.id);
  assert.equal(latest.body, 'CA ko documents bhej diye');
  assert.equal(latest.stage, null, 'news is not a stage change');
});

await run('updates read newest first, and every one is kept', () => {
  const t = DB.createTask({ title: 'Sunshine audit' });
  P.addUpdate(t.id, { body: 'first' });
  P.addUpdate(t.id, { body: 'second' });
  P.addUpdate(t.id, { body: 'third' });
  assert.deepEqual(P.updatesFor(t.id).map((u) => u.body), ['third', 'second', 'first']);
});

await run('a stage moves the task and is remembered on the update that moved it', () => {
  const t = DB.createTask({ title: 'IDMC audit query' });
  P.addUpdate(t.id, { body: 'sent across', stage: 'With the CA' });
  assert.equal(DB.getTask(t.id).stage, 'With the CA');
  assert.equal(P.updatesFor(t.id)[0].stage, 'With the CA');
});

await run('an update with no stage leaves the stage where it was', () => {
  const t = DB.createTask({ title: 'Arrohan TDS' });
  P.addUpdate(t.id, { body: 'filed', stage: 'Waiting for challan' });
  P.addUpdate(t.id, { body: 'chased them again' });
  assert.equal(DB.getTask(t.id).stage, 'Waiting for challan', 'news does not undo a stage');
});

await run('a stage can be cleared without deleting the history', () => {
  const t = DB.createTask({ title: 'Cleared stage' });
  P.addUpdate(t.id, { body: 'started', stage: 'In review' });
  P.addUpdate(t.id, { body: 'no longer in review', stage: '' });
  assert.equal(DB.getTask(t.id).stage, null);
  assert.equal(P.updatesFor(t.id).length, 2, 'both updates survive');
});

await run('an empty update is refused rather than stored', () => {
  const t = DB.createTask({ title: 'Nothing to say' });
  assert.throws(() => P.addUpdate(t.id, { body: '   ' }));
  assert.equal(P.updatesFor(t.id).length, 0);
});

await run('an update never touches the deadline or the status', async () => {
  const due = new Date(Date.now() + 4 * 3600_000).toISOString();
  const t = DB.createTask({ title: 'Send the notice', due_at: due, status: 'in_progress' });
  await call('POST', `/api/tasks/${t.id}/updates`, { body: 'lawyer ne draft bheja', stage: 'Draft received' });
  const after = DB.getTask(t.id);
  assert.equal(after.due_at, due, 'writing a note is not rescheduling');
  assert.equal(after.status, 'in_progress');
  assert.equal(after.stage, 'Draft received');
});

await run('the move between stages is in the permanent record', async () => {
  const t = DB.createTask({ title: 'Recorded stage' });
  await call('POST', `/api/tasks/${t.id}/updates`, { body: 'x', stage: 'Quote sent' });
  await call('POST', `/api/tasks/${t.id}/updates`, { body: 'y', stage: 'Quote approved' });
  const kinds = E.eventsForTask(t.id).filter((e) => e.kind === 'stage changed').map((e) => e.detail);
  assert.deepEqual(kinds, ['Quote sent', 'Quote approved'], 'both moves, not just the last');
});

await run('an update that changes nothing is recorded as progress, not as a move', async () => {
  const t = DB.createTask({ title: 'Same stage twice' });
  await call('POST', `/api/tasks/${t.id}/updates`, { body: 'a', stage: 'On hold' });
  await call('POST', `/api/tasks/${t.id}/updates`, { body: 'b', stage: 'On hold' });
  const kinds = E.eventsForTask(t.id).map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'stage changed').length, 1);
  assert.equal(kinds.filter((k) => k === 'progress noted').length, 1);
});

await run('the list carries the last update, so a row need not fetch its own', async () => {
  const t = DB.createTask({ title: 'Shown on the row' });
  P.addUpdate(t.id, { body: 'older' });
  P.addUpdate(t.id, { body: 'newest thing said' });
  const res = await call('GET', '/api/tasks?status=all&limit=500');
  const row = res.body.tasks.find((x) => x.id === t.id);
  assert.equal(row.latest_update.body, 'newest thing said');
  assert.equal(row.update_count, 2);
});

await run('a task with nothing written on it carries nothing', async () => {
  const t = DB.createTask({ title: 'Untouched' });
  const res = await call('GET', '/api/tasks?status=all&limit=500');
  const row = res.body.tasks.find((x) => x.id === t.id);
  assert.equal(row.latest_update, null);
  assert.equal(row.update_count, 0);
});

await run('stages already used are offered back, most-used first', () => {
  const stages = P.knownStages();
  assert.ok(stages.includes('With the CA'));
  assert.ok(stages.includes('On hold'));
});

await run('the same stage typed in different case is one suggestion', () => {
  const t = DB.createTask({ title: 'Casing' });
  P.addUpdate(t.id, { body: 'a', stage: 'Site visit' });
  const t2 = DB.createTask({ title: 'Casing 2' });
  P.addUpdate(t2.id, { body: 'b', stage: 'site visit' });
  const hits = P.knownStages(50).filter((s) => s.toLowerCase() === 'site visit');
  assert.equal(hits.length, 1);
});

await run('an update can be removed, and takes nothing else with it', async () => {
  const t = DB.createTask({ title: 'Typo' });
  const bad = P.addUpdate(t.id, { body: 'wrng' });
  P.addUpdate(t.id, { body: 'right' });
  const res = await call('DELETE', `/api/tasks/${t.id}/updates/${bad.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.updates.map((u) => u.body), ['right']);
  assert.ok(DB.getTask(t.id), 'the task is untouched');
});

await run('deleting the task takes its updates with it', () => {
  const t = DB.createTask({ title: 'Gone' });
  P.addUpdate(t.id, { body: 'something' });
  DB.deleteTask(t.id);
  assert.equal(P.updatesFor(t.id).length, 0);
});

await run('the digest says what stage each task is at', () => {
  const t = DB.createTask({ title: 'Digest stage', due_date: new Date().toISOString().slice(0, 10) });
  P.addUpdate(t.id, { body: 'x', stage: 'Waiting for signature' });
  const text = R.buildDigest([DB.getTask(t.id)]);
  assert.match(text, /Waiting for signature/);
});

await run('a task with no stage adds no clutter to the digest', () => {
  const t = DB.createTask({ title: 'Plain task', due_date: new Date().toISOString().slice(0, 10) });
  const text = R.buildDigest([DB.getTask(t.id)]);
  assert.ok(!text.includes('📍'), 'the marker only appears where there is a stage');
});

await run('the morning briefing carries the stage too', () => {
  // Asked at nine in the morning, not at whatever hour the suite happens to
  // run: "due in two hours" is tomorrow after 10pm, and the case would fail
  // every evening for a reason that has nothing to do with stages.
  const at9 = new Date(
    `${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}T09:00:00+05:30`
  );
  const t = DB.createTask({
    title: 'Briefing stage',
    due_at: new Date(at9.getTime() + 2 * 3600_000).toISOString(),
  });
  P.addUpdate(t.id, { body: 'x', stage: 'With the bank' });
  const { text } = B.buildBriefing(at9);
  assert.match(text || '', /With the bank/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
server.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
