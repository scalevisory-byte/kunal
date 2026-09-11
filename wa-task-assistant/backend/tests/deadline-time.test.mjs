/**
 * Setting the time on a deadline.
 *
 * Reported as "I set 11 am and it is not catching", and it never could have:
 * the field read and wrote `remind_at`, which is not the deadline. `remind_at`
 * is the moment the app decides to nudge - an hour before by default - and the
 * engine rewrites it from `due_at` on every reschedule, so the value shown was
 * an hour early and the value written was overwritten before it could matter.
 *
 * These hold the three facts that make the field work: the deadline is
 * `due_at`, writing it moves the ladder with it, and clearing the time does not
 * take the day with it.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-dtime-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const { db, createTask, getTask, updateTask } = await import('../src/db.js');
const { planTask, rescheduleTask } = await import('../src/task-lifecycle.js');

/** 18:00 IST on 11 Sep 2026, the default due hour. */
const SIX_PM = '2026-09-11T12:30:00.000Z';
/** 11:00 IST the same day - what he actually picked. */
const ELEVEN_AM = '2026-09-11T05:30:00.000Z';

let id;
beforeEach(() => {
  db.prepare('DELETE FROM tasks').run();
  db.prepare('DELETE FROM reminders').run();
  id = createTask({
    title: 'Activate Uttarakhand GST',
    due_date: '2026-09-11',
    due_at: SIX_PM,
    priority: 'high',
    status: 'open',
    source: 'manual',
    origin: 'manual',
  }).id;
  planTask(getTask(id));
});

describe('which field is the deadline', () => {
  it('is due_at, and remind_at is an hour earlier', () => {
    const task = getTask(id);
    assert.equal(task.due_at, SIX_PM);
    assert.notEqual(
      task.remind_at, SIX_PM,
      'remind_at is the nudge, not the deadline - showing it in a "Time" field shows the wrong hour'
    );
  });

  it('does not move when remind_at is written', () => {
    updateTask(id, { remind_at: ELEVEN_AM });
    rescheduleTask(id, { due_date: '2026-09-11', due_at: getTask(id).due_at });
    assert.equal(
      getTask(id).due_at, SIX_PM,
      'writing remind_at changed nothing - which is exactly what "not catching" looked like'
    );
  });

  it('moves when due_at is written, and takes the ladder with it', () => {
    updateTask(id, { due_at: ELEVEN_AM });
    rescheduleTask(id, { due_date: getTask(id).due_date, due_at: ELEVEN_AM });

    const task = getTask(id);
    assert.equal(task.due_at, ELEVEN_AM);
    assert.equal(task.due_date, '2026-09-11', 'the day is unchanged');

    /*
     * The ladder is rebuilt around the new deadline. A follow-up sits AFTER it
     * on purpose - that is what a follow-up is - so what matters is that the
     * rung at the deadline moved, and that nothing is still waiting at the old
     * one.
     */
    const fires = db
      .prepare(`SELECT kind, fire_at FROM reminders WHERE task_id = ? AND status = 'scheduled'`)
      .all(id);
    assert.ok(fires.length, 'something is scheduled');
    assert.equal(
      fires.find((r) => r.kind === 'due')?.fire_at, ELEVEN_AM,
      'the rung at the deadline fires at the new deadline'
    );
    assert.ok(
      !fires.some((r) => r.fire_at === SIX_PM),
      'nothing is left waiting at the deadline he moved away from'
    );
  });
});

describe('clearing the time', () => {
  it('keeps the day when the date is sent with it', () => {
    updateTask(id, { due_at: '', due_date: '2026-09-11' });
    const task = getTask(id);
    assert.equal(task.due_at, null, 'the exact time is gone');
    assert.equal(task.due_date, '2026-09-11', 'the deadline day is not');
  });

  it('would take the day with it if the date were left out', () => {
    // Not a wish - a fact about updateTask, and the reason the field sends
    // both halves. If this ever stops being true the guard can go.
    updateTask(id, { due_at: '' });
    assert.equal(getTask(id).due_date, null);
  });
});
