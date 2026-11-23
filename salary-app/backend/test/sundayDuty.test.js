import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRow } from '../../shared/calc.js';
import {
  SUNDAY_DAY_HOURS,
  SUNDAY_MARKS,
  shortSundays,
  sundayDutyFor,
  sundayHoursFor,
} from '../../shared/sundayDuty.js';

const PERIOD = { year: 2026, month: 11, hours_per_day: 9, pt_threshold: 12000, pt_amount: 200 };

test("a Sunday's duty is six hours, and a month can carry its own figure", () => {
  assert.equal(SUNDAY_DAY_HOURS, 6);
  assert.equal(sundayHoursFor({}), 6, 'the default when a month says nothing');
  assert.equal(sundayHoursFor(PERIOD), 6);
  assert.equal(sundayHoursFor({ sunday_hours: 8 }), 8, 'held per month');
  // Nonsense never becomes the rule.
  assert.equal(sundayHoursFor({ sunday_hours: 0 }), 6);
  assert.equal(sundayHoursFor({ sunday_hours: -3 }), 6);
  assert.equal(sundayHoursFor({ sunday_hours: 99 }), 6);
  assert.equal(sundayHoursFor({ sunday_hours: 'later' }), 6);
});

test('only the marks the register pays a day for are counted', () => {
  assert.deepEqual([...SUNDAY_MARKS].sort(), ['HP', 'SP']);
});

test('six hours is the whole day; under it is named; unclocked is NOT KNOWN', () => {
  const duty = sundayDutyFor(
    {
      attendance: {
        1: { code: 'SP', in_time: '09:00', out_time: '15:00' }, // exactly six
        8: { code: 'SP', in_time: '10:48', out_time: '16:09' }, // 5h 21m
        15: { code: 'SP' }, // worked, nobody clocked it
        22: { code: 'SP', in_time: '07:45', out_time: '17:56' }, // 10h 11m
        23: { code: 'P', in_time: '09:00', out_time: '10:00' }, // not a Sunday mark
      },
    },
    PERIOD
  );

  assert.equal(duty.counted, 4, 'the ordinary working day is not a Sunday');
  assert.equal(duty.clocked, 3);
  assert.equal(duty.unclocked, 1);
  assert.equal(duty.full, 2, 'exactly six hours earns the day');

  const on = (d) => duty.days.find((x) => x.day === d);
  assert.equal(on(1).full, true, 'six hours on the nose is the full day, not a near miss');
  assert.equal(on(1).short, 0);
  assert.equal(on(8).full, false);
  assert.equal(on(8).short, 39, '5h 21m is 39 minutes under six hours');
  assert.equal(on(22).full, true);

  /*
   * THE DISTINCTION THE MODULE EXISTS FOR. A Sunday nobody clocked is not a
   * Sunday somebody skipped. Most of the staff are not on the readers yet, so
   * reading a blank day as nought hours would condemn nearly every Sunday in
   * the month and get people docked for attendance that simply never arrived.
   */
  assert.equal(on(15).worked, null, 'never 0');
  assert.equal(on(15).full, null, 'never false');
  assert.equal(on(15).short, null);
  assert.ok(!duty.shortDays.some((d) => d.day === 15), 'and it is never on the short list');
});

test('the short list names people, longest first, and leaves everyone else out', () => {
  const rows = [
    {
      id: 1,
      employee_id: 1,
      employee_name: 'ALIFAYA CHIKHALIWALA',
      attendance: {
        8: { code: 'SP', in_time: '10:48', out_time: '16:09' },
        15: { code: 'SP', in_time: '11:00', out_time: '14:00' },
      },
    },
    { id: 2, employee_id: 2, employee_name: 'ASHOK MISHRA', attendance: { 22: { code: 'SP', in_time: '07:45', out_time: '17:56' } } },
    { id: 3, employee_id: 3, employee_name: 'ANSARI SULEMAN', attendance: { 8: { code: 'SP', in_time: '10:20', out_time: '16:59' } } },
  ];
  const lines = shortSundays(rows, PERIOD);
  assert.deepEqual(lines.map((l) => l.employee_name), ['ALIFAYA CHIKHALIWALA']);
  assert.equal(lines[0].days.length, 2);
  // 6h 39m clears the six-hour line, so ANSARI SULEMAN is not a question at all.
});

test('NOTHING HERE MOVES A RUPEE', () => {
  /*
   * The whole module reports. `calculateRow` still pays sundays_worked x the
   * day rate, exactly as it always has, whatever the clock says about those
   * days - a Sunday short of its hours is named for the office to decide, in
   * the same way an unreturned asset is named and never deducted.
   */
  const base = {
    salary: 26000,
    attendance: {
      1: { code: 'SP', in_time: '09:00', out_time: '15:00' },
      8: { code: 'SP', in_time: '11:00', out_time: '13:00' }, // two hours
      10: { code: 'P' },
    },
  };
  const full = {
    ...base,
    attendance: {
      ...base.attendance,
      8: { code: 'SP', in_time: '09:00', out_time: '18:00' }, // nine hours
    },
  };

  const a = calculateRow(base, PERIOD, base.attendance);
  const b = calculateRow(full, PERIOD, full.attendance);
  for (const key of ['gross_salary', 'net_salary', 'final_payable', 'sundays_worked', 'sunday_salary', 'pt']) {
    assert.equal(a[key], b[key], `${key} must not move on the strength of a Sunday's hours`);
  }
  assert.equal(a.sundays_worked, 2);
  assert.ok(a.sunday_salary > 0, 'both Sundays are still paid in full');
});
