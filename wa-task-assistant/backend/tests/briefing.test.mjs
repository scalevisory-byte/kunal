/**
 * The morning WhatsApp briefing. The cases that matter most are the ones about
 * sending it once: a second message before breakfast is worse than none.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-brief-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const db = await import('../src/db.js');
const S = await import('../src/scheduling.js');
const B = await import('../src/briefing.js');
const D = await import('../src/dates.js');

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

/*
 * The briefing is a question about a calendar day, so the tests fix the hour
 * they ask it at.
 *
 * Anchored to the wall clock, "due in two hours" was tomorrow after 10pm IST
 * and these cases failed every evening — a suite you cannot trust after dinner
 * is worse than no suite. Nine in the morning is when the briefing actually
 * goes out, which is the hour worth testing anyway.
 */
const NOW = new Date(
  `${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}T09:00:00+05:30`
);
const iso = (ms) => new Date(NOW.getTime() + ms).toISOString();
const clear = () => db.db.prepare(`DELETE FROM tasks`).run();

console.log('\nwhat the message says');

await run('no tasks reads as a clear morning', () => {
  clear();
  const { text, total } = B.buildBriefing(NOW);
  assert.equal(total, 0);
  assert.match(text, /no pending tasks/i);
  assert.ok(!text.includes('OVERDUE'));
});

await run('only overdue says so up front', () => {
  clear();
  db.createTask({ title: 'Pay TDS challan', due_at: iso(-30 * HOUR), priority: 'high' });
  db.createTask({ title: 'File GSTR-3B', due_at: iso(-50 * HOUR) });
  const { text } = B.buildBriefing(NOW);
  assert.match(text, /2 overdue tasks/i);
  assert.match(text, /OVERDUE/);
  assert.ok(!text.includes('TODAY’S TASKS'), 'nothing is due today');
});

await run('both groups are separated and counted', () => {
  clear();
  db.createTask({ title: 'Old thing', due_at: iso(-30 * HOUR) });
  db.createTask({ title: 'Today thing', due_at: iso(2 * HOUR) });
  const { text } = B.buildBriefing(NOW);
  assert.match(text, /⚠️ 1 overdue/);
  assert.match(text, /📋 1 due today/);
  assert.ok(text.indexOf('OVERDUE') < text.indexOf('TODAY'), 'overdue comes first');
});

await run('a task with no date is listed without inventing a time', () => {
  clear();
  db.createTask({ title: 'Call the accountant' });
  const { text } = B.buildBriefing(NOW);
  assert.match(text, /No fixed time/);
  assert.ok(!/Due: \d/.test(text));
});

await run('completed work never appears', () => {
  clear();
  const t = db.createTask({ title: 'Already finished', due_at: iso(2 * HOUR) });
  db.updateTask(t.id, { status: 'done' });
  const { text, total } = B.buildBriefing(NOW);
  assert.equal(total, 0);
  assert.ok(!text.includes('Already finished'));
});

await run('a long list is capped and points at the app', () => {
  clear();
  for (let i = 0; i < 14; i += 1) db.createTask({ title: `Task ${i}`, due_at: iso(2 * HOUR) });
  const { text, listed, total } = B.buildBriefing(NOW);
  assert.equal(total, 14);
  assert.equal(listed, 10, 'ten is enough for one message');
  assert.match(text, /and 4 more/);
});

await run('the most urgent is listed first', () => {
  clear();
  db.createTask({ title: 'Low today', due_at: iso(3 * HOUR), priority: 'low' });
  db.createTask({ title: 'Late one', due_at: iso(-40 * HOUR), priority: 'medium' });
  const { text } = B.buildBriefing(NOW);
  assert.ok(text.indexOf('Late one') < text.indexOf('Low today'));
});

await run('priority marks are carried through', () => {
  clear();
  db.createTask({ title: 'Urgent', due_at: iso(2 * HOUR), priority: 'high' });
  assert.match(B.buildBriefing(NOW).text, /🔴 Urgent/);
});

console.log('\nsent once, whatever happens');

await run('once a briefing is sent, nothing can claim that day again', () => {
  const day = '2026-09-20';
  const first = S.claimBriefing(day);
  assert.ok(first, 'the first claim should succeed');
  assert.equal(first.attempt, 1);

  S.recordBriefingSent(day, 3);

  // This is the invariant that matters: however many restarts, retries or
  // workers come along afterwards, none of them can send that day's message.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(S.claimBriefing(day), null, 'a sent briefing is never claimed again');
  }
  assert.ok(S.briefingFor(day).sent_at);
});

await run('a briefing sent by hand blocks the scheduled one that morning', () => {
  // "Send now" in Settings bypasses the claim, so it has to leave the same mark
  // behind - otherwise pressing it at 08:00 earns a second message at 08:30.
  const day = '2026-09-25';
  assert.equal(S.briefingFor(day), null, 'nothing claimed this day yet');

  S.recordBriefingSent(day, 2);

  assert.ok(S.briefingFor(day).sent_at, 'the manual send is on record');
  assert.equal(S.claimBriefing(day), null, 'the scheduled run finds it already sent');
});

await run('a failed send may be retried, but only a few times', () => {
  const day = '2026-09-21';
  assert.ok(S.claimBriefing(day));
  S.recordBriefingFailed(day, 'WhatsApp not connected');
  assert.ok(S.claimBriefing(day), 'attempt 2 is allowed');
  assert.ok(S.claimBriefing(day), 'attempt 3 is allowed');
  assert.equal(S.claimBriefing(day), null, 'and then it stops trying');
});

await run('a delivered briefing is never re-sent after a restart', async () => {
  S.saveSettings({ dailyBriefing: true, briefingTime: '00:01' });
  const day = B.localDay();
  S.claimBriefing(day);
  S.recordBriefingSent(day, 1);
  const again = await B.maybeSendBriefing();
  assert.equal(again.sent, false);
  assert.equal(again.reason, 'already sent');
});

await run('nothing is sent while the briefing is switched off', async () => {
  S.saveSettings({ dailyBriefing: false });
  const result = await B.maybeSendBriefing({ now: new Date() });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'off');
});

await run('nothing is sent before the configured hour', async () => {
  S.saveSettings({ dailyBriefing: true, briefingTime: '23:59' });
  const result = await B.maybeSendBriefing({ now: new Date('2026-09-22T01:00:00Z') });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not yet');
  S.saveSettings({ dailyBriefing: false, briefingTime: '09:00' });
});

console.log('\ntimezone');

await run('the hour is judged in the user timezone, not the server one', () => {
  const settings = { ...S.getSettings(), briefingTime: '09:00' };
  // 02:00 UTC is 07:30 in Kolkata - too early.
  assert.equal(B.briefingDue(new Date('2026-09-22T02:00:00Z'), settings), false);
  // 04:00 UTC is 09:30 - past it.
  assert.equal(B.briefingDue(new Date('2026-09-22T04:00:00Z'), settings), true);
});

await run('the day rolls over on the user clock', () => {
  // 19:00 UTC on the 21st is already the 22nd in Kolkata.
  assert.equal(B.localDay(new Date('2026-09-21T19:00:00Z')), '2026-09-22');
});

console.log('\nweekly summary');

await run('a week is keyed on the Monday that starts it, on the user clock', () => {
  // Sunday 2026-09-20 in Kolkata belongs to the week beginning Monday the 14th.
  assert.equal(B.localWeek(new Date('2026-09-20T14:00:00Z')), 'week:2026-09-14');
  // Monday the 21st starts the next one.
  assert.equal(B.localWeek(new Date('2026-09-21T06:00:00Z')), 'week:2026-09-21');
  // 19:00 UTC on Sunday is already Monday in Kolkata, so the week has turned.
  assert.equal(B.localWeek(new Date('2026-09-20T19:00:00Z')), 'week:2026-09-21');
});

await run('the weekly summary shares the daily briefing\'s send-once guarantee', () => {
  const key = B.localWeek(new Date('2026-10-04T14:00:00Z'));
  assert.ok(S.claimBriefing(key), 'the first claim wins');
  S.recordBriefingSent(key, 4);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(S.claimBriefing(key), null, 'a sent week is never claimed again');
  }
});

await run('it is only due on the configured day, at the configured hour', () => {
  const settings = { weeklySummary: true, weeklyDay: 0, weeklyTime: '20:00' };
  // Sunday 2026-09-20, 14:30 UTC = 20:00 in Kolkata.
  assert.equal(B.weeklyDue(new Date('2026-09-20T14:30:00Z'), settings), true);
  // Same Sunday, an hour earlier.
  assert.equal(B.weeklyDue(new Date('2026-09-20T13:00:00Z'), settings), false);
  // Saturday at the right hour is still the wrong day.
  assert.equal(B.weeklyDue(new Date('2026-09-19T14:30:00Z'), settings), false);
});

await run('the on-time breakdown adds up to the completed total', () => {
  const now = new Date('2026-11-04T06:00:00Z');
  const iso = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');

  // Three finished: one early, one late, one that never had a deadline.
  const rows = [
    { title: 'on time one', due: '2026-11-03T12:00:00.000Z', done: '2026-11-03T09:00:00Z' },
    { title: 'late one', due: '2026-11-02T12:00:00.000Z', done: '2026-11-03T09:00:00Z' },
    { title: 'no deadline one', due: null, done: '2026-11-03T09:00:00Z' },
  ];
  for (const row of rows) {
    const task = db.createTask({ title: row.title, due_at: row.due, status: 'open', source: 'manual' });
    db.updateTask(task.id, { status: 'done' });
    db.db.prepare(`UPDATE tasks SET completed_at = ? WHERE id = ?`).run(iso(row.done), task.id);
  }

  const out = B.buildWeeklySummary(now);
  assert.equal(out.finished, 3);
  assert.match(out.text, /1 on time · 1 late · 1 without a deadline/);
});

await run('a week with nothing finished reports the open work, not a fake total', () => {
  // Far enough ahead that nothing in the fixture completed inside the window.
  const out = B.buildWeeklySummary(new Date('2027-01-01T04:00:00Z'));
  assert.equal(out.finished, 0, 'nothing was completed in that week');
  assert.match(out.text, /Completed: \*0\*/);
  // The open count is real, so it is stated; on-time figures are not invented
  // for a week where nothing was finished.
  assert.doesNotMatch(out.text, /on time/);
  assert.doesNotMatch(out.text, /Finished this week/);
});

await run('an empty database says the week was quiet rather than showing zeroes', () => {
  // Proven directly on the builder's own branch: no tasks at all, either side.
  const before = db.listTasks({ status: 'all', limit: 500 });
  const ids = before.map((t) => t.id);
  for (const id of ids) db.deleteTask(id);

  const out = B.buildWeeklySummary(new Date('2027-01-01T04:00:00Z'));
  assert.match(out.text, /Nothing recorded this week/);
  assert.equal(out.finished, 0);
  assert.equal(out.open, 0);
});

console.log('\ndeadlines are read on the user clock');

await run('a bare wall-clock time is read in the user timezone, not the server one', () => {
  // 12:30 in Kolkata is 07:00 UTC. Reading it as server-local would land at
  // 12:30 UTC on a cloud host and move every deadline by five and a half hours.
  assert.equal(D.normalizeInstant('2026-09-06T12:30'), '2026-09-06T07:00:00.000Z');
  assert.equal(D.normalizeInstant('2026-09-06 12:30:00'), '2026-09-06T07:00:00.000Z');
});

await run('a string that already carries a zone is left alone', () => {
  assert.equal(D.normalizeInstant('2026-09-06T07:00:00.000Z'), '2026-09-06T07:00:00.000Z');
  assert.equal(D.normalizeInstant('2026-09-06T12:30:00+05:30'), '2026-09-06T07:00:00.000Z');
});

await run('nothing, or nonsense, becomes null rather than an invalid date', () => {
  for (const bad of [null, undefined, '', '   ', 'tomorrow', '2026-13-40T10:00', 42, {}]) {
    assert.equal(D.normalizeInstant(bad), null, String(bad));
  }
});

await run('a snoozed time is reported on the user clock', () => {
  // 07:00 UTC is 12:30 pm in Kolkata. Slicing the ISO string would say 07:00.
  assert.equal(B.clockOf('2026-09-06T07:00:00.000Z'), '12:30 pm');
});

console.log('\nchannel safety');

await run('the reminder destination is the linked account itself', async () => {
  const wa = await import('../src/whatsapp.js');
  // With no REMINDER_TO configured it resolves to the account's own id, so
  // there is no code path that addresses a contact.
  assert.equal(wa.reminderChatId(), wa.state.me);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
