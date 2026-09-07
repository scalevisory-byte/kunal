/**
 * Checklists, dependencies, templates, attachments, and holding back an
 * extraction the model was unsure about.
 *
 * The cases that matter are the ones where these touch the reminder engine:
 * a checklist must not finish a task by itself, a dependency must not be
 * allowed to form a loop, and an unconfirmed task must not be chased.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-extras-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const S = await import('../src/subtasks.js');
const D = await import('../src/dependencies.js');
const T = await import('../src/templates.js');
const A = await import('../src/attachments.js');
const L = await import('../src/task-lifecycle.js');
const { safeDisplayName } = await import('../src/safe-name.js');

let passed = 0;
let failed = 0;
const run = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const task = (title, extra = {}) =>
  DB.createTask({ title, status: 'open', source: 'manual', ...extra });

console.log('\nthe day and the moment agree');

run('a deadline given as a moment gets the day it falls on', () => {
  // 12:30 UTC is 18:00 in Kolkata, so the task belongs to that same day there.
  const t = DB.createTask({
    title: 'Only a moment', status: 'open', source: 'manual',
    due_at: '2026-10-05T12:30:00.000Z',
  });
  assert.equal(t.due_date, '2026-10-05');
});

run('a moment late in the UTC evening belongs to the next day here', () => {
  // 20:00 UTC on the 5th is 01:30 on the 6th in Kolkata. The list groups by the
  // day, so getting this wrong files the task under the wrong heading.
  const t = DB.createTask({
    title: 'Late instant', status: 'open', source: 'manual',
    due_at: '2026-10-05T20:00:00.000Z',
  });
  assert.equal(t.due_date, '2026-10-06');
});

run('a day the caller gave is never overwritten', () => {
  const t = DB.createTask({
    title: 'Both given', status: 'open', source: 'manual',
    due_date: '2026-10-09', due_at: '2026-10-09T12:30:00.000Z',
  });
  assert.equal(t.due_date, '2026-10-09');
});

run('moving the moment moves the day with it', () => {
  const t = DB.createTask({ title: 'Move me', status: 'open', source: 'manual', due_date: '2026-10-01' });
  const moved = DB.updateTask(t.id, { due_at: '2026-11-20T12:30:00.000Z' });
  assert.equal(moved.due_date, '2026-11-20', 'the row no longer sits under October');
});

run('clearing the moment clears the day', () => {
  const t = DB.createTask({
    title: 'Clear me', status: 'open', source: 'manual', due_at: '2026-10-05T12:30:00.000Z',
  });
  const cleared = DB.updateTask(t.id, { due_at: null });
  assert.equal(cleared.due_date, null);
});

console.log('\nchecklists');

run('items keep the order they were added, and count as progress', () => {
  const t = task('Close the month');
  S.addSubtask(t.id, 'Pull the bank statement');
  S.addSubtask(t.id, 'Match the invoices');
  S.addSubtask(t.id, 'File the return');

  const items = S.subtasksFor(t.id);
  assert.deepEqual(items.map((i) => i.title), [
    'Pull the bank statement', 'Match the invoices', 'File the return',
  ]);
  assert.deepEqual(S.subtaskProgress(t.id), { total: 3, done: 0 });

  S.updateSubtask(items[0].id, { done: true });
  assert.deepEqual(S.subtaskProgress(t.id), { total: 3, done: 1 });
});

run('ticking every box does NOT finish the parent task', () => {
  // Completing a task cancels its whole reminder ladder and writes a completion
  // into the permanent record. That must stay one explicit action.
  const t = task('Quarterly filing', { due_date: '2026-10-10' });
  const a = S.addSubtask(t.id, 'one');
  const b = S.addSubtask(t.id, 'two');
  S.updateSubtask(a.id, { done: true });
  S.updateSubtask(b.id, { done: true });

  assert.equal(DB.getTask(t.id).status, 'open', 'the task is still open');
  assert.deepEqual(S.subtaskProgress(t.id), { total: 2, done: 2 });
});

run('unticking an item clears its completion time', () => {
  const t = task('Reopen me');
  const item = S.addSubtask(t.id, 'thing');
  const done = S.updateSubtask(item.id, { done: true });
  assert.ok(done.completed_at, 'finishing stamps a time');
  const undone = S.updateSubtask(item.id, { done: false });
  assert.equal(undone.completed_at, null, 'unticking clears it rather than leaving a stale time');
});

run('an empty title is refused rather than stored blank', () => {
  const t = task('Host');
  assert.throws(() => S.addSubtask(t.id, '   '), /title/);
});

run('deleting the task takes its checklist with it', () => {
  const t = task('Temporary');
  S.addSubtask(t.id, 'child');
  DB.deleteTask(t.id);
  assert.equal(S.subtasksFor(t.id).length, 0);
});

console.log('\ndependencies');

run('a task is blocked while what it waits on is unfinished', () => {
  const invoice = task('Get the invoice approved');
  const pay = task('Pay the vendor');
  D.addDependency(pay.id, invoice.id);

  assert.equal(D.isBlocked(pay.id), true);
  assert.deepEqual(D.openBlockers(pay.id).map((b) => b.title), ['Get the invoice approved']);

  DB.updateTask(invoice.id, { status: 'done' });
  assert.equal(D.isBlocked(pay.id), false, 'finishing the blocker frees it');
});

run('a loop is refused, however long the chain', () => {
  const a = task('A');
  const b = task('B');
  const c = task('C');
  D.addDependency(b.id, a.id); // B waits on A
  D.addDependency(c.id, b.id); // C waits on B

  // A waiting on C would mean nothing in the chain could ever start.
  assert.throws(() => D.addDependency(a.id, c.id), /loop/);
  assert.throws(() => D.addDependency(a.id, a.id), /itself/);
});

run('the same dependency twice is one dependency', () => {
  const x = task('X');
  const y = task('Y');
  D.addDependency(x.id, y.id);
  D.addDependency(x.id, y.id);
  assert.equal(D.blockersOf(x.id).length, 1);
});

run('finishing a task reports only what it actually freed', () => {
  const first = task('First');
  const second = task('Second');
  const waiter = task('Waits on both');
  D.addDependency(waiter.id, first.id);
  D.addDependency(waiter.id, second.id);

  // One of two blockers done is not freedom.
  DB.updateTask(first.id, { status: 'done' });
  assert.deepEqual(D.unblockedBy(first.id), [], 'still waiting on the other one');

  DB.updateTask(second.id, { status: 'done' });
  assert.deepEqual(D.unblockedBy(second.id).map((t) => t.title), ['Waits on both']);
});

run('a blocked task still keeps its reminders', () => {
  // Going quiet on a deadline is how things get forgotten. The reminder says
  // what is in the way instead of disappearing.
  const blocker = task('Blocker');
  const blocked = task('Blocked but due', { due_date: '2026-10-15' });
  D.addDependency(blocked.id, blocker.id);

  const planned = L.planTask(DB.getTask(blocked.id));
  assert.ok(planned.planned > 0, 'a ladder is still built for a blocked task');
});

console.log('\ntemplates');

run('a template becomes an ordinary task, with its checklist', () => {
  const template = T.createTemplate({
    name: 'Monthly GST',
    title: 'File GST return',
    priority: 'high',
    due_in_days: 2,
    due_time: '18:00',
    subtasks: ['Collect invoices', 'Reconcile', 'File'],
  });

  const draft = T.taskFromTemplate(template);
  assert.equal(draft.title, 'File GST return');
  assert.equal(draft.priority, 'high');
  assert.ok(draft.due_at, 'due_in_days produces a real deadline');

  const made = task(draft.title, { priority: draft.priority, due_at: draft.due_at });
  S.addSubtasks(made.id, template.subtasks);
  assert.equal(S.subtaskProgress(made.id).total, 3);
});

run('a deadline from a template is on the user clock, not the server one', () => {
  const template = T.createTemplate({
    name: 'Evening thing', title: 'Do it', due_in_days: 0, due_time: '18:00',
  });
  const draft = T.taskFromTemplate(template);
  // 18:00 in Kolkata is 12:30 UTC. Reading it as server-local would say 18:00Z.
  assert.match(draft.due_at, /T12:30:00\.000Z$/);
});

run('a template needs both a name and a title', () => {
  assert.throws(() => T.createTemplate({ title: 'no name' }), /name/);
  assert.throws(() => T.createTemplate({ name: 'no title' }), /title/);
});

run('two templates cannot share a name', () => {
  T.createTemplate({ name: 'Unique one', title: 'x' });
  assert.throws(() => T.createTemplate({ name: 'Unique one', title: 'y' }), /UNIQUE|unique/i);
});

console.log('\nattachments');

run('a file is stored, read back byte for byte, and counted', () => {
  const t = task('Has a file');
  const bytes = Buffer.from('invoice contents, pretend this is a PDF');
  const saved = A.addAttachment(t.id, { filename: 'invoice.pdf', mime: 'application/pdf', buffer: bytes });

  assert.equal(saved.filename, 'invoice.pdf');
  assert.equal(saved.bytes, bytes.length);

  const back = A.readAttachment(saved.id);
  assert.ok(back.buffer.equals(bytes), 'the bytes come back unchanged');
  assert.equal(back.inline, true, 'a PDF may be shown in the browser');
  assert.equal(A.attachmentsFor(t.id).length, 1);
});

run('an oversized file is refused before anything is written', () => {
  const t = task('Too big');
  const before = A.storageState();
  assert.throws(
    () => A.addAttachment(t.id, { filename: 'huge.bin', mime: 'application/octet-stream', buffer: Buffer.alloc(11 * 1024 * 1024) }),
    /limited to/
  );
  assert.equal(A.storageState().used, before.used, 'nothing was stored');
});

run('an empty file is refused', () => {
  const t = task('Empty');
  assert.throws(() => A.addAttachment(t.id, { filename: 'nothing', mime: 'text/plain', buffer: Buffer.alloc(0) }), /empty/);
});

run('deleting an attachment frees the space and removes the file', () => {
  const t = task('Delete me');
  const saved = A.addAttachment(t.id, { filename: 'a.txt', mime: 'text/plain', buffer: Buffer.from('hello') });
  const stored = path.join(A.attachmentDir, DB.db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(saved.id).stored_name);
  assert.ok(fs.existsSync(stored));

  A.deleteAttachment(saved.id);
  assert.equal(fs.existsSync(stored), false, 'the bytes are gone, not just the row');
  assert.equal(A.attachmentsFor(t.id).length, 0);
});

run('a filename cannot escape the store or carry control characters', () => {
  assert.equal(safeDisplayName('../../etc/passwd'), 'passwd');
  assert.equal(safeDisplayName('C:\\Windows\\evil.exe'), 'evil.exe');
  assert.equal(safeDisplayName('...'), 'file');
  assert.equal(safeDisplayName(''), 'file');
  // A name the user would recognise survives intact, Hindi included.
  assert.equal(safeDisplayName('GST return सितंबर.pdf'), 'GST return सितंबर.pdf');
});

run('bytes with no row behind them are cleared away', () => {
  const stray = path.join(A.attachmentDir, 'orphan-from-a-crash.bin');
  fs.writeFileSync(stray, 'left behind');
  assert.equal(A.pruneOrphanFiles() >= 1, true);
  assert.equal(fs.existsSync(stray), false);
});

console.log('\nholding back what the model was unsure about');

run('a low-confidence task is created but not chased', () => {
  const unsure = DB.createTask({
    title: 'Maybe send the thing',
    status: 'open',
    source: 'whatsapp',
    origin: 'ai',
    due_date: '2026-10-20',
    ai_confidence: 'low',
    needs_confirmation: 1,
  });

  assert.equal(unsure.needs_confirmation, 1);
  const planned = L.planTask(unsure);
  assert.equal(planned.planned, 0, 'no reminder ladder is built');
  assert.equal(planned.reason, 'awaiting confirmation');
});

run('confirming it lets the ladder be built', () => {
  const unsure = DB.createTask({
    title: 'Confirm then chase', status: 'open', source: 'whatsapp', origin: 'ai',
    due_date: '2026-10-21', ai_confidence: 'low', needs_confirmation: 1,
  });
  DB.updateTask(unsure.id, { needs_confirmation: 0 });
  const planned = L.planTask(DB.getTask(unsure.id));
  assert.ok(planned.planned > 0, 'once confirmed it is scheduled like any other task');
});

run('a high-confidence task is never held back', () => {
  const sure = DB.createTask({
    title: 'Definitely a task', status: 'open', source: 'whatsapp', origin: 'ai',
    due_date: '2026-10-22', ai_confidence: 'high',
  });
  assert.equal(sure.needs_confirmation, 0);
  assert.ok(L.planTask(sure).planned > 0);
});

run('the digest skips anything still awaiting confirmation', () => {
  DB.createTask({
    title: 'Unsure and undated', status: 'open', source: 'whatsapp', origin: 'ai',
    ai_confidence: 'low', needs_confirmation: 1,
  });
  const titles = DB.pendingReminders('2026-12-31').map((t) => t.title);
  assert.equal(titles.includes('Unsure and undated'), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
