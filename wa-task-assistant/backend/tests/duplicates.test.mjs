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

/*
 * Two ways the guard was defeated in production, both reported as duplicate
 * rows on the board with identical titles.
 */
console.log('\nwhat let the copies through');

run('a description on the existing task no longer hides it', () => {
  // The score is the weaker of its two directions, so every word of a
  // description made the task HARDER to recognise: three title words shared
  // out of thirteen scored 0.23 against a threshold of 0.7, and a perfect copy
  // was created. Reported as two "Activate Uttarakhand GST" rows, same day.
  const existing = task('Activate Uttarakhand GST', {
    due_date: '2026-09-11',
    description: 'Office will visit today, I have to call and ask the time from the officer till 12',
  });
  const found = M.findDuplicateTask('Activate Uttarakhand GST', { dueDate: '2026-09-11' });
  assert.ok(found, 'the same title is the same job whatever else is written on it');
  assert.equal(found.id, existing.id);
});

run('the verb does not decide it: "File GSTR-1" is "GSTR - 1"', () => {
  const existing = task('GSTR - 1', { due_date: '2026-09-12' });
  const found = M.findDuplicateTask('File GSTR-1', { dueDate: '2026-09-12' });
  assert.ok(found, 'file / submit / upload carry no identity');
  assert.equal(found.id, existing.id);
});

run('but GSTR-9 is not GSTR-1, and GSTR-3B is neither', () => {
  // The lone digit was being thrown away as too short, so both reduced to
  // "gstr" and scored a perfect match - the annual return would have been
  // silently suppressed as a copy of the monthly one.
  //
  // Dated well clear of the monthly deadline rules this app seeds, which
  // legitimately carry these very titles.
  const far = '2027-03-13';
  task('File GSTR-1', { due_date: far });
  assert.equal(M.findDuplicateTask('File GSTR-9', { dueDate: far }), null);
  assert.equal(M.findDuplicateTask('File GSTR-3B', { dueDate: far }), null);
  assert.ok(M.findDuplicateTask('GSTR 1', { dueDate: far }), 'the same return, said differently');
});

run('two clients with identically shaped work stay two tasks', () => {
  // Five shared words out of seven scored 0.71 and merged them at the old bar.
  // A duplicate is visible and removable; a task suppressed by mistake is
  // invisible for ever, so refusing to merge is the safe error.
  task('Review Parth Bajaj ledger scrutiny FY2025-26', { due_date: '2027-03-14' });
  assert.equal(
    M.findDuplicateTask('Review Santosh Textile ledger scrutiny FY2025-26', { dueDate: '2027-03-14' }),
    null
  );
  // Both exist, which is the point: two clients, two pieces of work.
  task('Review Santosh Textile ledger scrutiny FY2025-26', { due_date: '2027-03-14' });
});

run('the list still offers the looser pair to a person', () => {
  // Strict when deciding alone, loose when asking: the pair above is exactly
  // what a human should be shown and allowed to judge.
  const group = M.duplicateGroups().find((g) => g.keep.title.includes('ledger scrutiny'));
  assert.ok(group, 'offered for review');
  assert.equal(group.drop.length, 1);
});

run('the oldest is still the one kept when only it has a description', () => {
  // Probing with title AND description found the pair only on the second pass,
  // from the copy that had none - so the group offered the NEWER row as the one
  // to keep, losing the history that "keep the oldest" exists to protect.
  const first = task('Renew trade licence', {
    due_date: '2027-04-09',
    description: 'Municipal office, ground floor, carry the old certificate and two photos',
  });
  const second = task('Renew trade licence', { due_date: '2027-04-09' });
  const group = M.duplicateGroups().find((g) => g.keep.title === 'Renew trade licence');
  assert.ok(group, 'found from either side');
  assert.equal(group.keep.id, first.id, 'the older row carries the history');
  assert.deepEqual(group.drop.map((t) => t.id), [second.id]);
});

/*
 * "Ek hi kaam nahi - alag alag purpose he na."
 *
 * Two conversations with the same person, days apart, about different things.
 * The title never said which, so both rows read "Talk with Vikas Gupta" and the
 * app called them one job. A name answers WHO. Two tasks that agree on nothing
 * else have not been shown to be the same work, and merging them loses the
 * second conversation - which, unlike a duplicate row, is invisible.
 */
console.log('\na name is who, not what');

run('refuses to merge two tasks that share only a person', () => {
  task('Talk with Vikas Gupta', { due_date: '2027-05-04', contact: 'Vikas Gupta' });
  const found = M.findDuplicateTask('Talk with Vikas Gupta', {
    dueDate: '2027-05-04', contact: 'Vikas Gupta',
  });
  assert.equal(found, null, 'two conversations, not one job said twice');
});

run('does not offer that pair for review either', () => {
  task('Talk with Vikas Gupta', { due_date: '2027-05-04', contact: 'Vikas Gupta' });
  const group = M.duplicateGroups().find((g) => g.keep.title === 'Talk with Vikas Gupta');
  assert.equal(group, undefined, 'the page would be asking a question it has not established');
});

run('merges them once the title says what it is about', () => {
  const first = task('Talk with Vikas Gupta about the Sena GST refund', {
    due_date: '2027-05-05', contact: 'Vikas Gupta',
  });
  const found = M.findDuplicateTask('Talk with Vikas Gupta about the Sena GST refund', {
    dueDate: '2027-05-05', contact: 'Vikas Gupta',
  });
  assert.ok(found, 'same person AND same subject');
  assert.equal(found.id, first.id);
});

run('keeps two subjects with the same person apart', () => {
  // Dated clear of the case above, whose task is still open and whose title is
  // word for word the one being asked about here.
  task('Talk with Vikas Gupta about the Pinetree invoice', {
    due_date: '2027-06-06', contact: 'Vikas Gupta',
  });
  assert.equal(
    M.findDuplicateTask('Talk with Vikas Gupta about the Sena GST refund', {
      dueDate: '2027-06-06', contact: 'Vikas Gupta',
    }),
    null
  );
});

run('the verb of reaching somebody carries no identity', () => {
  // "Talk with", "Call", "Meet" and "Discuss" are how you reach a person, not
  // what the job is - the same class as "send" and "file".
  assert.deepEqual(M.subjectWords('Call Vikas Gupta', 'Vikas Gupta'), []);
  assert.deepEqual(M.subjectWords('Meet Vikas Gupta about GSTR-9', 'Vikas Gupta'), ['gstr', '9']);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
