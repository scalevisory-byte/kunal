import test from 'node:test';
import assert from 'node:assert/strict';
import { IN_OUT_COLUMNS, inOutCells, inOutRegister } from '../../shared/inOutRegister.js';

const PERIOD = { year: 2026, month: 11, hours_per_day: 9, lunch_paid: 0 };
const ROWS = [
  {
    employee_id: 1,
    employee_name: 'ABDULHAK BHENSWALA',
    employee_code: 'BNF-EMP-0010',
    company_name: 'BNF',
    department: 'Ticketing',
    attendance: {
      // A full day: 09:40 to 18:25 less a 40-minute lunch = 8h 05m, 55m short.
      16: { code: 'P', in_time: '09:40', lunch_out: '13:25', lunch_in: '14:05', out_time: '18:25', minutes: -55 },
      // An arrival and no departure.
      17: { code: 'P', in_time: '09:35', out_time: '', minutes: 0 },
      // A mark with no times at all.
      18: { code: 'CL', minutes: 0 },
      // A figure somebody typed over the clock.
      19: { code: 'P', in_time: '09:30', out_time: '18:00', minutes: -50 },
    },
  },
  { employee_id: 2, employee_name: 'NOBODY CLOCKED', employee_code: '45', company_name: 'BNF', attendance: {} },
];

test('one line per person-day, read down the month', () => {
  const { lines, totals } = inOutRegister(ROWS, PERIOD);
  assert.equal(lines.length, 4, 'only the days that carry something');
  assert.deepEqual(lines.map((l) => l.day), [16, 17, 18, 19], 'date order');
  assert.equal(totals.people, 1);
  assert.equal(totals.days, 4);
  assert.equal(totals.with_times, 3, 'the CL day has no clock times');
});

test('THE HOURS ARE ASSEMBLED, never recalculated', () => {
  // 09:40 to 18:25 is 8h 45m; the 40-minute lunch comes off on this month.
  const { lines } = inOutRegister(ROWS, PERIOD);
  const day = lines.find((l) => l.day === 16);
  assert.equal(day.worked_minutes, 485, '8h 05m');
  assert.equal(day.lunch_minutes, 40);
  assert.equal(day.lunch_deducted, true);
  assert.equal(day.minutes, -55, 'what the sheet is paid from, unchanged');
  assert.equal(day.typed_over, false, 'the stored figure IS what the clock comes to');
});

test('the lunch follows the month, not a default', () => {
  const paid = inOutRegister(ROWS, { ...PERIOD, lunch_paid: 1 });
  const day = paid.lines.find((l) => l.day === 16);
  assert.equal(day.worked_minutes, 525, '8h 45m with the break inside the paid day');
  assert.equal(day.lunch_deducted, false);
});

test('A DAY NOBODY CLOCKED IS NULL, NEVER NOUGHT', () => {
  // Nought hours would read as somebody who turned up and did nothing.
  const { lines } = inOutRegister(ROWS, PERIOD);
  const leave = lines.find((l) => l.day === 18);
  assert.equal(leave.worked_minutes, null);
  assert.equal(leave.in_time, '');
  assert.equal(inOutCells(leave).worked, '—');
  assert.equal(inOutCells(leave).in_time, '—');
});

test('an arrival with no departure is counted and left uncharged', () => {
  const { lines, totals } = inOutRegister(ROWS, PERIOD);
  const open = lines.find((l) => l.day === 17);
  assert.equal(open.worked_minutes, null, 'the hours are not known');
  assert.equal(open.minutes, 0, 'and nothing is charged for them');
  assert.equal(totals.no_out, 1);
});

test('A FIGURE TYPED OVER THE CLOCK SAYS SO', () => {
  /*
   * 09:30 to 18:00 with no lunch is 8h 30m, so the clock comes to −30. The
   * day carries −50. Without saying so the register reads as a sum that does
   * not add up, which is worse than no sum at all.
   */
  const { lines, totals } = inOutRegister(ROWS, PERIOD);
  const typed = lines.find((l) => l.day === 19);
  assert.equal(typed.from_clock, -30);
  assert.equal(typed.minutes, -50, 'the typed figure is what the salary uses');
  assert.equal(typed.typed_over, true);
  assert.equal(totals.typed_over, 1);
  assert.match(inOutCells(typed).charged, /typed/);
});

test('blank days are counted, and only listed when asked for', () => {
  const { totals } = inOutRegister(ROWS, PERIOD);
  assert.ok(totals.blank_days > 50, 'two people across a 30-day month');
  const all = inOutRegister(ROWS, PERIOD, { everyDay: true });
  assert.equal(all.lines.length, 60, 'two people x thirty days');
  assert.ok(all.lines.some((l) => l.employee_id === 2), 'somebody with nothing marked still appears');
});

test('the punches ride alongside, matched per person and day', () => {
  const { lines } = inOutRegister(ROWS, PERIOD, {
    punches: { 1: { 16: [{ at: '09:40' }, { at: '11:20' }, { at: '13:25' }, { at: '14:05' }, { at: '18:25' }] } },
  });
  const day = lines.find((l) => l.day === 16);
  assert.equal(day.punches, 5);
  assert.equal(day.punch_times, '09:40 · 11:20 · 13:25 · 14:05 · 18:25');
  // A day with none says nothing rather than inventing a list.
  assert.equal(lines.find((l) => l.day === 17).punch_times, '');
});

test('the totals add up what is really there', () => {
  const { totals } = inOutRegister(ROWS, PERIOD);
  assert.equal(totals.worked_minutes, 485 + 510, 'the two days with both ends');
  assert.equal(totals.short_minutes, 55 + 50);
  assert.equal(totals.ot_minutes, 0);
});

test('it carries no salary and nothing statutory', () => {
  const keys = IN_OUT_COLUMNS.map((c) => c.key);
  for (const banned of ['monthly_salary', 'salary', 'net_salary', 'pan', 'aadhaar', 'bank_account']) {
    assert.ok(!keys.includes(banned), `${banned} has no business on an in/out register`);
  }
});

test('an empty month is an empty list, not a thrown error', () => {
  const got = inOutRegister([], PERIOD);
  assert.deepEqual(got.lines, []);
  assert.equal(got.totals.people, 0);
  assert.equal(got.totals.worked_minutes, 0);
});
