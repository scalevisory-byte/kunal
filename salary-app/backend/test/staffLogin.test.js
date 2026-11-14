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
  // Exposed so the few tests that need a raw fetch - an upload, an <img> - can
  // use the same signed-in session rather than a second one.
  const call = async (method, url, body) => {
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
  call.cookie = () => cookie;
  return call;
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

/*
 * The photograph.
 *
 * Dinesh asked for a photo on the employee master. It is served as a picture
 * rather than as a signed expiring link, because an <img> sits on a page all
 * afternoon and a link that dies in five minutes turns eighty faces into
 * eighty broken images. That makes the door the session, so the door is what
 * these pin.
 */
test('a photograph is served as a picture, and only a photograph', async () => {
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
      '53de0000000c49444154789c636060000000040001273f2a2b0000000049454e44ae426082',
    'hex'
  );
  const form = new FormData();
  form.set('document', new Blob([png], { type: 'image/png' }), 'face.png');
  form.set('kind', 'photo');
  const up = await fetch(`${base}/api/employees/${amit.id}/documents`, {
    method: 'POST',
    headers: { cookie: admin.cookie() },
    body: form,
  });
  assert.equal(up.status, 201);

  const got = await fetch(`${base}/api/employees/${amit.id}/photo`, {
    headers: { cookie: admin.cookie() },
  });
  assert.equal(got.status, 200);
  assert.equal((await got.arrayBuffer()).byteLength, png.length);

  // Riya has no photograph, and "none" is a 404 rather than somebody else's.
  const none = await fetch(`${base}/api/employees/${riya.id}/photo`, {
    headers: { cookie: admin.cookie() },
  });
  assert.equal(none.status, 404);

  // An Aadhaar card uploaded against the same person is NOT reachable here:
  // the kind is pinned in the query, so this route can only ever serve a face.
  const aadhaar = new FormData();
  aadhaar.set('document', new Blob([png], { type: 'image/png' }), 'aadhaar.png');
  aadhaar.set('kind', 'aadhaar');
  await fetch(`${base}/api/employees/${riya.id}/documents`, {
    method: 'POST',
    headers: { cookie: admin.cookie() },
    body: aadhaar,
  });
  const still = await fetch(`${base}/api/employees/${riya.id}/photo`, {
    headers: { cookie: admin.cookie() },
  });
  assert.equal(still.status, 404, 'an Aadhaar card is not a photograph');
});

test('a staff login sees their own face and cannot reach anybody else’s', async () => {
  // The test above switched Amit's login off, so sign in again - which also
  // shows that switching it back on lets them straight back in.
  const list = (await admin('GET', '/api/auth/staff')).body.staff;
  const mineRow = list.find((r) => r.employee_id === amit.id);
  await admin('PATCH', `/api/auth/users/${mineRow.user_id}`, { active: true });
  const again = session();
  assert.equal(
    (await again('POST', '/api/auth/login', {
      username: mineRow.username,
      password: amitsPassword,
    })).status,
    200
  );

  // Their own, through the one door they have.
  const mine = await fetch(`${base}/api/me/photo`, { headers: { cookie: again.cookie() } });
  assert.equal(mine.status, 200);

  // The office route is office-only, like every other office route.
  const theirs = await fetch(`${base}/api/employees/${riya.id}/photo`, {
    headers: { cookie: again.cookie() },
  });
  assert.equal(theirs.status, 403);
  const ownViaOffice = await fetch(`${base}/api/employees/${amit.id}/photo`, {
    headers: { cookie: again.cookie() },
  });
  assert.equal(ownViaOffice.status, 403, 'even their own, through the office door');
});

/* ---------------- a manager, deciding their own team ---------------- */

/*
 * Dinesh: "Leave apply and approval from employee login?" Applying already
 * worked. This is the other half - the person who actually knows whether
 * somebody can be spared deciding it from their own login, instead of
 * forwarding it to HR to type in.
 *
 * Amit is the manager here. Riya is given to him; Kiran deliberately is NOT.
 */

let riyaSession;
let kiranSession;
let riyasRequestId;
let kiransRequestId;

const signInAs = async (employeeId, password) => {
  const list = (await admin('GET', '/api/auth/staff')).body.staff;
  let mine = list.find((s) => s.employee_id === employeeId);
  if (!mine?.user_id) {
    await admin('POST', '/api/auth/staff', { employee_ids: [employeeId] });
    mine = (await admin('GET', '/api/auth/staff')).body.staff.find((s) => s.employee_id === employeeId);
  }
  await admin('POST', `/api/auth/users/${mine.user_id}/password`, { password });
  const s = session();
  await s('POST', '/api/auth/login', { username: mine.username, password });
  // The slip password forces a change before anything else answers.
  await s('POST', '/api/auth/password', { password: `${password}-chosen` });
  return s;
};

test('somebody who manages nobody is offered no team', async () => {
  const who = await staff('GET', '/api/me');
  assert.equal(who.status, 200);
  assert.equal(who.body.manages, 0);

  const team = await staff('GET', '/api/me/team');
  assert.equal(team.status, 200);
  assert.deepEqual(team.body.team, []);
  assert.equal(team.body.waiting, 0);
});

test('two people apply for leave from their own logins', async () => {
  riyaSession = await signInAs(riya.id, 'riyas-own-long-password');
  kiranSession = await signInAs(third.id, 'kirans-own-long-password');

  const r = await riyaSession('POST', '/api/me/requests', {
    period_id: periodId, day: 12, to_day: 13, kind: 'leave', code: 'CL', reason: 'Cousin wedding',
  });
  assert.equal(r.status, 201);
  riyasRequestId = r.body.id;

  const k = await kiranSession('POST', '/api/me/requests', {
    period_id: periodId, day: 14, kind: 'leave', code: 'SL', reason: 'Fever',
  });
  assert.equal(k.status, 201);
  kiransRequestId = k.body.id;
});

test('give Amit one report, and the team appears — names only, never pay', async () => {
  const moved = await admin('PATCH', `/api/employees/${riya.id}`, { reports_to_id: amit.id });
  assert.equal(moved.status, 200);

  const who = await staff('GET', '/api/me');
  assert.equal(who.body.manages, 1);

  const team = await staff('GET', '/api/me/team');
  assert.equal(team.body.team.length, 1);
  assert.equal(team.body.team[0].name, 'Riya Pal');
  assert.equal(team.body.waiting, 1);

  /*
   * The whole security claim of this feature: a manager gains names, not
   * records. Riya earns 48,000 and the string must not be anywhere in what
   * her manager is sent.
   */
  const sent = JSON.stringify(team.body);
  for (const secret of ['48000', 'monthly_salary', 'pan', 'bank_account', 'ifsc']) {
    assert.ok(!sent.includes(secret), `${secret} reached a manager`);
  }

  // And the queue is only their own team's.
  const queue = await staff('GET', '/api/me/team/requests');
  assert.equal(queue.body.requests.length, 1);
  assert.equal(queue.body.requests[0].employee_name, 'Riya Pal');
});

test('a manager cannot decide for somebody who does not report to them', async () => {
  const notMine = await staff('POST', `/api/me/team/requests/${kiransRequestId}/decide`, {
    approve: true,
  });
  assert.equal(notMine.status, 403);
  assert.match(notMine.body.error, /do not report to you/);

  // ...and it really was not decided.
  const still = (await admin('GET', '/api/attendance/requests')).body.requests
    .find((r) => r.id === kiransRequestId);
  assert.equal(still.status, 'pending');
});

test('a manager cannot approve their own time off', async () => {
  const own = await staff('POST', '/api/me/requests', {
    period_id: periodId, day: 20, kind: 'leave', code: 'CL', reason: 'My own day',
  });
  assert.equal(own.status, 201);

  const self = await staff('POST', `/api/me/team/requests/${own.body.id}/decide`, { approve: true });
  assert.equal(self.status, 403);
  assert.match(self.body.error, /your own request/);
});

test('somebody who manages nobody cannot decide anything', async () => {
  const nope = await kiranSession('POST', `/api/me/team/requests/${riyasRequestId}/decide`, {
    approve: true,
  });
  assert.equal(nope.status, 403);
});

test('a manager only RECOMMENDS — the grid is untouched until the office confirms', async () => {
  /*
   * Dinesh: "manager approve kare phir hr confirm kare".
   *
   * This test used to assert the opposite - that a manager's approval landed
   * on the grid - and it is rewritten rather than patched, because the rule
   * it states has changed, not the way it is checked.
   */
  const before = (await admin('GET', `/api/periods/${periodId}/attendance`)).body;
  const hers = before.employees.find((e) => e.employee_id === riya.id);
  assert.notEqual(hers.attendance[12]?.code, 'CL', 'already written before any decision');

  const backed = await staff('POST', `/api/me/team/requests/${riyasRequestId}/decide`, {
    approve: true,
  });
  assert.equal(backed.status, 200);
  assert.equal(backed.body.status, 'recommended');
  assert.equal(backed.body.recommended_by, 'Amit Shah');
  assert.ok(backed.body.recommended_at, 'no time on the recommendation');
  // Not decided. That word is reserved for the call that moves money.
  assert.equal(backed.body.decided_by, null);

  // THE POINT: nothing reached the grid.
  const mid = (await admin('GET', `/api/periods/${periodId}/attendance`)).body;
  const still = mid.employees.find((e) => e.employee_id === riya.id);
  for (const day of [12, 13]) {
    assert.notEqual(still.attendance[day]?.code, 'CL', `day ${day} was written by a manager`);
  }

  // A manager recommends once; sending it round again would overwrite what
  // the office was asked to confirm.
  const again = await staff('POST', `/api/me/team/requests/${riyasRequestId}/decide`, {
    approve: true,
  });
  // 400, not 403: it IS their team's request - it has simply moved on. 403 is
  // reserved for "that is not yours to decide", which is a different answer.
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already sent this to the office/);

  // It is still on the manager's own list, under what they have sent on.
  const team = await staff('GET', '/api/me/team');
  assert.equal(team.body.waiting, 0, 'it is no longer waiting on the manager');
  assert.equal(team.body.sent_on, 1);
});

test('the office confirms it, and THEN it lands — with both names on the row', async () => {
  // It is still on the office's list: a manager backing something hands it
  // over, it does not settle it.
  const open = (await admin('GET', '/api/attendance/requests?status=recommended')).body.requests;
  assert.ok(open.some((r) => r.id === riyasRequestId), 'the office lost sight of it');

  const done = await admin('POST', `/api/attendance/requests/${riyasRequestId}/decide`, {
    approve: true, by: 'Dinesh',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'approved');
  assert.equal(done.body.decided_by, 'Dinesh');
  // Who backed it is kept beside who confirmed it - one row, two people.
  assert.equal(done.body.recommended_by, 'Amit Shah');
  assert.match(done.body.decision_note, /recommended by Amit Shah/);

  const after = (await admin('GET', `/api/periods/${periodId}/attendance`)).body;
  const now = after.employees.find((e) => e.employee_id === riya.id);
  for (const day of [12, 13]) assert.equal(now.attendance[day]?.code, 'CL', `day ${day}`);
  assert.equal(now.attendance[12]?.approved, true);

  // And it cannot be decided twice, from either side.
  const twice = await admin('POST', `/api/attendance/requests/${riyasRequestId}/decide`, {
    approve: false,
  });
  assert.equal(twice.status, 400);
  assert.match(twice.body.error, /already approved/);
});

test('a manager REJECTING ends it — a refusal needs no second opinion', async () => {
  const asked = await riyaSession('POST', '/api/me/requests', {
    period_id: periodId, day: 27, kind: 'leave', code: 'CL', reason: 'A day out',
  });
  assert.equal(asked.status, 201);

  const no = await staff('POST', `/api/me/team/requests/${asked.body.id}/decide`, {
    approve: false,
  });
  assert.equal(no.status, 200);
  assert.equal(no.body.status, 'rejected', 'a refusal was left for the office to confirm');
  assert.equal(no.body.decided_by, 'Amit Shah');

  // Nothing written either way.
  const grid = (await admin('GET', `/api/periods/${periodId}/attendance`)).body;
  const hers = grid.employees.find((e) => e.employee_id === riya.id);
  assert.notEqual(hers.attendance[27]?.code, 'CL');
});

test('HR can still finish a request outright, for somebody with no manager', async () => {
  /*
   * Kiran reports to nobody, so no recommendation could ever come. The middle
   * step constrains the MANAGER, not the office - otherwise their leave would
   * wait for ever on a step that cannot happen.
   */
  const asked = await kiranSession('POST', '/api/me/requests', {
    period_id: periodId, day: 28, kind: 'leave', code: 'CL', reason: 'Nobody to ask',
  });
  assert.equal(asked.status, 201);
  assert.equal(asked.body.status, 'pending');

  const done = await admin('POST', `/api/attendance/requests/${asked.body.id}/decide`, {
    approve: true, by: 'Dinesh',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'approved');
  assert.equal(done.body.recommended_by, null);

  const grid = (await admin('GET', `/api/periods/${periodId}/attendance`)).body;
  const his = grid.employees.find((e) => e.employee_id === third.id);
  assert.equal(his.attendance[28]?.code, 'CL');
});

test('an employee can take back something their manager has already backed', async () => {
  const asked = await riyaSession('POST', '/api/me/requests', {
    period_id: periodId, day: 29, kind: 'leave', code: 'CL', reason: 'Might not need it',
  });
  await staff('POST', `/api/me/team/requests/${asked.body.id}/decide`, { approve: true });

  const gone = await riyaSession('DELETE', `/api/me/requests/${asked.body.id}`);
  assert.equal(gone.status, 200);
  assert.equal(gone.body.status, 'withdrawn');

  // ...but not once the office has acted on it.
  const settled = await riyaSession('DELETE', `/api/me/requests/${riyasRequestId}`);
  assert.equal(settled.status, 400);
});

test('HR still sees and can decide everything, manager or no manager', async () => {
  const all = (await admin('GET', '/api/attendance/requests')).body.requests;
  assert.ok(all.some((r) => r.id === kiransRequestId), 'the office lost sight of a request');
  assert.ok(all.some((r) => r.id === riyasRequestId));

  const byOffice = await admin('POST', `/api/attendance/requests/${kiransRequestId}/decide`, {
    approve: true, by: 'Dinesh',
  });
  assert.equal(byOffice.status, 200);
  assert.equal(byOffice.body.decided_by, 'Dinesh');
});
