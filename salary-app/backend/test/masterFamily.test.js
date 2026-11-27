/**
 * The employee master: parents' work, one reporting line, one name format.
 *
 * Dinesh: "Mother / father working detail / job company name", "Reporting
 * manager rakhna hai, HOD hata do employee master se", "Name in single format".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SECTIONS } from '../../shared/employeeMaster.js';
import { THEIRS_TO_FILL } from '../../shared/onboardingFlow.js';
import { calculateRow } from '../../shared/calc.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'master-family-'));
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const NEW = ['father_occupation', 'father_company', 'mother_occupation', 'mother_company'];
const formFields = SECTIONS.flatMap((s) => s.fields.map((f) => f[0]));

test('the form asks what each parent does and where', () => {
  for (const field of NEW) assert.ok(formFields.includes(field), `${field} is on the form`);
  // ...and the person themselves may fill them in, from the joining link or their own login.
  for (const field of NEW) assert.ok(THEIRS_TO_FILL.includes(field), `${field} is theirs to fill`);
});

test('one line of reporting: the manager stays, the second box is gone', () => {
  assert.ok(formFields.includes('reports_to_id'));
  assert.ok(!formFields.includes('hod_id'), 'two people to name is two answers to "who approves their leave"');
});

test('they are saved, changed and read back - and move no money', async () => {
  const company = (await api('POST', '/api/companies', { name: 'BNF' })).body;
  const made = await api('POST', '/api/employees', {
    name: 'Riya Pal', company_id: company.id, monthly_salary: 26000,
    father_occupation: 'Business', father_company: 'Pal Traders',
    mother_occupation: 'Teacher', mother_company: 'Navrachana School',
  });
  assert.equal(made.status, 201);
  for (const field of NEW) assert.ok(made.body[field], `${field} came back`);
  assert.equal(made.body.father_company, 'Pal Traders');

  const period = (await api('POST', '/api/periods', { month: 11, year: 2026 })).body;
  const net = async () => {
    const pay = (await api('GET', `/api/periods/${period.id}/payroll`)).body;
    const row = pay.rows.find((r) => r.employee_id === made.body.id);
    return calculateRow(row, pay.period, row.attendance).net_salary;
  };
  const before = await net();
  const changed = await api('PATCH', `/api/employees/${made.body.id}`, { mother_occupation: 'Retired', mother_company: '' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.mother_occupation, 'Retired');
  assert.equal(await net(), before, 'not one of these is an input to a calculation');

  // A HOD already on a record is not thrown away: only the box is gone.
  const kept = await api('PATCH', `/api/employees/${made.body.id}`, { designation: 'Executive' });
  assert.ok('hod_id' in kept.body);
});

test('a name typed in capitals or in small letters is put into one shape as it is typed', () => {
  const form = fs.readFileSync(new URL('../../frontend/src/components/EmployeeForm.jsx', import.meta.url), 'utf8');
  assert.match(form, /f\.field === 'name'[\s\S]{0,120}needsTidying\(e\.target\.value\) && onChange\(tidyName\(e\.target\.value\)\)/);
  // Everybody already on the list is one press: the button has to be on the page, not in a fold.
  const list = fs.readFileSync(new URL('../../frontend/src/components/Employees.jsx', import.meta.url), 'utf8');
  assert.match(list, /Tidy names/);
});
