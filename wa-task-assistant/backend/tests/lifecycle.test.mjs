/**
 * The task lifecycle: reminder before the deadline, one at it, then follow-ups
 * while it stays incomplete - and silence the moment it is done.
 *
 * The duplicate and stop-on-completion cases are the point of this suite. A
 * reminder that fires twice, or one that arrives after the work is finished, is
 * worse than one that never fires.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-life-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const db = await import('../src/db.js');
const S = await import('../src/scheduling.js');
const L = await import('../src/task-lifecycle.js');
const engine = await import('../src/reminders.js');
const { parseTaskInstruction } = await import('../src/nl-commands.js');
const { findDuplicateTask, matchOpenTask } = await import('../src/task-matching.js');

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

const iso = (ms) => new Date(Date.now() + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const task = (over = {}) => db.createTask({ title: `T${Math.random()}`, ...over });
const kinds = (id) =>
  S.remindersForTask(id).filter((r) => ['scheduled', 'snoozed'].includes(r.status)).map((r) => r.kind);

S.saveSettings({
  defaultReminderOffset: 60, remindAtDue: true, followUpEnabled: true,
  followUpOffsets: [30, 120, 960], followUpMax: 3, businessHoursEnabled: false, skipWeekends: false,
});

console.log('\nplanning from a deadline');

await run('a future deadline gets a pre-due reminder, a due reminder and the first follow-up', () => {
  const t = task({ due_at: iso(3 * HOUR) });
  L.planTask(t);
  assert.deepEqual(kinds(t.id).sort(), ['due', 'follow_up', 'pre_due']);
});

await run('planning twice does not double anything', () => {
  const t = task({ due_at: iso(3 * HOUR) });
  L.planTask(t);
  L.planTask(t);
  L.planTask(t);
  assert.equal(kinds(t.id).length, 3, `expected 3 reminders, got ${kinds(t.id).join()}`);
});

await run('a pre-due reminder already in the past is not arranged', () => {
  const t = task({ due_at: iso(10 * MIN) }); // 1h-before is already gone
  L.planTask(t);
  assert.ok(!kinds(t.id).includes('pre_due'));
});

await run('a task with no deadline gets no schedule', () => {
  const t = task();
  assert.equal(L.planTask(t).planned, 0);
  assert.equal(kinds(t.id).length, 0);
});

await run('the pre-due reminder lands the configured distance before the deadline', () => {
  const t = task({ due_at: iso(5 * HOUR) });
  L.planTask(t);
  const pre = S.remindersForTask(t.id).find((r) => r.kind === 'pre_due');
  const gap = Date.parse(t.due_at) - Date.parse(pre.fire_at);
  assert.equal(Math.round(gap / MIN), 60);
});

console.log('\nstate follows the clock, not a column');

await run('open before the deadline, due just after, overdue an hour later', () => {
  const t = task({ due_at: iso(HOUR) });
  assert.equal(L.taskState(t, new Date()), 'open');
  assert.equal(L.taskState(t, new Date(Date.now() + 61 * MIN)), 'due');
  assert.equal(L.taskState(t, new Date(Date.now() + 3 * HOUR)), 'overdue');
});

await run('a done task reads as done whatever the clock says', () => {
  const t = task({ due_at: iso(-5 * HOUR) });
  db.updateTask(t.id, { status: 'done' });
  assert.equal(L.taskState(db.getTask(t.id), new Date()), 'done');
});

await run('in progress survives until the deadline passes', () => {
  const t = task({ due_at: iso(HOUR) });
  db.updateTask(t.id, { status: 'in_progress' });
  assert.equal(L.taskState(db.getTask(t.id), new Date()), 'in_progress');
});

console.log('\nthe follow-up ladder');

await run('each follow-up that fires arranges exactly one more', async () => {
  const t = task({ title: 'Ladder task', due_at: iso(-40 * MIN) });
  L.planTask(t);
  assert.equal(kinds(t.id).filter((k) => k === 'follow_up').length, 1);

  await engine.runReminderEngine();
  const after = db.getTask(t.id);
  assert.equal(after.follow_up_count, 1, 'one round recorded');
  const pending = S.remindersForTask(t.id).filter((r) => r.status === 'scheduled' && r.kind === 'follow_up');
  assert.equal(pending.length, 1, 'exactly one follow-up waiting, never a queue');
});

await run('rungs keep their spacing instead of firing back to back', async () => {
  const t = task({ title: 'Spaced out', due_at: iso(-5 * HOUR) });
  L.planTask(t);
  // Rounds one and two are both long past, but only one should be waiting.
  await engine.runReminderEngine();
  const pending = S.remindersForTask(t.id).filter((r) => r.status === 'scheduled');
  assert.equal(pending.length, 1);
  const gap = Date.parse(pending[0].fire_at) - Date.now();
  assert.ok(gap > 60 * MIN, `the next rung should be an hour or more out, got ${Math.round(gap / MIN)} min`);
});

await run('the ladder stops at the maximum and flags the task', async () => {
  const t = task({ title: 'Nag limit', due_at: iso(-2 * HOUR) });
  L.planTask(t);

  // Walk the clock forward past each rung rather than waiting for real time.
  let clock = new Date();
  for (let round = 0; round < 4; round += 1) {
    await engine.runReminderEngine({ now: clock });
    const next = S.remindersForTask(t.id).find((r) => r.status === 'scheduled' && r.kind === 'follow_up');
    if (!next) break;
    clock = new Date(Date.parse(next.fire_at) + MIN);
  }

  const after = db.getTask(t.id);
  assert.equal(after.follow_up_count, 3, `expected 3 rounds, got ${after.follow_up_count}`);
  assert.equal(after.needs_attention, 1, 'the task should be flagged rather than chased again');
  assert.equal(kinds(t.id).filter((k) => k === 'follow_up').length, 0, 'nothing further scheduled');

  // And a later pass leaves it alone.
  const before = S.remindersForTask(t.id).length;
  await engine.runReminderEngine({ now: new Date(clock.getTime() + 2 * HOUR) });
  assert.equal(S.remindersForTask(t.id).length, before, 'a flagged task is not chased again');
});

console.log('\ncompletion stops everything');

await run('completing a task cancels every pending reminder', () => {
  const t = task({ due_at: iso(3 * HOUR) });
  L.planTask(t);
  assert.equal(kinds(t.id).length, 3);
  db.updateTask(t.id, { status: 'done' });
  L.completeTask(t.id);
  assert.equal(kinds(t.id).length, 0);
  assert.equal(db.getTask(t.id).remind_at, null);
});

await run('nothing is delivered for a task completed after its reminder came due', async () => {
  const t = task({ title: 'Finished early', due_at: iso(-40 * MIN) });
  L.planTask(t);
  db.updateTask(t.id, { status: 'done' });
  const before = S.listNotifications().length;
  await engine.runReminderEngine();
  assert.equal(S.listNotifications().length, before, 'finished work is never chased');
});

await run('a completed task is never re-planned by a later pass', async () => {
  const t = task({ title: 'Stay quiet', due_at: iso(-3 * HOUR) });
  L.planTask(t);
  db.updateTask(t.id, { status: 'done' });
  L.completeTask(t.id);
  await engine.runReminderEngine();
  await engine.runReminderEngine();
  assert.equal(kinds(t.id).length, 0);
});

console.log('\nduplicate protection');

await run('the same reminder cannot be arranged twice', () => {
  const t = task({ due_at: iso(3 * HOUR) });
  const a = S.scheduleReminder({ taskId: t.id, fireAt: iso(HOUR), kind: 'pre_due' });
  const b = S.scheduleReminder({ taskId: t.id, fireAt: iso(HOUR), kind: 'pre_due' });
  assert.equal(a.id, b.id);
  assert.equal(S.remindersForTask(t.id).length, 1);
});

await run('a reminder can only be claimed once', () => {
  const t = task({ due_at: iso(-2 * HOUR) });
  const r = S.scheduleReminder({ taskId: t.id, fireAt: iso(-MIN), kind: 'due' });
  assert.ok(S.claimReminder(r.id));
  assert.equal(S.claimReminder(r.id), null, 'a second claim must fail');
});

await run('one reminder produces one notification, however many passes run', async () => {
  const t = task({ title: 'Once only', due_at: iso(-30 * MIN) });
  const r = S.scheduleReminder({ taskId: t.id, fireAt: iso(-MIN), kind: 'due' });
  await engine.runReminderEngine();
  await engine.runReminderEngine();
  await engine.runReminderEngine();
  const forThisReminder = S.listNotifications({ limit: 200 }).filter((n) => n.reminder_id === r.id);
  assert.equal(forThisReminder.length, 1, 'the same reminder must notify exactly once');
});

await run('no reminder anywhere has notified more than once', () => {
  // The invariant the whole design exists to hold, checked across every row
  // this suite has produced.
  const seen = new Map();
  for (const n of S.listNotifications({ limit: 200 })) {
    if (!n.reminder_id) continue;
    seen.set(n.reminder_id, (seen.get(n.reminder_id) || 0) + 1);
  }
  const repeated = [...seen.entries()].filter(([, count]) => count > 1);
  assert.equal(repeated.length, 0, `reminders notified twice: ${JSON.stringify(repeated)}`);
});

await run('a custom reminder for a moment already covered is not a second alarm', () => {
  const t = task({ due_at: iso(3 * HOUR) });
  const at = iso(2 * HOUR);
  const a = S.scheduleCustomReminder(t.id, at);
  const b = S.scheduleCustomReminder(t.id, at);
  assert.equal(a.id, b.id);
});

await run('snooze moves the reminder rather than adding one', () => {
  const t = task({ due_at: iso(-2 * HOUR) });
  const r = S.scheduleReminder({ taskId: t.id, fireAt: iso(-MIN), kind: 'due' });
  S.claimReminder(r.id);
  const snoozed = S.snoozeReminder(r.id, 30);
  assert.equal(S.remindersForTask(t.id).length, 1);
  assert.equal(snoozed.snooze_count, 1);
  assert.ok(Date.parse(snoozed.fire_at) > Date.now());
});

console.log('\nreschedule');

await run('a new deadline clears the old schedule and starts the cycle again', async () => {
  const t = task({ title: 'Move me', due_at: iso(-3 * HOUR) });
  L.planTask(t);
  await engine.runReminderEngine();
  assert.ok(db.getTask(t.id).follow_up_count >= 1);

  L.rescheduleTask(t.id, { due_at: iso(5 * HOUR) });
  const after = db.getTask(t.id);
  assert.equal(after.follow_up_count, 0, 'the escalation count resets');
  assert.equal(after.needs_attention, 0);
  assert.deepEqual(kinds(t.id).sort(), ['due', 'follow_up', 'pre_due']);
});

await run('a rescheduled task is no longer overdue', () => {
  const t = task({ due_at: iso(-3 * HOUR) });
  assert.equal(L.taskState(t, new Date()), 'overdue');
  L.rescheduleTask(t.id, { due_at: iso(4 * HOUR) });
  assert.equal(L.taskState(db.getTask(t.id), new Date()), 'open');
});

console.log('\ncontrol from WhatsApp');

await run('"BNF salary done" resolves to the open task', () => {
  const t = task({ title: 'Process BNF salary', due_at: iso(HOUR) });
  const parsed = parseTaskInstruction('BNF salary done');
  assert.ok(parsed, 'expected a match');
  assert.equal(parsed.action, 'done');
  assert.equal(parsed.task.id, t.id);
  db.updateTask(t.id, { status: 'done' });
});

await run('"kal karunga" reads as a reschedule with a date', () => {
  const t = task({ title: 'Complete Sunshine audit', due_at: iso(HOUR) });
  const parsed = parseTaskInstruction('sunshine audit kal karunga');
  assert.equal(parsed.action, 'reschedule');
  assert.equal(parsed.task.id, t.id);
  assert.ok(parsed.due_date, 'a date is required to act');
  db.updateTask(t.id, { status: 'done' });
});

await run('an instruction naming no task does nothing', () => {
  assert.equal(parseTaskInstruction('done'), null);
  assert.equal(parseTaskInstruction('ok kar diya'), null);
});

await run('an imperative is not a completion report', () => {
  const t = task({ title: 'Pay TDS challan', due_at: iso(HOUR) });
  assert.equal(parseTaskInstruction('TDS challan complete kar dena'), null);
  db.updateTask(t.id, { status: 'done' });
});

await run('ordinary conversation is left alone', () => {
  assert.equal(parseTaskInstruction('kal milte hain, sab theek hai na'), null);
  assert.equal(parseTaskInstruction('good morning'), null);
});

await run('an ambiguous phrase resolves to nothing rather than a guess', () => {
  const a = task({ title: 'Send report' });
  const b = task({ title: 'Send report' });
  assert.equal(matchOpenTask('send report'), null, 'two equal matches must not be resolved');
  db.updateTask(a.id, { status: 'done' });
  db.updateTask(b.id, { status: 'done' });
});

console.log('\nduplicate tasks');

await run('a task that already exists is recognised, not recreated', () => {
  const t = task({ title: 'Process BNF salary for September' });
  assert.ok(findDuplicateTask('Process BNF salary for September'));
  assert.ok(findDuplicateTask('BNF salary for September'));
  db.updateTask(t.id, { status: 'done' });
});

await run('an unrelated title is not treated as a duplicate', () => {
  const t = task({ title: 'Book Dubai flights' });
  assert.equal(findDuplicateTask('Send GST invoice to Rakesh'), null);
  db.updateTask(t.id, { status: 'done' });
});

await run('a completed task does not block a new one with the same name', () => {
  const t = task({ title: 'Monthly GST filing' });
  db.updateTask(t.id, { status: 'done' });
  assert.equal(findDuplicateTask('Monthly GST filing'), null);
});

console.log('\ntimezone and quiet hours');

await run('local time is read in the configured zone', () => {
  const local = S.localParts(new Date('2026-09-07T03:30:00.000Z'), 'Asia/Kolkata');
  assert.equal(local.hour, 9);
});

await run('an out-of-hours reminder moves into the working window', () => {
  const settings = { ...S.getSettings(), businessHoursEnabled: true, businessStart: '09:00', businessEnd: '19:00' };
  const at = new Date('2026-09-07T16:30:00.000Z'); // 22:00 IST
  const moved = S.applyQuietHours(at, settings, 'Asia/Kolkata');
  assert.equal(S.localParts(moved, 'Asia/Kolkata').hour, 9);
  assert.ok(moved > at);
});

await run('a weekend reminder moves off the weekend', () => {
  const settings = { ...S.getSettings(), skipWeekends: true, businessHoursEnabled: true };
  const moved = S.applyQuietHours(new Date('2026-09-12T06:00:00.000Z'), settings, 'Asia/Kolkata');
  const weekday = S.localParts(moved, 'Asia/Kolkata').weekday;
  assert.ok(weekday !== 0 && weekday !== 6);
});

await run('a deadline given as a date alone uses the configured hour', () => {
  S.saveSettings({ defaultDueTime: '18:00' });
  const t = task({ due_date: '2026-09-10' });
  const due = L.dueMoment(db.getTask(t.id));
  assert.equal(S.localParts(due, 'Asia/Kolkata').hour, 18);
});

console.log('\nmissed reminders');

await run('a reminder older than the window is marked missed, not fired late', async () => {
  const t = task({ title: 'Long gone', due_at: iso(-50 * 60 * MIN) });
  const r = S.scheduleReminder({ taskId: t.id, fireAt: iso(-48 * HOUR), kind: 'custom', round: 99 });
  await engine.runReminderEngine();
  assert.equal(S.getReminder(r.id).status, 'missed');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
