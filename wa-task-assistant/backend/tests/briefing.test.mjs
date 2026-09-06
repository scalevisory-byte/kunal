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
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const clear = () => db.db.prepare(`DELETE FROM tasks`).run();

console.log('\nwhat the message says');

await run('no tasks reads as a clear morning', () => {
  clear();
  const { text, total } = B.buildBriefing();
  assert.equal(total, 0);
  assert.match(text, /no pending tasks/i);
  assert.ok(!text.includes('OVERDUE'));
});

await run('only overdue says so up front', () => {
  clear();
  db.createTask({ title: 'Pay TDS challan', due_at: iso(-30 * HOUR), priority: 'high' });
  db.createTask({ title: 'File GSTR-3B', due_at: iso(-50 * HOUR) });
  const { text } = B.buildBriefing();
  assert.match(text, /2 overdue tasks/i);
  assert.match(text, /OVERDUE/);
  assert.ok(!text.includes('TODAY’S TASKS'), 'nothing is due today');
});

await run('both groups are separated and counted', () => {
  clear();
  db.createTask({ title: 'Old thing', due_at: iso(-30 * HOUR) });
  db.createTask({ title: 'Today thing', due_at: iso(2 * HOUR) });
  const { text } = B.buildBriefing();
  assert.match(text, /⚠️ 1 overdue/);
  assert.match(text, /📋 1 due today/);
  assert.ok(text.indexOf('OVERDUE') < text.indexOf('TODAY'), 'overdue comes first');
});

await run('a task with no date is listed without inventing a time', () => {
  clear();
  db.createTask({ title: 'Call the accountant' });
  const { text } = B.buildBriefing();
  assert.match(text, /No fixed time/);
  assert.ok(!/Due: \d/.test(text));
});

await run('completed work never appears', () => {
  clear();
  const t = db.createTask({ title: 'Already finished', due_at: iso(2 * HOUR) });
  db.updateTask(t.id, { status: 'done' });
  const { text, total } = B.buildBriefing();
  assert.equal(total, 0);
  assert.ok(!text.includes('Already finished'));
});

await run('a long list is capped and points at the app', () => {
  clear();
  for (let i = 0; i < 14; i += 1) db.createTask({ title: `Task ${i}`, due_at: iso(2 * HOUR) });
  const { text, listed, total } = B.buildBriefing();
  assert.equal(total, 14);
  assert.equal(listed, 10, 'ten is enough for one message');
  assert.match(text, /and 4 more/);
});

await run('the most urgent is listed first', () => {
  clear();
  db.createTask({ title: 'Low today', due_at: iso(3 * HOUR), priority: 'low' });
  db.createTask({ title: 'Late one', due_at: iso(-40 * HOUR), priority: 'medium' });
  const { text } = B.buildBriefing();
  assert.ok(text.indexOf('Late one') < text.indexOf('Low today'));
});

await run('priority marks are carried through', () => {
  clear();
  db.createTask({ title: 'Urgent', due_at: iso(2 * HOUR), priority: 'high' });
  assert.match(B.buildBriefing().text, /🔴 Urgent/);
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
