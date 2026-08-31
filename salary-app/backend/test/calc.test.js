import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTENDANCE_CODES,
  STANDARD_WORKING_DAYS,
  absentDaysFromAttendance,
  calculateRow,
  countMarks,
  minutesFromAttendance,
  sundayDaysFromAttendance,
  sundaysFromAttendance,
  totalRows,
} from '../../shared/calc.js';

/**
 * Reference values taken straight from the April tab of Salary_Sheet_2627.xlsx.
 * If a formula here drifts, these fail.
 */
const APRIL = [
  // name, salary, absent, sundays, otAmount, esi, pf -> gross, pt, net, sundaySalary
  ['Ashutosh Jha', 60000, 7.5, 1, -90, 0, 0, 42602, 200, 42402, 2308],
  ['Rohit Tayade', 22000, 1, 1, 0, 0, 1800, 21154, 200, 19154, 846],
  ['Harshal Badlawala', 32500, 1.5, 0, 147, 0, 0, 30772, 200, 30572, 0],
  ['Varishal Singh Deora', 100000, 4, 0, 0, 0, 0, 84615, 200, 84415, 0],
  ['Hinali PHtel', 14000, 0, 0, -444, 0, 0, 13556, 200, 13356, 0],
  ['Krinali Patel', 12000, 13.5, 0, -464, 0, 0, 5305, 0, 5305, 0],
  ['Ishika Rana', 11000, 0.5, 0, 51, 0, 0, 10839, 0, 10839, 0],
  // Salary over 12,000, but absences pull the month under the slab, so no PT.
  ['Mahesh Shinde', 15000, 6, 0, -545, 0, 0, 10993, 0, 10993, 0],
  ['Nilesh Chitte', 14500, 4.5, 0, 0, 0, 0, 11990, 0, 11990, 0],
  ['Veer Gupta-Veer', 14000, 10, 0, -132, 0, 0, 8483, 0, 8483, 0],
];

test('April rows reproduce the sheet', () => {
  for (const [name, salary, absent, sundays, ot, esi, pf, gross, pt, net, sundaySalary] of APRIL) {
    const r = calculateRow(
      { salary, absent_days_override: absent, sundays_override: sundays, ot_amount_override: ot, esi, pf },
      {}
    );
    assert.equal(r.gross_salary, gross, `${name} gross`);
    assert.equal(r.pt, pt, `${name} PT`);
    assert.equal(r.net_salary, net, `${name} net`);
    assert.equal(r.sunday_salary, sundaySalary, `${name} sunday salary`);
    assert.equal(r.final_payable, net + sundaySalary, `${name} final payable`);
  }
});

test('absent days follow the sheet COUNTIF: A=1, HF=0.5, AD=2', () => {
  const attendance = { 1: 'A', 2: 'A', 3: 'HF', 4: 'AD', 5: 'P', 6: 'WH', 7: 'S', 8: 'PH', 9: 'zz' };
  assert.equal(absentDaysFromAttendance(attendance), 4.5);
  assert.equal(sundaysFromAttendance(attendance), 0);
});

test('SP and HP are the sundays/holidays worked', () => {
  assert.equal(sundaysFromAttendance({ 1: 'SP', 8: 'SP', 15: 'HP', 22: 'S' }), 3);
});

test('the register knows which dates those were', () => {
  const marks = { 15: 'HP', 1: 'SP', 22: 'S', 8: 'SP', 9: 'A' };
  assert.deepEqual(sundayDaysFromAttendance(marks), [1, 8, 15], 'in date order, SP and HP only');
  assert.deepEqual(sundayDaysFromAttendance({}), []);
  // A count typed over the marks leaves the register with no dates to show.
  const r = calculateRow({ salary: 26000, sundays_override: 3 }, {}, {});
  assert.equal(r.sundays_worked, 3);
  assert.deepEqual(sundayDaysFromAttendance({}), []);
});

test('paid leave costs nothing, unpaid leave costs a day', () => {
  assert.equal(ATTENDANCE_CODES.PL.absent, 0);
  assert.equal(ATTENDANCE_CODES.UL.absent, 1);

  const paid = calculateRow({ salary: 26000 }, {}, { 5: 'PL', 6: 'PL', 7: 'PL' });
  assert.equal(paid.absent_days, 0);
  assert.equal(paid.net_salary, 25800, 'three days of paid leave, full salary less PT');

  const unpaid = calculateRow({ salary: 26000 }, {}, { 5: 'UL', 6: 'UL', 7: 'UL' });
  assert.equal(unpaid.absent_days, 3);
  assert.equal(unpaid.gross_salary, 23000, 'three days deducted at 1000/day');
});

test('unpaid leave deducts exactly what a plain absence does', () => {
  const marks = { 5: 'A', 6: 'A' };
  const leave = { 5: 'UL', 6: 'UL' };
  assert.equal(
    calculateRow({ salary: 26000 }, {}, marks).net_salary,
    calculateRow({ salary: 26000 }, {}, leave).net_salary
  );
});

test('leave is counted separately from absence', () => {
  const counts = countMarks({ 1: 'P', 2: 'A', 3: 'PL', 4: 'PL', 5: 'UL', 6: 'zz', 7: '' });
  assert.deepEqual(counts, { P: 1, A: 1, PL: 2, UL: 1 }, 'unknown and empty marks are not counted');
});

test('every mark declares what it does to the salary', () => {
  for (const [code, meta] of Object.entries(ATTENDANCE_CODES)) {
    assert.equal(typeof meta.label, 'string', `${code} has a name to show`);
    assert.ok(Number.isFinite(meta.absent), `${code} has an absent weight`);
    assert.ok(Number.isFinite(meta.sunday), `${code} has a sunday weight`);
    // Nothing may both cost a day and earn one.
    assert.ok(!(meta.absent > 0 && meta.sunday > 0), `${code} is not both`);
  }
});

test('marks drive the numbers when nothing is overridden', () => {
  const attendance = { 2: 'A', 9: 'HF', 16: 'SP' };
  const r = calculateRow({ salary: 26000 }, {}, attendance);
  assert.equal(r.absent_days, 1.5);
  assert.equal(r.present_days, 24.5);
  assert.equal(r.per_day, 1000);
  assert.equal(r.absent_salary, 1500);
  assert.equal(r.gross_salary, 24500);
  assert.equal(r.sunday_salary, 1000);
  assert.equal(r.final_payable, 24300 + 1000);
});

test('a typed override beats the marks, and clearing it hands control back', () => {
  const attendance = { 2: 'A', 3: 'A', 4: 'A' };
  const withOverride = calculateRow({ salary: 26000, absent_days_override: 1 }, {}, attendance);
  assert.equal(withOverride.absent_days, 1);
  const cleared = calculateRow({ salary: 26000, absent_days_override: null }, {}, attendance);
  assert.equal(cleared.absent_days, 3);
  // 0 is a real override, not "unset".
  assert.equal(calculateRow({ salary: 26000, absent_days_override: 0 }, {}, attendance).absent_days, 0);
});

test('short hours marked on days add up and come off at the per-minute rate', () => {
  // 23400 / 26 / 9 / 60 = 1.6667 per minute
  const attendance = {
    5: { code: 'P', minutes: -30 },
    6: { code: 'P', minutes: -60 },
    7: { code: 'P', minutes: -40 },
  };
  assert.equal(minutesFromAttendance(attendance), -130);

  const r = calculateRow({ salary: 23400 }, {}, attendance);
  assert.equal(r.ot_minutes, -130);
  assert.equal(r.ot_minutes_from_days, -130);
  assert.equal(r.ot_salary, -216.67);
  assert.equal(r.gross_salary, 23183, '23400 - 217');
  assert.equal(r.absent_days, 0, 'short hours are not absent days');
});

test('an hour short costs exactly an hour of pay', () => {
  const hour = calculateRow({ salary: 23400 }, {}, { 5: { code: 'P', minutes: -60 } });
  assert.equal(hour.per_hour, 100);
  assert.equal(hour.ot_salary, -100);
});

test('overtime on a day is added, not deducted', () => {
  const r = calculateRow({ salary: 23400 }, {}, { 5: { code: 'P', minutes: 90 } });
  assert.equal(r.ot_minutes, 90);
  assert.equal(r.ot_salary, 150);
  assert.equal(r.gross_salary, 23550);
});

test('short hours and an absence on different days both apply', () => {
  const r = calculateRow({ salary: 26000 }, {}, { 5: 'A', 6: { code: 'P', minutes: -60 } });
  assert.equal(r.absent_days, 1);
  assert.equal(r.absent_salary, 1000);
  assert.equal(r.per_hour, 111.11);
  assert.equal(r.gross_salary, 24889, '26000 - 1000 day - 111 hour');
});

test('a month total typed on the sheet overrides the minutes marked on the days', () => {
  const attendance = { 5: { code: 'P', minutes: -30 }, 6: { code: 'P', minutes: -30 } };
  const derived = calculateRow({ salary: 23400 }, {}, attendance);
  assert.equal(derived.ot_minutes, -60);

  const typed = calculateRow({ salary: 23400, ot_minutes_override: -120 }, {}, attendance);
  assert.equal(typed.ot_minutes, -120, 'the typed total wins');
  assert.equal(typed.ot_minutes_from_days, -60, 'the days are still reported');

  // Zero is a real answer, not "unset".
  assert.equal(calculateRow({ salary: 23400, ot_minutes_override: 0 }, {}, attendance).ot_minutes, 0);
});

test('a day carries minutes with no mark at all', () => {
  const r = calculateRow({ salary: 23400 }, {}, { 5: { code: '', minutes: -60 } });
  assert.equal(r.absent_days, 0);
  assert.equal(r.ot_salary, -100);
});

test('OT is paid per minute off the salary, late minutes deduct', () => {
  // 23400 / 26 / 9 / 60 = 1.6667 per minute
  const ot = calculateRow({ salary: 23400, ot_minutes_override: 600 }, {});
  assert.equal(ot.gross_salary, 24400);
  const late = calculateRow({ salary: 23400, ot_minutes_override: -600 }, {});
  assert.equal(late.gross_salary, 22400);
});

test('PT applies only above the threshold', () => {
  assert.equal(calculateRow({ salary: 12000 }, {}).pt, 0, 'exactly 12000 is not "more than"');
  assert.equal(calculateRow({ salary: 12001 }, {}).pt, 200);
  // A period can carry its own slab without touching past months.
  assert.equal(calculateRow({ salary: 20000 }, { pt_threshold: 25000 }).pt, 0);
  assert.equal(calculateRow({ salary: 20000 }, { pt_threshold: 15000, pt_amount: 300 }).pt, 300);
});

test('PT goes by what the month pays, not by the salary on the master', () => {
  // Mahesh Shinde in the April sheet: 15,000 a month, but six days absent take
  // the month to 10,993, under the slab - so no PT that month.
  const absent = calculateRow({ salary: 15000, absent_days_override: 6 }, {});
  assert.ok(absent.gross_salary < 12000);
  assert.equal(absent.pt, 0);

  // And the other way: a 12,000 salary that overtime lifts over the line pays.
  const boosted = calculateRow({ salary: 12000, adjustment: 5000 }, {});
  assert.equal(boosted.gross_salary, 17000);
  assert.equal(boosted.pt, 200);
});

test('Sunday pay does not count towards the PT line', () => {
  // Paid on top of the net, so it never drags a month over the slab.
  const r = calculateRow({ salary: 12000, sundays_override: 3 }, {});
  assert.equal(r.gross_salary, 12000);
  assert.equal(r.sunday_salary, 1385);
  assert.ok(r.final_payable > 12000, 'the person takes home more than 12,000');
  assert.equal(r.pt, 0, 'but PT still goes by the gross alone');
});

test('every month divides by 26, whatever the calendar or the caller says', () => {
  assert.equal(STANDARD_WORKING_DAYS, 26);
  // 28, 30 and 31 day months all pay the same day rate for the same salary.
  for (const workingDays of [26, 27, 28, 30, 31, 0, null, undefined, 'thirty']) {
    const r = calculateRow({ salary: 26000, absent_days_override: 1 }, { working_days: workingDays });
    assert.equal(r.working_days, 26, `working_days ${workingDays}`);
    assert.equal(r.per_day, 1000, `day rate for working_days ${workingDays}`);
    assert.equal(r.present_days, 25);
    assert.equal(r.gross_salary, 25000);
  }
});

test('hours per day still moves the overtime rate, without touching the day rate', () => {
  const r = calculateRow({ salary: 26000, ot_minutes_override: 60 }, { hours_per_day: 8 });
  assert.equal(r.per_day, 1000, 'still salary / 26');
  assert.equal(r.per_hour, 125, '1000 / 8');
  assert.equal(r.gross_salary, 26125);
});

test('deductions and additions land on the gross before PT', () => {
  const deducted = calculateRow({ salary: 12100, adjustment: -200 }, {});
  assert.equal(deducted.gross_salary, 11900);
  assert.equal(deducted.pt, 0, 'a deduction that drops the month below the slab drops PT');

  const added = calculateRow({ salary: 11900, adjustment: 200 }, {});
  assert.equal(added.gross_salary, 12100);
  assert.equal(added.pt, 200, 'and an addition can create it');
});

test('totals add up across rows', () => {
  const rows = [calculateRow({ salary: 20000 }, {}), calculateRow({ salary: 30000, pf: 1800 }, {})];
  const t = totalRows(rows);
  assert.equal(t.count, 2);
  assert.equal(t.salary, 50000);
  assert.equal(t.pt, 400);
  assert.equal(t.net_salary, 19800 + 28000);
});

test('a zero salary produces zeroes, not NaN', () => {
  const r = calculateRow({ salary: 0 }, {});
  for (const value of Object.values(r)) assert.ok(Number.isFinite(value), 'every field is a number');
  assert.equal(r.net_salary, 0);
  assert.equal(r.final_payable, 0);
});
