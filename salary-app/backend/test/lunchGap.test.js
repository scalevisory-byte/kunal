import test from 'node:test';
import assert from 'node:assert/strict';
import { LUNCH_RULES, asTime, findLunchGap } from '../../shared/lunchGap.js';
import { DEFAULT_RULES, punchesToMarks } from '../../shared/punches.js';

const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const day = (...times) => times.map(at);

test('the window is 20 to 90 minutes, and both ends of it are the point', () => {
  assert.equal(LUNCH_RULES.minMinutes, 20);
  assert.equal(LUNCH_RULES.maxMinutes, 90);

  // A real door-lock day: in, tea, back, lunch, back, home.
  const found = findLunchGap(day('09:12', '11:40', '11:52', '13:30', '14:05', '18:02'));
  assert.equal(asTime(found.out), '13:30');
  assert.equal(asTime(found.in), '14:05');
  assert.equal(found.minutes, 35);
});

test('TEA IS NOT LUNCH AND GOING HOME IS NOT LUNCH', () => {
  /*
   * Ten minutes at the door is tea and nobody calls it a break. Four hours is
   * somebody who went home and came back - booking that as lunch would
   * quietly turn one day into two half days.
   */
  assert.equal(findLunchGap(day('09:00', '11:00', '11:10', '18:00')), null, 'twelve minutes is tea');
  assert.equal(findLunchGap(day('09:00', '11:00', '15:00', '18:00')), null, 'four hours is not a break');
  // And the edges are inclusive, so exactly twenty and exactly ninety count.
  assert.equal(findLunchGap(day('09:00', '13:00', '13:20', '18:00')).minutes, 20);
  assert.equal(findLunchGap(day('09:00', '13:00', '14:30', '18:00')).minutes, 90);
  assert.equal(findLunchGap(day('09:00', '13:00', '13:19', '18:00')), null, 'one minute under');
  assert.equal(findLunchGap(day('09:00', '13:00', '14:31', '18:00')), null, 'one minute over');
});

test('TWO PUNCHES ARE A DAY, NOT A GAP', () => {
  // The time between an arrival and a departure is the day itself. Reading it
  // as a break would book the whole day as lunch.
  assert.equal(findLunchGap(day('09:00', '18:00')), null);
  assert.equal(findLunchGap(day('09:00')), null);
  assert.equal(findLunchGap([]), null);
  // A repeated stamp is one punch, not two.
  assert.equal(findLunchGap(day('09:00', '09:00', '18:00')), null);
});

test('A GAP ON THE WAY IN IS NOT LUNCH', () => {
  /*
   * This test was written to check "the longest gap wins" and caught a real
   * hole instead: 09:00 / 10:30 / 11:00 / 13:00 / 13:40 / 18:00 has a NINETY
   * minute gap right after the arrival, and length alone called that lunch
   * rather than the 13:00 one. Somebody who popped out first thing is not at
   * lunch, and where lunch comes off the hours that costs them ninety
   * minutes.
   */
  const two = findLunchGap(day('09:00', '10:30', '11:00', '13:00', '13:40', '18:00'));
  assert.equal(two.minutes, 40, 'the one in the middle of the day, not the long one at the start');
  assert.equal(asTime(two.out), '13:00');
  assert.equal(findLunchGap(day('09:00', '09:30', '10:05', '18:00')), null, 'too early to be lunch');
  assert.equal(findLunchGap(day('09:00', '17:00', '17:35', '18:30')), null, 'too late to be lunch');

  const tie = findLunchGap(day('09:00', '10:00', '10:30', '13:10', '13:40', '18:00'));
  assert.equal(tie.minutes, 30);
  assert.equal(asTime(tie.out), '13:10', 'the one nearer the middle of the day');
});

/* ---------------- through the importer ---------------- */

const PERIOD = { year: 2026, month: 11, hours_per_day: 9 };
const STAFF = [{ id: 1, name: 'AMIT SHAH', code: 'E1', active: 1 }];
const MAP = { employee: 0, date: 1, inTime: 1, outTime: 1, matchBy: 'code' };
const stamps = (...hhmm) => hhmm.map((t) => ({ values: ['E1', `20-11-2026 ${t}:00`] }));

const run = (rows, extra = {}) =>
  punchesToMarks({ rows, mapping: MAP, rules: DEFAULT_RULES, employees: STAFF, period: PERIOD, ...extra });

test('the importer fills the lunch it found, and counts them', () => {
  const got = run(stamps('09:12', '11:40', '11:52', '13:30', '14:05', '18:02'));
  const entry = got.entries.find((e) => e.day === 20);
  assert.equal(entry.in_time, '09:12');
  assert.equal(entry.out_time, '18:02');
  assert.equal(entry.lunch_out, '13:30');
  assert.equal(entry.lunch_in, '14:05');
  assert.equal(entry.lunch_found, true, 'flagged, so a typed lunch can be protected');
  assert.equal(got.summary.lunchFound, 1);
  assert.equal(got.summary.lunchMinutes, 35);
});

test('A FOUND LUNCH DOES NOT MOVE THE HOURS WHERE LUNCH IS INSIDE THE PAID DAY', () => {
  /*
   * This is how Dinesh's office runs - "Lunch is inside the day" - so finding
   * the break can only ever be a record there. The same day with and without
   * the lunch filled has to come out at the same minutes, or the feature
   * would have cut everybody's pay the day it shipped.
   */
  const rows = stamps('09:12', '11:40', '11:52', '13:30', '14:05', '18:02');
  const withLunch = run(rows, { deductLunch: false });
  const without = run(rows, { deductLunch: false, findLunch: false });
  const a = withLunch.entries.find((e) => e.day === 20);
  const b = without.entries.find((e) => e.day === 20);

  assert.equal(a.minutes, b.minutes, 'the day is worth exactly what it was');
  assert.equal(a.code, b.code);
  assert.equal(b.lunch_out, undefined, 'and switching it off writes no lunch at all');
});

test('where lunch IS deducted it comes off the hours, which is the existing setting and not a new rule', () => {
  /*
   * A long enough day that the fifteen-minute grace cannot mask the break -
   * the first fixture here was 8h 50m, where the shortfall went from 10
   * minutes (forgiven) to 45 (charged), and the difference read as 45 rather
   * than 35. The grace was doing its job; the test was reading it wrong.
   */
  const rows = stamps('09:00', '12:00', '12:40', '19:00');
  const paid = run(rows, { deductLunch: false }).entries.find((e) => e.day === 20);
  const taken = run(rows, { deductLunch: true }).entries.find((e) => e.day === 20);
  assert.equal(paid.minutes, 60, 'ten hours is an hour over');
  assert.equal(taken.minutes, 20, 'less the forty-minute break');
  assert.equal(paid.minutes - taken.minutes, 40, 'exactly the break, nothing else');
});

test('a lunch the SHEET named always wins over one worked out from the gaps', () => {
  const rows = [
    { values: ['E1', '20-11-2026 09:12:00', '12:00', '12:45'] },
    { values: ['E1', '20-11-2026 13:30:00', '', ''] },
    { values: ['E1', '20-11-2026 14:05:00', '', ''] },
    { values: ['E1', '20-11-2026 18:02:00', '', ''] },
  ];
  const got = punchesToMarks({
    rows,
    mapping: { ...MAP, lunchOut: 2, lunchIn: 3 },
    rules: DEFAULT_RULES,
    employees: STAFF,
    period: PERIOD,
  });
  const entry = got.entries.find((e) => e.day === 20);
  assert.equal(entry.lunch_out, '12:00', 'the column, not the gap');
  assert.equal(entry.lunch_in, '12:45');
  assert.equal(entry.lunch_found, undefined, 'and it is not flagged as worked out');
});
