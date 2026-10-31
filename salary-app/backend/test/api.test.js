import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the app at a throwaway database before anything imports config.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-test-'));
process.env.APP_PASSWORD = '';
process.env.SERVE_FRONTEND = 'false';
process.env.PUNCH_ENABLED = 'true';

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

/**
 * This file runs with APP_PASSWORD empty, so there is no token to send and
 * `open` is the same call as `api`. It is named separately where the point of
 * the test is that a surface is reachable WITHOUT a password - the wall itself
 * is tested in hiring.test.js, which runs with auth on.
 */
const open = api;

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

  const period = await api('POST', '/api/periods', { year: 2026, month: 4 });
  assert.equal(period.status, 201);
  assert.equal(period.body.label, 'April 2026');
  assert.equal(period.body.working_days, 26);
  periodId = period.body.id;
});

test('a month is always 26 working days, however it is asked for', async () => {
  // February, and someone trying to open it on its own calendar length.
  const feb = await api('POST', '/api/periods', { year: 2026, month: 2, working_days: 28 });
  assert.equal(feb.status, 201);
  assert.equal(feb.body.working_days, 26, 'the request does not get to choose');

  const patched = await api('PATCH', `/api/periods/${feb.body.id}`, { working_days: 31 });
  assert.equal(patched.body.working_days, 26, 'and it cannot be changed afterwards');

  await api('DELETE', `/api/periods/${feb.body.id}`);
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
  assert.equal(row.final_payable, 56338, 'the Sunday is paid on its own register');
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
  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { ot_minutes_override: -60 });
  let after = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(after.body.rows[0].ot_minutes, -60);
  assert.equal(after.body.rows[0].overrides.ot_minutes, true);

  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { ot_minutes_override: '' });
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

test('clock times save, work out the day, and survive a mark being set', async () => {
  const saved = await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      {
        employee_id: employeeId,
        day: 20,
        in_time: '09:30',
        lunch_out: '13:00',
        lunch_in: '13:45',
        out_time: '18:30',
        code: 'P',
        minutes: -45,
      },
    ],
  });
  assert.equal(saved.status, 200);

  const { body } = await api('GET', `/api/periods/${periodId}/attendance`);
  const day = body.employees.find((e) => e.employee_id === employeeId).attendance[20];
  assert.equal(day.in_time, '09:30');
  assert.equal(day.lunch_in, '13:45');
  assert.equal(day.minutes, -45, 'eight and a quarter hours against nine');

  // The grid saves marks without ever mentioning the times. They must stay.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: employeeId, day: 20, code: 'PH', minutes: 0 }],
  });
  const after = await api('GET', `/api/periods/${periodId}/attendance`);
  const stillThere = after.body.employees.find((e) => e.employee_id === employeeId).attendance[20];
  assert.equal(stillThere.code, 'PH', 'the new mark took');
  assert.equal(stillThere.in_time, '09:30', 'and the hours are still on the day');
  assert.equal(stillThere.out_time, '18:30');

  // Naming a time with nothing in it is how one is cleared.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: employeeId, day: 20, code: '', minutes: 0, in_time: '', lunch_out: '', lunch_in: '', out_time: '' }],
  });
  const cleared = await api('GET', `/api/periods/${periodId}/attendance`);
  assert.equal(
    cleared.body.employees.find((e) => e.employee_id === employeeId).attendance[20],
    undefined,
    'a day with no mark, no minutes and no times is gone'
  );
});

test('an unreadable clock time is refused rather than stored as a blank hour', async () => {
  const bad = await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: employeeId, day: 21, in_time: 'morning' }],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /in time is not a time/);
});

test('reading a month with sync=false does not pull new staff into it', async () => {
  // A closed month, read only to be looked at - the dashboard's trend does
  // exactly this - must come back as it was, not as it would be today.
  const before = await api('GET', `/api/periods/${periodId}/payroll`);
  const had = before.body.rows.length;

  const company = before.body.rows[0].company_id;
  const hire = await api('POST', '/api/employees', {
    company_id: company,
    name: 'Joined Later',
    monthly_salary: 20000,
  });
  assert.equal(hire.status, 201);

  const readOnly = await api('GET', `/api/periods/${periodId}/payroll?sync=false`);
  assert.equal(readOnly.body.rows.length, had, 'the new hire is not backdated into the month');

  const normal = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(normal.body.rows.length, had + 1, 'and a normal read still picks them up');

  await api('DELETE', `/api/employees/${hire.body.id}`);
});

test('the Sunday register records its own payment, apart from the salary', async () => {
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: employeeId, day: 5, code: 'SP' },
      { employee_id: employeeId, day: 19, code: 'SP' },
    ],
  });

  let { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  let row = body.rows[0];
  assert.equal(row.sundays_worked, 2);
  assert.deepEqual(row.sunday_days, [5, 19], 'the register knows which dates');
  assert.equal(row.sunday_status, null, 'nothing paid yet');

  // Words must survive the round trip - these are not numeric columns.
  const saved = await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, {
    sunday_status: 'paid',
    sunday_mode: 'Cash',
  });
  assert.equal(saved.body.sunday_status, 'paid');
  assert.equal(saved.body.sunday_mode, 'Cash');

  ({ body } = await api('GET', `/api/periods/${periodId}/payroll`));
  row = body.rows[0];
  assert.equal(row.sunday_status, 'paid');
  assert.equal(row.status, 'pending', "the month's own status is untouched");

  const csv = await (await fetch(`${base}/api/periods/${periodId}/sunday.csv`)).text();
  assert.match(csv, /Company,Employee,Dates,Days,Day Rate,Amount,Paid By,Status/);
  assert.match(csv, /Ashutosh Jha/);
  assert.match(csv, /Cash,paid/);

  // Put the row back for the tests that follow.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [5, 19].map((day) => ({ employee_id: employeeId, day, code: '' })),
  });
  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { sunday_status: '', sunday_mode: '' });
});

test('a festival is a paid holiday for one religion and a working day for the rest', async () => {
  const companies = await api('GET', '/api/companies');
  const companyId = companies.body.companies[0].id;

  // Two more people, of two religions; Ashutosh has none set.
  const hindu = await api('POST', '/api/employees', {
    company_id: companyId, name: 'Diwali Person', monthly_salary: 20000, religion: 'Hindu',
  });
  const muslim = await api('POST', '/api/employees', {
    company_id: companyId, name: 'Eid Person', monthly_salary: 20000, religion: 'Muslim',
  });
  await api('POST', `/api/periods/${periodId}/sync`);

  const listed = await api('GET', `/api/periods/${periodId}/holidays`);
  assert.deepEqual(listed.body.religions, ['Hindu', 'Muslim'], 'the religions in use come back');

  const eid = await api('POST', `/api/periods/${periodId}/holidays`, {
    name: 'Eid', day: 20, code: 'PH', religions: ['Muslim'],
  });
  assert.equal(eid.status, 201);
  assert.deepEqual(eid.body.religions, ['Muslim']);
  assert.equal(eid.body.applied_at, null, 'nothing written until it is applied');

  const applied = await api('POST', `/api/periods/${periodId}/holidays/${eid.body.id}/apply`);
  assert.equal(applied.body.marked, 1, 'only the one Muslim employee');
  assert.ok(applied.body.holiday.applied_at, 'and it records that it ran');

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const byName = Object.fromEntries(body.rows.map((r) => [r.employee_name, r]));
  assert.equal(byName['Eid Person'].attendance[20].code, 'PH');
  assert.equal(byName['Diwali Person'].attendance[20], undefined, 'the Hindu employee works that day');
  assert.equal(byName['Ashutosh Jha'].attendance[20], undefined, 'and so does anyone with no religion');
  assert.equal(byName['Eid Person'].absent_days, 0, 'a paid holiday costs nothing');

  // No religions means the whole office.
  const shutdown = await api('POST', `/api/periods/${periodId}/holidays`, {
    name: 'Office shut', day: 21, code: 'PH', religions: [],
  });
  const all = await api('POST', `/api/periods/${periodId}/holidays/${shutdown.body.id}/apply`);
  assert.equal(all.body.marked, body.rows.length, 'everybody');

  // A bad mark and a bad date are refused.
  assert.equal(
    (await api('POST', `/api/periods/${periodId}/holidays`, { name: 'X', day: 5, code: 'ZZ' })).status,
    400
  );
  assert.equal(
    (await api('POST', `/api/periods/${periodId}/holidays`, { name: 'X', day: 99 })).status,
    400
  );
  assert.equal((await api('POST', `/api/periods/${periodId}/holidays`, { day: 5 })).status, 400);

  // Tidy up so the rest of the tests see the month they expect.
  await api('DELETE', `/api/periods/${periodId}/holidays/${eid.body.id}`);
  await api('DELETE', `/api/periods/${periodId}/holidays/${shutdown.body.id}`);
  await api('DELETE', `/api/periods/${periodId}/attendance`);
  await api('DELETE', `/api/employees/${hindu.body.id}`);
  await api('DELETE', `/api/employees/${muslim.body.id}`);
});

test('leave is counted from the marks and set against an entitlement', async () => {
  const companies = await api('GET', '/api/companies');
  const person = await api('POST', '/api/employees', {
    company_id: companies.body.companies[0].id,
    name: 'Leave Taker',
    monthly_salary: 26000,
    cl_quota: 6,
    sl_quota: 6,
    pl_quota: 12,
  });
  await api('POST', `/api/periods/${periodId}/sync`);

  // Two casual days, one sick, and eight privilege - two over the six due.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: person.body.id, day: 2, code: 'CL' },
      { employee_id: person.body.id, day: 3, code: 'CL' },
      { employee_id: person.body.id, day: 4, code: 'SL' },
      ...[6, 7, 8, 9, 10, 11, 12].map((day) => ({ employee_id: person.body.id, day, code: 'CL' })),
      { employee_id: person.body.id, day: 14, code: 'UL' },
    ],
  });

  const { body } = await api('GET', '/api/leave?year=2026');
  const row = body.rows.find((r) => r.name === 'Leave Taker');
  assert.equal(body.year, 2026);
  assert.deepEqual(row.quotas, { CL: 6, SL: 6, PL: 12 });
  assert.equal(row.taken.CL, 9, 'counted straight off the grid');
  assert.equal(row.taken.SL, 1);
  assert.equal(row.taken.PL, 0);
  assert.equal(row.taken.UL, 1);

  // Paid leave costs nothing; the one unpaid day does.
  const payroll = await api('GET', `/api/periods/${periodId}/payroll`);
  const paid = payroll.body.rows.find((r) => r.employee_name === 'Leave Taker');
  assert.equal(paid.absent_days, 1, 'only the unpaid day');
  assert.equal(paid.gross_salary, 25000);

  // A different year sees none of it.
  const other = await api('GET', '/api/leave?year=2025');
  assert.equal(other.body.rows.find((r) => r.name === 'Leave Taker').taken.CL, 0);

  await api('DELETE', `/api/employees/${person.body.id}`);
});

test('a loan takes its instalment each month and stops when it is repaid', async () => {
  const companies = await api('GET', '/api/companies');
  const person = await api('POST', '/api/employees', {
    company_id: companies.body.companies[0].id,
    name: 'Borrower',
    monthly_salary: 20000,
  });

  const loan = await api('POST', '/api/loans', {
    employee_id: person.body.id,
    amount: 5000,
    instalment: 2000,
    reason: 'Advance',
  });
  assert.equal(loan.status, 201);
  assert.equal(loan.body.outstanding, 5000);
  assert.equal(loan.body.repaid, 0);

  // Looking at the month posts the instalment and deducts it.
  let payroll = await api('GET', `/api/periods/${periodId}/payroll`);
  let row = payroll.body.rows.find((r) => r.employee_name === 'Borrower');
  assert.equal(row.loan_deduction, 2000);
  assert.equal(row.gross_salary, 20000);
  assert.equal(row.net_salary, 17800, '20000 - 200 PT - 2000 loan');

  // Looking again must not take it twice.
  payroll = await api('GET', `/api/periods/${periodId}/payroll`);
  row = payroll.body.rows.find((r) => r.employee_name === 'Borrower');
  assert.equal(row.loan_deduction, 2000, 'posted once, not once per look');

  let after = await api('GET', '/api/loans');
  assert.equal(after.body.loans.find((l) => l.id === loan.body.id).outstanding, 3000);

  // A month somebody cannot pay is set to nothing, and the loan just runs on.
  await api('PUT', `/api/loans/${loan.body.id}/repayment/${periodId}`, { amount: 0 });
  payroll = await api('GET', `/api/periods/${periodId}/payroll`);
  row = payroll.body.rows.find((r) => r.employee_name === 'Borrower');
  assert.equal(row.loan_deduction, 0);
  assert.equal(row.net_salary, 19800);
  after = await api('GET', '/api/loans');
  assert.equal(after.body.loans.find((l) => l.id === loan.body.id).outstanding, 5000);

  // The last instalment is capped at what is left, never more.
  await api('PATCH', `/api/loans/${loan.body.id}`, { instalment: 4000 });
  await api('PUT', `/api/loans/${loan.body.id}/repayment/${periodId}`, { amount: 4000 });
  const next = await api('POST', '/api/periods', { year: 2026, month: 5 });
  await api('POST', `/api/loans/post/${next.body.id}`);
  const later = await api('GET', `/api/loans?period_id=${next.body.id}`);
  const instalment = later.body.repayments.find((r) => r.loan_id === loan.body.id);
  assert.equal(instalment.amount, 1000, 'only the 1,000 still owed');
  assert.equal(later.body.loans.find((l) => l.id === loan.body.id).outstanding, 0);

  // And a repaid loan takes nothing in the month after that.
  const third = await api('POST', '/api/periods', { year: 2026, month: 6 });
  await api('POST', `/api/loans/post/${third.body.id}`);
  const done = await api('GET', `/api/loans?period_id=${third.body.id}`);
  assert.equal(done.body.repayments.filter((r) => r.loan_id === loan.body.id).length, 0);

  await api('DELETE', `/api/periods/${next.body.id}`);
  await api('DELETE', `/api/periods/${third.body.id}`);
  await api('DELETE', `/api/employees/${person.body.id}`);
});

test('a loan on hold takes nothing, and a bad amount is refused', async () => {
  const companies = await api('GET', '/api/companies');
  const person = await api('POST', '/api/employees', {
    company_id: companies.body.companies[0].id, name: 'On Hold', monthly_salary: 20000,
  });
  const held = await api('POST', '/api/loans', {
    employee_id: person.body.id, amount: 5000, instalment: 1000, status: 'held',
  });
  const period = await api('POST', '/api/periods', { year: 2026, month: 7 });
  await api('POST', `/api/loans/post/${period.body.id}`);
  const listed = await api('GET', `/api/loans?period_id=${period.body.id}`);
  assert.equal(listed.body.repayments.filter((r) => r.loan_id === held.body.id).length, 0);

  assert.equal((await api('POST', '/api/loans', { employee_id: person.body.id, amount: 0 })).status, 400);
  assert.equal((await api('POST', '/api/loans', { employee_id: 999999, amount: 100 })).status, 400);

  await api('DELETE', `/api/periods/${period.body.id}`);
  await api('DELETE', `/api/employees/${person.body.id}`);
});

test('an addition and a deduction are separate boxes, with a reason', async () => {
  // Whatever the row is worth already - earlier tests have left an OT override
  // on it - the two boxes move it by exactly their difference.
  const before = (await api('GET', `/api/periods/${periodId}/payroll`)).body.rows[0].gross_salary;

  const saved = await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, {
    addition: 1500,
    deduction: 400,
    remark: 'Incentive, less a breakage',
  });
  assert.equal(saved.body.addition, 1500);
  assert.equal(saved.body.deduction, 400);
  assert.equal(saved.body.remark, 'Incentive, less a breakage');

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows[0];
  assert.equal(row.gross_salary, before + 1500 - 400);
  assert.equal(row.adjustment, 1100, 'the net effect of the two');

  // The wage register counts the deduction with the rest of them.
  const register = await api('GET', `/api/periods/${periodId}/statutory`);
  const wage = register.body.wages.find((w) => w.name === 'Ashutosh Jha');
  assert.equal(wage.other_deduction, 400);
  assert.equal(wage.net, wage.gross - wage.deductions, 'and it still balances');

  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, {
    addition: 0, deduction: 0, remark: '',
  });
});

test('a locked month refuses edits', async () => {
  await api('PATCH', `/api/periods/${periodId}`, { locked: 1 });
  const blocked = await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { addition: 500 });
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
  await api('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { addition: 250 });

  const synced = await api('POST', `/api/periods/${periodId}/sync`);
  assert.equal(synced.body.added, 1);

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.rows.length, 2);
  assert.equal(body.rows.find((r) => r.employee_name === 'Ashutosh Jha').addition, 250);
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

/* ---------------- one person's own report ---------------- */

test("an employee's report reads their months without touching them", async () => {
  // A second month, so the report has something to run down.
  const second = await api('POST', '/api/periods', { year: 2027, month: 1 });
  assert.equal(second.status, 201);

  const before = (await api('GET', `/api/periods/${periodId}/payroll?sync=false`)).body.rows.length;

  const report = await api('GET', `/api/employees/${employeeId}/report`);
  assert.equal(report.status, 200);
  assert.equal(report.body.employee.id, employeeId);
  assert.ok(report.body.months.length >= 2, 'both months should be in the report');
  assert.deepEqual(
    report.body.months.map((m) => `${m.year}-${m.month}`).sort(),
    [...report.body.months.map((m) => `${m.year}-${m.month}`)].sort(),
    'months come back in order'
  );
  assert.ok(report.body.years.includes(2027));

  // Reading a report must not sync rows into a month somebody has closed, or
  // post a loan instalment there - that is the salary sheet's job, not a
  // report's.
  const after = (await api('GET', `/api/periods/${periodId}/payroll?sync=false`)).body.rows.length;
  assert.equal(after, before);
});

test("a report can be narrowed to one year, and totals follow", async () => {
  const all = (await api('GET', `/api/employees/${employeeId}/report`)).body;
  const one = (await api('GET', `/api/employees/${employeeId}/report?year=2027`)).body;
  assert.equal(one.year, 2027);
  assert.ok(one.months.every((m) => m.year === 2027));
  assert.ok(one.months.length < all.months.length);
  assert.equal(one.totals.months, one.months.length);
});

test('a report for somebody who does not exist is a 404, not an empty page', async () => {
  assert.equal((await api('GET', '/api/employees/999999/report')).status, 404);
});

/* ---------------- employee management: manager, history, documents ---------------- */

let managerId;

test('a reporting manager is another employee, and a loop is refused', async () => {
  const boss = await api('POST', '/api/employees', {
    company_id: (await api('GET', '/api/employees')).body.employees[0].company_id,
    name: 'Dinesh Parmar',
    monthly_salary: 100000,
  });
  managerId = boss.body.id;

  const set = await api('PATCH', `/api/employees/${employeeId}`, { reports_to_id: managerId });
  assert.equal(set.status, 200);
  assert.equal(set.body.reports_to_id, managerId);

  // The manager's own record lists the people under them.
  const record = await api('GET', `/api/employees/${managerId}/record`);
  assert.ok(record.body.reports.some((r) => r.id === employeeId));

  // Nobody reports to themselves.
  const self = await api('PATCH', `/api/employees/${managerId}`, { reports_to_id: managerId });
  assert.equal(self.status, 400);
  assert.match(self.body.error, /circle back/i);

  // And nobody reports to somebody who already reports to them.
  const loop = await api('PATCH', `/api/employees/${managerId}`, { reports_to_id: employeeId });
  assert.equal(loop.status, 400);
});

test('a salary or designation change is written into the history', async () => {
  const before = (await api('GET', `/api/employees/${employeeId}/record`)).body.history.length;

  await api('PATCH', `/api/employees/${employeeId}`, { monthly_salary: 25000, designation: 'Senior Accountant' });
  const { history } = (await api('GET', `/api/employees/${employeeId}/record`)).body;
  assert.equal(history.length, before + 2);

  const salary = history.find((h) => h.field === 'monthly_salary');
  assert.equal(salary.to_value, '25000');
  assert.ok(salary.label, 'the timeline needs a readable label');

  // The manager change earlier was recorded by name, not by id.
  const manager = history.find((h) => h.field === 'reports_to_id');
  assert.equal(manager.to_value, 'Dinesh Parmar');
});

test('setting a field to the value it already had records nothing', async () => {
  const before = (await api('GET', `/api/employees/${employeeId}/record`)).body.history.length;
  await api('PATCH', `/api/employees/${employeeId}`, { monthly_salary: 25000 });
  const after = (await api('GET', `/api/employees/${employeeId}/record`)).body.history.length;
  assert.equal(after, before);
});

test('a note can be put on the record without changing a field', async () => {
  const added = await api('POST', `/api/employees/${employeeId}/history`, { note: 'Moved to the Surat office' });
  assert.equal(added.status, 201);
  assert.ok(added.body.history.some((h) => h.note === 'Moved to the Surat office'));
  assert.equal((await api('POST', `/api/employees/${employeeId}/history`, { note: '  ' })).status, 400);
});

test('a document goes on disk, and the row never carries the path', async () => {
  const form = new FormData();
  form.set('document', new Blob([Buffer.from('%PDF-1.4 pan card')], { type: 'application/pdf' }), 'PAN Rohit.pdf');
  form.set('kind', 'pan');
  form.set('number', 'ABCDE1234F');
  const res = await fetch(`${base}/api/employees/${employeeId}/documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.APP_PASSWORD}` },
    body: form,
  });
  assert.equal(res.status, 201);
  const { document } = await res.json();
  assert.equal(document.kind, 'pan');
  assert.equal(document.file_name, 'PAN Rohit.pdf');
  assert.equal(document.file_path, undefined, 'the path on disk must not reach the page');
  assert.ok(document.link.url.startsWith('/files/document/'));

  // The signed link works with no password, and a tampered one does not.
  const open = await fetch(`${base}${document.link.url}`);
  assert.equal(open.status, 200);
  assert.match(await open.text(), /pan card/);
  const url = new URL(document.link.url, base);
  assert.equal(
    (await fetch(`${base}/files/document/${document.id}?exp=${url.searchParams.get('exp')}&sig=nope`)).status,
    403
  );

  // And the record knows what is still missing.
  const { document_status } = (await api('GET', `/api/employees/${employeeId}/record`)).body;
  assert.ok(!document_status.missing_kyc.includes('pan'));
  assert.ok(document_status.missing_kyc.includes('aadhaar'));
  assert.equal(document_status.complete, false);
});

test('only a real document format is accepted', async () => {
  const form = new FormData();
  form.set('document', new Blob([Buffer.from('#!/bin/sh')], { type: 'application/x-sh' }), 'x.sh');
  const res = await fetch(`${base}/api/employees/${employeeId}/documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.APP_PASSWORD}` },
    body: form,
  });
  assert.equal(res.status, 400);
});

test('deleting a document takes the file with it', async () => {
  const { documents } = (await api('GET', `/api/employees/${employeeId}/record`)).body;
  const doc = documents[0];
  assert.equal((await api('DELETE', `/api/employees/${employeeId}/documents/${doc.id}`)).status, 204);
  assert.equal((await fetch(`${base}${doc.link.url}`)).status, 404);
  // Somebody else's document id cannot be deleted through this employee.
  assert.equal((await api('DELETE', `/api/employees/${managerId}/documents/${doc.id}`)).status, 404);
});

/* ---------------- attendance: punching from a phone, and approvals ---------------- */

const alkapuri = { name: 'Alkapuri office', lat: 22.3072, lng: 73.1812, radius_m: 200 };
let punchToken;

test('an office location is where a punch counts as being at work', async () => {
  const created = await api('POST', '/api/attendance/offices', alkapuri);
  assert.equal(created.status, 201);
  assert.equal(created.body.radius_m, 200);

  // Latitude and longitude are not optional - an office nowhere fences nothing.
  assert.equal((await api('POST', '/api/attendance/offices', { name: 'Nowhere' })).status, 400);
});

test('a punch link identifies one person and carries no password', async () => {
  // The office asks for the link through the employees route.
  const link = await api('GET', `/api/employees/${employeeId}/punch-link`);
  assert.equal(link.status, 200);
  punchToken = link.body.path.split('/').pop();

  const page = await open('GET', `/api/punch/${punchToken}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.employee.id, employeeId);
  assert.equal(page.body.next, 'in');
  // What a punch link may NOT see. Checked as keys rather than as a substring
  // search - "company_name" contains "pan", which is not a leaked PAN.
  const shown = Object.keys(page.body.employee);
  for (const secret of ['monthly_salary', 'basic', 'hra', 'pan', 'aadhaar', 'uan', 'bank_account', 'pf', 'esi']) {
    assert.ok(!shown.includes(secret), `a punch link exposed ${secret}`);
  }
  assert.deepEqual(shown.sort(), ['code', 'company_name', 'designation', 'id', 'name']);
  assert.equal(JSON.stringify(page.body).includes('"net_salary"'), false);

  assert.equal((await open('GET', '/api/punch/not-a-token')).status, 403);
  // And the office is warned that the link is the identity.
  assert.match(link.body.warning, /Anybody holding this link/);
});

test('punching in at the office records it and lands on the grid', async () => {
  const res = await open('POST', `/api/punch/${punchToken}/punch`, {
    kind: 'in',
    lat: 22.3073,
    lng: 73.1813,
    accuracy: 15,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.inside, true);
  assert.match(res.body.where, /at Alkapuri office/);
  assert.equal(res.body.next, 'out', 'the phone offers the other button next');
  assert.ok(res.body.day.in_time, 'the day carries a clock time');
});

test('a punch away from the office is recorded and flagged, never refused', async () => {
  const res = await open('POST', `/api/punch/${punchToken}/punch`, {
    kind: 'out',
    lat: 22.3400,
    lng: 73.2100,
    accuracy: 20,
  });
  assert.equal(res.status, 201, 'refusing it would leave them with no attendance at all');
  assert.equal(res.body.inside, false);
  assert.match(res.body.where, /from Alkapuri office/);

  const log = await api('GET', `/api/attendance/punches?employee_id=${employeeId}`);
  assert.ok(log.body.punches.some((p) => p.inside_fence === false));
});

test('a punch with no location is refused while location is required', async () => {
  const res = await open('POST', `/api/punch/${punchToken}/punch`, { kind: 'in' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /location/i);
});

test('a request is raised by the employee and writes nothing on its own', async () => {
  const before = (await api('GET', `/api/periods/${periodId}/attendance`)).body;

  const raised = await open('POST', `/api/punch/${punchToken}/requests`, {
    period_id: periodId,
    day: 9,
    kind: 'missing_punch',
    in_time: '09:30',
    out_time: '18:30',
    reason: 'Machine did not read my finger',
  });
  assert.equal(raised.status, 201);
  assert.equal(raised.body.status, 'pending');

  // Nothing on the grid has moved.
  const after = (await api('GET', `/api/periods/${periodId}/attendance`)).body;
  assert.deepEqual(after, before, 'a pending request must not touch attendance');

  // A request with no reason is refused - the office has to decide on something.
  const thin = await open('POST', `/api/punch/${punchToken}/requests`, {
    period_id: periodId,
    day: 10,
    kind: 'missing_punch',
    in_time: '09:30',
  });
  assert.equal(thin.status, 400);
});

test('a punch link cannot raise a request in somebody else name', async () => {
  const raised = await open('POST', `/api/punch/${punchToken}/requests`, {
    employee_id: managerId,
    period_id: periodId,
    day: 11,
    kind: 'correction',
    code: 'CL',
    reason: 'trying it on',
  });
  assert.equal(raised.status, 201);
  // The id came from the token, not the body.
  assert.equal(raised.body.employee_id, employeeId);
});

test('approving is what writes the attendance, and only once', async () => {
  const pending = (await api('GET', '/api/attendance/requests?status=pending')).body.requests;
  const missing = pending.find((r) => r.kind === 'missing_punch' && r.day === 9);
  assert.ok(missing, 'the request should be waiting');

  const decided = await api('POST', `/api/attendance/requests/${missing.id}/decide`, {
    approve: true,
    by: 'Dinesh',
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.status, 'approved');
  assert.equal(decided.body.decided_by, 'Dinesh');

  const grid = (await api('GET', `/api/periods/${periodId}/attendance`)).body;
  const mine = grid.employees.find((e) => e.employee_id === employeeId);
  const day = mine.attendance[9];
  assert.ok(day, 'the approved day is on the grid now');
  assert.equal(day.in_time, '09:30');

  // And it cannot be decided twice.
  const again = await api('POST', `/api/attendance/requests/${missing.id}/decide`, { approve: false });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already approved/);
});

test('rejecting writes nothing beyond the decision', async () => {
  const pending = (await api('GET', '/api/attendance/requests?status=pending')).body.requests;
  const correction = pending.find((r) => r.kind === 'correction');
  assert.ok(correction);

  const before = (await api('GET', `/api/periods/${periodId}/attendance`)).body;
  const decided = await api('POST', `/api/attendance/requests/${correction.id}/decide`, {
    approve: false,
    note: 'He was not in that day',
  });
  assert.equal(decided.body.status, 'rejected');
  assert.equal(decided.body.decision_note, 'He was not in that day');

  const after = (await api('GET', `/api/periods/${periodId}/attendance`)).body;
  assert.deepEqual(after, before, 'a rejection must not touch attendance');
});


