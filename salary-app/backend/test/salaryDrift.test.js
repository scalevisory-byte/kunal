/*
 * "5 LAC SALARY SHOWING / 50 DALA HE" — the record said 50,000 and the sheet
 * was paying 5,00,000. `payroll_rows.salary` is taken from the record when
 * the row is first made and then left alone, so correcting a mistyped salary
 * afterwards never reaches a month that already has the row — and nothing on
 * the screen said so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { driftOf, salaryDrift, takeMasterPatch } from '../../shared/salaryDrift.js';

test('THE CASE HE HIT: the month pays ten times the record', () => {
  const d = driftOf({ salary: 500000, monthly_salary: 50000 });
  assert.deepEqual(d, { sheet: 500000, master: 50000, diff: -450000 });
});

test('agreement is not a finding', () => {
  assert.equal(driftOf({ salary: 26000, monthly_salary: 26000 }), null);
});

test('A ROW STILL AT 0 IS NOT A DISAGREEMENT', () => {
  /*
   * `syncPayrollRows` fills a 0 from the record on the next read, so a line
   * about it would vanish the moment somebody looked — which reads as the
   * screen being wrong rather than the row being new.
   */
  assert.equal(driftOf({ salary: 0, monthly_salary: 26000 }), null);
});

test('no record figure is "not known", never a disagreement', () => {
  for (const missing of [null, undefined, '']) {
    assert.equal(driftOf({ salary: 26000, monthly_salary: missing }), null, String(missing));
  }
});

test('the month paying LESS is reported too, and counted apart', () => {
  const out = salaryDrift([
    { id: 1, employee_id: 1, employee_name: 'Over', salary: 500000, monthly_salary: 50000 },
    { id: 2, employee_id: 2, employee_name: 'Under', salary: 10000, monthly_salary: 26000 },
    { id: 3, employee_id: 3, employee_name: 'Fine', salary: 26000, monthly_salary: 26000 },
  ]);
  assert.equal(out.lines.length, 2);
  assert.equal(out.over, 1);
  assert.equal(out.under, 1);
  /*
   * Counted apart on purpose: one figure netted off would read as nothing
   * wrong on a month where one person is ten times over and another is under.
   */
  assert.equal(out.worst.name, 'Over', 'the biggest gap is not first');
  assert.equal(out.any, true);
});

test('a clean month says nothing at all', () => {
  const out = salaryDrift([{ id: 1, salary: 26000, monthly_salary: 26000 }]);
  assert.equal(out.any, false);
  assert.equal(out.worst, null);
});

test('IT NEVER DECIDES — the patch is the only thing that moves a figure', () => {
  /*
   * A difference has two meanings the app cannot tell apart: a mistyped
   * salary since corrected, or a month the office meant to pay differently.
   * So there is no rule here, only the office's own button.
   */
  const line = { sheet: 500000, master: 50000 };
  assert.deepEqual(takeMasterPatch(line), { salary: 50000 });

  const rows = [{ id: 1, salary: 500000, monthly_salary: 50000 }];
  const before = JSON.stringify(rows);
  salaryDrift(rows);
  assert.equal(JSON.stringify(rows), before, 'reading the rows changed one');
});

/* ================================================================= *
 * the screen
 * ================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sheet = fs.readFileSync(path.join(here, '../../frontend/src/components/SalarySheet.jsx'), 'utf8');

test('the sheet NAMES the difference and never fixes it by itself', () => {
  assert.match(sheet, /salaryDrift\(rows\)/, 'the sheet does not look for the difference');
  assert.match(sheet, /takeMasterPatch\(line\)/, 'there is no way to take the record figure');
  /* Behind a confirmation, like every other bulk change on this screen. */
  const fn = sheet.slice(sheet.indexOf('const takeMaster'), sheet.indexOf('const stopCharging'));
  assert.match(fn, /window\.confirm/, 'it changes salaries without asking');
  assert.match(fn, /if \(!ok\) return;/);
  /* And the worst one is read back, because a figure out by a factor of ten
     is the whole reason somebody presses it. */
  assert.match(fn, /worst\.master/);
});

test('A MONTH THAT ALREADY CHARGES THE HOURS SAYS SO, and does not offer to charge them again', () => {
  /*
   * Dinesh: *"ot plus mins net me count ho raha he / o sirf dikhna chahiye"*.
   * His month was opened before the days-only rule and really is charging
   * them - while the bar offered to *"deduct the short hours"* that were
   * already inside the net.
   */
  assert.match(sheet, /decision\.charging \? \(/, 'the bar never states which rule the month is on');
  assert.match(sheet, /!decision\.charging && decision\.short\.length/, 'it still offers to deduct what is deducted');
  assert.match(sheet, /!decision\.charging && decision\.over\.length/);
  /* The switch is a POLICY, so it patches the month, not the rows. */
  /* Comments stripped, so an explanation of the rule cannot pass for the
     sentence the office actually reads. */
  const fn = sheet
    .slice(sheet.indexOf('const stopCharging'), sheet.indexOf('const grouped'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(fn, /onPatchPeriod\(\{ late_policy: 'none' \}\)/);
  assert.match(
    fn,
    /stop being deducted AND the overtime stops being paid/,
    'the confirmation names only one side of the switch'
  );
  /* And it says where the figures go, since they do not disappear. */
  assert.match(fn, /Month hrs/);
});
