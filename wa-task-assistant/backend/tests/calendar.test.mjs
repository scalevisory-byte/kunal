/**
 * Putting something on a day.
 *
 * A calendar you can only read is half a calendar: the thing it is for is
 * going to the 20th and putting work on it. What these cases hold is that
 * doing so lands on that day and enters the ordinary machinery - the deadline
 * is the day you picked, the reminder comes before it, the follow-up after -
 * and that a note put on a day is remembered on it, once, and never chased.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-cal-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const N = await import('../src/notes.js');
const S = await import('../src/scheduling.js');
const L = await import('../src/task-lifecycle.js');
const Q = await import('../src/quickparse.js');

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
const dayIn = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const clockIn = (iso) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/** What the calendar's add box does: the picked day, at the picked time. */
const onDay = (day, time) => Q.isoAtLocal(day, ...time.split(':').map(Number), TZ);

console.log('\na task put on a day');

const DAY = dayAhead(12);
let task;

run('it takes the day and the hour that were picked', () => {
  task = DB.createTask({
    title: 'Board meeting papers',
    due_date: DAY,
    due_at: onDay(DAY, '11:00'),
    source: 'manual',
    origin: 'manual',
  });
  assert.equal(task.due_date, DAY);
  assert.equal(dayIn(task.due_at), DAY, 'the deadline reads as that day on the user clock');
  assert.equal(clockIn(task.due_at), '11:00');
});

run('it is reminded before, due at, and chased after', () => {
  L.planTask(task);
  const kinds = S.remindersForTask(task.id).map((r) => r.kind);
  assert.ok(kinds.includes('pre_due'), 'a reminder before the deadline');
  assert.ok(kinds.includes('due'), 'one at it');
  assert.ok(kinds.includes('follow_up'), 'and the first rung after it');

  for (const r of S.remindersForTask(task.id).filter((x) => x.kind !== 'follow_up')) {
    assert.equal(dayIn(r.fire_at), DAY, `${r.kind} fires on the day itself`);
  }
});

run('it appears in that day\'s work, and on no other', () => {
  const onThatDay = DB.listTasks({ status: 'all', limit: 500 })
    .filter((t) => (t.due_at ? dayIn(t.due_at) : t.due_date) === DAY);
  assert.ok(onThatDay.some((t) => t.id === task.id));

  const elsewhere = DB.listTasks({ status: 'all', limit: 500 })
    .filter((t) => t.id === task.id && (t.due_at ? dayIn(t.due_at) : t.due_date) !== DAY);
  assert.equal(elsewhere.length, 0);
});

run('it is an ordinary task, not a calendar entry', () => {
  const fresh = DB.getTask(task.id);
  assert.equal(fresh.status, 'open');
  assert.equal(fresh.origin, 'manual');
  // Nothing marks it as having come from the calendar, because nothing should.
  assert.equal('calendar' in fresh, false);
});

console.log('\na note put on a day');

let note;

run('it is remembered on that day at that hour', () => {
  note = N.createNote({ title: 'Ask the CA about ITC', remind_at: onDay(DAY, '09:30') });
  assert.equal(dayIn(note.remind_at), DAY);
  assert.equal(clockIn(note.remind_at), '09:30');
});

run('it builds no ladder and is never chased', () => {
  /*
   * A note is not owed: one moment, delivered once. The reminders table is
   * keyed by task, so the test is that delivering a note's moment adds nothing
   * to it - no pre-due, no rung, nothing to chase with.
   */
  const before = DB.db.prepare(`SELECT COUNT(*) AS n FROM reminders`).get().n;

  const due = N.dueNoteReminders(new Date(Date.parse(note.remind_at) + 1000).toISOString());
  assert.ok(due.some((n) => n.id === note.id), 'its moment comes');
  assert.ok(N.claimNoteReminder(note.id), 'and is delivered');
  assert.equal(N.claimNoteReminder(note.id), null, 'exactly once');

  const after = DB.db.prepare(`SELECT COUNT(*) AS n FROM reminders`).get().n;
  assert.equal(after, before, 'and the ladder is untouched by it');
});

run('it shows on the day it was put on', () => {
  const shown = N.listNotes().filter((n) => n.remind_at && dayIn(n.remind_at) === DAY);
  assert.ok(shown.some((n) => n.id === note.id));
});

console.log('\nthe two are still different things');

run('a note has no deadline and the task has no note-ness', () => {
  const fresh = N.getNote(note.id);
  assert.equal('due_at' in fresh, false, 'a note is not owed on a date, only recalled on one');
  assert.equal('status' in fresh, false);
  assert.equal(DB.getTask(task.id).status, 'open');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
