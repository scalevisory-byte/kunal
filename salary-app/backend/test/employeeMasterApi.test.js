import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'master-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.ALLOW_OPEN = 'true';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let company;
let periodId;

test('set the scene', async () => {
  company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  assert.ok(company.id);
});

test('the code is suggested from the company’s own series, never reused', async () => {
  const first = await call('GET', `/api/employees/next-code?company_id=${company.id}`);
  assert.equal(first.status, 200);
  assert.match(first.body.code, /^BOO-\d{3}$/);

  const made = (await call('POST', '/api/employees', {
    company_id: company.id, name: 'Amit Shah', code: first.body.code,
    monthly_salary: 26000, joined_on: '2026-01-01', phone: '9825012345',
  })).body;
  assert.equal(made.code, first.body.code);

  const second = await call('GET', `/api/employees/next-code?company_id=${company.id}`);
  assert.notEqual(second.body.code, first.body.code);

  /*
   * THE SERIES IS READ OFF THE HIGHEST CODE IN USE, not a count - so a
   * leaver keeps their number and the next joiner does not inherit it.
   *
   * The one case where a number DOES come back is a record deleted
   * outright, and that is deliberate rather than overlooked: deletion is
   * already refused for anybody paid in a closed month or with an exit on
   * the record (see `employeeDeleteProblem`). What is left is somebody
   * typed in by mistake five minutes ago, whose code appears on no payslip,
   * no PF return and no muster roll - and handing that number back is
   * better than leaving a hole nobody can explain a year later.
   */
  await call('DELETE', `/api/employees/${made.id}`);
  const third = await call('GET', `/api/employees/next-code?company_id=${company.id}`);
  assert.equal(third.body.code, first.body.code, 'a mistake typed five minutes ago kept its number');
});

test('a duplicate is reported before anything is saved, and the code clash is refused', async () => {
  const amit = (await call('POST', '/api/employees', {
    company_id: company.id, name: 'Amit Shah', code: 'BOO-900',
    phone: '9825012345', pan: 'ABCDE1234F', joined_on: '2026-01-01',
  })).body;

  const asked = await call('POST', '/api/employees/check-duplicate', {
    name: 'Somebody Else', phone: '+91 98250 12345',
  });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.duplicates[0].id, amit.id);
  assert.deepEqual(asked.body.duplicates[0].why, ['the same mobile number']);

  /* A resemblance goes through - two brothers really do share a surname. */
  const sibling = await call('POST', '/api/employees', {
    company_id: company.id, name: 'Amit Shah', joined_on: '2026-02-01',
  });
  assert.equal(sibling.status, 201);

  /* A code clash does NOT. */
  const clash = await call('POST', '/api/employees', {
    company_id: company.id, name: 'Third Person', code: 'boo-900',
  });
  assert.equal(clash.status, 409);
  assert.match(clash.body.error, /already Amit Shah/);
});

test('A DRAFT IS ON NO PAYROLL MONTH', async () => {
  const draft = (await call('POST', '/api/employees', {
    company_id: company.id, name: 'Nisha Rawal', is_draft: 1, monthly_salary: 24000,
  })).body;
  assert.equal(draft.is_draft, 1);

  const period = (await call('POST', '/api/periods', { year: 2026, month: 10 })).body;
  periodId = period.id;
  const payroll = await call('GET', `/api/periods/${periodId}/payroll`);
  const names = payroll.body.rows.map((r) => r.employee_name);
  assert.ok(!names.includes('Nisha Rawal'), 'a half-typed form reached the salary sheet');
  assert.ok(names.includes('Amit Shah'));

  /* Finishing it puts them on the next refresh, with nothing else moved. */
  await call('PATCH', `/api/employees/${draft.id}`, { is_draft: 0 });
  const after = await call('GET', `/api/periods/${periodId}/payroll`);
  assert.ok(after.body.rows.map((r) => r.employee_name).includes('Nisha Rawal'));
});

test('the joining form’s own fields save, and move no figure', async () => {
  const before = (await call('GET', `/api/periods/${periodId}/payroll`)).body;
  const net = before.rows.reduce((t, r) => t + r.net_salary, 0);

  const person = before.rows.find((r) => r.employee_name === 'Amit Shah');
  const saved = await call('PATCH', `/api/employees/${person.employee_id}`, {
    employment_type: 'Permanent',
    work_location: 'Alkapuri desk',
    nationality: 'Indian',
    address_line1: '14 Gokul Flats',
    city: 'Vadodara',
    state: 'Gujarat',
    pincode: '390007',
    perm_same: 1,
    emergency_phone_alt: '9898012345',
    emergency_address: 'Same house',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.employment_type, 'Permanent');
  assert.equal(saved.body.city, 'Vadodara');
  assert.equal(saved.body.perm_same, 1);

  /* NOT ONE FIGURE MOVES. A joining form cannot change what anybody is paid. */
  const after = (await call('GET', `/api/periods/${periodId}/payroll`)).body;
  assert.equal(after.rows.reduce((t, r) => t + r.net_salary, 0), net);
});

test('looking at a masked identifier is written down', async () => {
  const list = (await call('GET', '/api/employees')).body.employees;
  const amit = list.find((e) => e.name === 'Amit Shah');

  const looked = await call('POST', `/api/employees/${amit.id}/viewed`, { field: 'aadhaar' });
  assert.equal(looked.status, 200);

  /* Only the three that are masked. Anything else would make the trail a
     list of everything anybody opened, which nobody reads. */
  const no = await call('POST', `/api/employees/${amit.id}/viewed`, { field: 'monthly_salary' });
  assert.equal(no.status, 400);

  const trail = (await call('GET', '/api/people/audit?entity=employees')).body;
  const rows = trail.entries || trail.audit || trail.rows || [];
  assert.ok(
    rows.some((r) => r.action === 'viewed' && r.field === 'aadhaar'),
    'the reveal is not on the audit trail'
  );
});
