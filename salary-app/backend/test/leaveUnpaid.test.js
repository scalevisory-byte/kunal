/**
 * v2.38.0: only casual and sick leave, both unpaid, against a yearly limit.
 *
 *   - a month that says so charges CL and SL a day each, exactly as UL;
 *     a month that does not is untouched (October keeps paying CL);
 *   - PL is retired: not offered on such a month, refused on an application,
 *     still readable on a day that already carries it;
 *   - the year's CL+SL is one balance against a limit; an application past it
 *     is refused, and an approval is checked again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { calculateRow, codesFor, markFor, absentDaysFromAttendance } from '../../shared/calc.js';
import { leaveLimitProblem, yearlyLeave, yearlyLine } from '../../shared/leavePolicy.js';

const row = { salary: 26000, pf: 0, esi: 0 };
const paid = { year: 2026, month: 10, working_days: 26, hours_per_day: 9, pt_threshold: 12000, pt_amount: 200, late_policy: 'none' };
const unpaid = { ...paid, month: 11, leave_unpaid: 1 };
const marks = { 2: 'P', 3: 'CL', 4: 'SL', 5: 'P' };

test('a month that charges leave takes a day for each CL and SL, exactly as UL', () => {
  const cl = calculateRow(row, unpaid, marks);
  const ul = calculateRow(row, unpaid, { 2: 'P', 3: 'UL', 4: 'UL', 5: 'P' });
  assert.equal(cl.absent_days, 2);
  assert.equal(cl.net_salary, ul.net_salary);
  assert.equal(cl.net_salary, 23800, "two days off 26,000, less PT");
});

test('a month that does not is untouched - nothing already paid moves', () => {
  const before = calculateRow(row, paid, marks);
  assert.equal(before.absent_days, 0);
  assert.equal(before.net_salary, 25800);
  assert.equal(absentDaysFromAttendance(marks), 0, 'no month given is the old rule');
});

test('the mark says so, and PL is retired from the pickers but still readable', () => {
  assert.match(markFor('CL', unpaid).label, /unpaid/);
  assert.equal(markFor('CL', paid).absent, 0);
  const codes = codesFor(unpaid);
  assert.equal(codes.PL.retired, true);
  assert.equal(codes.PL.absent, 0, 'a day already marked PL keeps its meaning');
  assert.equal(codesFor(paid).PL.retired, undefined);
  assert.equal(codes.UL.absent, 1);
});

test('the grid offers no retired mark except on the day that already has it', () => {
  const grid = fs.readFileSync(new URL('../../frontend/src/components/Attendance.jsx', import.meta.url), 'utf8');
  assert.match(grid, /const offered = \(codes, current\)/);
  assert.match(grid, /absentDaysFromAttendance\(merged, period\)/);
  const live = grid.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(live, /Object\.entries\(codes\)\.map/, 'a picker lists every mark again');
});

test('one balance: casual and sick together, never hiding a minus', () => {
  const y = yearlyLeave({ limit: 20, used: 22 });
  assert.equal(y.left, -2);
  assert.equal(y.over, true);
  assert.match(yearlyLine(y), /2 days over/);
  assert.match(yearlyLine(yearlyLeave({ limit: 20, used: 5 })), /5 days of 20 used · 15 days left/);
});

test('an application past the limit is refused, and what is waiting counts', () => {
  assert.equal(leaveLimitProblem({ limit: 20, used: 15, asking: 5 }), null);
  assert.match(leaveLimitProblem({ limit: 20, used: 15, asking: 6 }), /only 5 days of the yearly 20/);
  assert.match(leaveLimitProblem({ limit: 20, used: 15, waiting: 5, asking: 1 }), /used up/);
  assert.match(leaveLimitProblem({ limit: 20, used: 20, asking: 1 }), /no more leave can be applied for/);
});

/* ------------------------------- the API ------------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-unpaid-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function session() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

test('through the API: the rule reaches new months, the limit holds, PL is refused', async () => {
  const admin = session();
  const harish = session();
  await admin('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' });

  // An empty install starts with the rule off.
  assert.equal((await admin('GET', '/api/leave/policy')).body.policy.on, false);
  const oct = (await admin('POST', '/api/periods', { year: 2026, month: 10 })).body;
  assert.equal(Number(oct.leave_unpaid ?? oct.period?.leave_unpaid), 0);

  const set = await admin('PUT', '/api/leave/policy', { on: true, from: '2026-11', yearly_limit: 3 });
  assert.equal(set.status, 200);
  assert.equal(set.body.policy.yearly_limit, 3);
  const nov = (await admin('POST', '/api/periods', { year: 2026, month: 11 })).body;
  const novId = nov.id ?? nov.period?.id;
  assert.equal(Number(nov.leave_unpaid ?? nov.period?.leave_unpaid), 1, 'a month on or after the date opens charging it');

  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const him = (await admin('POST', '/api/employees', { company_id: company.id, name: 'Harish Gupta', monthly_salary: 26000 })).body;
  const slip = (await admin('POST', '/api/auth/staff', { employee_ids: [him.id] })).body.made[0];
  assert.equal((await harish('POST', '/api/auth/login', { username: slip.username, password: slip.password })).status, 200);

  // Two days already marked on the grid.
  await admin('POST', `/api/periods/${novId}/attendance`, {
    entries: [
      { employee_id: him.id, day: 2, code: 'CL' },
      { employee_id: him.id, day: 3, code: 'SL' },
    ],
  });
  const register = (await admin('GET', '/api/leave?year=2026')).body;
  const line = register.rows.find((r) => r.employee_id === him.id);
  assert.equal(line.yearly.used, 2);
  assert.equal(line.yearly.left, 1);

  // PL is no longer given.
  const pl = await harish('POST', '/api/me/requests', { period_id: novId, day: 10, kind: 'leave', code: 'PL', reason: 'family' });
  assert.equal(pl.status, 400);
  assert.match(pl.body.error, /privilege leave is no longer given/);

  // Two days asked, one left: refused, by name.
  const two = await harish('POST', '/api/me/requests', { period_id: novId, day: 10, to_day: 11, kind: 'leave', code: 'CL', reason: 'wedding' });
  assert.equal(two.status, 400);
  assert.match(two.body.error, /only 1 day of the yearly 3/);

  // One day fits - and then a second application has nothing left.
  const one = await harish('POST', '/api/me/requests', { period_id: novId, day: 10, kind: 'leave', code: 'SL', reason: 'fever' });
  assert.equal(one.status, 201);
  const again = await harish('POST', '/api/me/requests', { period_id: novId, day: 12, kind: 'leave', code: 'CL', reason: 'errand' });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /used up/);

  // The office's queue shows the yearly balance beside it.
  const queue = (await admin('GET', '/api/attendance/requests')).body;
  const mine = (queue.requests || queue).find((r) => r.id === one.body.id);
  assert.equal(mine.leave_balance.yearly, true);
  assert.equal(mine.leave_balance.after, 0);

  // Approving writes the day, and the day costs pay.
  const ok = await admin('POST', `/api/attendance/requests/${one.body.id}/decide`, { approve: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const pay = (await admin('GET', `/api/periods/${novId}/payroll`)).body;
  const r = pay.rows.find((x) => x.employee_id === him.id);
  assert.equal(r.absent_days, 3, 'CL, SL and the approved SL each cost a day');

  // His own page reads one balance.
  const own = (await harish('GET', '/api/me/leave?year=2026')).body;
  assert.equal(own.balance.yearly.used, 3);
  assert.equal(own.balance.yearly.left, 0);
});
