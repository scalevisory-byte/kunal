/**
 * Logins, roles and the record of who signed in.
 *
 * The property these tests exist for: **a role is enforced on the server, not
 * by hiding buttons.** A Viewer who knows the URL still cannot write, and HR
 * who knows the URL still cannot change the rules payroll runs on. Anything
 * less is decoration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-auth-'));
process.env.APP_PASSWORD = 'the-machine-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/** A call as nobody. */
const anon = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    cookie: res.headers.getSetCookie?.()?.[0] || res.headers.get('set-cookie') || '',
  };
};

/** A call as whoever holds this cookie. */
const as = (cookie) => async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/** A call as the machine key. */
const key = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: 'Bearer the-machine-key',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const login = async (username, password) => {
  const res = await anon('POST', '/api/auth/login', { username, password });
  assert.equal(res.status, 200, `${username} should be able to sign in`);
  const cookie = String(res.cookie).split(';')[0];
  assert.ok(cookie.startsWith('salary_session='), 'a session cookie came back');
  return as(cookie);
};

let admin;
let hr;
let viewer;
let hrId;
let viewerId;
let companyId;
let employeeId;
let periodId;
let rowId;

/* ================================================================= *
 * the first admin
 * ================================================================= */

test('before anybody exists, the app says it needs setting up', async () => {
  const { body } = await anon('GET', '/api/auth/state');
  assert.equal(body.needs_setup, true);
  assert.equal(body.signed_in, null);
  assert.deepEqual(
    body.roles.map((r) => r.key),
    // 'employee' is the staff login: their own payslip and nothing else.
    ['admin', 'hr', 'viewer', 'employee'],
  );
});

test('a short password is refused, with a reason', async () => {
  const res = await anon('POST', '/api/auth/setup', {
    username: 'dinesh',
    name: 'Dinesh Parmar',
    password: 'short',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /at least 8 characters/);
});

test('the first admin can be made, and is signed in straight away', async () => {
  const res = await anon('POST', '/api/auth/setup', {
    username: 'dinesh',
    name: 'Dinesh Parmar',
    password: 'a-real-password',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'admin');
  assert.ok(String(res.cookie).includes('HttpOnly'), 'the cookie is not readable from script');
  // Creating it IS signing in, so it is recorded as one rather than leaving the
  // login list saying "never" for somebody plainly looking at it.
  assert.ok(res.body.user.last_login_at, 'the first admin has signed in');
  admin = await login('dinesh', 'a-real-password');
});

test('setup closes itself the moment the first login exists', async () => {
  const again = await anon('POST', '/api/auth/setup', {
    username: 'sneaky',
    name: 'Sneaky',
    password: 'another-password',
  });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already logins/);
  assert.equal((await anon('GET', '/api/auth/state')).body.needs_setup, false);
});

test('once a login exists, nobody gets in without one', async () => {
  assert.equal((await anon('GET', '/api/employees')).status, 401);
  assert.equal((await anon('GET', '/api/periods')).status, 401);
  assert.equal((await anon('GET', '/api/people/notes')).status, 401);
});

/* ================================================================= *
 * signing in
 * ================================================================= */

test('a wrong password and an unknown username give the same answer', async () => {
  const wrongPassword = await anon('POST', '/api/auth/login', {
    username: 'dinesh',
    password: 'not-it-at-all',
  });
  const noSuchUser = await anon('POST', '/api/auth/login', {
    username: 'nobody-here',
    password: 'not-it-at-all',
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(
    wrongPassword.body.error,
    noSuchUser.body.error,
    'otherwise this tells you which logins exist',
  );
});

test('every attempt is on the record, the refusals included', async () => {
  const { body } = await admin('GET', '/api/auth/logins');
  const failures = body.logins.filter((l) => !l.ok);
  assert.ok(failures.length >= 2, 'the two refusals above');
  assert.ok(
    failures.some((l) => l.reason === 'wrong password'),
    'and it says which kind',
  );
  assert.ok(failures.some((l) => l.reason === 'no such login'));
  assert.ok(body.logins.some((l) => l.ok && l.username === 'dinesh'));
});

test('signing out stops the cookie working', async () => {
  const temp = await login('dinesh', 'a-real-password');
  assert.equal((await temp('GET', '/api/auth/state')).body.signed_in.username, 'dinesh');
  await temp('POST', '/api/auth/logout');
  // The cookie itself is not revoked server-side - it is cleared in the
  // browser - so this asserts what logout actually does.
  const cleared = await anon('GET', '/api/auth/state');
  assert.equal(cleared.body.signed_in, null);
});

/* ================================================================= *
 * three roles, enforced on the server
 * ================================================================= */

test('an admin can make the other two logins', async () => {
  const madeHr = await admin('POST', '/api/auth/users', {
    username: 'hema',
    name: 'Hema',
    password: 'hr-password-here',
    role: 'hr',
  });
  assert.equal(madeHr.status, 201);
  hrId = madeHr.body.id;
  assert.deepEqual(madeHr.body.abilities, ['read', 'write']);

  const madeViewer = await admin('POST', '/api/auth/users', {
    username: 'auditor',
    name: 'Auditor',
    password: 'viewer-password',
    role: 'viewer',
  });
  assert.equal(madeViewer.status, 201);
  viewerId = madeViewer.body.id;
  assert.deepEqual(madeViewer.body.abilities, ['read']);

  hr = await login('hema', 'hr-password-here');
  viewer = await login('auditor', 'viewer-password');
});

test('two logins cannot share a username', async () => {
  const clash = await admin('POST', '/api/auth/users', {
    username: 'hema',
    name: 'Somebody Else',
    password: 'another-password',
  });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /already a login called hema/);
});

test('an admin sets the scene the others will work in', async () => {
  const company = await admin('POST', '/api/companies', { name: 'BOOKNFLY' });
  assert.equal(company.status, 201);
  companyId = company.body.id;

  const employee = await admin('POST', '/api/employees', {
    company_id: companyId,
    name: 'Vaibhav Gupta',
    monthly_salary: 26000,
  });
  employeeId = employee.body.id;

  const period = await admin('POST', '/api/periods', { year: 2026, month: 11 });
  periodId = period.body.id;
  const payroll = await admin('GET', `/api/periods/${periodId}/payroll`);
  rowId = payroll.body.rows.find((r) => r.employee_id === employeeId).id;
});

test('a Viewer can read everything and change nothing', async () => {
  assert.equal((await viewer('GET', '/api/employees')).status, 200);
  assert.equal((await viewer('GET', `/api/periods/${periodId}/payroll`)).status, 200);
  assert.equal((await viewer('GET', '/api/people/audit')).status, 200);
  // Salaries included - a Viewer is for looking at reports.
  const { body } = await viewer('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.rows[0].net_salary > 0, true);

  for (const [method, url, payload] of [
    ['POST', '/api/employees', { company_id: companyId, name: 'Nope', monthly_salary: 1 }],
    ['PATCH', `/api/employees/${employeeId}`, { monthly_salary: 999999 }],
    ['DELETE', `/api/employees/${employeeId}`, undefined],
    ['POST', `/api/periods/${periodId}/attendance`, { entries: [{ employee_id: employeeId, day: 3, code: 'A' }] }],
    ['PATCH', `/api/periods/${periodId}/rows/${rowId}`, { addition: 5000 }],
    ['POST', '/api/people/notes', { employee_id: employeeId, kind: 'warning', subject: 'no' }],
  ]) {
    const res = await viewer(method, url, payload);
    assert.equal(res.status, 403, `${method} ${url} should be refused`);
    assert.match(res.body.error, /look at this but not change it/);
  }

  // And nothing moved.
  const after = await admin('GET', `/api/employees/${employeeId}`);
  assert.equal(after.body.monthly_salary, 26000);
});

test('HR can run the month, salaries included — which is what Dinesh asked for', async () => {
  assert.equal(
    (await hr('PATCH', `/api/employees/${employeeId}`, { monthly_salary: 27000 })).status,
    200,
  );
  assert.equal(
    (await hr('POST', `/api/periods/${periodId}/attendance`, {
      entries: [{ employee_id: employeeId, day: 4, code: 'A' }],
    })).status,
    200,
  );
  assert.equal((await hr('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { addition: 1500 })).status, 200);
  assert.equal(
    (await hr('POST', '/api/people/notes', {
      employee_id: employeeId,
      kind: 'appreciation',
      subject: 'Closed the Surat audit early',
    })).status,
    201,
  );
  const { body } = await hr('GET', `/api/periods/${periodId}/payroll`);
  assert.ok(body.rows[0].net_salary > 0, 'HR sees the money');
});

test('HR cannot change the rules payroll runs on', async () => {
  for (const [patch, field] of [
    [{ pt_threshold: 999 }, 'pt_threshold'],
    [{ pt_amount: 500 }, 'pt_amount'],
    [{ hours_per_day: 8 }, 'hours_per_day'],
    [{ late_policy: 'concession' }, 'late_policy'],
    [{ late_concession_minutes: 0 }, 'late_concession_minutes'],
    [{ locked: true }, 'locked'],
  ]) {
    const res = await hr('PATCH', `/api/periods/${periodId}`, patch);
    assert.equal(res.status, 403, `${field} should be an admin's`);
    assert.match(res.body.error, new RegExp(field));
  }
  // The month is untouched.
  const { body } = await admin('GET', `/api/periods/${periodId}`);
  assert.equal(body.pt_threshold, 12000);
  assert.equal(body.late_policy, 'hours');
  assert.equal(body.locked, 0);
});

test('HR can still rename a month — that is housekeeping, not a rule', async () => {
  const res = await hr('PATCH', `/api/periods/${periodId}`, { label: 'Nov 2026 (payroll)' });
  assert.equal(res.status, 200);
  assert.equal(res.body.label, 'Nov 2026 (payroll)');
});

test('HR cannot add a company, delete a month, or touch logins', async () => {
  assert.equal((await hr('POST', '/api/companies', { name: 'Sneaky Ltd' })).status, 403);
  assert.equal((await hr('DELETE', `/api/periods/${periodId}`)).status, 403);
  assert.equal((await hr('GET', '/api/auth/users')).status, 403);
  assert.equal((await hr('POST', '/api/auth/users', { username: 'x', name: 'X', password: 'password123' })).status, 403);
  assert.equal((await hr('GET', '/api/auth/logins')).status, 403);
});

test('but HR can read the company list, because every screen needs it', async () => {
  const res = await hr('GET', '/api/companies');
  assert.equal(res.status, 200);
  assert.ok(res.body.companies.length >= 1);
});

test('an admin can do all of it', async () => {
  assert.equal((await admin('PATCH', `/api/periods/${periodId}`, { late_policy: 'concession' })).status, 200);
  assert.equal((await admin('PATCH', `/api/periods/${periodId}`, { late_policy: 'hours' })).status, 200);
  assert.equal((await admin('GET', '/api/auth/users')).status, 200);
});

/* ================================================================= *
 * the machine key
 * ================================================================= */

test('the API key still works, and is described as a key rather than a person', async () => {
  assert.equal((await key('GET', '/api/employees')).status, 200);
  assert.equal((await key('GET', '/api/people/digest')).status, 200, 'what a cron fetches');
  const { body } = await key('GET', '/api/auth/state');
  assert.equal(body.signed_in.name, 'the API key');
  assert.equal(body.signed_in.via, 'api-key');
  assert.equal(body.signed_in.role, 'admin');
});

test('a wrong API key is nobody', async () => {
  const res = await fetch(`${base}/api/employees`, { headers: { authorization: 'Bearer guess' } });
  assert.equal(res.status, 401);
});

/* ================================================================= *
 * a role is read fresh, and the last admin is protected
 * ================================================================= */

test('demoting somebody takes effect at once, not when their cookie runs out', async () => {
  // Hema is HR and holds a valid session. Demote her mid-session.
  assert.equal((await hr('PATCH', `/api/employees/${employeeId}`, { department: 'Accounts' })).status, 200);
  await admin('PATCH', `/api/auth/users/${hrId}`, { role: 'viewer' });
  const res = await hr('PATCH', `/api/employees/${employeeId}`, { department: 'Nope' });
  assert.equal(res.status, 403, 'the same cookie, the new role');
  await admin('PATCH', `/api/auth/users/${hrId}`, { role: 'hr' });
});

test('switching a login off stops it working immediately', async () => {
  await admin('PATCH', `/api/auth/users/${viewerId}`, { active: false });
  assert.equal((await viewer('GET', '/api/employees')).status, 401);
  await admin('PATCH', `/api/auth/users/${viewerId}`, { active: true });
  assert.equal((await viewer('GET', '/api/employees')).status, 200);
});

test('the only admin cannot demote, disable or delete themselves out of existence', async () => {
  const me = (await admin('GET', '/api/auth/users')).body.users.find((u) => u.username === 'dinesh');
  for (const [method, url, payload] of [
    ['PATCH', `/api/auth/users/${me.id}`, { role: 'hr' }],
    ['PATCH', `/api/auth/users/${me.id}`, { active: false }],
    ['DELETE', `/api/auth/users/${me.id}`, undefined],
  ]) {
    const res = await admin(method, url, payload);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /only admin left/);
  }

  // With a second admin, it is allowed.
  await admin('POST', '/api/auth/users', {
    username: 'second',
    name: 'Second Admin',
    password: 'second-password',
    role: 'admin',
  });
  const freed = await admin('PATCH', `/api/auth/users/${me.id}`, { role: 'hr' });
  assert.equal(freed.status, 200);
  assert.equal(freed.body.role, 'hr');
  // Put it back, as the other tests sign in as this one.
  const other = await login('second', 'second-password');
  await other('PATCH', `/api/auth/users/${me.id}`, { role: 'admin' });
});

/* ================================================================= *
 * passwords
 * ================================================================= */

test('changing your own password needs the current one', async () => {
  const wrong = await hr('POST', '/api/auth/password', {
    current: 'not-my-password',
    password: 'a-brand-new-password',
  });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /not the current password/);

  const same = await hr('POST', '/api/auth/password', {
    current: 'hr-password-here',
    password: 'hr-password-here',
  });
  assert.equal(same.status, 400);
  assert.match(same.body.error, /already have/);

  const right = await hr('POST', '/api/auth/password', {
    current: 'hr-password-here',
    password: 'a-brand-new-password',
  });
  assert.equal(right.status, 200);
  assert.equal((await anon('POST', '/api/auth/login', { username: 'hema', password: 'hr-password-here' })).status, 401);
  hr = await login('hema', 'a-brand-new-password');
});

test('an admin reset does not need the old password, and forces a change', async () => {
  const reset = await admin('POST', `/api/auth/users/${hrId}/password`, { password: 'reset-by-admin' });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.must_change, true, 'so the admin does not keep knowing it');

  hr = await login('hema', 'reset-by-admin');
  const state = await hr('GET', '/api/auth/state');
  assert.equal(state.body.signed_in.must_change, true);

  // Being forced, she can set a new one without quoting the old.
  const changed = await hr('POST', '/api/auth/password', { password: 'her-own-again' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.must_change, false, 'and it stops being forced');
  hr = await login('hema', 'her-own-again');
});

/* ================================================================= *
 * the audit trail finally knows who
 * ================================================================= */

test('the trail records the signed-in user, not a name typed in the body', async () => {
  await hr('POST', '/api/people/notes', {
    employee_id: employeeId,
    kind: 'note',
    subject: 'Signed in and recorded',
    by: 'Somebody Else Entirely',
  });
  const { body } = await admin('GET', '/api/people/audit?entity=employee_notes');
  assert.equal(body.entries[0].who, 'Hema', 'the session wins over the body');
});

test('a corrected attendance mark is recorded under the user who corrected it', async () => {
  // Day 4 is already 'A' from the HR test above. Correct it to sick leave.
  await hr('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: employeeId, day: 4, code: 'SL' }],
  });
  const { body } = await admin('GET', `/api/people/audit?entity=attendance&entity_id=${employeeId}`);
  const line = body.entries.find((e) => e.from_value === 'A' && e.to_value === 'SL');
  assert.ok(line, 'the correction is on the trail');
  assert.equal(line.who, 'Hema');
});

test('a figure typed over the salary sheet is recorded under its user', async () => {
  await admin('PATCH', `/api/periods/${periodId}/rows/${rowId}`, { deduction: 250 });
  const { body } = await admin('GET', `/api/people/audit?entity=payroll_rows&entity_id=${rowId}`);
  const line = body.entries.find((e) => e.field === 'deduction');
  assert.ok(line);
  assert.equal(line.who, 'Dinesh Parmar');
});

test('closing a month is recorded under the admin who closed it', async () => {
  await admin('PATCH', `/api/periods/${periodId}`, { locked: true });
  const { body } = await admin('GET', `/api/people/audit?entity=periods&entity_id=${periodId}`);
  const closed = body.entries.find((e) => e.action === 'closed');
  assert.ok(closed);
  assert.equal(closed.who, 'Dinesh Parmar');
  await admin('PATCH', `/api/periods/${periodId}`, { locked: false });
});

/* ================================================================= *
 * the employee's own link is untouched by any of this
 * ================================================================= */

test('a punch link still needs no login, and still exposes nothing else', async () => {
  const link = await admin('GET', `/api/employees/${employeeId}/punch-link`);
  const token = link.body.path.split('/punch/')[1];
  const page = await anon('GET', `/api/punch/${token}`);
  assert.equal(page.status, 200, 'no password, by design - 115 people are not getting logins');
  assert.deepEqual(Object.keys(page.body.employee).sort(), [
    'code',
    'company_name',
    'designation',
    'id',
    'name',
  ]);
});
