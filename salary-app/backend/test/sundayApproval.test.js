/**
 * Sunday pay is approved by a manager before it is paid.
 *
 * Dinesh: "sunday ka payment with approval of only manager". The role that
 * carries `approve` is Manager (and Admin); HR prepares and pays, and cannot
 * approve.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sunday-approval-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;
const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const session = () => {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  };
};

test('HR can prepare and pay it; only a manager can approve it', async () => {
  const admin = session();
  await admin('POST', '/api/auth/setup', { username: 'dinesh', password: 'a-long-password-1', name: 'Dinesh' });
  const company = (await admin('POST', '/api/companies', { name: 'BNF' })).body;
  const riya = (await admin('POST', '/api/employees', { name: 'Riya Pal', company_id: company.id, monthly_salary: 26000 })).body;
  const idle = (await admin('POST', '/api/employees', { name: 'No Sunday', company_id: company.id, monthly_salary: 26000 })).body;
  const period = (await admin('POST', '/api/periods', { month: 10, year: 2026 })).body;
  await admin('POST', `/api/periods/${period.id}/attendance`, { entries: [{ employee_id: riya.id, day: 4, code: 'SP' }] });

  const made = async (username, role) => {
    const res = await admin('POST', '/api/auth/users', { username, name: username, role, password: 'first-password-22' });
    assert.ok(res.status === 200 || res.status === 201, `${role}: ${JSON.stringify(res.body)}`);
    const s = session();
    await s('POST', '/api/auth/login', { username, password: 'first-password-22' });
    await s('POST', '/api/auth/password', { password: 'my-own-password-33', current: 'first-password-22' });
    return s;
  };
  const hr = await made('hr.person', 'hr');
  const manager = await made('the.manager', 'manager');

  const rows = async () => (await admin('GET', `/api/periods/${period.id}/payroll?sync=false`)).body.rows;
  const row = (await rows()).find((r) => r.employee_id === riya.id);
  const other = (await rows()).find((r) => r.employee_id === idle.id);
  assert.equal(row.sunday_salary, 1000);

  // HR cannot tick it paid, and cannot approve it either.
  const tick = await hr('PATCH', `/api/periods/${period.id}/rows/${row.id}`, { sunday_status: 'paid' });
  assert.equal(tick.status, 409);
  assert.equal((await hr('POST', `/api/periods/${period.id}/sunday/approve`, { row_ids: [row.id] })).status, 403);

  // Somebody owed nothing is not "approved for nought".
  const none = await manager('POST', `/api/periods/${period.id}/sunday/approve`, { row_ids: [other.id] });
  assert.equal(none.body.approved, 0);
  assert.deepEqual(none.body.skipped, ['No Sunday']);
  // ...and their tick needs no approval, because there is nothing to pay.
  assert.equal((await hr('PATCH', `/api/periods/${period.id}/rows/${other.id}`, { sunday_status: 'paid' })).status, 200);

  // The manager approves; it carries their name and the figure.
  const yes = await manager('POST', `/api/periods/${period.id}/sunday/approve`, { row_ids: [row.id] });
  assert.deepEqual([yes.body.approved, yes.body.amount], [1, 1000]);
  const after = (await rows()).find((r) => r.employee_id === riya.id);
  assert.equal(after.sunday_approved_by, 'the.manager');
  assert.equal(after.sunday_approved_amount, 1000);
  assert.equal(after.sunday_status, null, 'approving pays nobody');

  // The approval cannot be forged through the ordinary row patch.
  await hr('PATCH', `/api/periods/${period.id}/rows/${other.id}`, { sunday_approved_by: 'me', sunday_approved_amount: 5000, sunday_approved_at: 'now' });
  assert.equal((await rows()).find((r) => r.employee_id === idle.id).sunday_approved_by, null);

  // A figure typed over it afterwards is not what was approved.
  await hr('PATCH', `/api/periods/${period.id}/rows/${row.id}`, { sunday_salary_override: 1500 });
  const stale = await hr('PATCH', `/api/periods/${period.id}/rows/${row.id}`, { sunday_status: 'paid' });
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /approved for 1000 and is now 1500/);
  await hr('PATCH', `/api/periods/${period.id}/rows/${row.id}`, { sunday_salary_override: '' });

  // Back at the approved figure, HR pays it.
  const paid = await hr('PATCH', `/api/periods/${period.id}/rows/${row.id}`, { sunday_status: 'paid', sunday_mode: 'Cash' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.sunday_status, 'paid');

  // And it moved no salary figure: approval is a gate on a tick.
  const final = (await rows()).find((r) => r.employee_id === riya.id);
  assert.equal(final.net_salary, row.net_salary);
  assert.equal(final.sunday_salary, 1000);
});

test('the register shows who can approve and why the tick is closed', () => {
  const read = (f) => fs.readFileSync(new URL(`../../frontend/src/${f}`, import.meta.url), 'utf8');
  const reg = read('components/SundayRegister.jsx');
  assert.match(reg, /\(abilities \|\| \[\]\)\.includes\('approve'\)/);
  assert.match(reg, /Only a Manager or Admin login can approve it/);
  assert.match(reg, /Paid \(needs approval\)/);
  assert.match(reg, /const needsApproval = !STANDALONE/, 'the single file has no logins, so nobody to ask');
  assert.equal((read('App.jsx').match(/abilities=\{me\?\.abilities \|\| \[\]\}/g) || []).length >= 3, true);
  assert.ok(read('styles.css').includes('.sunday-approval'));
});
