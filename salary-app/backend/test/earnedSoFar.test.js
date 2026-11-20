/**
 * WHAT THEY HAVE EARNED SO FAR THIS MONTH.
 *
 * Dinesh: *"jo date ko open kare o date tak ki earning bhi dikhavo"*. An
 * employee opening their own page on the 20th was shown the whole month's
 * net pay, eleven unworked days included.
 *
 * What these pin:
 *
 *  - **It stops at today.** Days after it are not counted, marked or not —
 *    approved leave next week is neither earned nor lost yet.
 *  - **It counts days the way the month does**: a day nobody marked counts
 *    as worked, an absence costs a day, a half day half, AD two.
 *  - **A weekly off is neither earned nor lost.**
 *  - **It is not take-home.** It is the day-rate earning, before PF, ESI,
 *    PT and anything else — the page says so, and the figure must never
 *    quietly become the net.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { earnedSoFar } from '../../shared/earnedSoFar.js';

// November 2026: the 1st, 8th, 15th, 22nd and 29th are Sundays.
const PERIOD = { year: 2026, month: 11 };
const CALC = { per_day: 1000 };

test('it stops at today, whatever is marked after it', () => {
  const marks = { 2: 'P', 3: 'P', 25: 'A', 26: 'A' };
  const to5 = earnedSoFar({ period: PERIOD, attendance: marks, calc: CALC, upto: 5 });
  // 1st is a Sunday; the 2nd to the 5th are four working days.
  assert.equal(to5.days_worked, 4);
  assert.equal(to5.days_lost, 0, 'absences later in the month are not lost yet');
  assert.equal(to5.amount, 4000);
});

test('a day nobody has marked counts as worked, because that is how the month pays it', () => {
  const to5 = earnedSoFar({ period: PERIOD, attendance: {}, calc: CALC, upto: 5 });
  assert.equal(to5.days_worked, 4);
  assert.equal(to5.days_unmarked, 4);
  assert.equal(to5.days_marked, 0);
});

test('an absence costs a day, a half day half, a double absence two', () => {
  const marks = { 2: 'A', 3: 'HF', 4: { code: 'AD' }, 5: 'P' };
  const to5 = earnedSoFar({ period: PERIOD, attendance: marks, calc: CALC, upto: 5 });
  assert.equal(to5.days_lost, 1 + 0.5 + 2);
  assert.equal(to5.days_worked, 0 + 0.5 + 0 + 1);
  assert.equal(to5.amount, 1500);
});

test('leave, a holiday and a day at home are days worked for this purpose', () => {
  const marks = { 2: 'CL', 3: 'PH', 4: 'WH', 5: 'SL' };
  const to5 = earnedSoFar({ period: PERIOD, attendance: marks, calc: CALC, upto: 5 });
  assert.equal(to5.days_worked, 4);
  assert.equal(to5.days_lost, 0);
});

test('unpaid leave costs a day, like an absence', () => {
  const to5 = earnedSoFar({ period: PERIOD, attendance: { 2: 'UL' }, calc: CALC, upto: 5 });
  assert.equal(to5.days_lost, 1);
  assert.equal(to5.days_worked, 3);
});

test('a Sunday is neither earned nor lost, marked S or left blank', () => {
  const blank = earnedSoFar({ period: PERIOD, attendance: {}, calc: CALC, upto: 8 });
  // 1st and 8th are Sundays, so the 2nd to the 7th are six working days.
  assert.equal(blank.days_off, 2);
  assert.equal(blank.days_worked, 6);

  const marked = earnedSoFar({ period: PERIOD, attendance: { 8: 'S' }, calc: CALC, upto: 8 });
  assert.equal(marked.days_off, 2);
  assert.equal(marked.days_worked, 6);
});

test('a Sunday that WAS worked counts as a day worked', () => {
  const worked = earnedSoFar({ period: PERIOD, attendance: { 8: 'SP' }, calc: CALC, upto: 8 });
  assert.equal(worked.days_off, 1, 'only the 1st is still an off day');
  assert.equal(worked.days_worked, 7);
});

test('it is nothing to show without a day rate, or before the month starts', () => {
  assert.equal(earnedSoFar({ period: PERIOD, calc: {}, upto: 5 }), null);
  assert.equal(earnedSoFar({ period: PERIOD, calc: CALC, upto: 0 }), null);
  assert.equal(earnedSoFar({ calc: CALC, upto: 5 }), null);
});

test('the figure is the day rate, never the net — the page says so and so does this', () => {
  const to20 = earnedSoFar({
    period: PERIOD,
    attendance: { 4: 'A', 6: 'HF' },
    calc: { per_day: 576.92 },
    upto: 20,
  });
  // The 1st, 8th and 15th are Sundays: 17 working days, less 1.5 not worked.
  assert.equal(to20.days_worked, 15.5);
  assert.equal(to20.amount, Math.round(15.5 * 576.92));
  // Nothing in here is a deduction, and nothing pretends to be a net.
  assert.ok(!('net' in to20) && !('pf' in to20) && !('pt' in to20));
});
