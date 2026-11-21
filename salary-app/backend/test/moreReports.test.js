import test from 'node:test';
import assert from 'node:assert/strict';
import { missingPunches, problemOf } from '../../shared/missingPunch.js';
import { deductionStatement, DEDUCTION_HEADS } from '../../shared/deductionStatement.js';
import { salaryByDepartment } from '../../shared/salaryByDepartment.js';
import { calculateRow } from '../../shared/calc.js';

/* ---------------- missing punches ---------------- */

test('only a day somebody was AT WORK can be missing a punch', () => {
  /* There is nothing to clock on an absence, a holiday or a day of leave.
     Listing those would bury the real ones under a hundred that were never
     going to have times. */
  for (const code of ['A', 'CL', 'SL', 'PL', 'UL', 'S', 'H', '']) {
    assert.equal(problemOf({ code }, { code }), null, code || '(blank)');
  }
  assert.equal(problemOf({ code: 'P' }, { code: 'P' }), 'nothing');
});

test('a day half-clocked and a day never clocked are counted apart', () => {
  const { totals, lines } = missingPunches([
    { employee_id: 1, employee_name: 'Amit', attendance: {
      1: { code: 'P', in_time: '09:30', out_time: '18:30' },   // complete
      2: { code: 'P', in_time: '09:30' },                      // in, never out
      3: { code: 'P' },                                        // nothing at all
      4: { code: 'A' },                                        // absent
      5: { code: 'P', out_time: '18:00' },                     // out with no in
      6: { code: 'P', in_time: '09:00', lunch_out: '13:00', out_time: '18:00' },
    } },
  ]);
  assert.equal(totals.days, 4);
  assert.equal(totals.no_out, 1);
  assert.equal(totals.no_in, 1);
  assert.equal(totals.lunch_half, 1);
  assert.equal(totals.nothing, 1);
  /* Not one number: the first is a record that is wrong, the second may be
     a job where nobody punches. */
  assert.notEqual(totals.no_out, totals.nothing + totals.no_out);
  assert.ok(!lines.some((l) => l.day === 1 || l.day === 4));
});

test('the worst offenders are named, because 200 days is not actionable', () => {
  const rows = [
    { employee_id: 1, employee_name: 'Amit', attendance: { 1: { code: 'P', in_time: '9' }, 2: { code: 'P', in_time: '9' } } },
    { employee_id: 2, employee_name: 'Riya', attendance: { 1: { code: 'P', in_time: '9' } } },
  ];
  const { worst } = missingPunches(rows);
  assert.equal(worst[0].name, 'Amit');
  assert.equal(worst[0].days, 2);
});

/* ---------------- the deductions statement ---------------- */

/*
 * A REAL CALCULATED ROW, not a hand-made one.
 *
 * The first version of these tests used figures typed by hand that happened
 * to balance - and so passed against a statement that was double-counting
 * two of its heads. Driving `calculateRow` is the only honest check: it is
 * what the payslip was printed from.
 */
const PERIOD = { year: 2026, month: 10, hours_per_day: 9, pt_threshold: 12000, pt_amount: 200 };
const calc = (over = {}, attendance = { 1: 'P', 2: 'A' }) => {
  const row = {
    employee_id: 1, employee_name: 'Amit Shah', employee_code: 'BNF-001',
    department: 'Accounts', salary: 26000,
    pf: 1200, esi: 180, loan_deduction: 500, deduction: 300, penalty_deduction: 0,
    ...over,
  };
  return { ...row, ...calculateRow(row, PERIOD, attendance) };
};

test('what the month EARNED, less every deduction, is the net — to the rupee', () => {
  const { lines, totals } = deductionStatement([calc()]);
  const line = lines[0];
  /* The Deduct box and the late charge come off BEFORE the sheet's gross is
     struck; PF, ESI, PT, a loan and a penalty come off after it. Listing all
     seven against `gross_salary` takes the first two twice - which is what
     this check found. */
  assert.equal(line.earned, line.gross_salary + line.deduction + line.late_salary);
  assert.equal(line.earned - line.total, line.net_salary);
  assert.equal(totals.balances, true);
});

test('it still balances with a penalty, a late charge and no deduction at all', () => {
  for (const over of [
    { deduction: 0 },
    { penalty_deduction: 750 },
    { deduction: 1200, penalty_deduction: 400, loan_deduction: 0 },
    { pf: 0, esi: 0, deduction: 0, loan_deduction: 0, penalty_deduction: 0 },
  ]) {
    const { lines, totals } = deductionStatement([calc(over)]);
    assert.equal(
      lines[0].earned - lines[0].total,
      lines[0].net_salary,
      `does not balance with ${JSON.stringify(over)}`
    );
    assert.equal(totals.balances, true);
  }
});

test('ABSENCE IS NOT A DEDUCTION, and the employer’s share is not one either', () => {
  const row = calc({}, { 1: 'P', 2: 'A', 3: 'A' });
  const { lines, totals } = deductionStatement([row]);
  /* A day not worked was never earned. The gross is already after it, so
     counting it among the deductions would take it twice. */
  assert.ok(lines[0].absent_salary > 0, 'two days were missed');
  assert.equal(lines[0].total, row.pf + row.esi + row.pt + row.loan_deduction + row.deduction + row.late_salary);
  assert.ok(lines[0].total < lines[0].absent_salary + lines[0].total);
  assert.equal(totals.earned - totals.total, totals.net_salary, 'still balances');
  /* And what the company pays on top never touches what anybody takes home. */
  assert.ok(totals.pf_employer >= 0);
  assert.equal(totals.net_salary, row.net_salary);
});

test('it says how many people each head touched, not only the money', () => {
  const { totals } = deductionStatement([
    calc(),
    calc({ employee_id: 2, employee_name: 'Riya', pf: 0, loan_deduction: 0, deduction: 0 }),
  ]);
  /* "PT 400" and "PT, 2 people" are different facts, and the second is the
     one that finds a slab charged to somebody it should not have been. */
  assert.equal(totals.counts.pt, 2);
  assert.equal(totals.counts.pf, 1);
  assert.equal(totals.counts.loan_deduction, 1);
  assert.equal(totals.counts.penalty_deduction, 0);
});

test('a typed-over net is NOT silently balanced — it is reported as not balancing', () => {
  const { totals } = deductionStatement([{ ...calc(), net_salary: 20000 }]);
  assert.equal(totals.balances, false);
});

test('every head on the statement is a real figure the calculation returns', () => {
  const row = calc();
  for (const [key] of DEDUCTION_HEADS) {
    assert.ok(key in row, `${key} is not something calculateRow returns`);
  }
});

/* ---------------- salary cost by department ---------------- */

test('cost to company is the gross plus the employer’s own share, never the net', () => {
  const row = calc();
  const { lines, totals } = salaryByDepartment([row]);
  const d = lines[0];
  assert.equal(d.net_salary, Math.round(row.net_salary), 'what they take home');
  /* The deductions are the employee's money passing through, so the gross
     already holds them - only the employer's own share goes on top. */
  assert.equal(d.cost, Math.round(row.gross_salary) + d.employer);
  assert.equal(totals.cost, d.cost);
  assert.ok(d.cost > d.net_salary);
  /* And a fine has ALREADY reduced the gross, which is right: the company
     is that much less out of pocket. */
  assert.equal(d.earned, Math.round(row.gross_salary) + Math.round(row.deduction) + Math.round(row.late_salary));
});

test('Sunday pay is shown apart and is in neither figure', () => {
  const row = calc();
  const { lines } = salaryByDepartment([{ ...row, sunday_salary: 900 }]);
  assert.equal(lines[0].sunday_salary, 900);
  /* It is settled on its own register - that is the whole reason the
     register exists, and folding it in here would make this report
     disagree with the salary sheet. */
  assert.equal(lines[0].cost, Math.round(row.gross_salary) + lines[0].employer);
  assert.equal(lines[0].net_salary, Math.round(row.net_salary));
});

test('nobody without a department is dropped, and the shares add to a hundred', () => {
  const { lines, totals } = salaryByDepartment([
    calc(),
    calc({ employee_id: 2, department: '', salary: 12000, pf: 0, esi: 0, deduction: 0,
      loan_deduction: 0 }),
  ]);
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => l.department === 'No department set'));
  assert.equal(Math.round(lines.reduce((t, l) => t + l.share, 0)), 100);
  assert.equal(totals.people, 2);
});

test('a department where somebody was paid nothing says how many were actually paid', () => {
  const { lines } = salaryByDepartment([
    calc(),
    { ...calc({ employee_id: 2 }), net_salary: 0, gross_salary: 0 },
  ]);
  /* Four people with one on unpaid leave all month is not four salaries,
     and an average over the headcount would say it was. */
  assert.equal(lines[0].people, 2);
  assert.equal(lines[0].paid, 1);
});
