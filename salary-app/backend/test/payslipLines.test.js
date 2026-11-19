/**
 * WHAT A SALARY SLIP SAYS — one function, so two slips cannot disagree.
 *
 * Dinesh: *"salary slip aur payslip ka bhi print report do"*. The slip on
 * screen and the printed batch off the salary sheet are the same document,
 * so they are built from one place. The first printed version was written
 * from the screen's JSX by hand and had already dropped the penalty line.
 *
 * What these pin:
 *
 *  - **It assembles, it never recalculates.** Every figure comes out of
 *    `calculateRow`.
 *  - **Earned, less deductions, IS the net** — to the rupee. A manual
 *    deduction and the late/early charge are inside the gross everywhere
 *    else, so they are added back into what was earned and then listed
 *    among the deductions: shown both ways at once, and still balancing.
 *  - **A zero line is not printed.** A slip listing "ESI 0" invites the
 *    question of why.
 *  - **Sunday duty is stated, never added in** — it is paid from its own
 *    register.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRow } from '../../shared/calc.js';
import { payslipFacts, payslipLines } from '../../shared/payslipLines.js';

const PERIOD = { year: 2026, month: 11, working_days: 26, hours_per_day: 9, pt_threshold: 12000, pt_amount: 200 };
const rowFor = (over = {}) => ({
  employee_name: 'Mahesh Shinde',
  company_name: 'BOOKNFLY',
  salary: 24000,
  payment_mode: 'Bank',
  ...over,
});

const linesFor = (over = {}, attendance = {}) => {
  const row = rowFor(over);
  const calc = calculateRow(row, PERIOD, attendance);
  return { row, calc, slip: payslipLines(row, calc) };
};

test('earned less deductions is the net, to the rupee', () => {
  const { slip } = linesFor({ pf: 1080, esi: 180, deduction: 500, addition: 250 });
  assert.equal(slip.earned - slip.totalDeductions, slip.net);
});

test('a manual deduction is in the earnings AND among the deductions, and still balances', () => {
  const { slip } = linesFor({ deduction: 1500, remark: 'breakage' });
  // It is added back into what was earned...
  assert.ok(slip.earned > slip.net);
  // ...and listed by name among the deductions, with the remark on it.
  assert.ok(slip.deductions.some(([label]) => label === 'Deducted: breakage'));
  assert.equal(slip.earned - slip.totalDeductions, slip.net);
});

test('nothing that came to zero is printed', () => {
  const { slip } = linesFor();
  for (const [label, amount] of [...slip.earnings, ...slip.deductions]) {
    assert.notEqual(Number(amount), 0, `${label} printed as zero`);
  }
  assert.ok(!slip.deductions.some(([label]) => label === 'ESI'));
});

test('every deduction the month carries reaches the slip, the penalty included', () => {
  const { slip } = linesFor({
    pf: 1080,
    esi: 180,
    loan_deduction: 2000,
    penalty_deduction: 300,
  });
  const labels = slip.deductions.map(([label]) => label);
  for (const line of ['Professional tax', 'ESI', 'PF', 'Loan / advance', 'Penalty']) {
    assert.ok(labels.includes(line), `${line} is missing from the slip`);
  }
  assert.equal(slip.earned - slip.totalDeductions, slip.net);
});

test('a salary breakup is listed as this month earned it, and adds up to the gross', () => {
  const { slip, calc } = linesFor({ basic: 12000, hra: 4800, conveyance: 1600, medical: 1250 });
  assert.equal(slip.broken, true);
  const labels = slip.earnings.map(([label]) => label);
  assert.ok(labels.includes('Basic'));
  assert.ok(labels.includes('HRA'));
  const components = slip.earnings
    .filter(([label]) => ['Basic', 'HRA', 'Conveyance', 'Medical', 'Special allowance'].includes(label))
    .reduce((sum, [, amount]) => sum + Number(amount), 0);
  assert.equal(Math.round(components), Math.round(calc.gross_after_absent));
});

test('with no breakup it reads as the salary less the days absent', () => {
  const { slip } = linesFor({}, { 2: { code: 'A' }, 3: { code: 'A' } });
  const labels = slip.earnings.map(([label]) => label);
  assert.ok(labels.includes('Salary for the month'));
  assert.ok(labels.includes('Less: absent days'));
  assert.equal(slip.broken, false);
});

test('Sunday duty is stated apart and never added into the net', () => {
  const { slip, calc } = linesFor({ sundays_override: 2 });
  assert.ok(slip.sunday > 0);
  assert.equal(slip.net, calc.net_salary);
  assert.equal(slip.earned - slip.totalDeductions, slip.net);
  // It is in no earnings line either: it is paid from the Sunday register.
  assert.ok(!slip.earnings.some(([label]) => /sunday/i.test(label)));
});

test('the facts above the columns are the days the figures were worked out from', () => {
  const { row, calc } = linesFor({}, { 2: { code: 'A' } });
  const facts = Object.fromEntries(payslipFacts(row, calc));
  assert.equal(facts['Working days'], calc.working_days);
  assert.equal(facts['Present days'], calc.present_days);
  assert.equal(facts['Absent days'], calc.absent_days);
  assert.equal(facts['Rate per day'], calc.per_day);
});
