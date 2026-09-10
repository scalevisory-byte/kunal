/**
 * The popup that says a deadline has arrived.
 *
 * The list already shows what is late, and a list is exactly what nobody reads
 * while in the middle of something else - which is how a hundred tasks reached
 * their deadline unnoticed. So a deadline passing interrupts once.
 *
 * "Once" is the whole difficulty. Too eager and it becomes something you
 * dismiss without reading; too forgetful and it never comes back when it
 * should. These pin both edges.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-duenow-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.TIMEZONE = 'Asia/Kolkata';

const DB = await import('../src/db.js');
const { dueNow, setTaskNotice } = await import('../src/due-notices.js');

const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const hoursAhead = (n) => new Date(Date.now() + n * 3600_000).toISOString();
const make = (fields) => DB.createTask({ title: 'a task', ...fields });
const titles = () => dueNow().map((d) => d.title);

describe('what the popup asks about', () => {
  it('a deadline that has passed', () => {
    make({ title: 'Pay Arroohan TDS', due_at: hoursAgo(2) });
    assert.deepEqual(titles(), ['Pay Arroohan TDS']);
  });

  it('never one still to come', () => {
    make({ title: 'Later today', due_at: hoursAhead(3) });
    assert.ok(!titles().includes('Later today'));
  });

  it('never one with no deadline at all', () => {
    make({ title: 'No deadline here' });
    assert.ok(!titles().includes('No deadline here'));
  });

  it('never one already finished', () => {
    const t = make({ title: 'Already done', due_at: hoursAgo(5) });
    DB.updateTask(t.id, { status: 'done' });
    assert.ok(!titles().includes('Already done'));
  });

  it('never one still waiting to be confirmed - it is not chased at all', () => {
    make({ title: 'Unsure about this', due_at: hoursAgo(4), needs_confirmation: 1 });
    assert.ok(!titles().includes('Unsure about this'));
  });

  it('the oldest broken promise first', () => {
    make({ title: 'Late by one', due_at: hoursAgo(1) });
    make({ title: 'Late by nine', due_at: hoursAgo(9) });
    const out = titles();
    assert.ok(out.indexOf('Late by nine') < out.indexOf('Late by one'));
  });
});

describe('answering it', () => {
  it('dismissing stops it coming back', () => {
    const t = make({ title: 'Dismiss me', due_at: hoursAgo(3) });
    const row = dueNow({ limit: 500 }).find((d) => d.id === t.id);
    assert.ok(row, 'it was asked about');

    setTaskNotice(t.id, row.due_key, 'seen');
    assert.ok(!dueNow({ limit: 500 }).some((d) => d.id === t.id), 'and not again');
  });

  it('later quiets it now and returns it afterwards', () => {
    const t = make({ title: 'Later me', due_at: hoursAgo(3) });
    const row = dueNow({ limit: 500 }).find((d) => d.id === t.id);

    setTaskNotice(t.id, row.due_key, 'later', 60);
    assert.ok(!dueNow({ limit: 500 }).some((d) => d.id === t.id), 'quiet for the hour');

    // The hour is up.
    const later = new Date(Date.now() + 61 * 60_000);
    assert.ok(
      dueNow({ now: later, limit: 500 }).some((d) => d.id === t.id),
      'and it is asked again'
    );
  });

  it('later does not touch the deadline itself', () => {
    const due = hoursAgo(3);
    const t = make({ title: 'Deadline stands', due_at: due });
    const row = dueNow({ limit: 500 }).find((d) => d.id === t.id);
    setTaskNotice(t.id, row.due_key, 'later', 60);
    assert.equal(DB.getTask(t.id).due_at, due, 'the promise is unchanged');
  });
});

describe('a new deadline is a new notice', () => {
  it('a task moved to a later day is asked about again when that day passes', () => {
    const t = make({ title: 'Moved on', due_at: hoursAgo(3) });
    const first = dueNow({ limit: 500 }).find((d) => d.id === t.id);
    setTaskNotice(t.id, first.due_key, 'seen');
    assert.ok(!dueNow({ limit: 500 }).some((d) => d.id === t.id), 'quiet after dismissal');

    /*
     * Rescheduled, and that deadline passes too. Inheriting the silence of the
     * old one is the failure worth guarding: the notice is keyed on the
     * deadline it was for, not on the task.
     */
    DB.updateTask(t.id, { due_at: hoursAgo(1) });
    const again = dueNow({ limit: 500 }).find((d) => d.id === t.id);
    assert.ok(again, 'the new deadline is its own notice');
    assert.notEqual(again.due_key, first.due_key);
  });
});
