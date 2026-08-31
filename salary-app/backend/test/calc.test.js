import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTENDANCE_CODES,
  absentDaysFromAttendance,
  calculateRow,
  countMarks,
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

test('OT is paid per minute off the salary, late minutes deduct', () => {
  // 23400 / 26 / 9 / 60 = 1.6667 per minute
  const ot = calculateRow({ salary: 23400, ot_minutes: 600 }, {});
  assert.equal(ot.gross_salary, 24400);
  const late = calculateRow({ salary: 23400, ot_minutes: -600 }, {});
  assert.equal(late.gross_salary, 22400);
});

test('PT applies only above the threshold, on the gross', () => {
  assert.equal(calculateRow({ salary: 12000 }, {}).pt, 0);
  assert.equal(calculateRow({ salary: 12001 }, {}).pt, 200);
  // A period can carry its own slab without touching past months.
  assert.equal(calculateRow({ salary: 20000 }, { pt_threshold: 25000 }).pt, 0);
  assert.equal(calculateRow({ salary: 20000 }, { pt_threshold: 15000, pt_amount: 300 }).pt, 300);
});

test('a period with different working days changes the day rate', () => {
  const r = calculateRow({ salary: 27000, absent_days_override: 1 }, { working_days: 27, hours_per_day: 8.5 });
  assert.equal(r.per_day, 1000);
  assert.equal(r.per_hour, 117.65);
  assert.equal(r.gross_salary, 26000);
});

test('deductions and additions land on the gross before PT', () => {
  const deducted = calculateRow({ salary: 12100, adjustment: -200 }, {});
  assert.equal(deducted.gross_salary, 11900);
  assert.equal(deducted.pt, 0, 'a deduction that drops the gross below the slab drops PT too');
  assert.equal(calculateRow({ salary: 11900, adjustment: 200 }, {}).pt, 200);
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
