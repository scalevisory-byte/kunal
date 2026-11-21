/**
 * THREE MORE ROLES, AND THE TWO ABILITIES BEHIND THEM.
 *
 * Dinesh, with three of his people all Admin: *"or bhi roll banavo"*. The
 * reason they were all Admin is that `admin` was the only thing that could
 * APPROVE — a month's payroll, an offer — so anybody who had to approve
 * anything was handed the Logins screen with it.
 *
 *   `approve`  approve and lock a month, approve or withdraw an offer.
 *              NOT administration: no logins, no branches, no month settings,
 *              and a month still cannot be deleted.
 *   `destroy`  delete, archive, retire, clear. Split out so a data-entry
 *              login can fill the day in and still not empty it.
 *
 * Manager = HR + approve. Operator = HR − destroy. Accounts = HR with two
 * module ticks to start with, because "Accounts" is not a different KIND of
 * action — it is a different set of modules, and the ticks are the truth.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/* users.js is imported AFTER DATA_DIR is set, below: a static import here
   opens the real database and the first-admin call then finds logins in it. */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'more-roles-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;
delete process.env.ALLOW_OPEN;

const { createServer } = await import('../src/server.js');
const users = await import('../src/users.js');
const db = await import('../src/db.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (cookie, method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const signIn = async (username, password) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `could not sign in as ${username}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
};

const boss = users.createFirstAdmin({ name: 'Dinesh', username: 'dinesh', password: 'first-pass-123' });
const company = db.createCompany({ name: 'BOOKNFLY PVT LTD' });
const amit = db.createEmployee({ company_id: company.id, name: 'Amit Shah', monthly_salary: 26000 });
const month = db.createPeriod({ year: 2026, month: 10 });
db.syncPayrollRows(month.id);

const made = {};
for (const [role, name] of [['manager', 'Krishna'], ['operator', 'Nidhi'], ['accounts', 'Hema'], ['hr', 'Riya']]) {
  made[role] = users.createUser({ name, username: `${role}.login`, role, password: `${role}-pass-123` });
}
db.db.prepare(`UPDATE users SET must_change = 0`).run();

const adminCookie = await signIn('dinesh', 'first-pass-123');
const manager = await signIn('manager.login', 'manager-pass-123');
const operator = await signIn('operator.login', 'operator-pass-123');
const hr = await signIn('hr.login', 'hr-pass-123');

test('A MANAGER APPROVES A MONTH; HR CANNOT', async () => {
  const no = await call(hr, 'POST', `/api/periods/${month.id}/approve`, { note: 'checked' });
  assert.equal(no.status, 403);
  assert.match(no.body.error, /Manager or an Admin/);

  const yes = await call(manager, 'POST', `/api/periods/${month.id}/approve`, { note: 'checked' });
  assert.equal(yes.status, 200);
});

test('...and an Admin still can, because admin covers approving', async () => {
  const back = await call(adminCookie, 'DELETE', `/api/periods/${month.id}/approve`, { reason: 'one more look' });
  assert.equal(back.status, 200, 'unapproved before anything was locked');

  // Approve it again, then lock it - locking needs an approval first.
  assert.equal((await call(manager, 'POST', `/api/periods/${month.id}/approve`, {})).status, 200);
  assert.equal((await call(manager, 'POST', `/api/periods/${month.id}/lock`, {})).status, 200);
});

test('A MANAGER IS NOT AN ADMIN: no logins, no companies, no deleting a month', async () => {
  assert.equal((await call(manager, 'GET', '/api/auth/users')).status, 403);
  assert.equal((await call(manager, 'POST', '/api/companies', { name: 'NEW CO' })).status, 403);
  assert.equal((await call(manager, 'DELETE', `/api/periods/${month.id}`)).status, 403);
});

test('AN OPERATOR FILLS THINGS IN AND CANNOT TAKE THEM AWAY', async () => {
  // Writing is theirs.
  const wrote = await call(operator, 'POST', '/api/front-office/visitors', {
    day: '2026-11-21', name: 'Rakesh Shah', mobile: '9825011111', purpose: 'Delivery',
  });
  assert.equal(wrote.status, 201);

  // Deleting is not - whatever the route, because the rule is on the method.
  const area = await call(operator, 'POST', '/api/front-office/areas', { name: 'Terrace' });
  assert.equal(area.status, 201, 'they may add an area');
  const gone = await call(operator, 'DELETE', `/api/front-office/areas/${area.body.id}`);
  assert.equal(gone.status, 403, 'and may not take one off');

  assert.equal((await call(operator, 'DELETE', `/api/employees/${amit.id}`)).status, 403);
  assert.equal((await call(operator, 'POST', `/api/periods/${month.id}/approve`, {})).status, 403);
});

test('...and HR still can delete, which is what HR could always do', async () => {
  const area = await call(hr, 'POST', '/api/front-office/areas', { name: 'Terrace 2' });
  assert.equal((await call(hr, 'DELETE', `/api/front-office/areas/${area.body.id}`)).status, 200);
});

test('ACCOUNTS IS HR WITH TWO TICKS SUGGESTED — the ticks are the truth', () => {
  const accounts = users.ROLES.find((r) => r.key === 'accounts');
  const hrRole = users.ROLES.find((r) => r.key === 'hr');
  assert.deepEqual(accounts.abilities, hrRole.abilities, 'not a different kind of action');
  assert.deepEqual(accounts.areas, ['salary', 'reports'], 'a starting point for the May-use ticks');
  // And the role itself narrows nothing: a login made with no ticks sees all.
  assert.deepEqual(made.accounts.areas, [], 'the role does not tick them behind your back');
});

test('a Viewer still changes nothing, and now cannot delete either', async () => {
  const viewer = users.createUser({ name: 'Auditor', username: 'auditor', role: 'viewer', password: 'viewer-pass-123' });
  db.db.prepare(`UPDATE users SET must_change = 0 WHERE id = ?`).run(viewer.id);
  const cookie = await signIn('auditor', 'viewer-pass-123');
  assert.equal((await call(cookie, 'GET', '/api/employees')).status, 200);
  assert.equal((await call(cookie, 'POST', '/api/front-office/areas', { name: 'X' })).status, 403);
  assert.equal((await call(cookie, 'DELETE', `/api/employees/${amit.id}`)).status, 403);
});
