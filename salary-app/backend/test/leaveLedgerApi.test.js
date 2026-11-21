import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.ALLOW_OPEN = 'true';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let amit;
let periodId;

test('set the scene: one person, one month, two days of casual leave', async () => {
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  amit = (await call('POST', '/api/employees', {
    company_id: company.id, name: 'Amit Shah', monthly_salary: 26000,
    joined_on: '2026-01-01', cl_quota: 7, sl_quota: 7, pl_quota: 12,
  })).body;
  periodId = (await call('POST', '/api/periods', { year: 2026, month: 10 })).body.id;
  await call('GET', `/api/periods/${periodId}/payroll`);
  await call('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: amit.id, day: 18, code: 'CL' },
      { employee_id: amit.id, day: 19, code: 'CL' },
    ],
  });
});

test('with nothing posted the ledger matches the register it replaces', async () => {
  const ledger = (await call('GET', `/api/leave/ledger/${amit.id}?year=2026`)).body;
  const cl = ledger.ledgers.find((l) => l.code === 'CL');
  assert.equal(cl.summary.closing, 5, '7 quota less 2 taken');
  assert.equal(cl.summary.posted, false);

  /* The OLD register, which other screens still read, must say the same. */
  const register = (await call('GET', '/api/leave?year=2026')).body;
  const row = register.rows.find((r) => r.employee_id === amit.id);
  assert.equal(row.quotas.CL - row.taken.CL, 5);
});

test('a posted credit takes over, and the days taken still come off the marks', async () => {
  const posted = await call('POST', '/api/leave/credits', {
    employee_id: amit.id, code: 'CL', kind: 'opening', days: 4, on_date: '2026-01-01',
  });
  assert.equal(posted.status, 201);

  const cl = (await call('GET', `/api/leave/ledger/${amit.id}?year=2026`)).body
    .ledgers.find((l) => l.code === 'CL');
  assert.equal(cl.summary.posted, true);
  assert.equal(cl.summary.opening, 4);
  assert.equal(cl.summary.availed, 2, 'still read off the grid, not stored');
  assert.equal(cl.summary.closing, 2);

  /* SICK LEAVE IS UNTOUCHED. Posting on one type must not switch the
     fallback off for another - somebody posting a casual-leave correction
     does not expect their sick leave to change. */
  const sl = (await call('GET', `/api/leave/ledger/${amit.id}?year=2026`)).body
    .ledgers.find((l) => l.code === 'SL');
  assert.equal(sl.summary.closing, 7);
  assert.equal(sl.summary.posted, false);
});

test('marking another day of leave moves the ledger with no posting at all', async () => {
  await call('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: amit.id, day: 20, code: 'CL' }],
  });
  const cl = (await call('GET', `/api/leave/ledger/${amit.id}?year=2026`)).body
    .ledgers.find((l) => l.code === 'CL');
  assert.equal(cl.summary.availed, 3);
  assert.equal(cl.summary.closing, 1);
});

test('THE LEDGER MOVES NO MONEY', async () => {
  const before = (await call('GET', `/api/periods/${periodId}/payroll`)).body;
  const net = before.rows.reduce((t, r) => t + r.net_salary, 0);

  await call('POST', '/api/leave/credits', {
    employee_id: amit.id, code: 'PL', kind: 'adjustment', days: 5,
    note: 'agreed with the manager',
  });

  const after = (await call('GET', `/api/periods/${periodId}/payroll`)).body;
  assert.equal(after.rows.reduce((t, r) => t + r.net_salary, 0), net);
});

test('an adjustment must say why, and a credit of nothing is refused', async () => {
  const no = await call('POST', '/api/leave/credits', {
    employee_id: amit.id, code: 'CL', kind: 'adjustment', days: 2,
  });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /why/);

  const zero = await call('POST', '/api/leave/credits', {
    employee_id: amit.id, code: 'CL', kind: 'opening', days: 0,
  });
  assert.equal(zero.status, 400);
});

test('the balance register and the ledger cannot disagree', async () => {
  const register = (await call('GET', '/api/leave/balances?year=2026')).body;
  const row = register.rows.find((r) => r.employee_id === amit.id);
  const ledger = (await call('GET', `/api/leave/ledger/${amit.id}?year=2026`)).body;
  for (const l of ledger.ledgers) {
    assert.equal(row.types[l.code].balance, l.summary.closing, `${l.code} disagrees`);
  }
});
