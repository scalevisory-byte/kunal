/**
 * Filing a task under the business it belongs to, after it exists.
 *
 * Routing puts a task in a group when it is created, but that is a guess made
 * from words in a message, and the corrections are the whole point: work
 * arrives from a chat that says nothing about which company it is for. So the
 * move has to be available on a task that is already on the list, it has to be
 * reversible, and it has to leave a trace - a task that silently changes which
 * list it appears in is a task that looks lost.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-filing-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';
delete process.env.DASHBOARD_PASSWORD;

const DB = await import('../src/db.js');
const G = await import('../src/groups.js');
const E = await import('../src/task-events.js');
const { createServer } = await import('../src/server.js');

const app = createServer();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
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

const bnf = G.createGroup({ name: 'Book N Fly', keywords: ['ticket'] });
const scale = G.createGroup({ name: 'Scale Visory', keywords: ['gst'] });

console.log('\nfiling a task under a business');

await run('a task with no group can be moved into one', async () => {
  const task = DB.createTask({ title: 'Call the auditor' });
  assert.equal(task.group_id, null, 'it starts unfiled');
  const res = await call('PATCH', `/api/tasks/${task.id}`, { group_id: scale.id });
  assert.equal(res.status, 200);
  assert.equal(res.body.group_id, scale.id);
  assert.equal(res.body.group_name, 'Scale Visory');
});

await run('a task in the wrong business can be moved to the right one', async () => {
  const task = DB.createTask({ title: 'Refund the Odisha ticket', group_id: scale.id });
  const res = await call('PATCH', `/api/tasks/${task.id}`, { group_id: bnf.id });
  assert.equal(res.body.group_name, 'Book N Fly');
});

await run('and taken back out of every group', async () => {
  const task = DB.createTask({ title: 'Personal errand', group_id: bnf.id });
  const res = await call('PATCH', `/api/tasks/${task.id}`, { group_id: null });
  assert.equal(res.body.group_id, null);
  assert.equal(res.body.group_name ?? null, null);
});

await run('the move is recorded, so a task that changed list can say why', async () => {
  const task = DB.createTask({ title: 'File GSTR-3B' });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: scale.id });
  const filed = E.eventsForTask(task.id).filter((e) => e.kind === 'filed');
  assert.equal(filed.length, 1);
  assert.equal(filed[0].detail, 'Scale Visory');
});

await run('every move is kept, not just the last one', async () => {
  const task = DB.createTask({ title: 'Moved twice' });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: scale.id });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: bnf.id });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: null });
  const filed = E.eventsForTask(task.id).filter((e) => e.kind === 'filed').map((e) => e.detail);
  assert.deepEqual(filed, ['Scale Visory', 'Book N Fly', 'no group']);
});

await run('moving it where it already is records nothing', async () => {
  const task = DB.createTask({ title: 'Already filed', group_id: bnf.id });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: bnf.id });
  assert.equal(E.eventsForTask(task.id).filter((e) => e.kind === 'filed').length, 0);
});

await run('a group deleted while the menu was open is refused, not a 500', async () => {
  const doomed = G.createGroup({ name: 'Temporary' });
  const task = DB.createTask({ title: 'Something' });
  G.deleteGroup(doomed.id);
  const res = await call('PATCH', `/api/tasks/${task.id}`, { group_id: doomed.id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /no longer exists/);
  assert.equal(DB.getTask(task.id).group_id, null, 'and the task is left where it was');
});

await run('moving a task does not disturb its deadline or its reminders', async () => {
  const due = new Date(Date.now() + 3600_000).toISOString();
  const task = DB.createTask({ title: 'Send the notice', due_at: due });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: bnf.id });
  const after = DB.getTask(task.id);
  assert.equal(after.due_at, due, 'filing is not rescheduling');
  assert.equal(after.status, 'open');
});

await run('undo is a move back, and lands where it started', async () => {
  const task = DB.createTask({ title: 'Wrong pick', group_id: scale.id });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: bnf.id });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: scale.id });
  assert.equal(DB.getTask(task.id).group_id, scale.id);
});

await run('the group counts follow the move', async () => {
  const before = G.groupCounts().get(bnf.id)?.open || 0;
  const task = DB.createTask({ title: 'Counted task' });
  await call('PATCH', `/api/tasks/${task.id}`, { group_id: bnf.id });
  assert.equal(G.groupCounts().get(bnf.id).open, before + 1);
});

await run('a task created inside a business starts there, not unfiled', async () => {
  // The route accepted every other column and silently dropped this one, so a
  // task added from inside a business landed outside it and had to be moved
  // into the place it was just created in.
  const res = await call('POST', '/api/tasks', { title: 'Refund the Nagpur booking', group_id: bnf.id });
  assert.equal(res.status, 201);
  assert.equal(res.body.group_id, bnf.id);
  assert.equal(res.body.group_name, 'Book N Fly');
});

await run('naming no business still creates a task, unfiled', async () => {
  const res = await call('POST', '/api/tasks', { title: 'Something general' });
  assert.equal(res.status, 201);
  assert.equal(res.body.group_id, null);
});

await run('a group that does not exist is refused in words, and leaves no task', async () => {
  const before = DB.listTasks({ status: 'all', limit: 500, includeSetAside: true }).length;
  const res = await call('POST', '/api/tasks', { title: 'Into nowhere', group_id: 999999 });
  assert.equal(res.status, 400);
  // Not "FOREIGN KEY constraint failed", which is true and useless.
  assert.match(res.body.error, /no longer exists/);
  assert.equal(DB.listTasks({ status: 'all', limit: 500, includeSetAside: true }).length, before);
});

/*
 * Renaming from the list, and what the record says afterwards.
 *
 * The title is what the list is read by, so a row that changed name is a row
 * he may not recognise - and "edited: title" is a true sentence that answers
 * nothing. The one thing the history has to be able to say is what it used to
 * be called.
 */
console.log('\nrenaming a task');

const editedIn = (events) => (events || []).find((e) => e.kind === 'edited');

await run('records what the task used to be called', async () => {
  const made = await call('POST', '/api/tasks', { title: 'Talk with Vikas Gupta' });
  assert.equal(made.status, 201);

  const patched = await call('PATCH', `/api/tasks/${made.body.id}`, {
    title: 'Talk with Vikas Gupta about the Sena GST refund',
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.title, 'Talk with Vikas Gupta about the Sena GST refund');

  const edited = editedIn(patched.body.events);
  assert.ok(edited, 'the rename is in the record');
  assert.match(edited.detail, /renamed from "Talk with Vikas Gupta"/);
});

await run('still names the fields for any other edit', async () => {
  const made = await call('POST', '/api/tasks', { title: 'Pay the electricity bill' });
  const patched = await call('PATCH', `/api/tasks/${made.body.id}`, { priority: 'high' });
  const edited = editedIn(patched.body.events);
  assert.ok(edited);
  assert.equal(edited.detail, 'priority');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
server.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
