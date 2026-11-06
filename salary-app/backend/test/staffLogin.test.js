import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/** A signed-in browser: cookies carried by hand, as the real one does. */
function session() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const admin = session();
let amit;
let riya;
let third;
let periodId;

test('set the scene: an office, two people, one month run', async () => {
  const setup = await admin('POST', '/api/auth/setup', {
    username: 'dinesh',
    name: 'Dinesh Parmar',
    password: 'a-long-enough-password',
  });
  assert.equal(setup.status, 201);

  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  amit = (await admin('POST', '/api/employees', {
    company_id: company.id, name: 'Amit Shah', monthly_salary: 26000,
    joined_on: '2024-04-01', cl_quota: 7, bank_account: '1234', ifsc: 'HDFC0001',
  })).body;
  riya = (await admin('POST', '/api/employees', {
    company_id: company.id, name: 'Riya Pal', monthly_salary: 48000, joined_on: '2023-01-01',
  })).body;

  // A third person, so the first-sign-in path can be walked on a login that
  // has genuinely never been used.
  third = (await admin('POST', '/api/employees', {
    company_id: company.id, name: 'Kiran Desai', monthly_salary: 21000, joined_on: '2025-06-01',
  })).body;

  const period = (await admin('POST', '/api/periods', { year: 2026, month: 10 })).body;
  periodId = period.id;
  await admin('GET', `/api/periods/${periodId}/payroll`);
});

test('an admin makes staff logins, and the password is said once', async () => {
  const before = await admin('GET', '/api/auth/staff');
  assert.equal(before.status, 200);
  assert.equal(before.body.staff.length, 3);
  assert.equal(before.body.staff.every((s) => !s.has_login), true);

  const made = await admin('POST', '/api/auth/staff', { employee_ids: [amit.id, riya.id] });
  assert.equal(made.status, 201);
  assert.equal(made.body.made.length, 2);
  // Sayable, because it gets read out over a counter.
  assert.match(made.body.made[0].password, /^[a-z]+-[a-z]+-\d{3}$/);
  assert.match(made.body.made[0].username, /^[a-z.]+\d*$/);

  // Twice is refused rather than making a second login for one person.
  const again = await admin('POST', '/api/auth/staff', { employee_ids: [amit.id] });
  assert.equal(again.body.made.length, 0);
  assert.match(again.body.refused[0].error, /already have a login/);

  const after = await admin('GET', '/api/auth/staff');
  const withOne = after.body.staff.filter((s) => s.has_login);
  assert.equal(withOne.length, 2);
  // It is temporary by construction.
  assert.equal(withOne.every((s) => s.must_change), true);
  // And Kiran is still listed as somebody who has none.
  assert.equal(after.body.staff.find((s) => s.name === 'Kiran Desai').has_login, false);
});

/* ---------------- the point of the whole exercise ---------------- */

let staff;
let amitsPassword;

test('a staff login signs in, and is told to change its password', async () => {
  const made = await admin('POST', '/api/auth/staff', { employee_ids: [] });
  assert.equal(made.status, 400);

  const list = (await admin('GET', '/api/auth/staff')).body.staff;
  const mine = list.find((s) => s.employee_id === amit.id);

  // Reset it so this test knows the password - the same route an admin uses
  // when somebody forgets theirs.
  amitsPassword = 'amits-own-long-password';
  const reset = await admin('POST', `/api/auth/users/${mine.user_id}/password`, {
    password: amitsPassword,
  });
  assert.equal(reset.status, 200);

  staff = session();
  const inn = await staff('POST', '/api/auth/login', {
    username: mine.username,
    password: amitsPassword,
  });
  assert.equal(inn.status, 200);
  assert.equal(inn.body.user.role, 'employee');
  assert.equal(inn.body.user.employee_id, amit.id);
  // No `read`: that is the whole design.
  assert.deepEqual(inn.body.user.abilities, ['self']);
});

/*
 * The handed-over password is temporary for real.
 *
 * `must_change` used to be written, shown on the admin list, and acted on
 * nowhere: the password read out over a counter kept working for ever while
 * the screen that handed it over promised it would not. The flag is the whole
 * mechanism, so it is pinned here on the server and the app stands a
 * change-password screen in front of everything while it is set.
 */
test('the password on the slip has to be replaced, and then stops working', async () => {
  const slip = (await admin('POST', '/api/auth/staff', { employee_ids: [third.id] })).body.made[0];

  const first = session();
  const inn = await first('POST', '/api/auth/login', {
    username: slip.username,
    password: slip.password,
  });
  assert.equal(inn.status, 200);
  // What the app reads to decide whether to stand in front of the rest of it.
  assert.equal((await first('GET', '/api/auth/state')).body.signed_in.must_change, true);

  // The same one again is not a change.
  const same = await first('POST', '/api/auth/password', { password: slip.password });
  assert.equal(same.status, 400);
  assert.match(same.body.error, /already have/);

  // No `current` is asked for: the one being replaced is the one on the slip.
  const changed = await first('POST', '/api/auth/password', { password: 'kirans-own-password' });
  assert.equal(changed.status, 200);
  assert.equal((await first('GET', '/api/auth/state')).body.signed_in.must_change, false);

  const old = await session()('POST', '/api/auth/login', {
    username: slip.username,
    password: slip.password,
  });
  assert.equal(old.status, 401);

  const now = session();
  assert.equal(
    (await now('POST', '/api/auth/login', { username: slip.username, password: 'kirans-own-password' })).status,
    200
  );
  // And changing it voluntarily DOES need the current one.
  assert.equal((await now('POST', '/api/auth/password', { password: 'another-one-again' })).status, 400);
  assert.equal(
    (await now('POST', '/api/auth/password', {
      current: 'kirans-own-password',
      password: 'another-one-again',
    })).status,
    200
  );
});

test('a staff login cannot read ANY of the office side', async () => {
  for (const url of [
    '/api/employees',
    `/api/periods/${periodId}/payroll`,
    '/api/people/assets',
    '/api/hiring/vacancies',
    '/api/leave?year=2026',
    '/api/loans',
    '/api/people/audit',
    '/api/companies',
  ]) {
    const res = await staff('GET', url);
    assert.equal(res.status, 403, `${url} answered a staff login with ${res.status}`);
  }
  // And cannot write anything either.
  const write = await staff('POST', '/api/employees', { name: 'Ghost', company_id: 1 });
  assert.equal(write.status, 403);
  // Nor make themselves an admin.
  const promote = await staff('GET', '/api/auth/staff');
  assert.equal(promote.status, 403);
});

test('they see their own payslip, and how it was worked out', async () => {
  const me = await staff('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.employee.name, 'Amit Shah');
  assert.equal(me.body.employee.monthly_salary, 26000);

  const months = await staff('GET', '/api/me/months');
  assert.equal(months.body.months.length, 1);
  assert.equal(months.body.months[0].period_id, periodId);

  const one = await staff('GET', `/api/me/months/${periodId}`);
  assert.equal(one.status, 200);
  // The whole row, because "how was this worked out" is the question.
  assert.equal(one.body.row.employee_id, amit.id);
  assert.ok(one.body.row.per_day > 0, 'the day rate it was paid on');
  assert.ok('gross_salary' in one.body.row && 'net_salary' in one.body.row);
  assert.ok('pt' in one.body.row && 'pf' in one.body.row);
  // And nobody else's row rides along with it.
  assert.equal(one.body.rows, undefined);
  assert.equal(JSON.stringify(one.body).includes('Riya Pal'), false);
});

test('they cannot read somebody ELSE through the staff door', async () => {
  // Riya's months are simply not theirs to see: the id comes from the login,
  // so there is no parameter to tamper with - and the office route is shut.
  const hers = await staff('GET', '/api/me/months');
  assert.equal(hers.body.months.every((m) => m.period_id === periodId), true);

  const one = await staff('GET', `/api/me/months/${periodId}`);
  assert.equal(one.body.row.employee_id, amit.id, 'their own row, never a chosen one');

  // Somebody else's ticket reads as missing, which is also what it is from
  // where they are standing.
  const theirs = await admin('POST', '/api/people/tickets', {
    employee_id: riya.id, category: 'Salary', subject: 'Riya’s private question',
  });
  const peek = await staff('GET', `/api/me/tickets/${theirs.body.id}`);
  assert.equal(peek.status, 404);
});

test('they can apply for leave, and it writes nothing until it is approved', async () => {
  const raised = await staff('POST', '/api/me/requests', {
    period_id: periodId,
    day: 12,
    to_day: 14,
    kind: 'leave',
    code: 'CL',
    reason: 'Family function in Surat',
  });
  assert.equal(raised.status, 201);
  assert.equal(raised.body.employee_id, amit.id, 'raised as themselves, from the login');
  assert.equal(raised.body.status, 'pending');

  // The grid is untouched until somebody decides.
  const grid = (await admin('GET', `/api/periods/${periodId}/payroll`)).body;
  const row = grid.rows.find((r) => r.employee_id === amit.id);
  assert.equal(row.attendance?.[12], undefined, 'a request writes nothing');

  const mine = await staff('GET', '/api/me/requests');
  assert.equal(mine.body.requests.length, 1);
});

test('a request cannot be raised in somebody else’s name', async () => {
  const sneaky = await staff('POST', '/api/me/requests', {
    employee_id: riya.id, // ignored: the id comes from the login
    period_id: periodId,
    day: 20,
    kind: 'leave',
    code: 'CL',
    reason: 'Not mine to take',
  });
  assert.equal(sneaky.status, 201);
  assert.equal(sneaky.body.employee_id, amit.id, 'the body does not get to say whose it is');
});

test('they can fix their own bank details, and it lands on the history', async () => {
  const changed = await staff('PATCH', '/api/me', {
    bank_account: '99887766',
    ifsc: 'ICIC0004',
    phone: '9825011223',
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.employee.bank_account, '99887766');

  // A salary is not theirs to change.
  const nope = await staff('PATCH', '/api/me', { monthly_salary: 99000 });
  assert.equal(nope.status, 400);
  assert.match(nope.body.error, /office’s to change/);
  const still = await staff('GET', '/api/me');
  assert.equal(still.body.employee.monthly_salary, 26000);

  // The office can see who changed it.
  const record = (await admin('GET', `/api/employees/${amit.id}/record`)).body;
  const bank = record.history.find((h) => h.field === 'bank_account');
  assert.ok(bank, 'a bank account changing before payday has to be visible');
});

test('leave, attendance and the year all answer for them alone', async () => {
  const leave = await staff('GET', '/api/me/leave?year=2026');
  assert.equal(leave.status, 200);
  assert.equal(leave.body.quotas.CL, 7);

  const att = await staff('GET', `/api/me/attendance/${periodId}`);
  assert.equal(att.status, 200);
  assert.ok('attendance' in att.body);
  /*
   * The days the month pays for, under the name the reports use.
   *
   * `calculateRow` calls it `present_days`; the reports rename it to
   * `payable_days` afterwards. Reading the report's name off the raw row gave
   * undefined, which the screen rendered as a dash - a figure that looked
   * missing rather than wrong, on the one page whose whole job is explaining
   * the pay. It is pinned as a NUMBER, so a rename cannot quietly return
   * nothing again.
   */
  assert.equal(typeof att.body.payable_days, 'number');
  const row = (await staff('GET', `/api/me/months/${periodId}`)).body.row;
  assert.equal(att.body.payable_days, row.present_days);

  const report = await staff('GET', '/api/me/report?year=2026');
  assert.equal(report.status, 200);
  assert.equal(report.body.employee.name, 'Amit Shah');
});

test('an office login with no employee row is told so, not shown a blank', async () => {
  const res = await admin('GET', '/api/me');
  assert.equal(res.status, 403);
  assert.match(res.body.error, /not tied to an employee/);
});

test('switching a staff login off stops it at once', async () => {
  const list = (await admin('GET', '/api/auth/staff')).body.staff;
  const mine = list.find((s) => s.employee_id === amit.id);
  await admin('PATCH', `/api/auth/users/${mine.user_id}`, { active: false });
  const after = await staff('GET', '/api/me');
  assert.equal(after.status, 401, 'the role is read fresh on every request');
});
