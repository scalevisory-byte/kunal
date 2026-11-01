/**
 * Branches, beneath a company.
 *
 * Dinesh's answer when asked what "branch" meant here: *"branches under a
 * company"* — the salary already runs across three or four separate companies,
 * and a branch is a place inside one of them.
 *
 * So companies are untouched and this is a second, optional level. The thing
 * these tests pin: **nothing that already worked changes.** Every existing
 * employee carries no branch, a branch is never required, and deleting one
 * never takes its people with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-branch-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: 'Bearer the-key',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let bnfl;
let scale;
let vadodara;
let surat;

test('two companies, as the salary is actually run', async () => {
  bnfl = (await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' })).body.id;
  scale = (await api('POST', '/api/companies', { name: 'SCALE' })).body.id;
  assert.ok(bnfl && scale);
});

test('a branch belongs to a company and is refused without one', async () => {
  const orphan = await api('POST', '/api/companies/branches', { name: 'Nowhere' });
  assert.equal(orphan.status, 400);
  assert.match(orphan.body.error, /belongs to a company/);

  const unnamed = await api('POST', '/api/companies/branches', { company_id: bnfl });
  assert.equal(unnamed.status, 400);
  assert.match(unnamed.body.error, /give the branch a name/);

  const made = await api('POST', '/api/companies/branches', {
    company_id: bnfl,
    name: 'Vadodara',
    city: 'Vadodara',
  });
  assert.equal(made.status, 201);
  vadodara = made.body.id;
  assert.equal(made.body.company_name, 'BOOKNFLY PRIVATE LIMITED');
});

test('a company cannot have the same branch twice, but two companies can share a name', async () => {
  const clash = await api('POST', '/api/companies/branches', { company_id: bnfl, name: 'Vadodara' });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /already has a branch called Vadodara/);

  const other = await api('POST', '/api/companies/branches', { company_id: scale, name: 'Vadodara' });
  assert.equal(other.status, 201, 'SCALE having its own Vadodara is normal');

  surat = (await api('POST', '/api/companies/branches', { company_id: bnfl, name: 'Surat' })).body.id;
  assert.ok(surat);
});

test('a branch must be a real company', async () => {
  const res = await api('POST', '/api/companies/branches', { company_id: 9999, name: 'Ghost' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /company not found/);
});

test('an employee needs no branch — which is where everybody starts', async () => {
  const made = await api('POST', '/api/employees', {
    company_id: bnfl,
    name: 'No Branch',
    monthly_salary: 26000,
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.branch_id, null);
  assert.equal(made.body.branch_name, null);
});

test('an employee can be put in one, and moved between them', async () => {
  const made = await api('POST', '/api/employees', {
    company_id: bnfl,
    name: 'Vaibhav Gupta',
    monthly_salary: 26000,
    branch_id: vadodara,
  });
  assert.equal(made.body.branch_id, vadodara);

  const moved = await api('PATCH', `/api/employees/${made.body.id}`, { branch_id: surat });
  assert.equal(moved.body.branch_id, surat);

  // A move is worth asking about a year later, so it is on the record.
  const record = await api('GET', `/api/employees/${made.body.id}/record`);
  assert.ok(
    record.body.history.some((h) => h.field === 'branch_id'),
    'the branch change is in the employee history',
  );

  const out = await api('PATCH', `/api/employees/${made.body.id}`, { branch_id: '' });
  assert.equal(out.body.branch_id, null, 'and back out of a branch again');
  await api('PATCH', `/api/employees/${made.body.id}`, { branch_id: vadodara });
});

test('the staff list can be narrowed to one branch', async () => {
  const all = await api('GET', '/api/employees');
  assert.equal(all.body.employees.length, 2);

  const inVadodara = await api('GET', `/api/employees?branch_id=${vadodara}`);
  assert.equal(inVadodara.body.employees.length, 1);
  assert.equal(inVadodara.body.employees[0].name, 'Vaibhav Gupta');
  assert.equal(inVadodara.body.employees[0].branch_name, 'Vadodara');
});

test('the branch list says which company and how many people', async () => {
  const { body } = await api('GET', '/api/companies/branches');
  const found = body.branches.find((b) => b.id === vadodara);
  assert.equal(found.company_name, 'BOOKNFLY PRIVATE LIMITED');
  assert.equal(found.people, 1);
  assert.equal(body.branches.find((b) => b.id === surat).people, 0);

  const justBnfl = await api('GET', `/api/companies/branches?company_id=${bnfl}`);
  assert.equal(justBnfl.body.branches.length, 2);
});

test('the branch rides onto the salary sheet', async () => {
  const period = await api('POST', '/api/periods', { year: 2026, month: 11 });
  const payroll = await api('GET', `/api/periods/${period.body.id}/payroll`);
  const row = payroll.body.rows.find((r) => r.employee_name === 'Vaibhav Gupta');
  assert.equal(row.branch_name, 'Vadodara');
  const none = payroll.body.rows.find((r) => r.employee_name === 'No Branch');
  assert.equal(none.branch_name, null, 'and a blank is a real answer, not a guess');
});

test('a branch can be closed without being deleted', async () => {
  await api('PATCH', `/api/companies/branches/${surat}`, { active: false });
  const open = await api('GET', '/api/companies/branches');
  assert.equal(open.body.branches.some((b) => b.id === surat), false);
  const all = await api('GET', '/api/companies/branches?all=true');
  assert.equal(all.body.branches.some((b) => b.id === surat), true);
  await api('PATCH', `/api/companies/branches/${surat}`, { active: true });
});

test('deleting a branch leaves its people on their company payroll', async () => {
  const before = await api('GET', `/api/employees?branch_id=${vadodara}`);
  assert.equal(before.body.employees.length, 1);
  const who = before.body.employees[0].id;

  const gone = await api('DELETE', `/api/companies/branches/${vadodara}`);
  assert.equal(gone.status, 204);

  const still = await api('GET', `/api/employees/${who}`);
  assert.equal(still.status, 200, 'a mistyped branch name must not take an employee with it');
  assert.equal(still.body.branch_id, null);
  assert.equal(still.body.company_id, bnfl, 'and they are still on their company');
});

test('deleting a company still takes its branches with it', async () => {
  await api('POST', '/api/companies/branches', { company_id: scale, name: 'Temporary' });
  const spare = (await api('POST', '/api/companies', { name: 'TO BE REMOVED' })).body.id;
  const branch = (await api('POST', '/api/companies/branches', { company_id: spare, name: 'Somewhere' })).body.id;
  await api('DELETE', `/api/companies/${spare}`);
  const all = await api('GET', '/api/companies/branches?all=true');
  assert.equal(all.body.branches.some((b) => b.id === branch), false);
});
