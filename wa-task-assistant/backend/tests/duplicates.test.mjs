/**
 * One job, one task.
 *
 * Two separate faults put the same work on the list twice, and this covers
 * both. They matter more than most bugs here because a duplicated task is not
 * just clutter: each copy carries its own reminder ladder, so the same job is
 * chased twice a day, forever, and the person being chased has no way to tell
 * which row to finish.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-dupes-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const M = await import('../src/task-matching.js');
const R = await import('../src/recurring.js');

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

/*
 * The same day the engine means.
 *
 * This used toISOString, which is UTC, while everything under test resolves
 * "today" in TIMEZONE. Between midnight and half past five in the morning IST
 * the two disagree about the date, so a rule was being created for the 7th and
 * asked to fire on the 8th — and the suite failed every night for six hours
 * for a reason that had nothing to do with duplicates.
 */
const day = (offset = 0) => {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  return at.toLocaleDateString('en-CA', { timeZone: process.env.TIMEZONE || 'Asia/Kolkata' });
};

console.log('\na second copy is caught however many there already are');

run('one existing copy is found', () => {
  task('Pay BNF TDS');
  assert.ok(M.findDuplicateTask('Pay BNF TDS'));
});

run('two existing copies are still found', () => {
  /*
   * The fault that made this unbounded. The matcher refused to answer when two
   * tasks tied, because for "which task does this sentence mean?" a tie must
   * not be guessed at. Asking "is this a copy?" inverts that: a tie means it is
   * certainly a copy of one of them, and answering "no" made a third. So every
   * later mention made another, and the list grew without limit.
   */
  task('Pay BNF TDS');
  assert.ok(M.findDuplicateTask('Pay BNF TDS'), 'a tie is a duplicate, not an unknown');
});

run('five copies in, it has not given up', () => {
  task('Pay BNF TDS');
  task('Pay BNF TDS');
  task('Pay BNF TDS');
  assert.ok(M.findDuplicateTask('Pay BNF TDS'));
});

run('a finished task is not something to deduplicate against', () => {
  const t = task('Renew trade licence');
  DB.updateTask(t.id, { status: 'done' });
  assert.equal(M.findDuplicateTask('Renew trade licence'), null, 'last month is over; this is new work');
});

run('different work is still different', () => {
  task('Pay Arroohan TDS', { due_date: day(0) });
  assert.equal(
    M.findDuplicateTask('Submit Bhavya mediclaim documents', { dueDate: day(0) }),
    null
  );
});

console.log('\nthe same words on a different day is different work');

run("last month's unfinished one does not suppress this month's", () => {
  task('Pay GST', { due_date: '2026-08-11' });
  assert.equal(
    M.findDuplicateTask('Pay GST', { dueDate: '2026-09-11' }),
    null,
    'September GST is owed whether or not August was ever paid'
  );
});

run('the same day is the same job', () => {
  assert.ok(M.findDuplicateTask('Pay GST', { dueDate: '2026-08-11' }));
});

run('an undated task matches on the words alone', () => {
  task('Call the auditor');
  assert.ok(M.findDuplicateTask('Call the auditor', { dueDate: day(3) }),
    'nothing dated it, so there is no occurrence to tell apart');
});

console.log('\na monthly rule does not re-make a task that already exists');

run('the rule creates its task when nothing is there', () => {
  const rule = R.createRule({
    title: 'Pay TDS', day_of_month: Number(day(0).slice(8, 10)), lead_days: 0, due_time: '18:00',
  });
  const made = R.materialiseDue();
  assert.equal(made.length, 1);
  assert.equal(made[0].title, 'Pay TDS');
  assert.ok(rule.id);
});

run('running it again makes nothing — the month is claimed', () => {
  assert.equal(R.materialiseDue().length, 0);
});

run('a task typed into WhatsApp first stops the rule making a second', () => {
  /*
   * The fault the dashboard actually showed. The month's claim stopped the rule
   * firing twice, but said nothing about the same job arriving another way:
   * "Pay sunshine tds today last date" in a chat became a task at 7:32 AM, and
   * the rule for the same date made another. Two rows, two ladders, one job.
   */
  const dom = Number(day(0).slice(8, 10));
  R.createRule({ title: 'Pay Sunshine TDS', day_of_month: dom, lead_days: 0, due_time: '18:00' });
  task('Pay Sunshine TDS', { due_date: day(0), source: 'whatsapp', origin: 'ai' });

  const made = R.materialiseDue();
  assert.ok(!made.some((t) => t.title === 'Pay Sunshine TDS'), 'the rule stood down');

  const rows = DB.listTasks({ status: 'all', limit: 500 })
    .filter((t) => t.title === 'Pay Sunshine TDS');
  assert.equal(rows.length, 1, `one task, not ${rows.length}`);
});

run('the month is still recorded as handled, so it is not retried tomorrow', () => {
  const before = DB.listTasks({ status: 'all', limit: 500 }).length;
  R.materialiseDue();
  assert.equal(DB.listTasks({ status: 'all', limit: 500 }).length, before);
});

console.log('\nnext month is not a copy of this month');

run('a monthly job a month later is new work, not a duplicate', () => {
  task('File GSTR-3B', { due_date: '2026-09-20' });
  assert.equal(
    M.findDuplicateTask('File GSTR-3B', { dueDate: '2026-10-20' }),
    null,
    'October is owed whether or not September was ever filed'
  );
});

run('a day apart is the same job', () => {
  /*
   * The pair on the dashboard: one "Process BNF salary" due the 6th and another
   * due the 7th. Same salary run, entered twice - a strict same-day rule missed
   * it, which is why the window exists rather than an equality check.
   */
  task('Process BNF salary', { due_date: '2026-09-06' });
  assert.ok(M.findDuplicateTask('Process BNF salary', { dueDate: '2026-09-07' }));
});

run('the window is where the difference falls', () => {
  assert.equal(M.sameOccurrence('2026-09-07', '2026-09-13'), true, 'six days: one job');
  assert.equal(M.sameOccurrence('2026-09-07', '2026-09-20'), false, 'thirteen days: two');
  assert.equal(M.sameOccurrence('2026-09-07', '2026-10-07'), false, 'next month: two');
  assert.equal(M.sameOccurrence(null, '2026-10-07'), true, 'undated has no occurrence');
});

console.log('\ncleaning up the copies already on the list');

run('it groups the copies and offers the oldest to keep', () => {
  const first = task('Renew insurance', { due_date: '2026-09-07' });
  const second = task('Renew insurance', { due_date: '2026-09-07' });
  const group = M.duplicateGroups().find((g) => g.keep.title === 'Renew insurance');
  assert.ok(group, 'found');
  assert.equal(group.keep.id, first.id, 'the first one carries the history');
  assert.deepEqual(group.drop.map((t) => t.id), [second.id]);
});

run('one job is never offered in two groups at once', () => {
  const ids = M.duplicateGroups().flatMap((g) => [g.keep.id, ...g.drop.map((t) => t.id)]);
  assert.equal(new Set(ids).size, ids.length);
});

run('an archived copy is not offered again', () => {
  const t = task('Pay electricity', { due_date: '2026-09-07' });
  task('Pay electricity', { due_date: '2026-09-07' });
  DB.updateTask(t.id, { archived_at: new Date().toISOString() });
  const group = M.duplicateGroups().find((g) => g.keep.title === 'Pay electricity');
  assert.equal(group, undefined, 'one left standing is not a duplicate of anything');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
