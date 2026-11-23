import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY_FOR_NEW_MONTHS, POLICY, POLICY_CHOICES, onConcession } from '../../shared/lateEarly.js';
import { onMonthlyHours } from '../../shared/monthlyHours.js';
import { calculateRow } from '../../shared/calc.js';

/**
 * BOTH RULES AT ONCE, AND THE ONE THING IT MUST NOT DO.
 *
 * Dinesh turned the monthly target on, then asked for the late/early
 * concession too. They answer different questions - did the hours go in, and
 * did somebody turn up on time - so they are not the same offence. What they
 * share is the person who is late and never makes it up: those minutes are in
 * both counts, and adding the two would take them twice.
 */

const period = {
  hours_per_day: 9,
  pt_threshold: 12000,
  pt_amount: 200,
  shift_in: '09:30',
  shift_out: '18:30',
  late_concession_minutes: 300,
};
const on = (policy) => ({ ...period, late_policy: policy });

const month = (times) => {
  const att = {};
  for (let d = 1; d <= 26; d += 1) att[d] = { code: 'P', ...times, minutes: 0 };
  return att;
};
const run = (policy, times, row = {}) =>
  calculateRow({ salary: 26000, ...row }, on(policy), month(times));

/* 40 minutes late every day: 1,040 minutes, 300 free, 740 chargeable. */
const LATE_BUT_COMPLETE = { in_time: '10:10', out_time: '19:10' }; // nine hours done
const LATE_AND_SHORT = { in_time: '10:10', out_time: '18:30' }; // 40 min short as well

test('the policy is recognised by both rules at once', () => {
  assert.equal(POLICY.monthlyLate, 'monthly_late');
  assert.equal(onMonthlyHours({ late_policy: 'monthly_late' }), true);
  assert.equal(onConcession({ late_policy: 'monthly_late' }), true);
  // And the other three are unchanged.
  assert.equal(onConcession({ late_policy: 'monthly' }), false);
  assert.equal(onMonthlyHours({ late_policy: 'concession' }), false);
  assert.equal(onConcession({}), false);
  assert.equal(onMonthlyHours({}), false);
});

test('somebody who DID their hours but came in late is charged for the lateness', () => {
  /*
   * This is the whole reason for running both: the monthly target alone sees
   * nine hours a day and charges nothing, however late they walked in.
   */
  const monthlyOnly = run('monthly', LATE_BUT_COMPLETE);
  assert.equal(monthlyOnly.ot_minutes, 0, 'their hours are complete');
  assert.equal(monthlyOnly.late_salary, 0);

  const both = run('monthly_late', LATE_BUT_COMPLETE);
  assert.equal(both.ot_minutes, 0, 'the hours are still complete');
  assert.ok(both.late_salary > 0, 'and the lateness is charged');
  assert.equal(both.late_salary, run('concession', LATE_BUT_COMPLETE).late_salary);
  assert.ok(both.net_salary < monthlyOnly.net_salary);
});

test('THE SAME MINUTES ARE NEVER CHARGED TWICE', () => {
  /*
   * Late AND gone on time: the same 1,040 minutes are missing from the
   * month's total and sitting in the late pool. Added, they would be taken
   * twice. The month is charged the GREATER of the two.
   */
  const monthlyOnly = run('monthly', LATE_AND_SHORT);
  const concessionOnly = run('concession', LATE_AND_SHORT);
  const both = run('monthly_late', LATE_AND_SHORT);

  const costOf = (r) => 26000 - r.net_salary;
  assert.ok(costOf(monthlyOnly) > 0 && costOf(concessionOnly) > 0, 'both rules bite here');

  assert.equal(
    costOf(both),
    Math.max(costOf(monthlyOnly), costOf(concessionOnly)),
    'the greater of the two'
  );
  assert.ok(
    costOf(both) < costOf(monthlyOnly) + costOf(concessionOnly),
    'adding them would have charged the same minutes twice'
  );
});

test('and it is never LESS than either rule alone would have charged', () => {
  for (const times of [LATE_BUT_COMPLETE, LATE_AND_SHORT, { in_time: '09:30', out_time: '18:00' }]) {
    const both = run('monthly_late', times);
    for (const alone of ['monthly', 'concession']) {
      assert.ok(
        26000 - both.net_salary >= 26000 - run(alone, times).net_salary - 0.01,
        `${alone} charged more than both together`
      );
    }
  }
});

test('a month where nobody is late or short is untouched by it', () => {
  const clean = { in_time: '09:30', out_time: '18:30' };
  const plain = run('hours', clean);
  const both = run('monthly_late', clean);
  assert.equal(both.net_salary, plain.net_salary);
  assert.equal(both.late_salary, 0);
  assert.equal(both.ot_minutes, 0);
});

test('overtime still pays, and the lateness is still charged beside it', () => {
  // In late, out very late: the month is OVER its total and still late.
  const both = run('monthly_late', { in_time: '10:10', out_time: '20:10' });
  assert.ok(both.ot_minutes > 0, 'the extra hours are owed');
  assert.ok(both.late_salary > 0, 'and turning up late still costs');
});

test('the row says which rule it ran on', () => {
  assert.equal(run('hours', LATE_AND_SHORT).late_policy, 'hours');
  assert.equal(run('concession', LATE_AND_SHORT).late_policy, 'concession');
  assert.equal(run('monthly', LATE_AND_SHORT).late_policy, 'monthly');
  assert.equal(run('monthly_late', LATE_AND_SHORT).late_policy, 'monthly_late');
});

test('a typed OT figure still beats all four', () => {
  const r = run('monthly_late', LATE_AND_SHORT, { ot_minutes_override: -15 });
  assert.equal(r.ot_minutes, -15);
});

/*
 * REWRITTEN, not patched. v1.84 opened new months on both rules; v2.6.0
 * opens them on `none` - Dinesh: *"Salary count sirf absent present half day
 * se hi ho"*. Both rules are still here, still priced and still one switch
 * away; what changed is where a month STARTS.
 */
test('a new month opens on the days alone, and both rules are still offered', () => {
  assert.equal(DEFAULT_POLICY_FOR_NEW_MONTHS, 'none');
  assert.ok(
    POLICY_CHOICES.some((c) => c.key === 'monthly_late'),
    'the combined rule must still be choosable'
  );
});

/* ================================================================= *
 * through the real server
 * ================================================================= */

process.env.DATA_DIR = (await import('node:fs')).mkdtempSync(
  (await import('node:path')).join((await import('node:os')).tmpdir(), 'both-')
);
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.APP_PASSWORD = 'open-sesame';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (m, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method: m,
    headers: { authorization: 'Bearer open-sesame', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('the server opens a month on the days alone, and keeps every older month where it was', async () => {
  const fresh = (await call('POST', '/api/periods', { year: 2028, month: 1 })).body;
  assert.equal(fresh.late_policy, 'none');

  const old = (await call('POST', '/api/periods', { year: 2028, month: 2, late_policy: 'hours' })).body;
  assert.equal(old.late_policy, 'hours');
  await call('GET', `/api/periods/${old.id}/payroll`);
  const rows = (await call('GET', '/api/periods')).body;
  assert.equal((rows.periods || rows).find((p) => p.id === old.id).late_policy, 'hours');
});

test('an unrecognised rule still falls back to hours, never to a rule nobody chose', async () => {
  const p = (await call('POST', '/api/periods', { year: 2028, month: 3 })).body;
  const patched = (await call('PATCH', `/api/periods/${p.id}`, { late_policy: 'whatever' })).body;
  assert.equal(patched.late_policy, 'hours');
});
