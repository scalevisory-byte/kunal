import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bonus-'));
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

let clean;
let absent;
let unmarked;
let periodId;
let netBefore;

test('set the scene: one clean month, one absence, one unmarked', async () => {
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const add = async (name) =>
    (await call('POST', '/api/employees', {
      company_id: company.id, name, monthly_salary: 26000, joined_on: '2026-01-01',
    })).body;
  clean = await add('Clean Kumar');
  absent = await add('Absent Anil');
  unmarked = await add('Unmarked Usha');

  periodId = (await call('POST', '/api/periods', { year: 2026, month: 10 })).body.id;
  await call('GET', `/api/periods/${periodId}/payroll`);
  await call('POST', `/api/periods/${periodId}/attendance`, {
    entries: [
      { employee_id: clean.id, day: 1, code: 'P' },
      { employee_id: clean.id, day: 2, code: 'P' },
      { employee_id: absent.id, day: 1, code: 'P' },
      { employee_id: absent.id, day: 2, code: 'A' },
    ],
  });
  netBefore = (await call('GET', `/api/periods/${periodId}/payroll`)).body
    .rows.reduce((t, r) => t + r.net_salary, 0);
});

test('looking at it pays nobody', async () => {
  const out = await call('GET', `/api/leave/bonus/${periodId}`);
  assert.equal(out.status, 200);
  assert.equal(out.body.totals.eligible, 1, 'only the clean month');
  assert.equal(out.body.totals.unknown, 1, 'the unmarked one is named, not paid');

  /* NOT A RUPEE MOVED by reading the page. */
  const net = (await call('GET', `/api/periods/${periodId}/payroll?sync=false`)).body
    .rows.reduce((t, r) => t + r.net_salary, 0);
  assert.equal(net, netBefore);
});

test('the rule lives on the server, not in a browser', async () => {
  const saved = await call('PUT', '/api/leave/bonus/rule', {
    kind: 'graded', amount: 1000, cut_per_day: 400, breaks: ['A', 'UL'],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rule.kind, 'graded');

  /* A fresh read gets the same rule — the next person running the month
     cannot get a different answer. */
  const read = (await call('GET', '/api/leave/bonus/rule')).body.rule;
  assert.equal(read.amount, 1000);
  assert.equal(read.cut_per_day, 400);
  assert.deepEqual(read.breaks, ['A', 'UL']);
});

test('a rule can be tried on without being saved', async () => {
  const tried = await call(
    'GET',
    `/api/leave/bonus/${periodId}?rule=${encodeURIComponent(
      JSON.stringify({ kind: 'all_or_nothing', amount: 5000 })
    )}`
  );
  assert.equal(tried.body.rule.amount, 5000);
  /* What is stored has not moved. */
  assert.equal(tried.body.saved_rule.amount, 1000);
  assert.equal((await call('GET', '/api/leave/bonus/rule')).body.rule.amount, 1000);
});

test('paying it adds to the month and says so on the payslip', async () => {
  const run = (await call('GET', `/api/leave/bonus/${periodId}`)).body;
  const lines = run.lines.filter((l) => l.eligible);
  /* Graded, 1,000 less 400 a day: Clean gets 1,000 and Anil 600. */
  assert.equal(lines.length, 2);

  const paid = await call('POST', `/api/leave/bonus/${periodId}/pay`, { lines });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.paid.length, 2);

  const rows = (await call('GET', `/api/periods/${periodId}/payroll?sync=false`)).body.rows;
  const cleanRow = rows.find((r) => r.employee_id === clean.id);
  assert.equal(cleanRow.addition, 1000);
  assert.match(cleanRow.adjustment_note, /leave bonus/);
  assert.equal(rows.find((r) => r.employee_id === absent.id).addition, 600);
  /* The one nobody marked was never in the list, so nothing reached them. */
  assert.equal(rows.find((r) => r.employee_id === unmarked.id).addition, 0);

  /* And the month is bigger by exactly the bonus. */
  const net = rows.reduce((t, r) => t + r.net_salary, 0);
  assert.equal(net, netBefore + 1600);
});

test('a second press cannot pay the same month twice', async () => {
  const run = (await call('GET', `/api/leave/bonus/${periodId}`)).body;
  assert.equal(run.totals.already_paid, 2);
  assert.equal(run.totals.to_pay, 0, 'nothing left to pay');

  /* Even sent straight at the API, it is refused per person and named. */
  const again = await call('POST', `/api/leave/bonus/${periodId}/pay`, {
    lines: [{ employee_id: clean.id, amount: 1000 }],
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.paid.length, 0);
  assert.match(again.body.skipped[0].why, /already paid/);

  const row = (await call('GET', `/api/periods/${periodId}/payroll?sync=false`)).body
    .rows.find((r) => r.employee_id === clean.id);
  assert.equal(row.addition, 1000, 'still one bonus, not two');
});

test('a bonus paid by mistake can be taken back, and only that amount', async () => {
  /* Something else was added to the same row — a claim, say. Taking the
     bonus back must not take that with it. */
  const rows = (await call('GET', `/api/periods/${periodId}/payroll?sync=false`)).body.rows;
  const row = rows.find((r) => r.employee_id === clean.id);
  await call('PATCH', `/api/periods/${periodId}/rows/${row.id}`, { addition: 1000 + 250 });

  const payment = (await call('GET', `/api/leave/bonus/${periodId}`)).body
    .payments.find((p) => p.employee_id === clean.id);
  assert.equal((await call('DELETE', `/api/leave/bonus/payment/${payment.id}`)).status, 200);

  const after = (await call('GET', `/api/periods/${periodId}/payroll?sync=false`)).body
    .rows.find((r) => r.employee_id === clean.id);
  assert.equal(after.addition, 250, 'the other 250 is still there');
  /* And they are payable again, which is the point of taking it back. */
  assert.equal((await call('GET', `/api/leave/bonus/${periodId}`)).body.totals.to_pay, 1);
});

test('a closed month is refused — that salary has been paid', async () => {
  await call('PATCH', `/api/periods/${periodId}`, { locked: 1 });
  const no = await call('POST', `/api/leave/bonus/${periodId}/pay`, {
    lines: [{ employee_id: clean.id, amount: 1000 }],
  });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /closed/);
  await call('PATCH', `/api/periods/${periodId}`, { locked: 0 });
});
