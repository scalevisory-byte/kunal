/**
 * The yearly leave bonus from the employment contract (v2.48.0).
 *
 *   Up to 20 leaves: 20 days' pay at salary / 30. 21-30: 75%. 31-40: 50%.
 *   41 or more: nothing. No bonus in the first year; pro rata after it.
 *
 * And the two rules every bonus here keeps: looking pays nobody, and a year
 * with nothing marked is not a year with no leave. Plus one of its own:
 * paid ONCE A YEAR, whichever month it is paid into.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_YEAR_RULE as R, normaliseYearRule, serviceShare, slabFor, yearBonusFor } from '../../shared/leaveBonusYear.js';

const anish = { id: 1, name: 'Anish', monthly_salary: 45000, joined_on: '2024-04-01' };
const run = (counts, e = anish, marked = 250) => yearBonusFor(e, counts, R, { year: 2026, marked_days: marked });

test('the contract’s figures: 20 days at salary ÷ 30, by slab', () => {
  assert.equal(run({ CL: 10 }).amount, 30000, '20 × 45,000 ÷ 30');
  assert.equal(run({ CL: 20 }).amount, 30000, 'exactly 20 is still the full bonus');
  assert.equal(run({ CL: 20, HF: 1 }).pct, 75, '20.5 is past 20');
  assert.equal(run({ CL: 30 }).amount, 22500);
  assert.equal(run({ UL: 31 }).amount, 15000);
  assert.equal(run({ A: 40 }).amount, 15000);
  assert.equal(run({ A: 41 }).amount, 0);
});

test('an absence without approval counts two, as the contract says', () => {
  const line = run({ A: 15, AD: 5 });
  assert.equal(line.leaves, 25);
  assert.equal(line.pct, 75);
});

test('no bonus in the first year, pro rata after it, and the reason is said', () => {
  const first = run({}, { ...anish, joined_on: '2026-06-01' });
  assert.equal(first.amount, 0);
  assert.match(first.why, /first-year leave earns no bonus/);

  // A year completed on 1 July: half of the 20 days, judged on the leave taken.
  const half = run({ CL: 5 }, { ...anish, joined_on: '2025-07-02' });
  assert.ok(Math.abs(half.share - 0.5) < 0.01, String(half.share));
  assert.ok(Math.abs(half.amount - 30000 * half.share) < 20, 'share is shown rounded; the amount uses the exact share');

  const off = yearBonusFor({ ...anish, joined_on: '2025-07-02' }, { CL: 5 }, { ...R, pro_rata: false }, { year: 2026, marked_days: 100 });
  assert.equal(off.amount, 30000, 'pro rata can be switched off');

  const left = serviceShare({ joined_on: '2020-01-01', left_on: '2026-03-31' }, 2026, R);
  assert.ok(left.share > 0.24 && left.share < 0.25, 'somebody who left in March gets a quarter');
});

test('held, never guessed: nothing marked, no salary, no joining date', () => {
  assert.match(run({}, anish, 0).why, /nothing is marked/);
  assert.equal(run({}, anish, 0).held, true);
  assert.match(run({ CL: 1 }, { ...anish, monthly_salary: 0 }).why, /no monthly salary/);
  assert.match(run({ CL: 1 }, { ...anish, joined_on: null }).why, /no joining date/);
});

test('the slabs are data, and a broken rule falls back to the contract', () => {
  assert.deepEqual(slabFor(25, { ...R, slabs: [{ upto: 10, pct: 100 }, { upto: 50, pct: 40 }] }), { pct: 40, band: '11–50' });
  const r = normaliseYearRule({ slabs: [], breaks: [], divisor: 0 });
  assert.deepEqual(r.slabs, R.slabs);
  assert.ok(r.breaks.length, 'an empty list would make everybody "no leave"');
  assert.equal(r.divisor, 30);
});

/* --------------------------- through the server --------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bonus-year-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.ALLOW_OPEN = 'true';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('through the API: worked out, paid into one month, never paid twice in a year', async () => {
  const company = (await call('POST', '/api/companies', { name: 'BOOK N FLY' })).body;
  const add = async (name, extra) =>
    (await call('POST', '/api/employees', { company_id: company.id, name, monthly_salary: 30000, ...extra })).body;
  const old = await add('Old Hand', { joined_on: '2024-01-01' });
  const fresh = await add('New Joiner', { joined_on: '2026-06-01' });
  const nodate = await add('No Date', {});
  const blank = await add('Never Marked', { joined_on: '2024-01-01' });

  const oct = (await call('POST', '/api/periods', { year: 2026, month: 10 })).body.id;
  const nov = (await call('POST', '/api/periods', { year: 2026, month: 11 })).body.id;
  await call('GET', `/api/periods/${oct}/payroll`);
  await call('GET', `/api/periods/${nov}/payroll`);
  await call('POST', `/api/periods/${oct}/attendance`, {
    entries: [
      { employee_id: old.id, day: 1, code: 'P' },
      { employee_id: old.id, day: 2, code: 'CL' },
      { employee_id: old.id, day: 3, code: 'CL' },
      { employee_id: fresh.id, day: 1, code: 'P' },
      { employee_id: nodate.id, day: 1, code: 'P' },
    ],
  });

  const look = await call('GET', '/api/leave/bonus-year/2026');
  assert.equal(look.status, 200, JSON.stringify(look.body));
  const line = (id) => look.body.lines.find((l) => l.employee_id === id);
  assert.equal(line(old.id).leaves, 2);
  assert.equal(line(old.id).amount, 20000, '20 × 30,000 ÷ 30');
  assert.equal(line(fresh.id).amount, 0);
  assert.equal(line(nodate.id).held, true);
  assert.equal(line(blank.id).held, true);
  assert.deepEqual(look.body.months_on_record, [10], 'the screen says how much of the year it has');

  const before = (await call('GET', `/api/periods/${oct}/payroll?sync=false`)).body.rows.find((r) => r.employee_id === old.id);
  const paid = await call('POST', '/api/leave/bonus-year/2026/pay', {
    period_id: oct,
    lines: [{ employee_id: old.id, amount: 20000, days_off: 2 }],
  });
  assert.equal(paid.body.paid.length, 1, JSON.stringify(paid.body));
  const after = (await call('GET', `/api/periods/${oct}/payroll?sync=false`)).body.rows.find((r) => r.employee_id === old.id);
  assert.equal((after.addition || 0) - (before.addition || 0), 20000);
  assert.match(after.adjustment_note, /leave bonus 2026/);

  const again = await call('POST', '/api/leave/bonus-year/2026/pay', {
    period_id: nov,
    lines: [{ employee_id: old.id, amount: 20000 }],
  });
  assert.equal(again.body.paid.length, 0, 'once a year, whichever month');
  assert.match(again.body.skipped[0].why, /already paid in/);

  const later = await call('GET', '/api/leave/bonus-year/2026');
  assert.equal(later.body.lines.find((l) => l.employee_id === old.id).already_paid, true);
});
