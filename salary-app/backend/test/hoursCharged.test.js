import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hoursDecision, chargedPhrase } from '../../shared/hoursDecision.js';

/**
 * WHAT THE MONTH'S HOURS ARE DOING, REPORTED AS TWO FIGURES AND NEVER ONE.
 *
 * Dinesh, twice, off his live November: *"ot wala minus amount abhi bhi salary
 * me se less ho raaha he"*. The bar that exists to report exactly that printed
 * "₹1,251 across 60 people" - the NET of `ot_salary` across everybody, where
 * one person was +13,237 of overtime paid and another -3,192 of hours charged.
 * The deduction he was asking about was cancelled out by somebody else's
 * overtime on the very line meant to name it.
 *
 * The module already held that short and over are two decisions, not one, for
 * the buttons. These tests hold the same of the figure describing them.
 */

const sheet = readFileSync(new URL('../../frontend/src/components/SalarySheet.jsx', import.meta.url), 'utf8');
/* Comments explain the rule and must not pass for the code that follows it -
   the same trap as `readable()` and the policy <option> sweep. */
const code = sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const charging = { late_policy: 'monthly_late' };
const row = (id, name) => ({ id, employee_name: name });
const calc = (otSalary, minutes) => ({
  ot_salary: otSalary,
  monthly_hours_judged: true,
  monthly_hours_diff: minutes,
  monthly_hours_chargeable: minutes,
  monthly_hours_amount: Math.abs(otSalary),
});

/** His own shape: somebody deducted thousands, somebody else paid thousands. */
const mixed = () =>
  hoursDecision(
    [
      { row: row(1, 'AJEETKUMAR'), calc: calc(-3192, -1358) },
      { row: row(2, 'ASHOK MISHRA'), calc: calc(13237, 5995) },
    ],
    { period: charging }
  );

test('deducted and paid are reported apart', () => {
  const d = mixed();
  assert.equal(d.chargedDeducted, 3192);
  assert.equal(d.chargedDeductedPeople, 1);
  assert.equal(d.chargedPaid, 13237);
  assert.equal(d.chargedPaidPeople, 1);
});

test('THE BUG: the net alone cannot describe such a month', () => {
  const d = mixed();
  // The net is still true and is what the sheet's own OT column adds up to.
  assert.equal(d.chargedAmount, 13237 - 3192);
  // But it is not what is being deducted, and reading it as that is the defect.
  assert.notEqual(Math.abs(d.chargedAmount), d.chargedDeducted);
  assert.ok(
    d.chargedDeducted > 0 && d.chargedPaid > 0,
    'both sides must survive into the report, or one of them is hidden'
  );
});

test('a month that charges nothing reports nothing charged', () => {
  const d = hoursDecision([{ row: row(1, 'A'), calc: calc(-3192, -1358) }], {
    period: { late_policy: 'none' },
  });
  assert.equal(d.charging, false);
  assert.equal(d.chargedDeducted, 0);
  assert.equal(d.chargedPaid, 0);
  assert.equal(d.chargedAmount, 0);
});

test('the phrase names both sides, or whichever side there is', () => {
  const rs = (n) => `₹${n}`;
  assert.equal(
    chargedPhrase(mixed(), rs),
    '₹3192 deducted from 1 person and ₹13237 paid to 1 person'
  );
  const onlyShort = hoursDecision([{ row: row(1, 'A'), calc: calc(-500, -100) }], { period: charging });
  assert.equal(chargedPhrase(onlyShort, rs), '₹500 deducted from 1 person');
  const onlyOver = hoursDecision([{ row: row(1, 'A'), calc: calc(500, 100) }], { period: charging });
  assert.equal(chargedPhrase(onlyOver, rs), '₹500 paid to 1 person');
  assert.equal(chargedPhrase(hoursDecision([], { period: charging }), rs), '');
});

test('the bar and the confirmation read one phrase, and neither prints the net', () => {
  const uses = code.match(/chargedPhrase\(/g) || [];
  assert.ok(uses.length >= 2, 'the bar and the confirm must both read the shared phrase');
  assert.ok(
    !/rupees\(Math\.abs\(decision\.chargedAmount\)\)/.test(code),
    'the netted figure must not be rendered as what the hours are doing'
  );
});

test('the confirmation names what stops being PAID, not only what stops being deducted', () => {
  assert.ok(
    /decision\.chargedPaid/.test(code),
    'pressing it costs the people on overtime their overtime, and that must be on the confirmation'
  );
  assert.match(code, /BOTH STOP/, 'both sides stopping is the thing somebody is surprised by');
});

test('somebody whose hours are not known is never counted as charged', () => {
  const d = hoursDecision(
    [{ row: row(1, 'A'), calc: { ot_salary: 0, monthly_hours_judged: false } }],
    { period: charging }
  );
  assert.equal(d.chargedPeople, 0);
  assert.equal(d.chargedDeducted, 0);
  assert.equal(d.unknown, 1);
});
