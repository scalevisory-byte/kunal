/**
 * The three report files the audit found missing: the leave register, the staff
 * list, and (checked here too) that both carry a BOM so Excel opens them with
 * the names and the rupee signs intact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-reports-'));
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
  return { status: res.status, body: text && text[0] === '{' ? JSON.parse(text) : null, text };
};

const bytes = async (url) => {
  const res = await fetch(`${base}${url}`, { headers: { authorization: 'Bearer the-key' } });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
};

let companyId;
let employeeId;
let periodId;

test('set the scene: somebody with leave taken', async () => {
  companyId = (await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' })).body.id;
  const branch = await api('POST', '/api/companies/branches', { company_id: companyId, name: 'Vadodara' });
  const employee = await api('POST', '/api/employees', {
    company_id: companyId,
    branch_id: branch.body.id,
    name: 'Riya Pal',
    code: 'E-14',
    monthly_salary: 24000,
    basic: 12000,
    cl_quota: 12,
    sl_quota: 6,
    pl_quota: 15,
    uan: '100200300400',
    joined_on: '2024-04-01',
  });
  employeeId = employee.body.id;
  periodId = (await api('POST', '/api/periods', { year: 2026, month: 11 })).body.id;
  await api('GET', `/api/periods/${periodId}/payroll`);

  // Two casual, one sick, and three unpaid - over nothing, but enough to count.
  await api('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: employeeId, day: 3, code: 'CL' },
      { employee_id: employeeId, day: 4, code: 'CL' },
      { employee_id: employeeId, day: 5, code: 'SL' },
      { employee_id: employeeId, day: 10, code: 'UL' },
    ],
  });
});

test('the leave register downloads, counted off the marks', async () => {
  const { status, buf } = await bytes('/api/leave.csv?year=2026');
  assert.equal(status, 200);
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM for Excel');
  const csv = buf.toString('utf8');
  assert.match(csv, /CL allowed,CL taken,CL left/);
  const line = csv.split('\n').find((l) => l.includes('Riya Pal'));
  assert.ok(line, 'she is on it');
  const cells = line.split(',');
  // Company, Employee, Department, then CL allowed/taken/left.
  assert.equal(cells[3], '12', 'CL allowed');
  assert.equal(cells[4], '2', 'CL taken, counted off the marks');
  assert.equal(cells[5], '10', 'CL left');
  assert.match(csv, /Unpaid leave taken/);
});

test('over-entitlement is named on the leave file, not just flagged', async () => {
  // Thirteen days of casual leave against twelve.
  const entries = [];
  for (let day = 12; day <= 24; day++) entries.push({ employee_id: employeeId, day, code: 'CL' });
  await api('POST', `/api/periods/${periodId}/attendance`, { entries });

  const { buf } = await bytes('/api/leave.csv?year=2026');
  const line = buf.toString('utf8').split('\n').find((l) => l.includes('Riya Pal'));
  assert.match(line, /CL by 3/, '15 taken against 12 allowed');
});

test('the staff list downloads, with the identifiers somebody is looking for', async () => {
  const { status, buf } = await bytes('/api/employees.csv');
  assert.equal(status, 200);
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = buf.toString('utf8');
  assert.match(csv, /Company,Branch,Code,Name/);
  assert.match(csv, /BOOKNFLY PRIVATE LIMITED,Vadodara,E-14,Riya Pal/);
  assert.match(csv, /100200300400/, 'the UAN, because finding who has none is the commonest use');
  assert.match(csv, /Working/, 'status reads as a word');
  // A blank own-weekly-off means "the company's day off", not missing data.
  assert.match(csv, /Own weekly off/);
});

test('the staff list can be narrowed, and includes people who have left', async () => {
  await api('POST', '/api/employees', {
    company_id: companyId,
    name: 'Gone Already',
    monthly_salary: 1,
    active: 0,
    left_on: '2026-06-30',
  });
  const all = (await bytes('/api/employees.csv')).buf.toString('utf8');
  assert.match(all, /Gone Already/);
  assert.match(all, /2026-06-30/);

  const working = (await bytes('/api/employees.csv?active=true')).buf.toString('utf8');
  assert.equal(working.includes('Gone Already'), false);
});
