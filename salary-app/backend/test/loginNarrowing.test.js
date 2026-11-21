/**
 * NARROWING A LOGIN, AND THE TWO HOLES IT HAD.
 *
 * Dinesh, having made a login for the front desk: *"sirf front desk ka rights
 * diya he to bhi ... salary and all bhi dikh raha he ... admin rights bhi mil
 * rahe he"*.
 *
 * Both halves were real:
 *
 *   **The modules were dropped on the way in.** `createUser` never read the
 *   field, so a login made with three modules ticked was created carrying
 *   every one of them, and signed in that minute to the whole payroll. It had
 *   to be narrowed a second time, on the row, by somebody who already
 *   believed they had done it.
 *
 *   **An Admin cannot be narrowed.** The Admin tab is the Logins screen, so
 *   ticks against an Admin are a fence drawn in front of the gate key - and
 *   so is changing your own row.
 *
 * What must NOT change: nothing ticked still means everything. Four people
 * are using this installation that way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'narrowing-'));
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
db.createEmployee({ company_id: company.id, name: 'Amit Shah', monthly_salary: 26000 });
const month = db.createPeriod({ year: 2026, month: 10 });
db.syncPayrollRows(month.id);
db.db.prepare(`UPDATE users SET must_change = 0 WHERE id = ?`).run(boss.id);

const adminCookie = await signIn('dinesh', 'first-pass-123');

let krutika = 0;

test('THE MODULES TICKED WHEN THE LOGIN IS MADE ARE THE MODULES IT GETS', async () => {
  const made = await call(adminCookie, 'POST', '/api/auth/users', {
    name: 'Krutika', username: 'krutika', password: 'front-desk-123',
    role: 'hr', areas: ['frontoffice'],
  });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.areas, ['frontoffice'], 'this came back [] before, which means everything');
  krutika = made.body.id;
});

test('and she is refused the payroll, the staff master and every other module', async () => {
  db.db.prepare(`UPDATE users SET must_change = 0 WHERE id = ?`).run(krutika);
  const hers = await signIn('krutika', 'front-desk-123');

  for (const url of [
    '/api/periods',
    `/api/periods/${month.id}/payroll`,
    '/api/employees',
    '/api/people/notes',
    '/api/loans',
    '/api/hiring/candidates',
    '/api/people/assets',
  ]) {
    const got = await call(hers, 'GET', url);
    assert.equal(got.status, 403, `${url} answered ${got.status}`);
  }

  // And the one she is for still answers.
  const desk = await call(hers, 'GET', '/api/front-office/areas');
  assert.equal(desk.status, 200);

  // The Logins screen is an Admin's, and she is not one.
  const logins = await call(hers, 'GET', '/api/auth/users');
  assert.equal(logins.status, 403);
});

test('NOTHING TICKED STILL MEANS EVERYTHING', async () => {
  const made = await call(adminCookie, 'POST', '/api/auth/users', {
    name: 'Hema', username: 'hema', password: 'all-of-it-123', role: 'hr',
  });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.areas, []);
  db.db.prepare(`UPDATE users SET must_change = 0 WHERE id = ?`).run(made.body.id);
  const hers = await signIn('hema', 'all-of-it-123');
  assert.equal((await call(hers, 'GET', `/api/periods/${month.id}/payroll`)).status, 200);
});

test('an Admin cannot be narrowed — it is a fence in front of the gate key', async () => {
  const refused = await call(adminCookie, 'POST', '/api/auth/users', {
    name: 'Nikhil', username: 'nikhil', password: 'admin-pass-123',
    role: 'admin', areas: ['frontoffice'],
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /cannot be an Admin/);
});

test('nor in two clicks: narrow somebody first, then promote them', async () => {
  const made = await call(adminCookie, 'POST', '/api/auth/users', {
    name: 'Rina', username: 'rina', password: 'viewer-pass-123',
    role: 'viewer', areas: ['attendance'],
  });
  assert.equal(made.status, 201);

  const promoted = await call(adminCookie, 'PATCH', `/api/auth/users/${made.body.id}`, { role: 'admin' });
  assert.equal(promoted.status, 400, 'the pair is checked against what the row WOULD be');
  assert.match(promoted.body.error, /cannot be an Admin/);

  // Untick first, then promote: that is allowed, and says what it is doing.
  assert.equal((await call(adminCookie, 'PATCH', `/api/auth/users/${made.body.id}`, { areas: [] })).status, 200);
  const now = await call(adminCookie, 'PATCH', `/api/auth/users/${made.body.id}`, { role: 'admin' });
  assert.equal(now.status, 200);
  // ...and the ticks cannot come back while they are one.
  const back = await call(adminCookie, 'PATCH', `/api/auth/users/${made.body.id}`, { areas: ['attendance'] });
  assert.equal(back.status, 400);
});

test('NOBODY WIDENS THEIR OWN LOGIN', async () => {
  const role = await call(adminCookie, 'PATCH', `/api/auth/users/${boss.id}`, { role: 'viewer' });
  assert.equal(role.status, 403);
  assert.match(role.body.error, /your own role/);

  const areas = await call(adminCookie, 'PATCH', `/api/auth/users/${boss.id}`, { areas: ['salary'] });
  assert.equal(areas.status, 403);

  // Their own name is still their own to change.
  assert.equal((await call(adminCookie, 'PATCH', `/api/auth/users/${boss.id}`, { name: 'Dinesh Parmar' })).status, 200);
});

test('a staff login carries no module ticks — its authority is one person', async () => {
  const employee = db.createEmployee({ company_id: company.id, name: 'Riya Pal', monthly_salary: 18000 });
  const refused = await call(adminCookie, 'POST', '/api/auth/users', {
    name: 'Riya Pal', username: 'riya.pal', password: 'staff-pass-123',
    role: 'employee', employee_id: employee.id, areas: ['salary'],
  });
  assert.equal(refused.status, 400);
});
