/**
 * One line in, one task out.
 *
 * The full form asks for notes, assignment, deadline, date, time, reminder,
 * follow-up and priority. Most tasks are a sentence and a day, and the cost of
 * the other six fields is not the typing - it is the tasks that never get
 * written down at all.
 *
 * What these cases hold is that the fast path is not a second kind of task: the
 * same table, the same deadline, the same ladder, and nothing invented. A
 * reminder or a follow-up is set only where the words actually say so;
 * otherwise the saved defaults apply, exactly as they do for the form.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-quick-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const Q = await import('../src/quickparse.js');
const DB = await import('../src/db.js');
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
const dayAhead = (n) =>
  new Date(Date.parse(`${todayIso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const clockIn = (iso) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

console.log('\nreading the sentence');

run('a bare line is just a task', () => {
  const p = Q.parseQuickTask('Send invoice');
  assert.equal(p.title, 'Send invoice');
  assert.equal(p.due_date, null);
  assert.equal(p.remind_at, null);
  assert.equal(p.reminder_offset, null, 'nothing was said about a reminder');
  assert.equal(p.follow_up_offset, null);
});

run('"Call Rahul tomorrow" is tomorrow, with no hour invented', () => {
  const p = Q.parseQuickTask('Call Rahul tomorrow');
  assert.equal(p.title, 'Call Rahul');
  assert.equal(p.due_date, dayAhead(1));
  assert.equal(p.remind_at, null, 'no time was given, so none is made up');
});

run('"GST audit today 6 PM" carries the hour', () => {
  const p = Q.parseQuickTask('GST audit today 6 PM');
  assert.equal(p.title, 'GST audit');
  assert.equal(p.due_date, todayIso);
  assert.equal(clockIn(p.remind_at), '18:00');
});

run('"BNF salary kal 5 baje karni hai" reads as Hinglish', () => {
  const p = Q.parseQuickTask('BNF salary kal 5 baje karni hai');
  assert.equal(p.title, 'BNF salary', 'the day, the hour and "karni hai" all come out of the title');
  assert.equal(p.due_date, dayAhead(1));
  assert.equal(clockIn(p.remind_at), '17:00', 'a bare 5 is the evening');
});

console.log('\nreminders and follow-ups, only when asked for');

run('"1 hour pehle remind karna" sets the reminder, not the deadline', () => {
  const p = Q.parseQuickTask('BNF salary kal 5 baje karni hai, 1 hour pehle remind karna');
  assert.equal(p.due_date, dayAhead(1));
  assert.equal(clockIn(p.remind_at), '17:00', 'the deadline is still five');
  assert.equal(p.reminder_offset, 60);
  assert.ok(!/hour|pehle|remind/i.test(p.title), `the phrase is out of the title: ${p.title}`);
});

run('"2 ghante baad follow-up" sets the follow-up', () => {
  const p = Q.parseQuickTask('BNF salary kal 5 baje karni hai, 2 ghante baad follow-up');
  assert.equal(p.follow_up_offset, 120);
  assert.equal(clockIn(p.remind_at), '17:00');
  assert.ok(!/follow/i.test(p.title), p.title);
});

run('either order of the follow-up phrase', () => {
  assert.equal(Q.parseQuickTask('Audit report friday, follow up after 3 hours').follow_up_offset, 180);
  assert.equal(Q.parseQuickTask('Audit report friday, 3 hours later follow-up').follow_up_offset, 180);
});

run('minutes and days as well as hours', () => {
  assert.equal(Q.parseQuickTask('x kal 5 baje, 30 min pehle remind').reminder_offset, 30);
  assert.equal(Q.parseQuickTask('x kal 5 baje, 1 din baad follow-up').follow_up_offset, 1440);
});

run('a length with no reminder or follow-up word is left alone', () => {
  // "2 hours of training" is not an instruction about reminders.
  const p = Q.parseQuickTask('Plan 2 hours of training');
  assert.equal(p.reminder_offset, null);
  assert.equal(p.follow_up_offset, null);
});

run('the words come first, so a length is never read as a clock time', () => {
  // "1 hour pehle" left in place used to be read as one o'clock.
  const p = Q.parseQuickTask('BNF salary kal 5 baje, 1 hour pehle remind karna');
  assert.equal(clockIn(p.remind_at), '17:00');
});

console.log('\nthe same task the form makes');

run('a quick task enters the ordinary ladder', () => {
  const parsed = Q.parseQuickTask('Send BNF report kal 5 baje, 1 hour pehle remind karna');
  const task = DB.createTask({
    title: parsed.title,
    due_date: parsed.due_date,
    due_at: parsed.remind_at,
    priority: parsed.priority,
    source: 'manual',
    origin: 'manual',
  });
  L.planTask(task, {
    reminderOffset: parsed.reminder_offset ?? undefined,
    followUpOffset: parsed.follow_up_offset ?? undefined,
  });

  const kinds = S.remindersForTask(task.id).map((r) => r.kind);
  assert.ok(kinds.includes('pre_due'), 'the reminder before the deadline');
  assert.ok(kinds.includes('due'), 'and one at it');
  assert.ok(kinds.includes('follow_up'), 'and the first rung after it');

  const pre = S.remindersForTask(task.id).find((r) => r.kind === 'pre_due');
  assert.equal(clockIn(pre.fire_at), '16:00', 'an hour before five, as asked');
});

run('it is an ordinary row, indistinguishable from a typed one', () => {
  const [task] = DB.db.prepare(`SELECT * FROM tasks WHERE title LIKE 'Send BNF%'`).all();
  assert.ok(task, 'stored in the same table');
  assert.equal(task.status, 'open');
  assert.equal(task.origin, 'manual');
  assert.equal(task.source, 'manual');
});

run('a quick task with no date gets no ladder, and is not chased', () => {
  const task = DB.createTask({ title: 'Send invoice', source: 'manual', origin: 'manual' });
  const result = L.planTask(task);
  assert.equal(result.planned, 0);
  assert.equal(result.reason, 'no deadline');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
