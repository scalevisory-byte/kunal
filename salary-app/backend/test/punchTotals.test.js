import test from 'node:test';
import assert from 'node:assert/strict';
import { PUNCH_TOTAL_COLUMNS, dayOf, punchTotals } from '../../shared/punchTotals.js';

const STAFF = [
  { id: 1, name: 'AMIT SHAH', code: 'BNF-EMP-0043', device_code: '37', company_name: 'BNF', active: 1 },
  { id: 2, name: 'RIYA PAL', code: '45', device_code: '', company_name: 'BNF', active: 1 },
  { id: 3, name: 'KIRAN DESAI', code: 'BNF-EMP-0099', device_code: '', company_name: 'BNF', active: 1 },
  { id: 4, name: 'GONE ALREADY', code: '12', device_code: '', company_name: 'BNF', active: 0 },
];
const PUNCHES = [
  { code: '37', at: '2026-11-20 09:12:01', source: 'Bizcompass spool' },
  { code: '37', at: '2026-11-20 18:02:44', source: 'Bizcompass spool' },
  { code: '0037', at: '2026-11-21 09:05:00', source: 'IN gate' },
  { code: '188', at: '2026-11-21 10:00:00', source: 'IN gate' },
];

test('a leading zero is the same enrolment, and both feeds are named', () => {
  const { lines } = punchTotals(PUNCHES, STAFF);
  const amit = lines.find((l) => l.employee_id === 1);
  assert.equal(amit.punches, 3, '0037 and 37 are one number');
  assert.equal(amit.days, 2);
  assert.deepEqual(amit.sources, ['Bizcompass spool', 'IN gate'], 'named apart, never merged away');
  assert.equal(amit.first_day, '2026-11-20');
  assert.equal(amit.last_day, '2026-11-21');
});

test('CANNOT BE REACHED IS NULL; REACHED AND SILENT IS 0 — never the same figure', () => {
  /*
   * The two are different problems and adding them together hides the only
   * one anybody can fix. KIRAN has no Punch ID and an employee code no reader
   * will ever send, so nobody has even looked for him - that is a dash.
   * RIYA's code IS a number, so the importer's fallback does match her; the
   * readers simply never saw her this month, which is a real 0.
   */
  const { lines, totals } = punchTotals(PUNCHES, STAFF);
  const kiran = lines.find((l) => l.employee_id === 3);
  const riya = lines.find((l) => l.employee_id === 2);

  assert.equal(kiran.punches, null);
  assert.equal(kiran.days, null);
  assert.equal(kiran.reach, 'none');
  assert.equal(riya.punches, 0, 'a real nought');
  assert.equal(riya.reach, 'fallback');

  assert.equal(totals.unreachable, 1);
  assert.equal(totals.silent, 1);
  assert.equal(totals.reaching, 1);
  // Somebody who has left is not on the report at all.
  assert.ok(!lines.some((l) => l.employee_id === 4));
});

test('the unreachable sort first, then the silent, then fewest punches', () => {
  const order = punchTotals(PUNCHES, STAFF).lines.map((l) => l.employee_name);
  assert.deepEqual(order, ['KIRAN DESAI', 'RIYA PAL', 'AMIT SHAH']);
});

test('numbers belonging to nobody are named with their punches', () => {
  const { unknown, totals } = punchTotals(PUNCHES, STAFF);
  assert.deepEqual(unknown, [
    { id: '188', punches: 1, days: 1, first_day: '2026-11-21', last_day: '2026-11-21', sources: ['IN gate'] },
  ]);
  assert.equal(totals.unknownPunches, 1);
});

test('NOTHING COLLECTED IS NULL, NEVER 0 — "none came in" is not "all accounted for"', () => {
  const { totals, lines } = punchTotals([], STAFF);
  assert.equal(totals.punches, null);
  assert.equal(totals.unknownPunches, null);
  assert.equal(totals.reaching, 0);
  // Somebody reachable still reads 0 rather than a dash: the question was asked.
  assert.equal(lines.find((l) => l.employee_id === 2).punches, 0);
  assert.equal(lines.find((l) => l.employee_id === 3).punches, null);
});

test('an unreadable stamp costs the punch its day, not the whole count', () => {
  const { lines } = punchTotals(
    [
      { code: '37', at: 'rubbish', source: 'IN gate' },
      { code: '37', at: '2026-11-20 09:00:00', source: 'IN gate' },
    ],
    STAFF
  );
  const amit = lines.find((l) => l.employee_id === 1);
  assert.equal(amit.punches, 2, 'both were recorded');
  assert.equal(amit.days, 1, 'only one of them says which day');
  assert.equal(dayOf('rubbish'), null);
  assert.equal(dayOf('2026-11-20 09:00:00'), '2026-11-20');
});

test('the columns are a deliberate list and carry nothing private', () => {
  const keys = PUNCH_TOTAL_COLUMNS.map((c) => c.key);
  for (const never of ['monthly_salary', 'salary', 'pan', 'aadhaar', 'bank_account', 'ifsc', 'dob']) {
    assert.ok(!keys.includes(never), `${never} has no business on a punch count`);
  }
  assert.ok(keys.includes('punches') && keys.includes('punch_id'));
});
