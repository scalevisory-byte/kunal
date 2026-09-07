/**
 * "This is not a task."
 *
 * An ambient reader produces near-misses - a sales pitch, a price enquiry,
 * somebody's small talk. The list is only worth reading if throwing one out is
 * as quick as ticking one off.
 *
 * The half that matters is what happens afterwards. Until this, archiving took
 * a task off the list and *kept chasing it*: the twice-daily digest, the
 * exact-time reminder and the follow-up ladder all selected on `status !=
 * 'done'` and none of them looked at `archived_at`. So a task you had
 * explicitly thrown away still arrived on WhatsApp twice a day, with no row
 * left on the dashboard to finish it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-nottask-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const L = await import('../src/task-lifecycle.js');
const S = await import('../src/scheduling.js');
const E = await import('../src/task-events.js');

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

const today = new Date().toISOString().slice(0, 10);
const task = (title, extra = {}) =>
  DB.createTask({ title, status: 'open', source: 'whatsapp', origin: 'ai', due_date: today, ...extra });

/** Exactly what POST /api/tasks/:id/reject does, in the order it does it. */
const reject = (id) => {
  S.cancelRemindersForTask(id);
  DB.updateTask(id, { archived_at: new Date().toISOString(), needs_confirmation: 0 });
  E.recordEvent(id, E.EVENT.archived, 'not a task');
};

console.log('\nthrowing one out');

const junk = task('Can I get more info on this?');
const real = task('Pay BNF TDS');
L.planTask(DB.getTask(junk.id));
L.planTask(DB.getTask(real.id));

run('it has a reminder ladder before it is thrown out', () => {
  assert.ok(S.remindersForTask(junk.id).some((r) => r.status === 'scheduled'));
});

run('it leaves the list', () => {
  reject(junk.id);
  assert.ok(!DB.listTasks({ status: 'pending' }).some((t) => t.id === junk.id));
  assert.ok(DB.listTasks({ status: 'pending' }).some((t) => t.id === real.id));
});

run('it is archived, not deleted', () => {
  const row = DB.getTask(junk.id);
  assert.ok(row, 'the row survives');
  assert.ok(row.archived_at);
});

run('the reason is on the permanent record', () => {
  const events = E.eventsForTask(junk.id);
  assert.ok(events.some((e) => e.kind === 'archived' && e.detail === 'not a task'));
});

run('it works on any task, not only ones the extractor asked about', () => {
  const typed = DB.createTask({ title: 'Something I typed', source: 'manual', status: 'open' });
  reject(typed.id);
  assert.ok(DB.getTask(typed.id).archived_at);
});

console.log('\nand it stops being chased');

run('no reminder is left scheduled for it', () => {
  const live = S.remindersForTask(junk.id).filter((r) => ['scheduled', 'snoozed'].includes(r.status));
  assert.equal(live.length, 0);
});

run('the twice-daily digest does not carry it', () => {
  const ids = DB.pendingReminders(today).map((t) => t.id);
  assert.ok(!ids.includes(junk.id), 'a task thrown away must not arrive on WhatsApp');
  assert.ok(ids.includes(real.id), 'and real work still does');
});

run('its exact-time reminder never fires', () => {
  const at = new Date(Date.now() - 60_000).toISOString();
  DB.updateTask(junk.id, { remind_at: at });
  DB.updateTask(real.id, { remind_at: at });
  const due = DB.dueExactReminders(new Date().toISOString()).map((t) => t.id);
  assert.ok(!due.includes(junk.id));
  assert.ok(due.includes(real.id));
});

run('the engine does not walk it, so no follow-up is ever built', () => {
  const walked = L.tasksWithDeadlines().map((t) => t.id);
  assert.ok(!walked.includes(junk.id));
  assert.ok(walked.includes(real.id));
});

run('the figures on the dashboard drop it', () => {
  assert.equal(DB.taskStats().open, DB.listTasks({ status: 'pending' }).length);
});

console.log('\nnothing is lost');

run('it is still there to look back at', () => {
  assert.equal(DB.getTask(junk.id).title, 'Can I get more info on this?');
});

run('restoring puts it back', () => {
  DB.updateTask(junk.id, { archived_at: '' });
  assert.ok(DB.listTasks({ status: 'pending' }).some((t) => t.id === junk.id));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
