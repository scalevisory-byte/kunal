/**
 * The reminder and follow-up engine, exercised against a real SQLite file.
 * The duplicate-protection cases are the point of this suite: a reminder that
 * fires twice is worse than one that never fires at all.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sched-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const db = await import('../src/db.js');
const S = await import('../src/scheduling.js');
const TR = await import('../src/task-reminders.js');

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};
const testAsync = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const newTask = (over = {}) => db.createTask({ title: `T${Math.random()}`, ...over });

console.log('\nreminders');

test('a reminder is scheduled and found as due once its moment passes', () => {
  const task = newTask();
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });
  assert.equal(r.status, 'scheduled');
  const due = S.dueReminders(new Date().toISOString());
  assert.ok(due.some((d) => d.id === r.id));
});

test('a future reminder is not due yet', () => {
  const task = newTask();
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(3600_000) });
  const due = S.dueReminders(new Date().toISOString());
  assert.ok(!due.some((d) => d.id === r.id));
});

test('scheduling the same moment twice does not create a second reminder', () => {
  const task = newTask();
  const at = iso(3600_000);
  const a = S.scheduleReminder({ taskId: task.id, fireAt: at });
  const b = S.scheduleReminder({ taskId: task.id, fireAt: at });
  assert.equal(a.id, b.id, 'expected the same reminder back');
  assert.equal(S.remindersForTask(task.id).length, 1);
});

test('two different moments on one task are two reminders', () => {
  const task = newTask();
  S.scheduleReminder({ taskId: task.id, fireAt: iso(3600_000) });
  S.scheduleReminder({ taskId: task.id, fireAt: iso(7200_000) });
  assert.equal(S.remindersForTask(task.id).length, 2);
});

test('a reminder can only be claimed once', () => {
  const task = newTask();
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });
  const first = S.claimReminder(r.id);
  const second = S.claimReminder(r.id);
  assert.ok(first, 'the first claim should succeed');
  assert.equal(second, null, 'the second claim must fail');
  assert.equal(S.getReminder(r.id).status, 'triggered');
});

test('a claimed reminder is no longer due', () => {
  const task = newTask();
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });
  S.claimReminder(r.id);
  assert.ok(!S.dueReminders(new Date().toISOString()).some((d) => d.id === r.id));
});

test('snooze moves the existing reminder instead of adding one', () => {
  const task = newTask();
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });
  S.claimReminder(r.id);
  const snoozed = S.snoozeReminder(r.id, 15);
  assert.equal(S.remindersForTask(task.id).length, 1, 'snooze must not duplicate');
  assert.equal(snoozed.status, 'snoozed');
  assert.equal(snoozed.snooze_count, 1);
  assert.ok(Date.parse(snoozed.fire_at) > Date.now(), 'snoozed into the future');
});

test('a snoozed reminder becomes claimable again', () => {
  const task = newTask();
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });
  S.claimReminder(r.id);
  S.snoozeReminder(r.id, -1); // already in the past, so it is due again
  assert.ok(S.claimReminder(r.id), 'a snoozed reminder should fire again');
});

test('completing a task cancels its pending reminders', () => {
  const task = newTask();
  S.scheduleReminder({ taskId: task.id, fireAt: iso(3600_000) });
  S.scheduleReminder({ taskId: task.id, fireAt: iso(7200_000) });
  const cancelled = TR.clearTaskReminders(task.id);
  assert.equal(cancelled, 2);
  assert.ok(S.remindersForTask(task.id).every((r) => r.status === 'cancelled'));
  assert.equal(db.getTask(task.id).remind_at, null, 'the task should show no next reminder');
});

test('a cancelled reminder is never due again', () => {
  const task = newTask();
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });
  S.cancelReminder(r.id);
  assert.equal(S.claimReminder(r.id), null);
});

test('the task carries its next reminder for display', () => {
  const task = newTask();
  const later = iso(7200_000);
  const sooner = iso(3600_000);
  S.scheduleReminder({ taskId: task.id, fireAt: later });
  S.scheduleReminder({ taskId: task.id, fireAt: sooner });
  TR.syncTaskRemindAt(task.id);
  assert.equal(db.getTask(task.id).remind_at, new Date(sooner).toISOString());
});

console.log('\nquiet hours and timezone');

test('local parts are read in the configured timezone, not the server one', () => {
  // 03:30 UTC is 09:00 in Asia/Kolkata.
  const at = new Date('2026-09-07T03:30:00.000Z');
  const local = S.localParts(at, 'Asia/Kolkata');
  assert.equal(local.hour, 9);
  assert.equal(local.minute, 0);
});

test('business hours push an out-of-hours reminder to the next morning', () => {
  const settings = { ...S.getSettings(), businessHoursEnabled: true, businessStart: '09:00', businessEnd: '19:00' };
  // 22:00 IST on a Monday.
  const at = new Date('2026-09-07T16:30:00.000Z');
  const moved = S.applyQuietHours(at, settings, 'Asia/Kolkata');
  const local = S.localParts(moved, 'Asia/Kolkata');
  assert.equal(local.hour, 9, `expected 09:00 local, got ${local.hour}:${local.minute}`);
  assert.ok(moved > at, 'it should move forward, never back');
});

test('a time already inside business hours is left alone', () => {
  const settings = { ...S.getSettings(), businessHoursEnabled: true };
  const at = new Date('2026-09-07T08:00:00.000Z'); // 13:30 IST
  assert.equal(S.applyQuietHours(at, settings, 'Asia/Kolkata').getTime(), at.getTime());
});

test('skip weekends moves a Saturday reminder off the weekend', () => {
  const settings = { ...S.getSettings(), skipWeekends: true, businessHoursEnabled: true };
  const saturday = new Date('2026-09-12T06:00:00.000Z'); // Sat 11:30 IST
  const moved = S.applyQuietHours(saturday, settings, 'Asia/Kolkata');
  assert.notEqual(S.localParts(moved, 'Asia/Kolkata').weekday, 6);
  assert.notEqual(S.localParts(moved, 'Asia/Kolkata').weekday, 0);
});

console.log('\nfollow-ups');

test('a follow-up is created with history', () => {
  const f = S.createFollowUp({ title: 'Follow up with Ravi', due_at: iso(86400_000), reason: 'Waiting for quotation' });
  assert.equal(f.status, 'waiting');
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].kind, 'created');
});

test('a follow-up past its date becomes due, then overdue', () => {
  S.createFollowUp({ title: 'Due one', due_at: iso(-60_000) });
  S.refreshFollowUpStatuses();
  assert.ok(S.listFollowUps({ status: 'due' }).some((f) => f.title === 'Due one'));

  S.createFollowUp({ title: 'Old one', due_at: iso(-3 * 86400_000) });
  S.refreshFollowUpStatuses();
  S.refreshFollowUpStatuses(); // waiting -> due -> overdue
  assert.ok(S.listFollowUps({ status: 'overdue' }).some((f) => f.title === 'Old one'));
});

test('completing a follow-up cancels its reminders and records it', () => {
  const f = S.createFollowUp({ title: 'Close me', due_at: iso(86400_000) });
  S.scheduleReminder({ followUpId: f.id, fireAt: iso(3600_000) });
  const done = S.updateFollowUp(f.id, { status: 'completed' });
  assert.equal(done.status, 'completed');
  assert.ok(done.completed_at);
  assert.ok(done.reminders.every((r) => r.status === 'cancelled'));
  assert.ok(done.events.some((e) => e.kind === 'completed'));
});

test('a reply pauses the chase without closing the follow-up', () => {
  const f = S.createFollowUp({ title: 'Ravi quotation', due_at: iso(86400_000), chat_id: 'ravi@c.us' });
  S.scheduleReminder({ followUpId: f.id, fireAt: iso(3600_000) });
  const touched = S.recordReply('ravi@c.us', 'Haan bhej diya');
  assert.equal(touched, 1);
  const after = S.getFollowUp(f.id);
  assert.ok(after.responded_at, 'the reply should be recorded');
  assert.notEqual(after.status, 'completed', 'a reply must not close it by itself');
  assert.ok(after.reminders.every((r) => r.status === 'cancelled'));
  assert.ok(after.events.some((e) => e.kind === 'reply received'));
});

test('a reply in an unrelated chat touches nothing', () => {
  const f = S.createFollowUp({ title: 'Someone else', due_at: iso(86400_000), chat_id: 'a@c.us' });
  assert.equal(S.recordReply('b@c.us', 'hi'), 0);
  assert.equal(S.getFollowUp(f.id).responded_at, null);
});

test('a recurring follow-up schedules the next round', () => {
  const settings = { ...S.getSettings(), followUpMax: 3, escalation: true };
  const f = S.createFollowUp({ title: 'Chase BNF', due_at: iso(-60_000), interval_days: 2, max_follow_ups: 3 });
  const outcome = S.advanceFollowUp(S.getFollowUp(f.id), settings);
  assert.equal(outcome.repeated, true);
  const after = S.getFollowUp(f.id);
  assert.equal(after.follow_up_count, 1);
  assert.equal(after.status, 'waiting');
  assert.ok(Date.parse(after.due_at) > Date.now());
});

test('the maximum stops the chain and flags it for attention', () => {
  const settings = { ...S.getSettings(), followUpMax: 2, escalation: true };
  const f = S.createFollowUp({ title: 'Give up', due_at: iso(-60_000), interval_days: 1, max_follow_ups: 2 });
  S.advanceFollowUp(S.getFollowUp(f.id), settings);
  const outcome = S.advanceFollowUp(S.getFollowUp(f.id), settings);
  assert.equal(outcome.repeated, false);
  assert.equal(outcome.reason, 'maximum reached');
  assert.equal(S.getFollowUp(f.id).status, 'needs_attention');
});

test('a non-recurring follow-up does not repeat', () => {
  const f = S.createFollowUp({ title: 'One shot', due_at: iso(-60_000) });
  const outcome = S.advanceFollowUp(S.getFollowUp(f.id), S.getSettings());
  assert.equal(outcome.repeated, false);
});

console.log('\nsettings and notifications');

test('settings round-trip and reject unknown keys', () => {
  const saved = S.saveSettings({ followUpMax: 5, notifyWhatsApp: true, nonsense: 'x' });
  assert.equal(saved.followUpMax, 5);
  assert.equal(saved.notifyWhatsApp, true);
  assert.ok(!('nonsense' in saved));
  assert.equal(S.getSettings().followUpMax, 5);
  S.saveSettings({ followUpMax: 3, notifyWhatsApp: false });
});

test('notifications count unread, then stop counting once read', () => {
  const before = S.unreadNotificationCount();
  const n = S.addNotification({ kind: 'reminder', title: 'Test' });
  assert.equal(S.unreadNotificationCount(), before + 1);
  S.markNotificationRead(n.id);
  assert.equal(S.unreadNotificationCount(), before);
});

test('a dismissed notification leaves the list', () => {
  const n = S.addNotification({ kind: 'reminder', title: 'Bye' });
  S.dismissNotification(n.id);
  assert.ok(!S.listNotifications().some((x) => x.id === n.id));
});

console.log('\nengine');

const engine = await import('../src/reminders.js');

await testAsync('the engine sends a due reminder exactly once', async () => {
  const task = newTask({ title: 'Engine task' });
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });

  const first = await engine.runReminderEngine();
  assert.equal(first.sent >= 1, true);
  assert.equal(S.getReminder(r.id).status, 'triggered');

  const second = await engine.runReminderEngine();
  assert.ok(!S.dueReminders(new Date().toISOString()).some((d) => d.id === r.id));
  assert.equal(S.getReminder(r.id).status, 'triggered', 'a second pass must not re-fire it');
  assert.equal(second.sent, 0);
});

await testAsync('a reminder older than the missed window is marked missed, not fired', async () => {
  const task = newTask({ title: 'Old reminder' });
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-48 * 3600_000) });
  await engine.runReminderEngine();
  assert.equal(S.getReminder(r.id).status, 'missed');
});

await testAsync('a reminder for a completed task is not delivered', async () => {
  const task = newTask({ title: 'Already done' });
  const r = S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });
  db.updateTask(task.id, { status: 'done' });
  const before = S.listNotifications().length;
  await engine.runReminderEngine();
  assert.equal(S.listNotifications().length, before, 'no notification for finished work');
});

await testAsync('a delivered reminder leaves a notification behind', async () => {
  const task = newTask({ title: 'Notify me' });
  S.scheduleReminder({ taskId: task.id, fireAt: iso(-60_000) });
  await engine.runReminderEngine();
  assert.ok(S.listNotifications().some((n) => n.title.includes('Notify me')));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
