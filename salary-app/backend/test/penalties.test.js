/**
 * Fines, losses and damage recovered from salary.
 *
 * Dinesh asked for a penalty that comes out of the salary, a report of it, and
 * a note saying what it was for. Two rules hold the whole thing up:
 *
 *   1. recording a penalty deducts NOTHING — recovery names the month;
 *   2. the Payment of Wages Act's limits are REPORTED, never enforced silently.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'penalty-'));
process.env.APP_PASSWORD = '';
process.env.SERVE_FRONTEND = 'false';
process.env.LINK_SECRET = 'test-secret';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let amit;
let periodId;
const rowOf = async (id) => {
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  return body.rows.find((r) => r.employee_id === id);
};

test('set the scene', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  amit = (await api('POST', '/api/employees', {
    company_id: company.body.id,
    name: 'Amit Shah',
    monthly_salary: 26000,
  })).body;
  const period = await api('POST', '/api/periods', { year: 2026, month: 11 });
  periodId = period.body.id;
  await api('GET', `/api/periods/${periodId}/payroll`);
});

test('a penalty with no reason is refused — that is the whole point of it', async () => {
  const bad = await api('POST', '/api/people/penalties', {
    employee_id: amit.id,
    kind: 'damage',
    amount: 5000,
    what: 'Dell laptop',
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /say why/i);
});

test('damage and loss have to name what it was', async () => {
  const bad = await api('POST', '/api/people/penalties', {
    employee_id: amit.id,
    kind: 'loss',
    amount: 1000,
    note: 'it went missing',
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /name what was damaged or lost/i);
});

let penaltyId;

test('recording one deducts nothing at all', async () => {
  const before = await rowOf(amit.id);

  const made = await api('POST', '/api/people/penalties', {
    employee_id: amit.id,
    kind: 'damage',
    amount: 6000,
    what: 'BPL-LAP-014 Dell Latitude',
    note: 'Dropped in the cab, screen replaced',
    happened_on: '2026-11-03',
    months: 3,
  });
  assert.equal(made.status, 201);
  penaltyId = made.body.id;
  assert.equal(made.body.outstanding, 6000);
  assert.equal(made.body.recovered, 0);
  // Three months, so an instalment is a third.
  assert.equal(made.body.instalment, 2000);

  const after = await rowOf(amit.id);
  assert.equal(after.net_salary, before.net_salary, 'nobody has been docked yet');
  assert.equal(after.deduction, before.deduction);
});

test('the preview says what it would do before it does it', async () => {
  const look = await api('GET', `/api/people/penalties/${penaltyId}/preview?period_id=${periodId}`);
  assert.equal(look.status, 200);
  assert.equal(look.body.amount, 2000);
  assert.equal(look.body.net_after, look.body.net_now - 2000);
  assert.equal(look.body.has_row, true);
  // A third of the month is well under half the wages.
  assert.deepEqual(look.body.warnings, []);
});

test('recovering takes it from the named month, with the reason on the payslip', async () => {
  const before = await rowOf(amit.id);
  const done = await api('POST', `/api/people/penalties/${penaltyId}/recover`, {
    period_id: periodId,
    by: 'Dinesh',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.recovered, 2000);
  assert.equal(done.body.outstanding, 4000);
  assert.equal(done.body.status, 'open', 'two instalments still to come');

  const after = await rowOf(amit.id);
  assert.equal(after.deduction, (before.deduction || 0) + 2000);
  assert.equal(before.net_salary - after.net_salary, 2000);
  // "kyu kata he kis chiz ka kata he" — on the row, so on the payslip.
  assert.match(after.adjustment_note, /Damage to company property: Dropped in the cab/);
});

test('it cannot be taken from the same month twice', async () => {
  const again = await api('POST', `/api/people/penalties/${penaltyId}/recover`, {
    period_id: periodId,
  });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already taken from/i);
});

test('the register adds up, and says what is still to come', async () => {
  const { body } = await api('GET', '/api/people/penalties');
  assert.equal(body.report.totals.count, 1);
  assert.equal(body.report.totals.amount, 6000);
  assert.equal(body.report.totals.recovered, 2000);
  assert.equal(body.report.totals.outstanding, 4000);
  assert.equal(body.report.by_kind[0].label, 'Damage to company property');
});

test('the law’s limits are reported, not enforced', async () => {
  // A penalty bigger than the whole month, taken in one go.
  const big = await api('POST', '/api/people/penalties', {
    employee_id: amit.id,
    kind: 'loss',
    amount: 40000,
    what: 'company scooter',
    note: 'Not returned after leaving the site',
  });
  assert.equal(big.status, 201);

  const look = await api('GET', `/api/people/penalties/${big.body.id}/preview?period_id=${periodId}`);
  const rules = look.body.warnings.map((w) => w.rule);
  assert.ok(rules.includes('half of wages'), 'over half the wages is named');
  assert.ok(rules.includes('more than a month'), 'more than a month of pay is named');
  assert.match(look.body.warnings[0].says, /Payment of Wages Act/);

  // And it still goes through, because this app states the rule and lets the
  // office decide - refusing would push the figure into the Deduct box, where
  // nothing checks anything at all.
  const done = await api('POST', `/api/people/penalties/${big.body.id}/recover`, {
    period_id: periodId,
    amount: 40000,
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'recovered');
  assert.equal(done.body.outstanding, 0);
});

test('waiving stops the collecting and keeps the record', async () => {
  const made = await api('POST', '/api/people/penalties', {
    employee_id: amit.id,
    kind: 'fine',
    amount: 500,
    note: 'Late three times in a week',
  });
  const noReason = await api('POST', `/api/people/penalties/${made.body.id}/waive`, {});
  assert.equal(noReason.status, 400);

  const waived = await api('POST', `/api/people/penalties/${made.body.id}/waive`, {
    note: 'First time — let it go',
  });
  assert.equal(waived.status, 200);
  assert.equal(waived.body.status, 'waived');

  const after = await api('POST', `/api/people/penalties/${made.body.id}/recover`, {
    period_id: periodId,
  });
  assert.equal(after.status, 400, 'a waived penalty cannot be recovered');
});

test('a penalty money has come out of cannot be deleted', async () => {
  const gone = await api('DELETE', `/api/people/penalties/${penaltyId}`);
  assert.equal(gone.status, 400);
  assert.match(gone.body.error, /waive it instead/i);
});
