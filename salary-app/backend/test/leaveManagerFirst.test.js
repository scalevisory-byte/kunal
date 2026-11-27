/**
 * Leave: the reporting manager first, then the office - and the balance in
 * front of everybody who has to decide.
 *
 * Dinesh: "leave ke liye pehle reporting manager leave approve karega after
 * that hr approve karega to hi leave milega", "leave approve karte waqt leave
 * balance dikhe", "7 days se jyada ek sath leave nahi le sakte", and that a
 * new application was not reaching the manager or HR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MANAGER_FIRST_KINDS, MAX_LEAVE_DAYS, balanceLine, validateRequest } from '../../shared/attendanceRequests.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-first-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function session() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

/* ------------------------------ the rules ------------------------------ */

test('leave is applied for seven days at a time at most', () => {
  assert.equal(MAX_LEAVE_DAYS, 7);
  const ask = (day, to_day) => validateRequest({ kind: 'leave', code: 'CL', period_id: 1, day, to_day, reason: 'x' });
  assert.equal(ask(3, 9).ok, true, 'seven days is allowed');
  const eight = ask(3, 10);
  assert.equal(eight.ok, false);
  assert.match(eight.problems.join(' '), /7 days at a time at most — this is 8/);
  // Working from home for a fortnight is a fortnight WORKED, not leave.
  assert.equal(validateRequest({ kind: 'remote', period_id: 1, day: 1, to_day: 14, reason: 'x' }).ok, true);
});

test('only time off waits for the manager', () => {
  assert.deepEqual([...MANAGER_FIRST_KINDS].sort(), ['leave', 'short_leave']);
});

test('the balance is said in one sentence, and "more than they have" is said too', () => {
  assert.equal(balanceLine(null), null);
  const fine = balanceLine({ label: 'Casual Leave', paid: true, left: 5, taking: 3, after: 2 });
  assert.equal(fine.over, false);
  assert.match(fine.text, /5 days left · this takes 3 · 2 days after/);
  const over = balanceLine({ label: 'Casual Leave', paid: true, left: 2, taking: 3, after: -1 });
  assert.equal(over.over, true);
  assert.match(over.text, /1 day more than they have/);
  // Unpaid leave has no balance: a nought there would read as "none left".
  const unpaid = balanceLine({ label: 'Unpaid Leave', paid: false, left: null, taking: 2, after: null });
  assert.match(unpaid.text, /no balance to run down/);
});

/* --------------------------- through the server --------------------------- */

const admin = session();
const boss = session();
const amitS = session();
let alpesh;
let amit;
let kiran;
let periodId;
const requests = {};

test('an office, a manager with a login, his report, and somebody who reports to nobody', async () => {
  assert.equal((await admin('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' })).status, 201);
  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const make = (body) => admin('POST', '/api/employees', { company_id: company.id, monthly_salary: 26000, joined_on: '2024-01-01', ...body });
  alpesh = (await make({ name: 'Alpesh Shah' })).body;
  amit = (await make({ name: 'Amit Shah', reports_to_id: alpesh.id, cl_quota: 5 })).body;
  kiran = (await make({ name: 'Kiran Desai', cl_quota: 7 })).body;
  periodId = (await admin('POST', '/api/periods', { year: 2026, month: 11 })).body.id;
  await admin('GET', `/api/periods/${periodId}/payroll`);

  const made = (await admin('POST', '/api/auth/staff', { employee_ids: [alpesh.id, amit.id] })).body.made;
  for (const [who, slip] of [[boss, made.find((m) => m.employee_id === alpesh.id) || made[0]], [amitS, made.find((m) => m.employee_id === amit.id) || made[1]]]) {
    assert.equal((await who('POST', '/api/auth/login', { username: slip.username, password: slip.password })).status, 200);
    assert.equal((await who('POST', '/api/auth/password', { password: `${slip.username}-own-password` })).status, 200);
  }
  assert.equal((await boss('GET', '/api/me')).body.manages, 1);
});

test('eight days of leave in one go is refused at the door', async () => {
  const res = await amitS('POST', '/api/me/requests', { kind: 'leave', code: 'CL', period_id: periodId, day: 2, to_day: 9, reason: 'Trip' });
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /7 days at a time/);
});

test('the employee applies; they, their manager and the office are all told, with the balance', async () => {
  const res = await amitS('POST', '/api/me/requests', { kind: 'leave', code: 'CL', period_id: periodId, day: 16, to_day: 18, reason: 'Family function' });
  assert.equal(res.status, 201);
  requests.amit = res.body.id;

  // The employee sees WHO it is waiting on, and their own balance.
  const mine = (await amitS('GET', '/api/me/requests')).body.requests.find((r) => r.id === requests.amit);
  assert.equal(mine.needs_manager, true);
  assert.equal(mine.manager_name, 'Alpesh Shah');
  const myLeave = (await amitS('GET', '/api/me/leave?year=2026')).body;
  assert.equal(myLeave.balance.types.find((t) => t.code === 'CL').left, 5);
  assert.equal(myLeave.balance.types.find((t) => t.code === 'UL').left, null, 'unpaid leave has no balance');

  // The manager is told on every page, not only when the tab is opened.
  assert.equal((await boss('GET', '/api/me')).body.team_waiting, 1);
  const team = (await boss('GET', '/api/me/team')).body;
  assert.equal(team.waiting, 1);
  assert.equal(team.team[0].leave.types.find((t) => t.code === 'CL').left, 5, 'the manager sees their report’s balance');
  for (const secret of ['monthly_salary', 'salary', 'pan', 'bank_account']) {
    assert.ok(!(secret in team.team[0]), `the team list still carries no ${secret}`);
  }
  const ask = (await boss('GET', '/api/me/team/requests')).body.requests.find((r) => r.id === requests.amit);
  assert.deepEqual(
    { left: ask.leave_balance.left, taking: ask.leave_balance.taking, after: ask.leave_balance.after },
    { left: 5, taking: 3, after: 2 }
  );

  // The office's count is there too, and says it is still the manager's move.
  assert.deepEqual((await admin('GET', '/api/attendance/requests/waiting')).body, { office: 0, with_manager: 1 });
  const office = (await admin('GET', '/api/attendance/requests')).body.requests.find((r) => r.id === requests.amit);
  assert.equal(office.needs_manager, true);
  assert.equal(office.leave_balance.left, 5, 'HR sees the balance beside the button');
});

test('the office cannot grant it before the manager has - but may still refuse', async () => {
  const early = await admin('POST', `/api/attendance/requests/${requests.amit}/decide`, { approve: true, by: 'HR' });
  assert.equal(early.status, 400);
  assert.match(early.body.error, /Alpesh Shah has to approve this first/);
  const grid = (await admin('GET', `/api/periods/${periodId}/attendance`)).body.employees.find((e) => e.employee_id === amit.id);
  assert.ok(!grid.attendance[16], 'nothing reached the grid');
});

test('manager backs it, then the office confirms it, and only then is it leave', async () => {
  const backed = await boss('POST', `/api/me/team/requests/${requests.amit}/decide`, { approve: true });
  assert.equal(backed.status, 200);
  assert.equal(backed.body.status, 'recommended');
  assert.equal((await boss('GET', '/api/me')).body.team_waiting, 0, 'no longer waiting on the manager');
  assert.deepEqual((await admin('GET', '/api/attendance/requests/waiting')).body, { office: 1, with_manager: 0 });

  const done = await admin('POST', `/api/attendance/requests/${requests.amit}/decide`, { approve: true, by: 'HR' });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'approved');
  const grid = (await admin('GET', `/api/periods/${periodId}/attendance`)).body.employees.find((e) => e.employee_id === amit.id);
  assert.deepEqual([16, 17, 18].map((d) => grid.attendance[d].code), ['CL', 'CL', 'CL']);

  // Taken now, so the balance has moved - once, not twice.
  const after = (await admin('GET', '/api/attendance/requests')).body.requests.find((r) => r.id === requests.amit);
  assert.equal(after.leave_balance.left, 2);
  assert.equal(after.leave_balance.after, 2, 'an approved leave is already inside "taken"');
  assert.equal((await amitS('GET', '/api/me/leave?year=2026')).body.balance.types.find((t) => t.code === 'CL').left, 2);
});

test('nobody is left waiting on a manager who cannot act', async () => {
  // Kiran reports to nobody: the office decides, as it always did.
  const raised = await admin('POST', '/api/attendance/requests', {
    employee_id: kiran.id, period_id: periodId, day: 20, kind: 'leave', code: 'CL', reason: 'Asked on the phone',
  });
  assert.equal(raised.status, 201);
  const row = (await admin('GET', '/api/attendance/requests')).body.requests.find((r) => r.id === raised.body.id);
  assert.equal(row.needs_manager, false);
  assert.equal((await admin('POST', `/api/attendance/requests/${raised.body.id}/decide`, { approve: true, by: 'HR' })).status, 200);

  // A manager with no login cannot press anything, so the office is not blocked - and is told why.
  const set = await admin('PATCH', `/api/employees/${alpesh.id}`, { reports_to_id: kiran.id });
  assert.equal(set.status, 200);
  const forBoss = await admin('POST', '/api/attendance/requests', {
    employee_id: alpesh.id, period_id: periodId, day: 24, kind: 'leave', code: 'CL', reason: 'Half the team is away',
  });
  const seen = (await admin('GET', '/api/attendance/requests')).body.requests.find((r) => r.id === forBoss.body.id);
  assert.equal(seen.manager_name, 'Kiran Desai');
  assert.equal(seen.needs_manager, false, 'Kiran has no login');
  assert.equal(seen.manager_cannot_act, true);
  assert.equal((await admin('POST', `/api/attendance/requests/${forBoss.body.id}/decide`, { approve: true, by: 'HR' })).status, 200);
});

test('a correction is not time off, and has never needed a manager', async () => {
  const fix = await amitS('POST', '/api/me/requests', { kind: 'missing_punch', period_id: periodId, day: 5, in_time: '09:30', out_time: '18:30', reason: 'Machine was down' });
  assert.equal(fix.status, 201);
  assert.equal((await admin('POST', `/api/attendance/requests/${fix.body.id}/decide`, { approve: true, by: 'HR' })).status, 200);
});

test('the screens show it where the decision is taken', () => {
  const read = (f) => fs.readFileSync(new URL(`../../frontend/src/${f}`, import.meta.url), 'utf8');
  const queue = read('components/AttendanceRequests.jsx');
  assert.match(queue, /balanceLine\(r\.leave_balance\)/, 'the office queue');
  assert.match(queue, /r\.needs_manager \?/, 'and no Approve while it is the manager’s move');
  const portal = read('components/MyPage.jsx');
  assert.match(portal, /balanceLine\(r\.leave_balance\)/, 'the manager’s page');
  assert.match(portal, /className="team-waiting"/, 'a manager is told on every page');
  assert.match(read('App.jsx'), /\/attendance\/requests\/waiting/, 'the office count is in the header, on every tab');
  const css = read('styles.css');
  for (const cls of ['who-waiting', 'team-waiting']) assert.ok(css.includes(`.${cls}`), `.${cls} has a rule`);
  assert.match(read('components/Reports.jsx'), /'leave-balance': \(\) => \(/, 'the leave balance report is a screen now');
});
