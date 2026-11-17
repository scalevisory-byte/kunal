import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * SOMEBODY WHO HAS LEFT COMES OFF THE SHEET - BUT ONLY IF NOTHING IS
 * RECORDED AGAINST THEM.
 *
 * Dinesh: "aaj maine sare delete kiye the, employee wale dusra add kiya tha,
 * but attendance mai abhi bhi left walo ka show kar raha hai / excel mai bhi
 * left wale ke naam nahi hai phir bhi". He did what the Employees screen told
 * him to do - untick Active rather than delete - and the row that had already
 * been created for the month just stayed, because sync only ever ADDED.
 *
 * The line that must not be crossed: somebody who left on the 10th is still
 * owed ten days, and their row carries the marks that pay them.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leavers-'));
process.env.LINK_SECRET = 'test-secret';

const db = await import('../src/db.js');

const company = db.createCompany({ name: 'BOOKNFLY PVT LTD' });
const hire = (name, salary = 20000) =>
  db.createEmployee({ company_id: company.id, name, monthly_salary: salary });

const namesOn = (periodId) =>
  db.listPayrollRows(periodId).map((r) => r.employee_name).sort();

test('a leaver with nothing recorded comes off when the month is re-opened', () => {
  const staying = hire('Amit Shah');
  const leaving = hire('Gone Already');
  const period = db.createPeriod({ year: 2026, month: 10 });
  db.syncPayrollRows(period.id);
  assert.deepEqual(namesOn(period.id), ['Amit Shah', 'Gone Already']);

  db.updateEmployee(leaving.id, { active: 0 });
  db.syncPayrollRows(period.id);
  assert.deepEqual(
    namesOn(period.id),
    ['Amit Shah'],
    'they are off the staff list and the Excel - the grid has to agree'
  );
  assert.ok(db.getEmployee(staying.id), 'and nobody else was touched');
});

test('somebody who left mid-month KEEPS their row — they are owed those days', () => {
  const leaver = hire('Worked Ten Days', 26000);
  const period = db.createPeriod({ year: 2026, month: 9 });
  db.syncPayrollRows(period.id);
  db.setAttendance(period.id, [
    { employee_id: leaver.id, day: 1, code: 'P' },
    { employee_id: leaver.id, day: 10, code: 'P' },
  ]);

  db.updateEmployee(leaver.id, { active: 0 });
  db.syncPayrollRows(period.id);
  assert.ok(
    namesOn(period.id).includes('Worked Ten Days'),
    'taking this row away would wipe the pay they are owed'
  );
});

test('a typed-over figure, an addition or a remark all keep the row', () => {
  const period = db.createPeriod({ year: 2026, month: 8 });
  const cases = [
    ['Has An Override', { absent_days_override: 2 }],
    ['Has An Addition', { addition: 500 }],
    ['Has A Deduction', { deduction: 300 }],
    ['Has A Remark', { remark: 'full and final pending' }],
    ['Has Been Paid', { status: 'paid' }],
  ];
  const made = cases.map(([name]) => hire(name));
  db.syncPayrollRows(period.id);

  made.forEach((emp, i) => {
    const row = db.listPayrollRows(period.id).find((r) => r.employee_id === emp.id);
    db.updatePayrollRow(row.id, cases[i][1]);
    db.updateEmployee(emp.id, { active: 0 });
  });
  db.syncPayrollRows(period.id);

  for (const [name] of cases) {
    assert.ok(
      namesOn(period.id).includes(name),
      `${name} carries something somebody typed - it cannot be thrown away`
    );
  }
});

test('a locked month is never rewritten', () => {
  const leaver = hire('Paid And Filed', 24000);
  const period = db.createPeriod({ year: 2026, month: 7 });
  db.syncPayrollRows(period.id);
  db.updatePeriod(period.id, { locked: 1 });

  db.updateEmployee(leaver.id, { active: 0 });
  db.syncPayrollRows(period.id);
  assert.ok(
    namesOn(period.id).includes('Paid And Filed'),
    'a closed month sits behind a PF return and a payslip - it does not change'
  );
});

test('coming back puts them on again', () => {
  const back = hire('Rejoined Later');
  const period = db.createPeriod({ year: 2026, month: 6 });
  db.syncPayrollRows(period.id);
  db.updateEmployee(back.id, { active: 0 });
  db.syncPayrollRows(period.id);
  assert.ok(!namesOn(period.id).includes('Rejoined Later'));

  db.updateEmployee(back.id, { active: 1 });
  db.syncPayrollRows(period.id);
  assert.ok(namesOn(period.id).includes('Rejoined Later'));
});
