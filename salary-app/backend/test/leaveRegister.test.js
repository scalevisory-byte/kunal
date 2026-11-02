import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRow } from '../../shared/calc.js';
import { leaveRegister, leaveRegisterCsv } from '../../shared/leaveRegister.js';

/*
 * The leave register.
 *
 * The rule the whole thing hangs on: it REPORTS what the salary sheet already
 * did. It never re-prices a day. A register that worked the amounts out for
 * itself would disagree with the payslip the first time somebody typed a net
 * salary over the formula, and then nobody could say which was right.
 */

const period = { year: 2026, month: 11, hours_per_day: 9, pt_threshold: 12000, pt_amount: 200 };

const person = (name, salary, attendance) => {
  const row = { employee_id: name.length, employee_name: name, salary, pf: 0, esi: 0, attendance };
  return { ...row, ...calculateRow(row, period, attendance) };
};

const STAFF = [
  person('TOOK PAID LEAVE', 26000, { 3: 'CL', 4: 'CL', 10: 'SL' }),
  person('TOOK UNPAID', 26000, { 5: 'UL', 6: 'UL' }),
  person('BOTH', 13000, { 7: 'PL', 8: 'UL' }),
  person('JUST ABSENT', 26000, { 9: 'A', 11: 'A' }),
  person('NOTHING', 26000, { 1: 'P', 2: 'P' }),
];

test('only the people who took something are on it', () => {
  const { lines } = leaveRegister(STAFF);
  // Most days taken first; a tie falls back to the name, so the order is the
  // same every time rather than whatever the rows happened to arrive in.
  assert.deepEqual(lines.map((l) => l.employee_name), [
    'TOOK PAID LEAVE', // 3 days
    'BOTH', // 2, and B before T
    'TOOK UNPAID', // 2
  ]);
  // Eighty-five lines of nought would bury the nine that matter, and plain
  // absence is not leave.
  assert.ok(!lines.some((l) => l.employee_name === 'JUST ABSENT'));
});

test('paid and unpaid are counted apart, never added together', () => {
  const { lines, totals } = leaveRegister(STAFF);
  const both = lines.find((l) => l.employee_name === 'BOTH');
  assert.equal(both.paid_days, 1);
  assert.equal(both.unpaid_days, 1);
  assert.equal(both.paid_amount, 500, '13000 / 26 days');
  assert.equal(both.unpaid_amount, 500);

  assert.equal(totals.paid_days, 4, '2 CL + 1 SL + 1 PL');
  assert.equal(totals.unpaid_days, 3);
  assert.equal(totals.by_kind.CL.days, 2);
  assert.equal(totals.by_kind.SL.days, 1);
  assert.equal(totals.by_kind.PL.days, 1);
});

test('plain absence is kept out of both, and shown on its own', () => {
  const { lines } = leaveRegister([...STAFF, person('ABSENT AND LEAVE', 26000, { 2: 'A', 3: 'CL' })]);
  const mixed = lines.find((l) => l.employee_name === 'ABSENT AND LEAVE');
  assert.equal(mixed.paid_days, 1);
  assert.equal(mixed.unpaid_days, 0, 'an absence is not unpaid LEAVE');
  assert.equal(mixed.absent_days, 1);
});

/*
 * The one that matters most: the register must agree with the payslip.
 */
test('the amounts are the salary sheet’s own, not worked out again', () => {
  const row = person('ODD SALARY', 27777, { 3: 'UL', 4: 'CL' });
  const { lines } = leaveRegister([row]);
  const line = lines[0];

  // Per day is the figure calculateRow produced, and the amounts are days
  // times that - so what the sheet deducted and what this reports cannot
  // differ by a rupee of rounding.
  assert.equal(line.per_day, Math.round(row.per_day));
  assert.equal(line.unpaid_amount, Math.round(row.per_day));

  // The unpaid day is already out of the salary: the sheet docked exactly one
  // day for it, and the paid day cost nothing.
  const none = person('ODD SALARY', 27777, {});
  assert.equal(
    Math.round(none.gross_after_absent - row.gross_after_absent),
    Math.round(row.per_day),
    'one day docked for the UL, nothing for the CL'
  );
});

test('a month where nobody took leave is an empty register, not a crash', () => {
  const { lines, totals } = leaveRegister([person('NOBODY', 20000, { 1: 'P' })]);
  assert.deepEqual(lines, []);
  assert.equal(totals.people, 0);
  assert.equal(totals.paid_amount, 0);
});

test('the CSV carries a total row and opens in Excel', () => {
  const csv = leaveRegisterCsv(STAFF);
  assert.ok(csv.startsWith('﻿'), 'a BOM, or Excel mangles the rupee column');
  const lines = csv.trim().split('\n');
  assert.match(lines[0], /Casual days,Casual ₹/);
  assert.match(lines[lines.length - 1], /^,TOTAL,/);
  assert.equal(lines.length, 2 + 3, 'header, three people, total');
});
