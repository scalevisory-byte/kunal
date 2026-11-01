/**
 * The late/early concession, end to end through the API.
 *
 * The point of these tests is the switch: a month carries the late and early
 * minutes either way, and opening a month cannot start charging for them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-late-'));
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
let nightId;

test('a month opens on the hours policy, with the concession stored but unused', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  const employee = await api('POST', '/api/employees', {
    company_id: company.body.id,
    name: 'Mahesh Shinde',
    monthly_salary: 26000,
  });
  employeeId = employee.body.id;
  const night = await api('POST', '/api/employees', {
    company_id: company.body.id,
    name: 'Night Desk',
    monthly_salary: 26000,
    shift_in: '21:00',
    shift_out: '06:00',
  });
  assert.equal(night.status, 201);
  nightId = night.body.id;
  assert.equal(night.body.shift_in, '21:00', 'a person can carry their own shift');

  const period = await api('POST', '/api/periods', { year: 2026, month: 10 });
  assert.equal(period.status, 201);
  periodId = period.body.id;
  assert.equal(period.body.late_policy, 'hours', 'nothing switches itself on');
  assert.equal(period.body.late_concession_minutes, 300);
  assert.equal(period.body.shift_in, '09:30');
});

test('late and early minutes are reported on the hours policy but cost nothing', async () => {
  const entries = [];
  for (let day = 1; day <= 26; day++) {
    entries.push({ employee_id: employeeId, day, code: 'P', in_time: '09:52', out_time: '18:20' });
  }
  const saved = await api('POST', `/api/periods/${periodId}/attendance`, { entries });
  assert.equal(saved.status, 200);

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows.find((r) => r.employee_id === employeeId);
  assert.equal(row.late_minutes, 26 * 22);
  assert.equal(row.early_minutes, 26 * 10);
  assert.equal(row.late_chargeable_minutes, 26 * 32 - 300);
  assert.ok(row.late_computed > 0, 'the app can say what the rule would cost');
  assert.equal(row.late_salary, 0, 'the late/early rule charges nothing on this policy');

  /*
   * The hours rule DOES charge, though - and this is the half that used to be
   * silently skipped. These days were posted through the attendance API with
   * clock times and no minutes, which is what a phone punch and an approved
   * missing-punch request both send. The server now works the shortfall out
   * itself, so 8h28m against a 9h day costs 32 minutes a day whichever screen
   * wrote it. Before the fix this read 26,000 - the hours were stored, shown on
   * the Time tab, and never paid for.
   */
  assert.equal(row.ot_minutes, 26 * -32, 'the shortfall is worked out on the server');
  const perMinute = 26000 / 26 / 9 / 60;
  assert.equal(row.gross_salary, Math.round(26000 - 26 * 32 * perMinute));
});

test('the two policies are alternatives, and each charges only its own figure', async () => {
  const before = await api('GET', `/api/periods/${periodId}/payroll`);
  const was = before.body.rows.find((r) => r.employee_id === employeeId);
  const perMinute = 26000 / 26 / 9 / 60;

  // On the hours policy: the shortfall is charged, the lateness is not.
  assert.equal(was.late_salary, 0);
  assert.equal(was.gross_salary, Math.round(26000 - 26 * 32 * perMinute));

  const patched = await api('PATCH', `/api/periods/${periodId}`, { late_policy: 'concession' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.late_policy, 'concession');

  const after = await api('GET', `/api/periods/${periodId}/payroll`);
  const now = after.body.rows.find((r) => r.employee_id === employeeId);

  // On the concession policy: the lateness past 300 minutes is charged, and the
  // shortfall is NOT charged again - the same minutes must never cost twice.
  assert.equal(now.late_salary, was.late_computed);
  assert.equal(now.ot_minutes, 0, 'the shortfall is not charged on top');
  assert.equal(now.gross_salary, Math.round(26000 - (26 * 32 - 300) * perMinute));
  assert.equal(now.late_policy, 'concession');

  // Both come off the same 26,000, by different amounts. The concession policy
  // is the kinder one here, because 300 minutes a month are forgiven.
  assert.ok(now.gross_salary > was.gross_salary);
});

test('a changed concession moves the charge, and only that', async () => {
  await api('PATCH', `/api/periods/${periodId}`, { late_concession_minutes: 0 });
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows.find((r) => r.employee_id === employeeId);
  assert.equal(row.late_concession_minutes, 0);
  assert.equal(row.late_chargeable_minutes, 26 * 32);

  await api('PATCH', `/api/periods/${periodId}`, { late_concession_minutes: 300 });
});

test('a night-shift worker is judged against their own hours, not the office’s', async () => {
  const entries = [];
  for (let day = 1; day <= 26; day++) {
    entries.push({ employee_id: nightId, day, code: 'P', in_time: '21:00', out_time: '06:00' });
  }
  await api('POST', `/api/periods/${periodId}/attendance`, { entries });

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows.find((r) => r.employee_id === nightId);
  assert.equal(row.shift_in, '21:00');
  assert.equal(row.late_total_minutes, 0, 'on time every day');
  assert.equal(row.late_salary, 0);
  // Judged against 09:30/18:30 this person would have read as 11h30m late a day.
  assert.ok(row.net_salary > 25000);
});

test('the office shift can be moved for the month', async () => {
  const patched = await api('PATCH', `/api/periods/${periodId}`, { shift_in: '10:00' });
  assert.equal(patched.body.shift_in, '10:00');
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows.find((r) => r.employee_id === employeeId);
  assert.equal(row.late_minutes, 0, 'nobody is late for a ten o’clock start');
  assert.equal(row.early_minutes, 26 * 10, 'but they still left early');
  await api('PATCH', `/api/periods/${periodId}`, { shift_in: '09:30' });
});
