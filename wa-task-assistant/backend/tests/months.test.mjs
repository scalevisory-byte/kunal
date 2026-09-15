/**
 * The list, by month.
 *
 * Asked for as "itna karo ki usme month wise dikhe — month complete ho aur us
 * month ke task pending he to us month ki tab me dikhe". Both halves are one
 * rule and both are pinned here: a finished month keeps its chip for exactly
 * as long as it still has work owed, and loses it the moment it does not.
 *
 * The failure this is guarding against is the expensive one in both
 * directions. A September job still open in October must not quietly become
 * October's problem (he would stop trusting the dates), and it must not vanish
 * because September is over (he would lose the work).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { taskMonth, monthsFor, monthLabel, currentMonth } =
  await import('../../frontend/src/lib/task.js');

const NOW = new Date('2026-10-08T10:00:00');   // October; September is over
const task = (over = {}) => ({
  id: Math.random(), status: 'open', due_date: null, due_at: null,
  created_at: '2026-10-01 09:00:00', ...over,
});

describe('which month a task belongs to', () => {
  it('is its deadline\'s month, not the month the message arrived', () => {
    // A job due on 20 October is October's work even when it was asked for in
    // September. Filing it under September would put it behind a chip he has
    // already stopped looking at.
    const t = task({ created_at: '2026-09-05 11:00:00', due_date: '2026-10-20' });
    assert.equal(taskMonth(t), '2026-10');
  });

  it('falls back to when it arrived, which is all a task with no deadline has', () => {
    assert.equal(taskMonth(task({ created_at: '2026-09-05 11:00:00' })), '2026-09');
  });

  it('reads a bare due_at when that is the only moment on the task', () => {
    assert.equal(taskMonth(task({ due_at: '2026-11-03T12:30:00.000Z' })), '2026-11');
  });

  it('says nothing rather than guessing when there is no date at all', () => {
    assert.equal(taskMonth({ status: 'open' }), null);
  });
});

describe('which months get a chip', () => {
  it('keeps a finished month while its work is still owed', () => {
    const months = monthsFor([
      task({ due_date: '2026-09-18' }),                    // September, still open
      task({ due_date: '2026-10-09' }),                    // October
    ], NOW);
    const sep = months.find((m) => m.key === '2026-09');
    assert.ok(sep, 'September lost its chip while it still had work owed');
    assert.equal(sep.pending, 1);
  });

  it('drops a past month once everything in it is finished', () => {
    const months = monthsFor([
      task({ due_date: '2026-09-18', status: 'done' }),
      task({ due_date: '2026-10-09' }),
    ], NOW);
    assert.ok(!months.some((m) => m.key === '2026-09'),
      'a month with nothing left to chase still took up the row');
  });

  it('always shows this month, even on a morning with nothing in it', () => {
    const months = monthsFor([], NOW);
    assert.equal(months.length, 1);
    assert.equal(months[0].key, '2026-10');
    assert.equal(months[0].current, true);
  });

  it('marks a past month whose work is already late', () => {
    // isOverdue compares against the real clock, so the date has to be a
    // genuinely past one rather than one relative to NOW.
    const months = monthsFor([task({ due_date: '2020-09-18' })], NOW);
    const old = months.find((m) => m.key === '2020-09');
    assert.ok(old, 'a long-overdue month lost its chip');
    assert.equal(old.overdue, 1);
  });

  it('counts only what is still owed, not everything that ever happened', () => {
    const months = monthsFor([
      task({ due_date: '2026-10-02', status: 'done' }),
      task({ due_date: '2026-10-03' }),
      task({ due_date: '2026-10-04' }),
    ], NOW);
    const oct = months.find((m) => m.key === '2026-10');
    assert.equal(oct.total, 3);
    assert.equal(oct.pending, 2, 'a finished task was counted as work owed');
  });

  it('puts the newest month first, because that is where he is working', () => {
    const months = monthsFor([
      task({ due_date: '2026-08-11' }),
      task({ due_date: '2026-10-11' }),
      task({ due_date: '2026-09-11' }),
    ], NOW);
    assert.deepEqual(months.map((m) => m.key), ['2026-10', '2026-09', '2026-08']);
  });

  it('names the year only when it is not this one', () => {
    assert.equal(monthLabel('2026-09', NOW), 'Sep');
    assert.equal(monthLabel('2025-09', NOW), 'Sep 2025');
  });

  it('agrees with the clock about what "this month" is', () => {
    assert.equal(currentMonth(NOW), '2026-10');
  });
});

describe('the chips and the list cannot disagree', () => {
  it('a chip reading N opens a list of N', () => {
    // The strip counts the rows the board already holds, and the board then
    // filters those same rows by the same taskMonth(). Two rules would drift;
    // one cannot.
    const rows = [
      task({ due_date: '2026-09-18' }),
      task({ due_date: '2026-09-19' }),
      task({ due_date: '2026-10-09' }),
      task({ due_date: '2026-09-20', status: 'done' }),
    ];
    const sep = monthsFor(rows, NOW).find((m) => m.key === '2026-09');
    const shown = rows.filter((t) => taskMonth(t) === '2026-09' && t.status !== 'done');
    assert.equal(sep.pending, shown.length);
  });
});
