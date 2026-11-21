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

/* ---------------- the year end, and encashment ---------------- */

test('the year end is a preview, then the same plan posted', async () => {
  const seen = await call('GET', '/api/leave/year-end/2026');
  assert.equal(seen.status, 200);
  const before = seen.body.totals.carried;
  assert.ok(before >= 0);

  const done = await call('POST', '/api/leave/year-end/2026', {});
  assert.equal(done.status, 200);
  assert.equal(done.body.plan.totals.carried, before, 'what was shown is what was posted');

  /* Next year opens with what was carried, as a carry-forward entry on the
     ledger with the run it came from. */
  const next = (await call('GET', '/api/leave/credits?year=2027')).body.credits;
  assert.ok(next.some((c) => c.kind === 'carry_forward' && c.reference === 'year end 2026'));
});

test('running the year end twice is refused rather than doubled', async () => {
  const again = await call('POST', '/api/leave/year-end/2026', {});
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already been run/);
  /* And it can still be forced, deliberately, by somebody who means it. */
  const forced = await call('POST', '/api/leave/year-end/2026', { again: true });
  assert.equal(forced.status, 200);
});

test('encashing takes days off the ledger and pays nobody', async () => {
  /* 2027, because the year end above closed 2026 out: it took the closing
     balance off the old year and posted it as a carry-forward into the new
     one. Encashing a year that has already been settled is exactly what the
     closing-balance check below refuses. */
  const before = (await call('GET', `/api/leave/ledger/${amit.id}?year=2027`)).body
    .ledgers.find((l) => l.code === 'PL');
  assert.ok(before.summary.closing >= 2, 'carried forward into the new year');

  const net = (await call('GET', `/api/periods/${periodId}/payroll?sync=false`)).body
    .rows.reduce((t, r) => t + r.net_salary, 0);

  const asked = await call('POST', '/api/leave/encash', {
    employee_id: amit.id, code: 'PL', days: 2, year: 2027,
  });
  assert.equal(asked.status, 201);
  assert.match(asked.body.note, /Nothing has been paid/);

  const after = (await call('GET', `/api/leave/ledger/${amit.id}?year=2027`)).body
    .ledgers.find((l) => l.code === 'PL');
  assert.equal(after.summary.closing, before.summary.closing - 2);
  assert.equal(after.summary.encashed, 2);

  /* NOT A RUPEE MOVED. Paying it is an addition on a named month, typed on
     the salary sheet where every other one-off payment is. */
  assert.equal(
    (await call('GET', `/api/periods/${periodId}/payroll?sync=false`)).body
      .rows.reduce((t, r) => t + r.net_salary, 0),
    net
  );
});

test('more days cannot be encashed than somebody has', async () => {
  const no = await call('POST', '/api/leave/encash', {
    employee_id: amit.id, code: 'PL', days: 999, year: 2027,
  });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /cannot be taken off/);
});

test('the calendar tells approved leave from a pending application', async () => {
  await call('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: amit.id, day: 7, code: 'SL' }],
  });
  const cal = await call('GET', `/api/leave/calendar/${periodId}`);
  assert.equal(cal.status, 200);
  const seventh = cal.body.days.find((d) => d.day === 7);
  assert.equal(seventh.on_leave.length, 1);
  assert.equal(seventh.on_leave[0].code, 'SL');
  assert.equal(seventh.pending.length, 0);
});

test('an encashment cannot be dated into another year', async () => {
  const no = await call('POST', '/api/leave/encash', {
    employee_id: amit.id, code: 'PL', days: 1, year: 2027, on_date: '2026-11-21',
  });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /not in 2027/);

  /* And with no date at all it lands IN the year it was checked against,
     not on today. The balance was read off 2027; the days must come off
     2027. */
  const ok = await call('POST', '/api/leave/encash', {
    employee_id: amit.id, code: 'PL', days: 1, year: 2027,
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.credit.on_date.slice(0, 4), '2027');
});

test('nothing can be lapsed off a ledger that has not got it either', async () => {
  /* The SAME rule as encashing, because it is the same door: a kind that
     takes leave away cannot take more than is there. Posting it through the
     plain credits form used to walk straight past the check. */
  const no = await call('POST', '/api/leave/credits', {
    employee_id: amit.id, code: 'PL', kind: 'expiry', days: 999, on_date: '2027-12-31',
  });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /cannot be taken off/);

  /* A credit, which GIVES leave, is not checked against anything. */
  const yes = await call('POST', '/api/leave/credits', {
    employee_id: amit.id, code: 'PL', kind: 'opening', days: 3, on_date: '2028-01-01',
  });
  assert.equal(yes.status, 201);
});

/* ---------------- the two reports ---------------- */

test('leave by department reads the same days the salary sheet is paid from', async () => {
  await call('PATCH', `/api/employees/${amit.id}`, { department: 'Accounts' });
  const out = await call('GET', `/api/leave/by-department/${periodId}`);
  assert.equal(out.status, 200);
  const line = out.body.lines.find((l) => l.department === 'Accounts');
  assert.ok(line, 'the department is on the row the month was read from');
  /* NOT A SECOND COUNT. The figure is checked against the marks on the
     month's own row - the same ones the salary sheet is paid from - rather
     than against a number typed here, which is the whole claim. */
  const row = (await call('GET', `/api/periods/${periodId}/payroll?sync=false`)).body
    .rows.find((r) => r.employee_id === amit.id);
  const marked = Object.values(row.attendance || {}).filter(
    (e) => (typeof e === 'object' ? e?.code : e) === 'CL'
  ).length;
  assert.ok(marked > 0, 'there are CL days on the grid');
  assert.equal(line.CL, marked);
  assert.equal(line.people, 1);
  assert.equal(line.took, 1);
});

test('the application report says whose move it is and for how long', async () => {
  const out = await call('GET', `/api/leave/applications?period_id=${periodId}`);
  assert.equal(out.status, 200);
  assert.ok(Array.isArray(out.body.lines));
  /* Nothing has been applied for in this month, so it is empty rather than
     wrong - and the totals still answer. */
  assert.equal(out.body.totals.open, out.body.lines.filter((l) => l.open).length);
  assert.equal(
    out.body.totals.buckets.reduce((n, b) => n + b.count, 0),
    out.body.totals.open
  );
});

test('days cannot be encashed off a ledger nobody has started', async () => {
  const fresh = (await call('POST', '/api/employees', {
    company_id: (await call('GET', '/api/companies')).body.companies[0].id,
    name: 'Nisha Rao', monthly_salary: 20000, joined_on: '2026-01-01', cl_quota: 7,
  })).body;

  /* Her ledger reads 7 - but nothing is posted, so the 7 is an assumption
     and the first entry would END it. Encashing 3 used to leave her on
     MINUS 3, which reads as a debt she does not owe. */
  const before = (await call('GET', `/api/leave/ledger/${fresh.id}?year=2026`)).body
    .ledgers.find((l) => l.code === 'CL');
  assert.equal(before.summary.closing, 7);
  assert.equal(before.summary.posted, false);

  const no = await call('POST', '/api/leave/encash', {
    employee_id: fresh.id, code: 'CL', days: 3, year: 2026,
  });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /nothing has been posted/i);
  assert.match(no.body.error, /7-day entitlement/, 'it names what to do first');

  /* Start it properly, and then it works and the arithmetic holds. */
  assert.equal(
    (await call('POST', '/api/leave/credits', {
      employee_id: fresh.id, code: 'CL', kind: 'annual', days: 7, on_date: '2026-01-01',
    })).status,
    201
  );
  assert.equal(
    (await call('POST', '/api/leave/encash', {
      employee_id: fresh.id, code: 'CL', days: 3, year: 2026,
    })).status,
    201
  );
  const after = (await call('GET', `/api/leave/ledger/${fresh.id}?year=2026`)).body
    .ledgers.find((l) => l.code === 'CL');
  assert.equal(after.summary.closing, 4, '7 less the 3 encashed — not minus 3');
});
