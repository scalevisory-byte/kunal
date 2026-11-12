/**
 * Fines, losses and damage recovered from salary.
 *
 * Dinesh asked for a penalty that comes out of the salary, a report of it, and
 * a note saying what it was for — and then, pointing at the Loans page:
 * "ek loan ki tarah penalty deduction ka option banavo / jo add kiya ho wo
 * salary me se auto deduct ho jaye". So it now posts its instalment every
 * month by itself, exactly as a running loan does.
 *
 * Three rules hold the whole thing up:
 *
 *   1. the money is summed off the LEDGER into its own penalty_deduction
 *      column, and never written into payroll_rows.deduction — that is the
 *      box a one-off is typed into, and two writers on one number is how a
 *      typed figure gets overwritten and how the same money is taken twice;
 *   2. a month already posted is never posted again, so looking at the salary
 *      sheet twice cannot fine anybody twice;
 *   3. the Payment of Wages Act's limits are REPORTED, never enforced silently.
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

test('recording one takes nothing on its own — the MONTH takes it', async () => {
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
  // The POST itself moves no money - it writes a penalty, not a deduction.
  assert.equal(made.body.recovered, 0);

  // ...and then the month is opened, which is when a loan takes its
  // instalment too. This is the whole of what was asked for: nobody presses
  // anything, and a penalty recorded in November comes off November.
  const after = await rowOf(amit.id);
  assert.equal(after.penalty_deduction, 2000, 'the first instalment posted by itself');
  assert.equal(before.net_salary - after.net_salary, 2000);

  // RULE 1. The hand-typed Deduct box is not where this money lives.
  assert.equal(after.deduction, before.deduction, 'the typed Deduct column is untouched');
});

test('looking at the month again does not fine anybody twice', async () => {
  const once = await rowOf(amit.id);
  const twice = await rowOf(amit.id);
  const thrice = await rowOf(amit.id);
  assert.equal(once.penalty_deduction, 2000);
  assert.equal(twice.penalty_deduction, 2000);
  assert.equal(thrice.penalty_deduction, 2000);
  assert.equal(twice.net_salary, once.net_salary);
  const { body } = await api('GET', `/api/people/penalties/${penaltyId}`);
  assert.equal(body.penalty.recovered, 2000, 'one instalment, however often the sheet is read');
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

test('"kyu kata he kis chiz ka kata he" reaches the payslip', async () => {
  const row = await rowOf(amit.id);
  // The reason travels with the money rather than being appended to the
  // row's free-text remark - which, posting every month, would grow a
  // sentence longer each time.
  assert.deepEqual(row.penalty_notes, ['Dropped in the cab, screen replaced']);
});

test('November is already taken, so taking it by hand is refused', async () => {
  const again = await api('POST', `/api/people/penalties/${penaltyId}/recover`, {
    period_id: periodId,
  });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already taken from/i);
});

test('the next month takes the next instalment, and the last one finishes it', async () => {
  const months = [];
  for (const month of [12, 1]) {
    const year = month === 12 ? 2026 : 2027;
    const made = await api('POST', '/api/periods', { year, month });
    months.push(made.body.id);
    const { body } = await api('GET', `/api/periods/${made.body.id}/payroll`);
    const row = body.rows.find((r) => r.employee_id === amit.id);
    assert.equal(row.penalty_deduction, 2000, `${year}-${month} took its instalment`);
    assert.equal(row.deduction, 0, 'still not in the typed Deduct box');
  }

  const { body } = await api('GET', `/api/people/penalties/${penaltyId}`);
  assert.equal(body.penalty.recovered, 6000);
  assert.equal(body.penalty.outstanding, 0);
  assert.equal(body.penalty.status, 'recovered', 'it closed itself — nobody pressed anything');

  // And a fourth month takes nothing, because there is nothing left.
  const extra = await api('POST', '/api/periods', { year: 2027, month: 2 });
  const later = await api('GET', `/api/periods/${extra.body.id}/payroll`);
  const row = later.body.rows.find((r) => r.employee_id === amit.id);
  assert.equal(row.penalty_deduction, 0, 'a paid-off penalty keeps taking nothing');
});

test('the register adds up, and the ledger is what it adds', async () => {
  const { body } = await api('GET', '/api/people/penalties');
  assert.equal(body.report.totals.count, 1);
  assert.equal(body.report.totals.amount, 6000);
  // Three months have been opened above and each took its own instalment,
  // so the whole 6,000 has come out and nothing is left to chase. Every
  // rupee of that figure is a penalty_recoveries row - the register reads
  // the ledger rather than keeping a second count of its own.
  assert.equal(body.report.totals.recovered, 6000);
  assert.equal(body.report.totals.outstanding, 0);
  assert.equal(body.report.by_kind[0].label, 'Damage to company property');

  const paid = await api('GET', `/api/people/penalties/${penaltyId}`);
  assert.equal(paid.body.recoveries.length, 3, 'one row per month it came out of');
  assert.equal(
    paid.body.recoveries.reduce((t, r) => t + r.amount, 0),
    body.report.totals.recovered
  );
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

test('a penalty on hold takes nothing, and is still owed', async () => {
  const made = await api('POST', '/api/people/penalties', {
    employee_id: amit.id,
    kind: 'fine',
    amount: 1200,
    note: 'Phone on the shop floor',
    months: 2,
  });
  const held = await api('PATCH', `/api/people/penalties/${made.body.id}`, { status: 'held' });
  assert.equal(held.status, 200);
  assert.equal(held.body.status, 'held');

  const period = await api('POST', '/api/periods', { year: 2027, month: 3 });
  const { body } = await api('GET', `/api/periods/${period.body.id}/payroll`);
  const row = body.rows.find((r) => r.employee_id === amit.id);
  assert.equal(row.penalty_deduction, 0, 'on hold means nothing comes off');

  // Held is NOT waived: the money is still owed, it is simply not being
  // taken. Those two must never be one button.
  const list = await api('GET', '/api/people/penalties');
  const mine = list.body.report.rows.find((r) => r.id === made.body.id);
  assert.equal(mine.status, 'held');
  assert.ok(list.body.report.totals.outstanding >= 1200, 'still counted as owed');

  // Taking it off hold puts it back on the next month it is asked for.
  await api('PATCH', `/api/people/penalties/${made.body.id}`, { status: 'open' });
  const again = await api('POST', '/api/periods', { year: 2027, month: 4 });
  const back = await api('GET', `/api/periods/${again.body.id}/payroll`);
  const row2 = back.body.rows.find((r) => r.employee_id === amit.id);
  assert.equal(row2.penalty_deduction, 600, 'running again, half of 1200 over two months');
});
