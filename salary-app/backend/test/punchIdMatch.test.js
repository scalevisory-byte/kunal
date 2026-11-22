/**
 * Working out which reader number belongs to which person.
 *
 * The two lists are typed by different people and do not agree, so this is a
 * PROPOSAL and never a write. A wrong number here puts one person's
 * attendance on another person's payslip, and nobody finds it until somebody
 * queries their own pay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAYBE,
  SURE,
  editDistance,
  matchPunchIds,
  nameScore,
  normaliseName,
} from '../../shared/punchIdMatch.js';

const staff = [
  { id: 1, name: 'RAJESHKUMAR VANKAR', code: 'BNF-EMP-0001', active: 1 },
  { id: 2, name: 'PRIYA SOLANKI', code: 'BNF-EMP-0002', active: 1 },
  { id: 3, name: 'MEENA CHAUHAN', code: 'BNF-EMP-0003', active: 1 },
];

/* ---------------- the words ---------------- */

test('case and punctuation are thrown away, nothing else', () => {
  assert.equal(normaliseName('  priya   solanki.  '), 'PRIYA SOLANKI');
  assert.equal(normaliseName("O'BRIEN"), 'O BRIEN');
});

test('edit distance counts single-character changes', () => {
  assert.equal(editDistance('VANKAR', 'VANKER'), 1);
  assert.equal(editDistance('', 'ABC'), 3);
  assert.equal(editDistance('SAME', 'SAME'), 0);
});

/* ---------------- the score ---------------- */

test('the same name written the same way is a certainty', () => {
  assert.equal(nameScore('PRIYA SOLANKI', 'priya solanki'), 1);
});

test('a middle name on one side only is still a strong match', () => {
  // This is the real shape: the machine has the short name, the payroll the
  // full one, or the other way round.
  assert.ok(nameScore('RAJESH VANKAR', 'RAJESHKUMAR VANKAR') >= SURE);
});

test('a surname spelt a letter differently is a strong match', () => {
  assert.ok(nameScore('PRIYA SOLANKHI', 'PRIYA SOLANKI') >= SURE);
});

test('a shared first name and a different surname is NOT a match', () => {
  // Two real people. This must not reach the proposal at all.
  assert.ok(nameScore('PRIYA VANKAR', 'PRIYA SOLANKI') < MAYBE);
});

test('a first name alone scores far below certain', () => {
  assert.ok(nameScore('PRIYA', 'PRIYA SOLANKI') < SURE);
});

test('nothing against something is zero', () => {
  assert.equal(nameScore('', 'PRIYA SOLANKI'), 0);
  assert.equal(nameScore('PRIYA SOLANKI', ''), 0);
});

/* ---------------- the proposal ---------------- */

const people = [
  { code: '3', name: 'RAJESH VANKAR', company: 'BNF' },
  { code: '18', name: 'PRIYA SOLANKI', company: 'SCALE' },
];

test('an exact name arrives ticked; a near miss arrives for checking', () => {
  const got = matchPunchIds({ people, employees: staff });
  const exact = got.pairs.find((p) => p.code === '18');
  const near = got.pairs.find((p) => p.code === '3');
  assert.equal(exact.suggest, true);
  assert.equal(exact.employee_name, 'PRIYA SOLANKI');
  assert.equal(near.employee_name, 'RAJESHKUMAR VANKAR');
  assert.equal(near.suggest, near.score >= SURE && true);
});

test('somebody on the machine who is not on the staff list is NAMED', () => {
  const got = matchPunchIds({
    people: [{ code: '99', name: 'SOMEBODY ELSE ENTIRELY', company: 'BNF' }],
    employees: staff,
  });
  assert.equal(got.pairs.length, 0);
  assert.equal(got.onlyOnMachine[0].code, '99');
});

test('a number already on the record is shown and NOT re-applied', () => {
  const employees = staff.map((e) => (e.id === 2 ? { ...e, device_code: '18' } : e));
  const got = matchPunchIds({ people, employees });
  const pair = got.pairs.find((p) => p.code === '18');
  assert.equal(pair.suggest, false);
  assert.equal(pair.why, 'already set');
});

test('a DIFFERENT number already on the record is never silently replaced', () => {
  const employees = staff.map((e) => (e.id === 2 ? { ...e, device_code: '77' } : e));
  const got = matchPunchIds({ people, employees });
  const pair = got.pairs.find((p) => p.code === '18');
  assert.equal(pair.suggest, false);
  assert.match(pair.why, /already has 77/);
});

test('a number already on somebody ELSE is refused by name', () => {
  const employees = staff.map((e) => (e.id === 3 ? { ...e, device_code: '18' } : e));
  const got = matchPunchIds({ people, employees });
  const pair = got.pairs.find((p) => p.code === '18');
  assert.equal(pair.suggest, false);
  assert.match(pair.why, /already on MEENA CHAUHAN/);
});

test('two machine numbers pointing at one person tick NEITHER', () => {
  // One of them is somebody else and nothing here can say which.
  const got = matchPunchIds({
    people: [
      { code: '3', name: 'PRIYA SOLANKI' },
      { code: '4', name: 'PRIYA SOLANKHI' },
    ],
    employees: staff,
  });
  assert.deepEqual(got.pairs.map((p) => p.suggest), [false, false]);
  assert.equal(got.conflicts.length, 2);
});

test('somebody who left takes their number with them', () => {
  const employees = staff.map((e) => (e.id === 2 ? { ...e, active: 0 } : e));
  const got = matchPunchIds({ people, employees });
  assert.ok(!got.pairs.some((p) => p.employee_name === 'PRIYA SOLANKI'));
  assert.ok(got.onlyOnMachine.some((p) => p.code === '18'));
});

test('a half-finished record is not offered a number', () => {
  const employees = staff.map((e) => (e.id === 2 ? { ...e, is_draft: 1 } : e));
  const got = matchPunchIds({ people, employees });
  assert.ok(!got.pairs.some((p) => p.employee_id === 2));
});

test('staff the machine has nothing for are listed, so they are not forgotten', () => {
  const got = matchPunchIds({ people, employees: staff });
  assert.deepEqual(got.stillWithout.map((e) => e.name), ['MEENA CHAUHAN']);
});

test('the counts say what the office is about to do', () => {
  const got = matchPunchIds({ people, employees: staff });
  assert.equal(got.counts.machine, 2);
  assert.equal(got.counts.staff, 3);
  assert.ok(got.counts.suggested >= 1);
});
