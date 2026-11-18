import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * PER-LOGIN RIGHTS.
 *
 * Dinesh, looking at four people who are all Admin: "rights me aur option
 * do". The roles say what KIND of thing somebody may do; they cannot say
 * that Krishna handles attendance and has no business on the salary sheet.
 *
 * Enforced on the SERVER. A right that only hides a tab is not a right -
 * somebody who knows the address still gets the data.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rights-'));
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

/* --- an installation with a company, an employee and a month --- */
const boss = users.createFirstAdmin({ name: 'Dinesh', username: 'dinesh', password: 'first-pass-123' });
const company = db.createCompany({ name: 'BOOKNFLY PVT LTD' });
const amit = db.createEmployee({ company_id: company.id, name: 'Amit Shah', monthly_salary: 26000 });
const month = db.createPeriod({ year: 2026, month: 10 });
db.syncPayrollRows(month.id);

const made = users.createUser({
  name: 'Krishna', username: 'krishna', role: 'hr', password: 'attend-only-123',
});
users.updateUser(made.id, { areas: ['attendance'], must_change: false });
db.db.prepare(`UPDATE users SET must_change = 0 WHERE id IN (?, ?)`).run(boss.id, made.id);

const adminCookie = await signIn('dinesh', 'first-pass-123');
const narrowCookie = await signIn('krishna', 'attend-only-123');

test('nothing ticked means everything, so nobody is moved by this existing', async () => {
  const everything = await call(adminCookie, 'GET', `/api/periods/${month.id}/payroll`);
  assert.equal(everything.status, 200);
  assert.ok(everything.body.rows.length >= 1);
  assert.ok(everything.body.rows[0].salary > 0, 'and the figures are there');
});

test('a narrowed login is refused the modules it does not carry', async () => {
  for (const [url, what] of [
    ['/api/hiring/candidates', 'Hiring'],
    ['/api/loans', 'Loans'],
    ['/api/people/notes', 'People'],
    ['/api/people/assets', 'Assets'],
    ['/api/employees', 'Employees'],
  ]) {
    const res = await call(narrowCookie, 'GET', url);
    assert.equal(res.status, 403, `${what} (${url}) should be refused`);
    assert.match(res.body.error, /does not cover/, 'and it has to say why, and who can change it');
    assert.match(res.body.error, /admin/i);
  }
});

test('the module it DOES carry still works', async () => {
  const grid = await call(narrowCookie, 'GET', `/api/periods/${month.id}/attendance`);
  assert.equal(grid.status, 200);
  const marked = await call(narrowCookie, 'POST', `/api/periods/${month.id}/attendance`, {
    entries: [{ employee_id: amit.id, day: 5, code: 'P' }],
  });
  assert.equal(marked.status, 200, 'marking attendance is the job this login is for');
});

test('the salary sheet is refused outright, from the same month', async () => {
  /*
   * The month carries both jobs on one router. Gating it as one thing would
   * defeat the whole point: somebody who marks attendance and never sees pay
   * is exactly the case this exists for.
   */
  const sheet = await call(narrowCookie, 'GET', `/api/periods/${month.id}/payroll`);
  assert.equal(sheet.status, 403);
  const slip = await call(narrowCookie, 'GET', `/api/periods/${month.id}/payslip/${amit.id}`);
  assert.equal(slip.status, 403);
});

test('and a figure cannot leak through a door that IS open', async () => {
  /*
   * The point of taking pay out in one place. A login without the salary
   * area must not see a figure wherever it surfaces - and the month itself,
   * which it needs for attendance, carries one.
   */
  const period = await call(narrowCookie, 'GET', `/api/periods/${month.id}`);
  assert.equal(period.status, 200);
  const text = JSON.stringify(period.body);
  assert.ok(!/26000/.test(text), `a salary reached a login without the salary right: ${text}`);

  const companies = await call(narrowCookie, 'GET', '/api/companies');
  assert.equal(companies.status, 200, 'the company list is needed on every screen');
  assert.ok(!/monthly_salary|"salary"/.test(JSON.stringify(companies.body)));
});

test('the admin still sees every figure', async () => {
  const slip = await call(adminCookie, 'GET', `/api/periods/${month.id}/payslip/${amit.id}`);
  assert.equal(slip.status, 200);
  assert.match(JSON.stringify(slip.body), /26000/, 'nothing is hidden from a login that carries it');
});

test('a login says which tabs to draw, and the server refuses the rest anyway', async () => {
  const state = await call(narrowCookie, 'GET', '/api/auth/state');
  assert.deepEqual(state.body.signed_in.areas, ['attendance']);
  const wide = await call(adminCookie, 'GET', '/api/auth/state');
  assert.ok(wide.body.signed_in.areas.length > 5, 'everything, for a login nobody narrowed');
});

test('unticking the last box means "stop narrowing", not "lock them out"', () => {
  users.updateUser(made.id, { areas: [] });
  const row = users.listUsers().find((u) => u.id === made.id);
  assert.deepEqual(row.areas, [], 'read back as not narrowed');
  // ...which `may` reads as everything, or somebody has to be talked through
  // unlocking a login that can open no tab at all.
  assert.equal(
    db.db.prepare(`SELECT areas FROM users WHERE id = ?`).get(made.id).areas,
    null
  );
});

test('a staff login carries no office area, whatever is ticked', async () => {
  const staff = users.createUser({
    name: 'Amit Shah', username: 'amit.shah', role: 'employee',
    employee_id: amit.id, password: 'staff-pass-123',
  });
  users.updateUser(staff.id, { areas: ['salary', 'attendance'] });
  db.db.prepare(`UPDATE users SET must_change = 0 WHERE id = ?`).run(staff.id);
  const cookie = await signIn('amit.shah', 'staff-pass-123');
  const res = await call(cookie, 'GET', `/api/periods/${month.id}/payroll`);
  assert.equal(res.status, 403, 'its whole authority is /api/me');
});

/* ---------------- the screen and the server must agree ---------------- */

const src = (f) => fs.readFileSync(new URL(`../../frontend/src/${f}`, import.meta.url), 'utf8');

test('every tab names a right that exists', async () => {
  /*
   * A tab naming an area nobody defined would be hidden from everybody who
   * has been narrowed at all, for ever, and nothing would say why.
   */
  const { AREA_KEYS } = await import('../../shared/rights.js');
  const app = src('App.jsx');
  const tabs = [...app.matchAll(/^\s*\['([a-z]+)',\s*'[^']+',\s*'[a-z]+',\s*'([a-z]*)'\]/gm)];
  assert.ok(tabs.length >= 10, `only found ${tabs.length} tabs`);
  for (const [, key, area] of tabs) {
    if (!area) continue;
    assert.ok(AREA_KEYS.includes(area), `the ${key} tab asks for "${area}", which is not a right`);
  }
  // Admin is governed by the role, not an area - locking somebody out of
  // their own Logins screen with a tick is how an installation ends up with
  // nobody who can fix it.
  assert.equal(tabs.find(([, key]) => key === 'admin')?.[2], '');
});

test('every office router is gated, so none is forgotten', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  for (const [mount, area] of [
    ['/api/employees', 'employees'],
    ['/api/leave', 'leave'],
    ['/api/loans', 'loans'],
    ['/api/hiring', 'hiring'],
    ['/api/attendance', 'attendance'],
  ]) {
    const line = server.split('\n').find((l) => l.includes(`'${mount}'`));
    assert.ok(line, `${mount} is not mounted`);
    assert.match(line, new RegExp(`requireArea\\('${area}'\\)`), `${mount} is not gated`);
  }
  // And the pay filter goes on every office router at once, not per route -
  // a list of screens to remember is a list somebody forgets.
  assert.match(server, /const office = \[requireAuth, requireRead, hidePay\]/);
});

/*
 * THE TWO ROUTERS THAT CARRY MORE THAN ONE JOB are gated by PATH, inside
 * themselves, and this states where that decision lives.
 *
 * This test used to assert that server.js carried requireArea('people') for
 * /api/people and requireArea('assets') for /api/people/assets. Both of those
 * ran, in that order, so a login ticked to Assets alone passed the second and
 * was refused by the first - it had no asset register at all. It is rewritten
 * rather than patched, because the rule itself changed: one place decides.
 */
test('the month and the people router decide by path, in one place each', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  for (const mount of ['/api/people', '/api/periods']) {
    const line = server.split('\n').find((l) => l.includes(`'${mount}'`));
    assert.ok(line, `${mount} is not mounted`);
    assert.ok(
      !/requireArea/.test(line),
      `${mount} is gated twice: once here and once inside its router, which is how the two came to disagree`
    );
  }

  const people = fs.readFileSync(new URL('../src/routes/people.js', import.meta.url), 'utf8');
  assert.match(people, /\[\/\^\\\/\(assets\|asset-masters\|maintenance\|rounds\)/, 'the asset paths are not claimed by the assets right');
  assert.match(people, /'license'/, 'the licence paths are not claimed by the licence right');
  assert.match(people, /requireArea\(area\)/);

  const periods = fs.readFileSync(new URL('../src/routes/periods.js', import.meta.url), 'utf8');
  assert.match(periods, /requireArea\(wants\)/);
});

test('a login ticked to ONE module can actually use it — the half nobody checked', async () => {
  const keeper = users.createUser({
    name: 'Store keeper', username: 'store', role: 'hr', password: 'assets-only-123',
  });
  users.updateUser(keeper.id, { areas: ['assets'], must_change: false });
  db.db.prepare(`UPDATE users SET must_change = 0 WHERE id = ?`).run(keeper.id);
  const cookie = await signIn('store', 'assets-only-123');

  // The register, its masters, its maintenance and its stock takes are all
  // the Assets tab, whatever path they sit on.
  for (const url of ['/api/people/assets', '/api/people/asset-masters', '/api/people/maintenance', '/api/people/rounds', '/api/people/options']) {
    const res = await call(cookie, 'GET', url);
    assert.equal(res.status, 200, `${url} was refused to the login whose job it is`);
  }

  // And still nothing else: a store keeper has no business reading a warning
  // letter, or the Tally key.
  for (const url of ['/api/people/notes', '/api/people/licenses', '/api/people/penalties']) {
    const res = await call(cookie, 'GET', url);
    assert.equal(res.status, 403, `${url} was open to a login that does not carry it`);
  }
});
