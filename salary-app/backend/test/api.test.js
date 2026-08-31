import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the app at a throwaway database before anything imports config.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-test-'));
process.env.APP_PASSWORD = '';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');

const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let periodId;
let employeeId;
let rowId;

test('a month can be opened with its own divisors', async () => {
  const company = await api('POST', '/api/companies', { name: 'BNF PVT LTD' });
  assert.equal(company.status, 201);

  const employee = await api('POST', '/api/employees', {
    company_id: company.body.id,
    name: 'Ashutosh Jha',
    monthly_salary: 60000,
  });
  assert.equal(employee.status, 201);
  employeeId = employee.body.id;

  const period = await api('POST', '/api/periods', { year: 2026, month: 4, working_days: 26 });
  assert.equal(period.status, 201);
  assert.equal(period.body.label, 'April 2026');
  periodId = period.body.id;
});

test('opening a month gives every active employee a row at their master salary', async () => {
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.rows.length, 1);
  rowId = body.rows[0].id;
  assert.equal(body.rows[0].salary, 60000);
  assert.equal(body.rows[0].net_salary, 59800); // full month, PT 200
});

test('the same month cannot be opened twice', async () => {
  const again = await api('POST', '/api/periods', { year: 2026, month: 4 });
  assert.equal(again.status, 409);
});

test('attendance marks flow through to the calculated row', async () => {
  const saved = await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: employeeId, day: 2, code: 'A' },
      { employee_id: employeeId, day: 3, code: 'HF' },
      { employee_id: employeeId, day: 5, code: 'SP' },
    ],
  });
  assert.equal(saved.status, 200);

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows[0];
  assert.equal(row.absent_days, 1.5);
  assert.equal(row.sundays_worked, 1);
  assert.equal(row.gross_salary, 56538);
  assert.equal(row.net_salary, 56338);
  assert.equal(row.sunday_salary, 2308);
  assert.equal(row.final_payable, 58646);
});

test('leave marks save and land on the row', async () => {
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: employeeId, day: 8, code: 'PL' },
      { employee_id: employeeId, day: 9, code: 'UL' },
    ],
  });
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows[0];
  assert.equal(row.mark_counts.PL, 1);
  assert.equal(row.mark_counts.UL, 1);
  assert.equal(row.absent_days, 2.5, 'A + HF + UL; the paid leave costs nothing');

  // Put the row back for the tests that follow.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: employeeId, day: 8, code: '' },
      { employee_id: employeeId, day: 9, code: '' },
    ],
  });
});

test('short hours marked on a day reach the salary sheet', async () => {
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: employeeId, day: 12, code: 'P', minutes: -30 },
      { employee_id: employeeId, day: 13, code: 'P', minutes: -60 },
      { employee_id: employeeId, day: 14, minutes: -40 },
    ],
  });

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows[0];
  assert.equal(row.ot_minutes, -130, '30 + 60 + 40 short');
  assert.equal(row.ot_minutes_from_days, -130);
  assert.equal(row.overrides.ot_minutes, false, 'nothing typed over it');
  // 60000 / 26 / 9 / 60 = 4.2735 a minute
  assert.equal(row.ot_salary, -555.56);

  // A total typed on the salary sheet takes over, and clearing it hands back.
  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { ot_minutes: -60 });
  let after = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(after.body.rows[0].ot_minutes, -60);
  assert.equal(after.body.rows[0].overrides.ot_minutes, true);

  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { ot_minutes: '' });
  after = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(after.body.rows[0].ot_minutes, -130, 'back to the days');

  // Put the row back for the tests that follow.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [12, 13, 14].map((day) => ({ employee_id: employeeId, day, code: '', minutes: 0 })),
  });
});

test('minutes that are not a number are rejected', async () => {
  const bad = await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: employeeId, day: 15, code: 'P', minutes: 'half an hour' }],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /minutes/);
});

test('an unknown mark is rejected instead of silently ignored', async () => {
  const bad = await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: employeeId, day: 7, code: 'XX' }],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /XX/);
});

test('clearing a mark removes it', async () => {
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: employeeId, day: 3, code: '' }],
  });
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.rows[0].absent_days, 1);
});

test('overrides and deductions save, and blanking an override restores the formula', async () => {
  const patched = await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, {
    absent_days_override: 7.5,
    ot_amount_override: -90,
    esi: 0,
    pf: 0,
  });
  assert.equal(patched.status, 200);

  let { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.rows[0].absent_days, 7.5);
  assert.equal(body.rows[0].gross_salary, 42602, 'matches the April sheet');
  assert.equal(body.rows[0].net_salary, 42402);
  assert.equal(body.rows[0].overrides.absent_days, true);

  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { absent_days_override: '' });
  ({ body } = await api('GET', `/api/periods/${periodId}/payroll`));
  assert.equal(body.rows[0].absent_days, 1, 'back to counting the marks');
  assert.equal(body.rows[0].overrides.absent_days, false);
});

test('a locked month refuses edits', async () => {
  await api('PATCH', `/api/periods/${periodId}`, { locked: 1 });
  const blocked = await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { adjustment: 500 });
  assert.equal(blocked.status, 409);
  const marks = await api('POST', `/api/periods/${periodId}/attendance`, { entries: [] });
  assert.equal(marks.status, 409);
  await api('PATCH', `/api/periods/${periodId}`, { locked: 0 });
});

test('totals are grouped by company and in the grand total', async () => {
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.companies.length, 1);
  assert.equal(body.companies[0].company_name, 'BNF PVT LTD');
  assert.equal(body.companies[0].totals.net_salary, body.totals.net_salary);
  assert.equal(body.totals.count, 1);
});

test('a payslip comes back for one employee', async () => {
  const { status, body } = await api('GET', `/api/periods/${periodId}/payslip/${employeeId}`);
  assert.equal(status, 200);
  assert.equal(body.row.employee_name, 'Ashutosh Jha');
  assert.equal(body.period.label, 'April 2026');
});

test('the month exports as a real xlsx', async () => {
  const res = await fetch(`${base}/api/periods/${periodId}/export.xlsx`);
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 2000);
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'xlsx files are zips');
});

test('the csv exports carry the calculated columns', async () => {
  const res = await fetch(`${base}/api/periods/${periodId}/export.csv`);
  const csv = await res.text();
  assert.match(csv, /Company,Employee,Working Days/);
  assert.match(csv, /Ashutosh Jha/);

  const bank = await (await fetch(`${base}/api/periods/${periodId}/bank.csv`)).text();
  assert.match(bank, /Company,Employee,Mode,Amount/);
});

test('a new employee is picked up by sync without touching entered rows', async () => {
  const companies = await api('GET', '/api/companies');
  await api('POST', '/api/employees', {
    company_id: companies.body.companies[0].id,
    name: 'Rohit Tayade',
    monthly_salary: 22000,
    pf: 1800,
  });
  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { adjustment: 250 });

  const synced = await api('POST', `/api/periods/${periodId}/sync`);
  assert.equal(synced.body.added, 1);

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.rows.length, 2);
  assert.equal(body.rows.find((r) => r.employee_name === 'Ashutosh Jha').adjustment, 250);
  assert.equal(body.rows.find((r) => r.employee_name === 'Rohit Tayade').pf, 1800);
});

test('auth is enforced when a password is set', async () => {
  process.env.APP_PASSWORD = 'secret';
  const { config } = await import('../src/config.js');
  config.appPassword = 'secret';
  const locked = createServer().listen(0);
  const lockedBase = `http://127.0.0.1:${locked.address().port}`;
  try {
    assert.equal((await fetch(`${lockedBase}/api/companies`)).status, 401);
    assert.equal((await fetch(`${lockedBase}/healthz`)).status, 200, 'health check stays open');
    const ok = await fetch(`${lockedBase}/api/companies`, { headers: { authorization: 'Bearer secret' } });
    assert.equal(ok.status, 200);
  } finally {
    locked.close();
    config.appPassword = '';
  }
});
