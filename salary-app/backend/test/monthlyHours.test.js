import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MONTHLY_GRACE,
  describeMonthlyHours,
  monthlyHoursLine,
  onMonthlyHours,
} from '../../shared/monthlyHours.js';
import { POLICY } from '../../shared/lateEarly.js';
import { calculateRow } from '../../shared/calc.js';

const period = { hours_per_day: 9, pt_threshold: 12000, pt_amount: 200 };
const monthly = { ...period, late_policy: 'monthly' };

const fullMonth = (overrides = {}) => {
  const att = {};
  for (let d = 1; d <= 26; d += 1) att[d] = { code: 'P', in_time: '09:30', out_time: '18:30' };
  return { ...att, ...overrides };
};

/* ================================================================= *
 * the total
 * ================================================================= */

test('nine hours times twenty-six days is two hundred and thirty-four', () => {
  const line = monthlyHoursLine(fullMonth(), { period: monthly });
  assert.equal(line.expected, 234 * 60);
  assert.equal(line.worked, 234 * 60);
  assert.equal(line.diff, 0);
  assert.equal(line.days, 26);
  assert.match(describeMonthlyHours(line), /234h 00m owed/);
});

test('a day short and a day long CANCEL — which is the whole rule', () => {
  const line = monthlyHoursLine(
    fullMonth({
      5: { code: 'P', in_time: '09:30', out_time: '17:30' }, // an hour short
      9: { code: 'P', in_time: '09:30', out_time: '19:30' }, // an hour long
    }),
    { period: monthly }
  );
  assert.equal(line.diff, 0);
  assert.equal(line.chargeable, 0);
});

test('only what is missing from the TOTAL is charged', () => {
  const line = monthlyHoursLine(
    fullMonth({ 5: { code: 'P', in_time: '09:30', out_time: '16:30' } }), // two hours short
    { period: monthly, per_minute: 2 }
  );
  assert.equal(line.diff, -120);
  assert.equal(line.chargeable, -120);
  assert.equal(line.amount, -240);
  assert.match(describeMonthlyHours(line), /2h 00m short/);
});

test('hours over the total are owed as overtime, not thrown away', () => {
  const line = monthlyHoursLine(
    fullMonth({ 5: { code: 'P', in_time: '09:30', out_time: '20:30' } }),
    { period: monthly, per_minute: 2 }
  );
  assert.equal(line.diff, 120);
  assert.equal(line.amount, 240);
  assert.match(describeMonthlyHours(line), /2h 00m over/);
});

/* ================================================================= *
 * the thing it exists to get right
 * ================================================================= */

test('AN ABSENCE LOWERS THE TARGET — it must never be charged twice', () => {
  /*
   * Two days absent have ALREADY come off the salary as two days. Keeping the
   * target at a flat 234 would then also charge the eighteen hours they were
   * not there for - the same two days taken twice.
   */
  const line = monthlyHoursLine(fullMonth({ 7: { code: 'A' }, 8: { code: 'A' } }), {
    period: monthly,
  });
  assert.equal(line.days, 24);
  assert.equal(line.expected, 24 * 9 * 60);
  assert.equal(line.diff, 0, 'somebody absent two days came out short as well');
});

test('leave, a holiday, a weekly off and a half day add nothing to the target either', () => {
  for (const code of ['CL', 'SL', 'PL', 'UL', 'PH', 'S', 'HF', 'AD', 'SP', 'HP']) {
    const line = monthlyHoursLine(fullMonth({ 11: { code } }), { period: monthly });
    assert.equal(line.days, 25, `${code} was counted towards the target`);
    assert.equal(line.diff, 0, `${code} left them short`);
  }
});

test('a day nobody clocked counts on NEITHER side', () => {
  /*
   * No in time means "not known". Booking nine hours against somebody and
   * crediting none would deduct a whole day from a person who was there and
   * simply did not punch.
   */
  const line = monthlyHoursLine(fullMonth({ 14: { code: 'P' } }), { period: monthly });
  assert.equal(line.days, 25);
  assert.equal(line.expected, 25 * 9 * 60);
  assert.equal(line.diff, 0);
});

test('a whole month with no clock times is NOT judged', () => {
  const att = {};
  for (let d = 1; d <= 26; d += 1) att[d] = { code: 'P' };
  const line = monthlyHoursLine(att, { period: monthly });
  assert.equal(line.judged, false);
  assert.equal(line.diff, 0);
  assert.match(describeMonthlyHours(line), /nothing is judged/);
});

test('minutes typed straight onto an unclocked day still stand', () => {
  // Somebody put "40 minutes short" there on purpose; dropping it would
  // quietly forgive it.
  const line = monthlyHoursLine(fullMonth({ 14: { code: 'P', minutes: -40 } }), {
    period: monthly,
  });
  assert.equal(line.typed, -40);
  assert.equal(line.diff, -40);
});

/* ================================================================= *
 * the grace
 * ================================================================= */

test('the monthly grace is zero by default, and only forgives a shortfall', () => {
  assert.equal(DEFAULT_MONTHLY_GRACE, 0);
  const tight = monthlyHoursLine(fullMonth({ 5: { code: 'P', in_time: '09:30', out_time: '18:00' } }), {
    period: monthly,
  });
  assert.equal(tight.chargeable, -30);

  const lenient = monthlyHoursLine(
    fullMonth({ 5: { code: 'P', in_time: '09:30', out_time: '18:00' } }),
    { period: { ...monthly, monthly_hours_grace: 60 } }
  );
  assert.equal(lenient.diff, -30);
  assert.equal(lenient.chargeable, 0, 'within the grace');

  // It is not a floor under overtime: an hour over is still an hour over.
  const over = monthlyHoursLine(fullMonth({ 5: { code: 'P', in_time: '09:30', out_time: '19:30' } }), {
    period: { ...monthly, monthly_hours_grace: 120 },
  });
  assert.equal(over.minutes, 60);
});

/* ================================================================= *
 * one of three, never two
 * ================================================================= */

test('the policy switch is recognised and defaults to hours', () => {
  assert.equal(onMonthlyHours({}), false);
  assert.equal(onMonthlyHours({ late_policy: 'hours' }), false);
  assert.equal(onMonthlyHours({ late_policy: 'concession' }), false);
  assert.equal(onMonthlyHours({ late_policy: 'monthly' }), true);
  assert.equal(POLICY.monthly, 'monthly');
});

const withStoredMinutes = (overrides = {}) => {
  const att = fullMonth(overrides);
  for (const [d, entry] of Object.entries(att)) {
    // What setAttendance would have stored per day, grace and all.
    if (d === '5' && entry.out_time === '17:30') att[d] = { ...entry, minutes: -60 };
    else att[d] = { ...entry, minutes: 0 };
  }
  return att;
};

test('NO EXISTING MONTH MOVES — the default policy is untouched', () => {
  const att = withStoredMinutes({ 5: { code: 'P', in_time: '09:30', out_time: '17:30' } });
  const before = calculateRow({ salary: 26000 }, period, att);
  assert.equal(before.late_policy, 'hours');
  assert.equal(before.ot_minutes, -60);
  // The monthly line is still WORKED OUT, so a switch can be priced - and it
  // is worth nothing while the month is not on it.
  assert.equal(before.monthly_hours_expected, 234 * 60);
  assert.equal(before.monthly_hours_diff, -60);
  assert.equal(before.net_salary, calculateRow({ salary: 26000 }, period, att).net_salary);
});

test('on the monthly policy the DAILY minutes are not charged as well', () => {
  /*
   * The same trap as the concession: somebody an hour short on Tuesday is
   * already an hour short in the month's total. One rule, never two.
   */
  const att = withStoredMinutes({
    5: { code: 'P', in_time: '09:30', out_time: '17:30' },
    9: { code: 'P', in_time: '09:30', out_time: '19:30' },
  });
  // The stored daily figures say an hour short (the long day was never
  // re-stored), but the month's own account says they are square.
  const row = calculateRow({ salary: 26000 }, monthly, att);
  assert.equal(row.late_policy, 'monthly');
  assert.equal(row.ot_minutes, 0);
  assert.equal(row.net_salary, calculateRow({ salary: 26000 }, monthly, withStoredMinutes()).net_salary);
});

test('a typed figure on the sheet still beats every policy', () => {
  const att = withStoredMinutes({ 5: { code: 'P', in_time: '09:30', out_time: '16:30' } });
  const row = calculateRow({ salary: 26000, ot_minutes_override: -15 }, monthly, att);
  assert.equal(row.ot_minutes, -15);
});

test('a part-timer’s month owes their own hours, not nine a day', () => {
  const att = {};
  for (let d = 1; d <= 26; d += 1) att[d] = { code: 'P', in_time: '10:00', out_time: '16:00' };
  const line = monthlyHoursLine(att, {
    employee: { shift_in: '10:00', shift_out: '16:00' },
    period: monthly,
  });
  assert.equal(line.expected, 26 * 6 * 60);
  assert.equal(line.diff, 0, 'a six-hour day judged against nine');
});

/* ================================================================= *
 * turning it on, from now
 * ================================================================= */

import { DEFAULT_POLICY_FOR_NEW_MONTHS } from '../../shared/lateEarly.js';

process.env.DATA_DIR = (await import('node:fs')).mkdtempSync(
  (await import('node:path')).join((await import('node:os')).tmpdir(), 'monthlyon-')
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

test('a month opened from now starts on the monthly rule', async () => {
  assert.equal(DEFAULT_POLICY_FOR_NEW_MONTHS, 'monthly');
  const made = (await call('POST', '/api/periods', { year: 2027, month: 1 })).body;
  assert.equal(made.late_policy, 'monthly');
});

test('AND A MONTH ALREADY OPEN IS NOT TOUCHED', async () => {
  /*
   * The whole reason the policy is per month: a rule chosen in December must
   * not rewrite a payslip paid in November. Nothing in this release rewrites
   * a stored value - the month open when it is installed has to be switched
   * by hand, with the cost on screen first.
   */
  const old = (await call('POST', '/api/periods', { year: 2027, month: 2, late_policy: 'hours' })).body;
  assert.equal(old.late_policy, 'hours');

  // Reading it, and reading its payroll, leaves it alone.
  await call('GET', `/api/periods/${old.id}/payroll`);
  const again = (await call('GET', '/api/periods')).body;
  const same = (again.periods || again).find((p) => p.id === old.id);
  assert.equal(same.late_policy, 'hours');
});

test('switching one month on does not switch any other', async () => {
  const a = (await call('POST', '/api/periods', { year: 2027, month: 3, late_policy: 'hours' })).body;
  const b = (await call('POST', '/api/periods', { year: 2027, month: 4, late_policy: 'hours' })).body;
  await call('PATCH', `/api/periods/${a.id}`, { late_policy: 'monthly' });
  const all = (await call('GET', '/api/periods')).body;
  const rows = all.periods || all;
  assert.equal(rows.find((p) => p.id === a.id).late_policy, 'monthly');
  assert.equal(rows.find((p) => p.id === b.id).late_policy, 'hours');
});

test('the write route cannot change what the monthly rule charges', async () => {
  /*
   * Typed on the Time tab with a minutes figure, straight through the API
   * with none, and through an approved missing-punch request. On this rule
   * the clock times are the record, so all three must come out the same -
   * the typed `minutes: 0` does not forgive the day.
   */
  const company = (await call('POST', '/api/companies', { name: 'ROUTES' })).body;
  const mk = async (name) =>
    (await call('POST', '/api/employees', {
      company_id: company.id, name, monthly_salary: 26000, joined_on: '2024-01-01',
    })).body;
  const typed = await mk('Typed Tarun');
  const punched = await mk('Punched Pooja');

  const p = (await call('POST', '/api/periods', { year: 2027, month: 6 })).body;
  assert.equal(p.late_policy, 'monthly');
  await call('GET', `/api/periods/${p.id}/payroll`);

  const hours = { in_time: '09:52', out_time: '18:20' }; // 32 minutes short
  const entries = [];
  for (const day of [10, 11, 12]) {
    entries.push({ employee_id: typed.id, day, code: 'P', ...hours, minutes: 0 });
    entries.push({ employee_id: punched.id, day, ...hours });
  }
  await call('POST', `/api/periods/${p.id}/attendance`, { entries });

  const rows = (await call('GET', `/api/periods/${p.id}/payroll`)).body.rows;
  const a = rows.find((r) => r.employee_id === typed.id);
  const b = rows.find((r) => r.employee_id === punched.id);
  assert.equal(a.monthly_hours_diff, -96, 'three days, 32 minutes each');
  assert.equal(a.monthly_hours_diff, b.monthly_hours_diff, 'the route changed the figure');
  assert.equal(a.ot_minutes, b.ot_minutes);
  assert.equal(a.net_salary, b.net_salary);
});
