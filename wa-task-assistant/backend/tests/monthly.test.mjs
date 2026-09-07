/**
 * The day before a statutory deadline.
 *
 * GSTR-1 on the 11th at 6 PM, warned a day ahead, is the case this file is
 * about: the warning has to land at 6 PM on the 10th - not at midnight, not an
 * hour before the deadline itself - and it has to land exactly once however
 * many times the engine ticks, the dashboard refreshes or the server restarts.
 *
 * Everything here runs through the systems that already existed: the reminder
 * ladder schedules the warning, completing the task cancels it, moving the
 * deadline rebuilds it. There is no second reminder engine to test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-monthly-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const R = await import('../src/recurring.js');
const S = await import('../src/scheduling.js');
const L = await import('../src/task-lifecycle.js');

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

const TZ = 'Asia/Kolkata';
const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
/** A day of the month whose occurrence is still ahead of us this month. */
const dayInDays = (n) => {
  const at = new Date(Date.parse(`${todayIso}T00:00:00Z`) + n * 86_400_000);
  return { day: Number(at.toISOString().slice(8, 10)), date: at.toISOString().slice(0, 10) };
};
const warningFor = (taskId) =>
  S.remindersForTask(taskId).filter((r) => r.kind === 'warning');
const clockIn = (iso, tz = TZ) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
const dayIn = (iso, tz = TZ) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });

console.log('\nthe warning lands a day before, at the deadline hour');

let gstr1;
let gstr1Task;

run('a rule inside its lead time produces the task and its warning', () => {
  // Three days out, warned two days ahead: inside the window, so the task is
  // made now and the warning is still in the future - the shape the popup and
  // the notification both hang off.
  const { day, date } = dayInDays(3);
  gstr1 = R.createRule({ title: 'File GSTR-1', day_of_month: day, due_time: '18:00', lead_days: 2 });
  const made = R.materialiseDue();

  [gstr1Task] = made.filter((t) => t.title.startsWith('File GSTR-1'));
  assert.ok(gstr1Task, 'the monthly instance exists');
  assert.equal(gstr1Task.due_date, date);
  assert.equal(gstr1Task.warn_days, 2, "the rule's warning is carried onto the task");

  const warnings = warningFor(gstr1Task.id);
  assert.equal(warnings.length, 1, 'exactly one warning');
  assert.equal(dayIn(warnings[0].fire_at), dayInDays(1).date, 'two days before the deadline');
});

run('it fires at the deadline time, not at midnight', () => {
  const [warning] = warningFor(gstr1Task.id);
  assert.equal(clockIn(warning.fire_at), '18:00',
    '"before" preserves the hour: a 6 PM deadline warns at 6 PM');
  assert.notEqual(clockIn(warning.fire_at), '00:00');
});

run('the hour is the user\'s, not the server\'s', () => {
  const [warning] = warningFor(gstr1Task.id);
  // 18:00 in Kolkata is 12:30 UTC. Reading the same instant in UTC must not
  // give 18:00, or the code is using the server's clock.
  assert.equal(clockIn(warning.fire_at, 'UTC'), '12:30');
});

console.log('\nit is arranged once, whatever happens');

run('forty ticks do not make forty warnings', () => {
  for (let i = 0; i < 40; i += 1) {
    R.materialiseDue();
    L.planTask(DB.getTask(gstr1Task.id));
  }
  assert.equal(warningFor(gstr1Task.id).length, 1);
});

run('the database itself refuses a second one', () => {
  const before = warningFor(gstr1Task.id)[0];
  const again = S.scheduleReminder({
    taskId: gstr1Task.id, fireAt: new Date().toISOString(), kind: 'warning',
  });
  assert.equal(again.id, before.id, 'asking again returns the one that exists');
  assert.equal(warningFor(gstr1Task.id).length, 1);
});

console.log('\nfinishing the work ends it');

run('completing the task cancels the warning', () => {
  const { day } = dayInDays(2);
  R.createRule({ title: 'Pay TDS soon', day_of_month: day, due_time: '18:00', lead_days: 1 });
  const [task] = R.materialiseDue().filter((t) => t.title.startsWith('Pay TDS'));
  assert.ok(task, 'the task was made');
  assert.equal(warningFor(task.id).length, 1);

  DB.updateTask(task.id, { status: 'done' });
  L.completeTask(task.id);
  const live = warningFor(task.id).filter((r) => ['scheduled', 'snoozed'].includes(r.status));
  assert.equal(live.length, 0, 'nothing is left to send about finished work');
});

console.log('\nediting the rule moves this month with it');

run('changing the day moves the task and rebuilds the schedule', () => {
  const moved = dayInDays(4);
  R.updateRule(gstr1.id, { day_of_month: moved.day });
  const task = DB.getTask(gstr1Task.id);
  assert.equal(task.due_date, moved.date, "this month's task follows the rule");

  const warnings = warningFor(task.id).filter((r) => ['scheduled', 'snoozed'].includes(r.status));
  assert.equal(warnings.length, 1, 'one warning, against the new date');
  assert.equal(dayIn(warnings[0].fire_at), dayInDays(2).date);
});

run('changing the time moves the warning to the new hour', () => {
  R.updateRule(gstr1.id, { due_time: '17:00' });
  const task = DB.getTask(gstr1Task.id);
  assert.equal(clockIn(task.due_at), '17:00');
  const [warning] = warningFor(task.id).filter((r) => ['scheduled', 'snoozed'].includes(r.status));
  assert.equal(clockIn(warning.fire_at), '17:00');
});

run('editing does not produce a second task for the month', () => {
  assert.equal(
    DB.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE id = ?`).get(gstr1Task.id).n,
    1
  );
  assert.equal(
    DB.db.prepare(`SELECT COUNT(*) AS n FROM recurring_runs WHERE rule_id = ?`).get(gstr1.id).n,
    1,
    'one occurrence claimed for the month, before and after the edit'
  );
});

run('rescheduling the task leaves the rule alone', () => {
  const task = DB.getTask(gstr1Task.id);
  const later = dayInDays(9);
  L.rescheduleTask(task.id, { due_date: later.date, due_at: `${later.date}T12:30:00.000Z` });

  const rule = R.getRule(gstr1.id);
  assert.notEqual(rule.day_of_month, later.day, 'only this month moved');
  assert.equal(DB.getTask(task.id).due_date, later.date);
});

console.log('\nthe popup, and why it does not come back');

let popupRule;
let popupDate;

run('a deadline inside its window asks for a popup', () => {
  const tomorrow = dayInDays(1);
  popupRule = R.createRule({ title: 'GST Payment', day_of_month: tomorrow.day, due_time: '18:00', lead_days: 1 });
  R.materialiseDue();

  const item = R.upcoming().find((u) => u.rule.id === popupRule.id);
  assert.ok(item, 'it is in the upcoming list');
  popupDate = item.due_date;
  assert.equal(item.days_away, 1);
  assert.equal(item.popup, true);
  assert.ok(item.due_at, 'the exact moment is sent, so the popup can say the hour');
});

run('dismissing it stops it, and a refresh does not bring it back', () => {
  R.setNotice(popupRule.id, popupDate, 'dismiss');
  for (let i = 0; i < 5; i += 1) {
    const item = R.upcoming().find((u) => u.rule.id === popupRule.id);
    assert.equal(item.popup, false, 'reload number ' + i);
  }
});

run('the deadline is still shown after the popup is dismissed', () => {
  // Dismissing the interruption is not the same as hiding the deadline: the
  // card stays, which is what the dashboard is for.
  const item = R.upcoming().find((u) => u.rule.id === popupRule.id);
  assert.ok(item, 'still listed');
  assert.equal(item.days_away, 1);
});

run('"remind me later" brings it back, and only then', () => {
  const later = dayInDays(1);
  const rule = R.createRule({ title: 'Later filing', day_of_month: later.day, due_time: '18:00', lead_days: 1 });
  R.materialiseDue();
  const first = R.upcoming().find((u) => u.rule.id === rule.id);
  assert.equal(first.popup, true);

  R.setNotice(rule.id, first.due_date, 'later', 120);
  assert.equal(R.upcoming().find((u) => u.rule.id === rule.id).popup, false, 'quiet for now');

  const after = new Date(Date.now() + 3 * 3600_000);
  assert.equal(
    R.upcoming({ now: after }).find((u) => u.rule.id === rule.id).popup,
    true,
    'back once the two hours are up'
  );
});

run('"later" never adds a reminder, and never pulls one forward', () => {
  /*
   * The popup shows from the start of the warning day; the warning itself goes
   * out that evening. "Remind me later" at breakfast must not drag the 6 PM
   * notification forward to lunchtime, and must not arrange a second one.
   */
  const soon = dayInDays(2);
  const rule = R.createRule({ title: 'Snooze filing', day_of_month: soon.day, due_time: '18:00', lead_days: 1 });
  const [task] = R.materialiseDue().filter((t) => t.title.startsWith('Snooze'));
  assert.ok(task);
  const before = warningFor(task.id);
  assert.equal(before.length, 1);

  const item = R.upcoming({ within: 60 }).find((u) => u.rule.id === rule.id);
  R.setNotice(rule.id, item.due_date, 'later', 120);

  const after = warningFor(task.id);
  assert.equal(after.length, 1, 'no second reminder was created');
  assert.ok(after[0].fire_at >= before[0].fire_at, 'the warning was not pulled forward');
});

run('a finished deadline never asks for a popup', () => {
  const soon = dayInDays(1);
  const rule = R.createRule({ title: 'Done filing', day_of_month: soon.day, due_time: '18:00', lead_days: 1 });
  const [task] = R.materialiseDue().filter((t) => t.title.startsWith('Done'));
  assert.ok(task);
  DB.updateTask(task.id, { status: 'done' });

  const item = R.upcoming().find((u) => u.rule.id === rule.id);
  assert.equal(item.popup, false);
  assert.equal(item.done, true);
});

run('a paused rule is not shown at all', () => {
  const soon = dayInDays(1);
  const rule = R.createRule({ title: 'Paused monthly', day_of_month: soon.day, lead_days: 1 });
  R.updateRule(rule.id, { active: 0 });
  assert.equal(R.upcoming().some((u) => u.rule.id === rule.id), false);
});

run('each deadline is its own notice', () => {
  // Dismissing GST Payment says nothing about anything else, and next month's
  // occurrence is a different date and so a different row.
  const soon = dayInDays(1);
  const other = R.createRule({ title: 'TDS payment', day_of_month: soon.day, due_time: '18:00', lead_days: 1 });
  R.materialiseDue();

  assert.equal(R.upcoming().find((u) => u.rule.id === other.id).popup, true,
    'a different deadline still asks');
  assert.equal(R.upcoming().find((u) => u.rule.id === popupRule.id).popup, false,
    'the dismissed one stays quiet');
  assert.equal(R.noticeFor(popupRule.id, '2099-01-11'), null,
    'a different date has no notice, so next month asks again');
});

console.log('\nwhat the message says');

run('the warning names the day, not just the hour', async () => {
  // "Due 11 Sep" read on the 10th does not say "tomorrow"; the warning must.
  const src = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');
  assert.match(src, /kind === 'warning'\s*\n?\s*\? `Due \$\{whenWord\}/);
  assert.match(src, /UPCOMING DEADLINE/);
});

run('it goes to the user\'s own chat, like every other reminder', () => {
  const src = fs.readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8');
  assert.match(src, /sendMessage\(reminderChatId\(\)/);
  assert.ok(!/sendMessage\(task\.(assigned_to_wid|chat_id)/.test(src),
    'nothing here can message a contact');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
