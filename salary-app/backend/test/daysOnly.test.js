/**
 * SALARY FROM THE DAY COUNT ALONE - `POLICY.none`.
 *
 * Dinesh: *"Salary count sirf absent presnet half day se hi ho / Monthly
 * hour wala manual coloum do / Count karna he ki nahi uske liye"*.
 *
 * The claim this file exists to pin: on this rule the clock changes nobody's
 * pay. Hours are still read, still counted, still shown on the salary sheet
 * and still exported - they simply do not move a rupee unless somebody types
 * a figure into the month's own OT/LT box, which is the manual column he
 * asked for and which has beaten every policy since the sheet was built.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { calculateRow } from '../../shared/calc.js';
import {
  DEFAULT_POLICY_FOR_NEW_MONTHS,
  POLICY,
  POLICY_CHOICES,
  normalisePolicy,
  onConcession,
  onDaysOnly,
} from '../../shared/lateEarly.js';
import { onMonthlyHours } from '../../shared/monthlyHours.js';
import { minutesForMark } from '../../shared/timesheet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(path.join(here, '../../frontend/src', p), 'utf8');

const month = (policy, extra = {}) => ({
  year: 2026, month: 11, working_days: 26, hours_per_day: 9,
  late_policy: policy, lunch_paid: 0, pt_threshold: 12000, pt_amount: 200, ...extra,
});
/*
 * 12 working days.
 *
 * THE FIXTURE MODELS THE PIPELINE, and the first draft did not. `setAttendance`
 * works the day's minutes out on the way IN and stores them on the row; a
 * fixture carrying clock times and no `minutes` leaves the day-by-day rule
 * with nothing to charge, so every assertion here passed with the days-only
 * branch deleted. Proved by putting the old code back: 1 of 13 failed, and
 * it was the end-to-end one. Same trap as v1.82.
 */
const days = (inAt, outAt, over = {}) =>
  Array.from({ length: 12 }, (_, i) => ({
    day: i + 2,
    code: 'P',
    in_time: inAt,
    out_time: outAt,
    minutes: minutesForMark(
      { in_time: inAt, out_time: outAt, code: 'P' },
      { hoursPerDay: 9, code: 'P', deductLunch: true }
    ),
    ...over,
  }));

test('a new month opens on the days alone', () => {
  assert.equal(DEFAULT_POLICY_FOR_NEW_MONTHS, POLICY.none);
  assert.ok(onDaysOnly(month(POLICY.none)));
  /* And it is NEITHER of the two rules that charge, which is the whole
     point - both predicates are asked separately in `calculateRow`. */
  assert.equal(onConcession(month(POLICY.none)), false);
  assert.equal(onMonthlyHours(month(POLICY.none)), false);
});

test('THE CLAIM: short hours change nobody’s pay on this rule', () => {
  const row = { salary: 26000, pf: 0, esi: 0 };
  /* An hour short every day for twelve days - twelve hours missing. */
  const short = calculateRow({ ...row }, month(POLICY.none), days('09:30', '17:30'));
  const exact = calculateRow({ ...row }, month(POLICY.none), days('09:30', '18:30'));
  const none = calculateRow({ ...row }, month(POLICY.none),
    Array.from({ length: 12 }, (_, i) => ({ day: i + 2, code: 'P' })));

  for (const key of ['gross_salary', 'net_salary', 'pt', 'present_days', 'absent_days']) {
    assert.equal(short[key], exact[key], `${key} moved on a short month`);
    assert.equal(short[key], none[key], `${key} differs from a month with no clock at all`);
  }
  assert.equal(short.ot_minutes, 0);
  assert.equal(short.ot_salary, 0);
  assert.equal(short.late_salary, 0);
  assert.equal(short.net_salary, 25800, '26,000 less PT - the day count, nothing else');
});

test('and overtime is not PAID either - it is the day count or nothing', () => {
  const row = { salary: 26000, pf: 0, esi: 0 };
  const long = calculateRow({ ...row }, month(POLICY.none), days('09:30', '19:30'));
  assert.equal(long.ot_salary, 0, 'an extra hour a day pays nothing on this rule');
  assert.equal(long.net_salary, 25800);
  /* Half the reason to say it out loud: on the monthly rule it DOES pay. */
  const onMonthly = calculateRow({ ...row }, month(POLICY.monthly), days('09:30', '19:30'));
  assert.ok(onMonthly.ot_salary > 0, 'the comparison this test rests on');
});

test('lateness is not charged on this rule either', () => {
  const row = { salary: 26000, pf: 0, esi: 0 };
  /* An hour late in and an hour late out - the hours are complete, so only
     the concession would ever bite, and here it does not. */
  const late = calculateRow({ ...row }, month(POLICY.none), days('10:30', '19:30'));
  assert.ok(late.late_minutes > 300, 'the lateness is still counted');
  assert.equal(late.late_salary, 0, 'and still costs nothing');
  const onConcessionRule = calculateRow({ ...row }, month(POLICY.concession), days('10:30', '19:30'));
  assert.ok(onConcessionRule.late_salary > 0, 'the comparison this test rests on');
});

test('the month’s hours are STILL worked out, because the sheet shows them', () => {
  const r = calculateRow({ salary: 26000, pf: 0, esi: 0 }, month(POLICY.none), days('09:30', '17:30'));
  assert.equal(r.monthly_hours_judged, true);
  assert.equal(r.monthly_hours_days, 12);
  assert.equal(r.monthly_hours_expected, 12 * 540);
  assert.equal(r.monthly_hours_diff, -12 * 60, 'an hour short a day, read off the clock');
  /* What it WOULD have been worth, so the office can price the decision. */
  assert.ok(r.monthly_hours_amount < 0);
  /* But none of it reached the pay. */
  assert.equal(r.ot_salary, 0);
});

test('a day nobody clocked reads as NOT KNOWN, never as nought hours', () => {
  const r = calculateRow({ salary: 26000, pf: 0, esi: 0 }, month(POLICY.none),
    Array.from({ length: 12 }, (_, i) => ({ day: i + 2, code: 'P' })));
  assert.equal(r.monthly_hours_judged, false, 'false is "not known" - a number could not say it');
  assert.equal(r.monthly_hours_days, 0);
});

test('THE MANUAL COLUMN: a typed figure still wins, exactly as it always has', () => {
  const base = { salary: 26000, pf: 0, esi: 0 };
  const exact = days('09:30', '18:30');
  /* Nothing was short - and the office decides to take 120 minutes anyway. */
  const typed = calculateRow({ ...base, ot_minutes_override: -120 }, month(POLICY.none), exact);
  assert.equal(typed.ot_minutes, -120);
  assert.equal(typed.ot_salary, -222.22);
  assert.equal(typed.net_salary, 25578);
  /* And a typed PLUS pays. */
  const paid = calculateRow({ ...base, ot_minutes_override: 120 }, month(POLICY.none), exact);
  assert.equal(paid.ot_salary, 222.22);
  assert.ok(paid.net_salary > 25800);
  /* An amount typed over the minutes still wins over both. */
  const amount = calculateRow(
    { ...base, ot_minutes_override: -120, ot_amount_override: -500 },
    month(POLICY.none), exact
  );
  assert.equal(amount.ot_salary, -500);
});

test('an unrecognised rule falls back to hours, NOT to today’s default', () => {
  /*
   * Deliberate. A month must only ever arrive on the current default by
   * being opened today; a typo or a stale form landing one there would move
   * money with nobody having chosen it.
   */
  assert.equal(normalisePolicy('whatever'), POLICY.hours);
  assert.equal(normalisePolicy(''), POLICY.hours);
  assert.equal(normalisePolicy(undefined), POLICY.hours);
  assert.equal(normalisePolicy('none'), POLICY.none);
  assert.equal(normalisePolicy('MONTHLY_LATE'), POLICY.monthlyLate);
  /* Every policy there is can be asked for by name. */
  for (const c of POLICY_CHOICES) assert.equal(normalisePolicy(c.key), c.key);
  for (const value of Object.values(POLICY)) {
    assert.ok(POLICY_CHOICES.some((c) => c.key === value), `${value} is missing from the list`);
  }
});

test('the server and the offline build share one list of policies', () => {
  /*
   * Both kept their own hand-written `['concession','monthly','monthly_late']`
   * and both would have gone stale the moment a fifth was added - the same
   * drift as the hand-written `<option>`s in v1.85.
   */
  const db = fs.readFileSync(path.join(here, '../src/db.js'), 'utf8');
  const store = src('localStore.js');
  for (const [name, file] of [['db.js', db], ['localStore.js', store]]) {
    assert.match(file, /normalisePolicy/, `${name} must use the shared validator`);
    assert.ok(
      !/\['concession', 'monthly', 'monthly_late'\]/.test(file),
      `${name} still keeps its own copy of the list`
    );
  }
});

test('the salary sheet shows the month’s hours beside the box, read-only', () => {
  const sheet = src('components/SalarySheet.jsx');
  assert.match(sheet, /Month hrs/, 'the column has to be on the sheet');
  /* It is a plain cell, never an EditableCell - the figure comes off the
     clock and typing over it would be a second answer to one question. The
     box beside it is the one to type in. */
  const start = sheet.indexOf('{calc.monthly_hours_judged');
  assert.ok(start > -1, 'the cell renders the figure');
  const cell = sheet.slice(start, sheet.indexOf('</td>', start));
  assert.ok(!/EditableCell/.test(cell), 'the month-hours cell must not be editable');
  /* And it says "not known" rather than 0. */
  assert.match(sheet, /monthly_hours_judged[\s\S]{0,400}\\u2014|monthly_hours_judged[\s\S]{0,400}—/);
});

test('the Excel export carries it too, blank where nothing was clocked', async () => {
  const wb = fs.readFileSync(path.join(here, '../../shared/workbook.js'), 'utf8');
  assert.match(wb, /Month Hrs/, 'the export column');
  assert.match(wb, /monthly_hours_judged \? r\.monthly_hours_diff : ''/);
});

/* ================================================================= *
 * through the real server
 * ================================================================= */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'daysonly-'));
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
    headers: {
      authorization: 'Bearer open-sesame',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('end to end: a short month pays in full, and a typed figure takes it off', async () => {
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const emp = (await call('POST', '/api/employees', {
    company_id: company.id, name: 'Harish Gupta', monthly_salary: 26000, joined_on: '2024-01-01',
  })).body;
  const period = (await call('POST', '/api/periods', { year: 2026, month: 11 })).body;
  assert.equal(period.late_policy, 'none', 'opened on the days alone');
  await call('GET', `/api/periods/${period.id}/payroll`);

  /* Twelve days, an hour short on each, written the way the punch import
     and the Time tab both write them. */
  const entries = [];
  for (let day = 2; day <= 13; day += 1) {
    entries.push({ employee_id: emp.id, day, code: 'P', in_time: '09:30', out_time: '17:30' });
  }
  assert.equal((await call('POST', `/api/periods/${period.id}/attendance`, { entries })).status, 200);

  const got = (await call('GET', `/api/periods/${period.id}/payroll`)).body;
  const row = got.rows.find((r) => r.employee_id === emp.id);
  assert.equal(row.ot_salary, 0, 'twelve hours short, nothing charged');
  assert.equal(row.net_salary, 25800);
  /* The hours ARE there to look at - the sheet's new column reads them. */
  assert.equal(row.monthly_hours_diff, -720);
  assert.equal(row.monthly_hours_judged, true);

  /* Now the office decides it should count, and types it in. */
  const rowId = row.id;
  await call('PATCH', `/api/periods/${period.id}/rows/${rowId}`, { ot_minutes_override: -720 });
  const after = (await call('GET', `/api/periods/${period.id}/payroll`)).body
    .rows.find((r) => r.employee_id === emp.id);
  assert.equal(after.ot_minutes, -720);
  assert.ok(after.net_salary < 25800, 'the manual column really does take it off');
  assert.equal(after.overrides.ot_minutes, true);

  /* Clearing it hands the month back to its rule, which charges nothing. */
  await call('PATCH', `/api/periods/${period.id}/rows/${rowId}`, { ot_minutes_override: '' });
  const back = (await call('GET', `/api/periods/${period.id}/payroll`)).body
    .rows.find((r) => r.employee_id === emp.id);
  assert.equal(back.net_salary, 25800);
});

test('switching one month to the days alone does not touch any other', async () => {
  const a = (await call('POST', '/api/periods', {
    year: 2027, month: 5, late_policy: 'monthly_late',
  })).body;
  const b = (await call('POST', '/api/periods', {
    year: 2027, month: 6, late_policy: 'monthly_late',
  })).body;
  await call('PATCH', `/api/periods/${a.id}`, { late_policy: 'none' });
  const all = (await call('GET', '/api/periods')).body;
  const rows = all.periods || all;
  assert.equal(rows.find((p) => p.id === a.id).late_policy, 'none');
  assert.equal(rows.find((p) => p.id === b.id).late_policy, 'monthly_late', 'the other month stands');
});
