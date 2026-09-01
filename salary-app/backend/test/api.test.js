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
