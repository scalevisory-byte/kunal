/**
 * v2.37.0.
 *
 * 1. "Front Office Management" and the owner's own record sat on the salary
 *    sheet as critical "no salary set" rows. A record can now be on the staff
 *    list and on no payroll: `not_on_payroll`.
 * 2. Days imported BEFORE the no-out-punch rule stay P for good, by design.
 *    They are offered for one press instead, and a grid save can no longer
 *    carry the rule's own flag back onto a mark a person chose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingOutCandidates } from '../../shared/missingOut.js';

const here = path.dirname(fileURLToPath(import.meta.url));

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'not-on-payroll-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;
const db = await import('../src/db.js');
const { buildPayroll } = await import('../src/payroll.js');

const company = db.createCompany({ name: 'BOOKNFLY' });
const amit = db.createEmployee({ company_id: company.id, name: 'Amit Shah', monthly_salary: 26000 });
const desk = db.createEmployee({ company_id: company.id, name: 'Front Office Management', monthly_salary: 0 });
const period = db.createPeriod({ year: 2026, month: 11 });
const names = () => buildPayroll(period.id).rows.map((r) => r.employee_name);

test('an account ticked "not on the payroll" comes off the open month, and stays off', () => {
  assert.ok(names().includes('Front Office Management'), 'on the sheet before');
  db.updateEmployee(desk.id, { not_on_payroll: 1 });
  assert.deepEqual(names(), ['Amit Shah']);
  // Marks on its grid are no reason to keep it: nobody's salary is on that row.
  db.updateEmployee(desk.id, { not_on_payroll: 0 });
  buildPayroll(period.id);
  db.setAttendance(period.id, [{ employee_id: desk.id, day: 3, code: 'P' }]);
  db.updateEmployee(desk.id, { not_on_payroll: '1' });
  assert.deepEqual(names(), ['Amit Shah']);
  assert.equal(db.getEmployee(desk.id).not_on_payroll, 1);
  assert.equal(db.getEmployee(desk.id).active, 1, 'still on the staff list - logins, desk, assets');
});

test('unticking puts them back, and a row with money typed on it is never taken off', () => {
  db.updateEmployee(desk.id, { not_on_payroll: false });
  assert.ok(names().includes('Front Office Management'));
  const row = buildPayroll(period.id).rows.find((r) => r.employee_id === amit.id);
  db.updatePayrollRow(row.id, { addition: 500 });
  db.updateEmployee(amit.id, { not_on_payroll: 1 });
  assert.ok(names().includes('Amit Shah'), 'money on the row keeps it');
});

/* -------------------- days the rule never reached -------------------- */

const rows = [
  { employee_id: 1, employee_name: 'AJEETKUMAR', attendance: {
    27: { code: 'P', in_time: '10:29' },                       // imported before the rule
    26: { code: 'P', in_time: '10:00', out_time: '19:00' },    // complete
    25: { code: 'HF', in_time: '10:00', missing_out: 1 },      // the rule already wrote it
    24: { code: 'P', in_time: '10:00', marked_by_hand: 1 },    // a person chose P
    23: { code: 'P', in_time: '10:00', approved: true },       // somebody decided
    22: { code: 'CL', in_time: '10:00' },                      // leave
    28: { code: 'P', in_time: '10:05' },                       // today - still running
  } },
];
const entryOf = (row, day) => row.attendance[day] || { code: '' };

test('only finished, undecided P days with an arrival and no departure are offered', () => {
  const got = missingOutCandidates(rows, { entryOf, lastDay: 27 });
  assert.deepEqual(got.map((d) => d.day), [27]);
  assert.equal(got[0].in_time, '10:29');
});

test('a grid save never carries the rule’s flag back; only the sweep sets it', () => {
  const src = fs.readFileSync(path.join(here, '../../frontend/src/components/Attendance.jsx'), 'utf8');
  assert.match(src, /const \{ missing_out: _flag, marked_by_hand: _hand, rule_half_day: rule, \.\.\.rest \} = entry;/);
  assert.match(src, /\.\.\.\(rule \? \{ missing_out: 1 \} : \{\}\)/);
  assert.match(src, /rule_half_day: true/);
});

test('the sweep writes a half day the rule owns, which a typed out time undoes', () => {
  const ajeet = db.createEmployee({ company_id: company.id, name: 'Ajeetkumar', monthly_salary: 26000 });
  buildPayroll(period.id);
  db.setAttendance(period.id, [{ employee_id: ajeet.id, day: 20, code: 'P', in_time: '10:29', missing_out: null }]);
  db.setAttendance(period.id, [{ employee_id: ajeet.id, day: 20, code: 'HF', minutes: 0, missing_out: 1 }]);
  const cell = () => db.listAttendance(period.id).find((r) => r.employee_id === ajeet.id && r.day === 20);
  assert.equal(cell().code, 'HF');
  assert.equal(cell().missing_out, 1);
  db.setAttendance(period.id, [{ employee_id: ajeet.id, day: 20, out_time: '19:05' }]);
  assert.equal(cell().code, 'P');
});
