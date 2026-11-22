import test from 'node:test';
import assert from 'node:assert/strict';
import { bonusFor, bonusRun, daysOff, normaliseRule } from '../../shared/leaveBonus.js';

const RULE = { kind: 'all_or_nothing', amount: 1000, cut_per_day: 300 };
const month = (attendance) => ({ employee_id: 1, employee_name: 'Amit', attendance });

/* ------------------------------------------------------------------
 * THE TRAP THIS MODULE EXISTS FOR.
 * ------------------------------------------------------------------ */

test('NOTHING MARKED IS NOT A CLEAN MONTH', () => {
  const line = bonusFor(month({}), RULE);
  /* Without this, one unfilled grid pays the whole staff a bonus: every
     person reads as having taken no leave, because nothing says they took
     any. The same rule the biometric import follows for a day the machine
     has no record of. */
  assert.equal(line.eligible, false);
  assert.equal(line.amount, 0);
  assert.equal(line.unknown, true);
  assert.match(line.why, /nothing is marked/);
});

test('a month with marks on it, and no day off, IS clean', () => {
  const line = bonusFor(month({ 1: 'P', 2: 'P', 3: 'S' }), RULE);
  assert.equal(line.eligible, true);
  assert.equal(line.amount, 1000);
  assert.equal(line.unknown, false);
  assert.equal(line.days_off, 0);
});

test('"nothing marked" is counted and named apart from "missed it"', () => {
  const { totals, lines } = bonusRun(
    [
      month({ 1: 'P' }),
      { employee_id: 2, employee_name: 'Riya', attendance: { 1: 'A' } },
      { employee_id: 3, employee_name: 'Kiran', attendance: {} },
    ],
    RULE
  );
  assert.equal(totals.eligible, 1);
  assert.equal(totals.unknown, 1);
  /* Three different outcomes, three different figures. Folding the third
     into the second would read as "Kiran took leave", which nobody knows. */
  assert.equal(lines.filter((l) => !l.eligible && !l.unknown).length, 1);
});

/* ------------------------------------------------------------------
 * The two shapes.
 * ------------------------------------------------------------------ */

test('all or nothing: one qualifying day loses the lot', () => {
  assert.equal(bonusFor(month({ 1: 'P', 2: 'A' }), RULE).amount, 0);
  assert.equal(bonusFor(month({ 1: 'P', 2: 'CL' }), RULE).amount, 0);
  assert.equal(bonusFor(month({ 1: 'P', 2: 'P' }), RULE).amount, 1000);
});

test('graded: the amount less a cut a day, and never below zero', () => {
  const graded = { ...RULE, kind: 'graded' };
  assert.equal(bonusFor(month({ 1: 'P', 2: 'A' }), graded).amount, 700);
  assert.equal(bonusFor(month({ 1: 'P', 2: 'A', 3: 'A' }), graded).amount, 400);
  /* Five absences at 300 would be minus 500. Nobody is billed for taking
     leave - the bonus simply stops. */
  const many = bonusFor(month({ 1: 'A', 2: 'A', 3: 'A', 4: 'A', 5: 'A' }), graded);
  assert.equal(many.amount, 0);
  assert.ok(many.days_off > 0);
});

test('a half day costs half a day, and AD costs two — as the sheet docks them', () => {
  const graded = { ...RULE, kind: 'graded' };
  assert.equal(bonusFor(month({ 1: 'P', 2: 'HF' }), graded).amount, 850);
  /* The sheet docks two days for an AD, so the bonus reads it the same way
     rather than inventing a second opinion about one mark. */
  assert.equal(daysOff({ AD: 1 }, normaliseRule(RULE)), 2);
  /* And the half can be made to cost a whole day, for an office that
     counts it that way. */
  assert.equal(
    bonusFor(month({ 1: 'P', 2: 'HF' }), { ...graded, half_counts_half: false }).amount,
    700
  );
});

test('which marks cost it is the office’s choice, and paid leave counts by default', () => {
  for (const code of ['A', 'UL', 'CL', 'SL', 'PL', 'HF']) {
    assert.equal(bonusFor(month({ 1: 'P', 2: code }), RULE).amount, 0, code);
  }
  /* An office that pays the bonus through sick leave unticks it. */
  const soft = { ...RULE, breaks: ['A', 'UL'] };
  assert.equal(bonusFor(month({ 1: 'P', 2: 'SL' }), soft).amount, 1000);
  assert.equal(bonusFor(month({ 1: 'P', 2: 'A' }), soft).amount, 0);
});

test('a Sunday, a holiday and a day at work never cost the bonus', () => {
  /* S, H and WH are not time off somebody chose to take. WH is tickable,
     but is not in the default list. */
  assert.equal(bonusFor(month({ 1: 'P', 2: 'S', 3: 'H', 4: 'WH' }), RULE).amount, 1000);
});

test('a broken rule falls back rather than paying something made up', () => {
  const r = normaliseRule({ kind: 'nonsense', amount: -50, breaks: ['ZZ'] });
  assert.equal(r.kind, 'all_or_nothing');
  assert.equal(r.amount, 0, 'a negative amount is not a bonus');
  assert.ok(r.breaks.length > 0, 'an empty break list would pay everybody');
});

test('somebody already paid is not counted into what is left to pay', () => {
  const rows = [month({ 1: 'P' }), { employee_id: 2, employee_name: 'Riya', attendance: { 1: 'P' } }];
  const { totals } = bonusRun(rows, RULE, { paid: new Set([1]) });
  assert.equal(totals.eligible, 2);
  assert.equal(totals.already_paid, 1);
  /* The figure on the button is what WOULD go out now, not the month's
     whole bill - otherwise the second press pays twice over. */
  assert.equal(totals.to_pay, 1);
  assert.equal(totals.amount, 1000);
  assert.equal(totals.paid_amount, 1000);
});
