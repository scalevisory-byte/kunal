/**
 * EXITING SOMEBODY, FROM THE SCREEN THEY ARE STANDING ON.
 *
 * Dinesh's HR, looking at the employee master: *"exit employee ka nhi hai
 * option"*. The app could do all of it - resignation, notice, clearance,
 * full and final - from People → Leaving. What it could not do was be found:
 * the only control on an employee's row that looked like a way out of the
 * payroll was a red Delete, which takes every month they were ever paid in.
 *
 * What these pin:
 *
 *  - **A notice period leaves somebody on the payroll.** Recording a
 *    resignation with a last working day still to come must NOT take them
 *    off the month they are still working and still owed.
 *  - **The way in is on the row**, and it opens the same panel rather than a
 *    second resignation form of its own.
 *  - **Leaving is the one picker that must still offer somebody who has
 *    gone** - which is tested next door, in leavers.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-exit-master-'));
process.env.APP_PASSWORD = 'the-key';
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
  return { status: res.status, body: await res.json().catch(() => null) };
};

/* Dates relative to today, so these do not rot into the past. */
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

let amit = 0;
let periodId = 0;

test('set up: one person, this month open', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  const made = await api('POST', '/api/employees', {
    name: 'Amit Shah',
    company_id: company.body.id,
    monthly_salary: 26000,
    joined_on: '2024-01-05',
  });
  amit = made.body.id;
  const now = new Date();
  const period = await api('POST', '/api/periods', {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    hours_per_day: 9,
  });
  periodId = period.body.id;
  const payroll = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.ok(payroll.body.rows.some((r) => r.employee_id === amit), 'he is on this month');
});

test('A RESIGNATION SERVED WITH NOTICE LEAVES THEM ON THE PAYROLL', async () => {
  /*
   * This forced active = 0 the moment the resignation was recorded, which
   * contradicted the master's own rule - "a date still to come leaves them on
   * it until that day". Somebody resigning on the 1st with a month's notice
   * dropped off the sheet the same afternoon, so the month they were still
   * working opened without them and they were not paid for it.
   */
  const saved = await api('PUT', `/api/people/exits/${amit}`, {
    type: 'resigned',
    resigned_on: day(0),
    notice_days: 30,
    last_working_day: day(21),
    reason: 'moving to Ahmedabad',
  });
  assert.equal(saved.status, 200);

  const employee = await api('GET', `/api/employees/${amit}`);
  assert.equal(employee.body.left_on, day(21), 'the master carries the date, so every tab reads one fact');
  assert.equal(employee.body.active, 1, 'he is still here, and still owed this month');

  const payroll = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.ok(payroll.body.rows.some((r) => r.employee_id === amit), 'still on the sheet he is working');
});

test('and the day it passes, he comes off', async () => {
  await api('PUT', `/api/people/exits/${amit}`, { last_working_day: day(-1) });
  const employee = await api('GET', `/api/employees/${amit}`);
  assert.equal(employee.body.active, 0);
  assert.equal(employee.body.left_on, day(-1));
});

test('somebody already off the list can still have their exit recorded', async () => {
  /*
   * The usual order of events: Active is unticked on the day somebody stops
   * coming in, and the paperwork follows. Nothing in the API may refuse them
   * for being inactive - the picker that used to is fixed in Leaving.jsx.
   */
  const company = await api('POST', '/api/companies', { name: 'SCALE' });
  const made = await api('POST', '/api/employees', {
    name: 'Riya Pal', company_id: company.body.id, monthly_salary: 18000, joined_on: '2023-06-01',
  });
  await api('PATCH', `/api/employees/${made.body.id}`, { active: false });

  const saved = await api('PUT', `/api/people/exits/${made.body.id}`, {
    type: 'resigned', resigned_on: day(-40), last_working_day: day(-10),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.exit.last_working_day, day(-10));
});

/* ---------------- the way in ---------------- */

const src = (rel) =>
  fs.readFileSync(new URL(`../../frontend/src/${rel}`, import.meta.url), 'utf8');

test('the employee row carries an exit button, and it is not the Delete button', () => {
  const employees = src('components/Employees.jsx');
  assert.match(employees, /import ExitEmployee from '\.\/ExitEmployee\.jsx'/);
  assert.match(employees, /onClick=\{\(\) => setExitFor\(emp\)\}/);
  assert.match(employees, /<ExitEmployee/);
  // Delete still exists and still says what it takes with it.
  assert.match(employees, /Deletes the employee and every month they appear in/);
});

test('the row opens the SAME leaving panel, not a second resignation form', () => {
  const modal = src('components/ExitEmployee.jsx');
  assert.match(modal, /import Leaving from '\.\/people\/Leaving\.jsx'/);
  assert.match(modal, /only=\{employee\}/);
  // Nothing in the modal writes an exit itself.
  assert.ok(!/api\.(put|post)\(/.test(modal), 'the modal records nothing of its own');
});

test('handed one person, Leaving drops the picker and everybody else’s exits', () => {
  const leaving = src('components/people/Leaving.jsx');
  assert.match(leaving, /if \(only\) open\(only\.id\);/, 'it opens them straight away');
  assert.match(leaving, /\{!only && \(\s*<div className="toolbar">/, 'no picker on one person’s screen');
  assert.match(leaving, /\{!only && exits\.length > 0 && \(/, 'and not a list of everybody who ever left');
});

test('nobody is told to press a New month button they have not got', () => {
  const app = src('App.jsx');
  assert.match(app, /const mayHaveMonths = useCallback\(/);
  assert.match(app, /if \(!mayHaveMonths\(\)\) \{/, 'a login with no months does not ask for them');
  assert.match(app, /MONTHLY_TABS\.has\(tab\) && mayHaveMonths\(\) && \(/);

  const dashboard = src('components/Dashboard.jsx');
  assert.match(dashboard, /if \(!mayUse\('salary'\) && !mayUse\('attendance'\)\) \{/);
});
