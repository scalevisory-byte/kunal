import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-'));
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
let request;
let netWithLeave;

test('set the scene: three days of casual leave, approved', async () => {
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  amit = (await call('POST', '/api/employees', {
    company_id: company.id, name: 'Amit Shah', monthly_salary: 26000,
    joined_on: '2026-01-01', cl_quota: 7,
  })).body;
  periodId = (await call('POST', '/api/periods', { year: 2026, month: 10 })).body.id;
  await call('GET', `/api/periods/${periodId}/payroll`);

  request = (await call('POST', '/api/attendance/requests', {
    employee_id: amit.id, period_id: periodId, kind: 'leave',
    day: 18, to_day: 20, code: 'CL', reason: 'family wedding',
  })).body;
  assert.equal(request.status, 'pending');

  const decided = await call('POST', `/api/attendance/requests/${request.id}/decide`, {
    approve: true, by: 'Dinesh',
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.status, 'approved');

  const row = (await call('GET', `/api/periods/${periodId}/payroll`)).body
    .rows.find((r) => r.employee_id === amit.id);
  const code = (d) => {
    const e = row.attendance[d];
    return typeof e === 'object' ? e?.code : e;
  };
  assert.deepEqual([code(18), code(19), code(20)], ['CL', 'CL', 'CL']);
  netWithLeave = row.net_salary;
});

test('nothing that has not been approved can be cancelled', async () => {
  const other = (await call('POST', '/api/attendance/requests', {
    employee_id: amit.id, period_id: periodId, kind: 'leave',
    day: 24, code: 'CL', reason: 'still waiting',
  })).body;
  const no = await call('POST', `/api/attendance/requests/${other.id}/cancel`, {
    reason: 'changed their mind',
  });
  assert.equal(no.status, 400);
  /* Nothing was written for it, so taking it back is a withdrawal - which
     already exists and is the employee's own to do. */
  assert.match(no.body.error, /nothing has been written for this yet/);
});

test('a cancellation has to say why', async () => {
  const no = await call('POST', `/api/attendance/requests/${request.id}/cancel`, {});
  assert.equal(no.status, 400);
  assert.match(no.body.error, /say why/);
});

test('cancelling CLEARS the days — it does not decide what happened instead', async () => {
  const done = await call('POST', `/api/attendance/requests/${request.id}/cancel`, {
    by: 'Dinesh', reason: 'the wedding was called off',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'cancelled');
  assert.equal(done.body.cancelled_by, 'Dinesh');
  assert.match(done.body.cancel_reason, /called off/);

  const row = (await call('GET', `/api/periods/${periodId}/payroll`)).body
    .rows.find((r) => r.employee_id === amit.id);
  for (const day of [18, 19, 20]) {
    const entry = row.attendance[day];
    const code = typeof entry === 'object' ? entry?.code : entry;
    /* NOT 'P' and NOT 'A'. They may have come in, or been absent, or taken
       something else - the app cannot know, and either guess moves money.
       The day goes back to unmarked and says why it is blank. */
    assert.ok(!code, `day ${day} should be unmarked, got ${code}`);
    assert.match(entry.reason, /leave cancelled/);
    /* An approval that has been undone is not an approval. */
    assert.equal(entry.approved, null);
  }
});

test('the row is kept, not deleted — his brief says so by name', async () => {
  const listed = (await call('GET', `/api/attendance/requests?period_id=${periodId}`)).body.requests;
  const still = listed.find((r) => r.id === request.id);
  assert.ok(still, 'the approved leave is still on the list after being cancelled');
  assert.equal(still.status, 'cancelled');
  /* And it still says who approved it in the first place. Deleting the row
     would leave the attendance change with nothing behind it. */
  assert.equal(still.decided_by, 'Dinesh');
  assert.equal(still.day, 18);
  assert.equal(still.to_day, 20);
});

test('nothing is cancelled twice', async () => {
  const again = await call('POST', `/api/attendance/requests/${request.id}/cancel`, {
    reason: 'again',
  });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already cancelled/);
});

test('the days are back in the balance and the month is paid as worked', async () => {
  const register = (await call('GET', '/api/leave?year=2026')).body;
  const row = register.rows.find((r) => r.employee_id === amit.id);
  assert.equal(row.taken.CL, 0, 'the three days are not counted as taken any more');

  /* Paid leave costs the same as a day at work, so the net does not move -
     but the days are back in hand, which is the point. */
  const paid = (await call('GET', `/api/periods/${periodId}/payroll`)).body
    .rows.find((r) => r.employee_id === amit.id);
  assert.equal(paid.net_salary, netWithLeave);
});

test('a locked month refuses: that leave has been paid', async () => {
  const req2 = (await call('POST', '/api/attendance/requests', {
    employee_id: amit.id, period_id: periodId, kind: 'leave',
    day: 7, code: 'CL', reason: 'one day',
  })).body;
  await call('POST', `/api/attendance/requests/${req2.id}/decide`, { approve: true, by: 'Dinesh' });
  await call('PATCH', `/api/periods/${periodId}`, { locked: 1 });

  const no = await call('POST', `/api/attendance/requests/${req2.id}/cancel`, {
    reason: 'too late',
  });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /locked/);
  await call('PATCH', `/api/periods/${periodId}`, { locked: 0 });
});
