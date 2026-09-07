/**
 * Monthly statutory deadlines: TDS on the 7th, GST on the 11th, GSTR-3B on the
 * 20th. Missing one costs money, and being reminded twice about the same filing
 * is how you stop reading the reminders - so the case that matters most is that
 * each month produces exactly one task, however often the engine ticks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-recurring-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const R = await import('../src/recurring.js');
const G = await import('../src/groups.js');

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

const tasksNamed = (title) =>
  DB.db.prepare(`SELECT * FROM tasks WHERE title = ? AND archived_at IS NULL`).all(title);

console.log('\nsetting a monthly deadline');

run('a rule needs a title and a day that exists in every month', () => {
  assert.throws(() => R.createRule({ day_of_month: 7 }), /title/);
  // The 30th does not exist in February; a rule on it would silently skip.
  assert.throws(() => R.createRule({ title: 'x', day_of_month: 30 }), /between 1 and 28/);
  assert.throws(() => R.createRule({ title: 'x', day_of_month: 0 }), /between 1 and 28/);
});

run("Dinesh's three filings can be set up", () => {
  const gst = G.createGroup({ name: 'GST' });
  const tds = R.createRule({ title: 'Pay TDS', day_of_month: 7, due_time: '18:00' });
  const gstr1 = R.createRule({ title: 'File GST', day_of_month: 11, group_id: gst.id });
  const gstr3b = R.createRule({ title: 'File GSTR-3B', day_of_month: 20, lead_days: 2 });

  assert.equal(tds.day_of_month, 7);
  assert.equal(gstr1.group_name, 'GST', 'a rule can belong to a business');
  assert.equal(gstr3b.lead_days, 2, 'the warning can start earlier than a day');
  assert.equal(tds.lead_days, 1, 'a day ahead by default');
  assert.equal(R.listRules().length, 3);
});

console.log('\nthe task appears before the date, not on it');

run('nothing is created while the date is still far off', () => {
  // A rule whose date is weeks away is not on today's list yet.
  const far = R.createRule({ title: 'Far away filing', day_of_month: 28, lead_days: 1 });
  const before = tasksNamed('Far away filing').length;
  R.materialiseDue();
  const now = tasksNamed('Far away filing').length;
  // Either it is genuinely within a day of the 28th, or nothing was made.
  const soon = R.upcoming().find((u) => u.rule.id === far.id);
  if (soon && soon.days_away <= far.lead_days) {
    assert.equal(now, before + 1, 'inside the lead time it is created');
  } else {
    assert.equal(now, before, 'outside the lead time nothing is created');
  }
});

run('a rule due within its lead time produces a task with a real deadline', () => {
  // Anchored on today so the test is not tied to the calendar.
  const todayDay = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(8, 10));
  const day = Math.min(Math.max(todayDay, 1), 28);
  R.createRule({ title: 'Due right now filing', day_of_month: day, lead_days: 15, due_time: '18:00' });

  R.materialiseDue();
  const made = tasksNamed('Due right now filing');
  assert.equal(made.length, 1, 'exactly one task');
  assert.ok(made[0].due_at, 'it carries an exact deadline');
  assert.equal(made[0].due_date.slice(8, 10), String(day).padStart(2, '0'));
  // 18:00 in Kolkata is 12:30 UTC - the deadline is on the user's clock.
  assert.match(made[0].due_at, /T12:30:00\.000Z$/);
});

console.log('\none task a month, whatever happens');

run('forty ticks do not make forty filings', () => {
  for (let i = 0; i < 40; i += 1) R.materialiseDue();
  assert.equal(tasksNamed('Due right now filing').length, 1);
});

run('deleting the task does not make the month come round again', () => {
  const [task] = tasksNamed('Due right now filing');
  DB.deleteTask(task.id);
  for (let i = 0; i < 5; i += 1) R.materialiseDue();
  assert.equal(tasksNamed('Due right now filing').length, 0,
    'the month is spent; it returns next month, not immediately');
});

run('completing it does not make it come back either', () => {
  const day = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(8, 10));
  R.createRule({ title: 'Complete me filing', day_of_month: Math.min(Math.max(day, 1), 28), lead_days: 15 });
  R.materialiseDue();
  const [task] = tasksNamed('Complete me filing');
  assert.ok(task);
  DB.updateTask(task.id, { status: 'done' });

  for (let i = 0; i < 5; i += 1) R.materialiseDue();
  assert.equal(tasksNamed('Complete me filing').length, 1, 'still just the one, now done');
});

console.log('\nwhat is coming up');

run('the upcoming list is ordered by how near the date is', () => {
  const list = R.upcoming();
  assert.ok(list.length > 0);
  const days = list.map((u) => u.days_away);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
  assert.ok(days.every((d) => d >= 0), 'a date that has passed is not "upcoming"');
});

run('an inactive rule is left out entirely', () => {
  const rule = R.createRule({ title: 'Paused filing', day_of_month: 15 });
  R.updateRule(rule.id, { active: 0 });
  assert.equal(R.upcoming().some((u) => u.rule.id === rule.id), false);
  R.materialiseDue();
  assert.equal(tasksNamed('Paused filing').length, 0);
});

run('deleting a rule stops future months but keeps what it already made', () => {
  const day = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(8, 10));
  const rule = R.createRule({ title: 'Kept filing', day_of_month: Math.min(Math.max(day, 1), 28), lead_days: 15 });
  R.materialiseDue();
  assert.equal(tasksNamed('Kept filing').length, 1);

  R.deleteRule(rule.id);
  assert.equal(tasksNamed('Kept filing').length, 1, 'the task it already created survives');
  assert.equal(R.listRules().some((r) => r.id === rule.id), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
