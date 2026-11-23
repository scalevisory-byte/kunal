/**
 * HOW MANY MINUTES A DAY MAY BE OUT BEFORE IT COUNTS.
 *
 * Dinesh, looking at a live Time tab where the whole + / - column read a
 * dash: *"kuch logo me +- minutes kyu nahi aa rahi he"*. Nothing was wrong -
 * every day on that screen was inside the quarter of an hour the app has
 * always forgiven. His own figures that morning: +7, -11, +8, +13, -8, -15,
 * -10. Then: *"dikhavo"*.
 *
 * So the grace is a per-month figure now. A month opened from here on counts
 * every minute; a month already run keeps the 15 it was paid on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DAY_GRACE_FOR_NEW_MONTHS,
  TIME_RULES,
  dayGrace,
  minutesForMark,
  timesToDay,
} from '../../shared/timesheet.js';
import { monthlyHoursLine } from '../../shared/monthlyHours.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(path.join(here, '../../frontend/src', p), 'utf8');

/* His own seven days, read off the screenshot. */
const HIS_DAYS = [
  ['SHRANKHALA PATEL', '09:05', '18:12', 7],
  ['SUHANI KAPADNIS', '10:14', '19:03', -11],
  ['UTKARSH TIWARI', '10:13', '19:21', 8],
  ['VAIBHAV GUPTA', '12:05', '21:18', 13],
  ['VISHAL KATARIYA', '10:18', '19:10', -8],
  ['YASNA SARDHARA', '10:36', '19:21', -15],
  ['Zahid Shaikh', '10:26', '19:16', -10],
];

test('THE QUESTION: every one of his days was inside the 15-minute grace', () => {
  for (const [who, inAt, outAt, expected] of HIS_DAYS) {
    const day = { in_time: inAt, out_time: outAt, code: 'P' };
    const read = timesToDay(day, { hoursPerDay: 9, deductLunch: false });
    assert.equal(read.diff, expected, `${who} is ${expected} minutes off a nine-hour day`);
    /* On the old grace the column reads a dash... */
    assert.equal(
      minutesForMark(day, { hoursPerDay: 9, code: 'P', deductLunch: false, graceMinutes: 15 }),
      0,
      `${who} should be forgiven at 15`
    );
    /* ...and on 0 it reads the real figure. */
    assert.equal(
      minutesForMark(day, { hoursPerDay: 9, code: 'P', deductLunch: false, graceMinutes: 0 }),
      expected,
      `${who} should count at 0`
    );
  }
  /* YASNA is exactly 15 under, so the boundary is inclusive - it is forgiven
     at 15, which is what "may be out by 15" has to mean. */
  assert.equal(
    minutesForMark({ in_time: '10:36', out_time: '19:21', code: 'P' },
      { hoursPerDay: 9, code: 'P', deductLunch: false, graceMinutes: 15 }),
    0
  );
});

test('THE HALF THAT MADE IT CONFUSING: the month’s total always counted them', () => {
  /*
   * `monthlyHours` reads the clock times themselves, not this column, so the
   * grace never reached it. His three days read 0, 0, 0 on the grid and +9 in
   * the month - which is the figure the "Deduct the short hours" decision is
   * taken on.
   */
  const att = [
    { day: 2, code: 'P', in_time: '09:05', out_time: '18:12', minutes: 0 },
    { day: 3, code: 'P', in_time: '10:14', out_time: '19:03', minutes: 0 },
    { day: 4, code: 'P', in_time: '12:05', out_time: '21:18', minutes: 0 },
  ];
  const line = monthlyHoursLine(att, {
    employee: {}, period: { hours_per_day: 9, lunch_paid: 1 }, per_minute: 1.85,
  });
  assert.equal(line.diff, 9, '+7 -11 +13');
  assert.equal(att.reduce((t, a) => t + a.minutes, 0), 0, 'and the column said nothing');
});

test('a month with nothing stored keeps the old quarter of an hour', () => {
  /* Which is what every month already run was paid on. This is the whole of
     "nothing rewrites a stored value" for this release. */
  assert.equal(dayGrace({}), TIME_RULES.graceMinutes);
  assert.equal(dayGrace({ day_grace_minutes: null }), 15);
  assert.equal(dayGrace({ day_grace_minutes: '' }), 15);
  assert.equal(dayGrace({ day_grace_minutes: 'nonsense' }), 15, 'a typo falls back, never to 0');
  assert.equal(dayGrace({ day_grace_minutes: -5 }), 15);
  assert.equal(dayGrace({ day_grace_minutes: 999 }), 15, 'four hours is not a grace');
  /* And a real figure is taken at its word, 0 included. */
  assert.equal(dayGrace({ day_grace_minutes: 0 }), 0);
  assert.equal(dayGrace({ day_grace_minutes: 30 }), 30);
  assert.equal(dayGrace({ day_grace_minutes: '20' }), 20);
});

test('a new month counts every minute, and that is NOT the column default', () => {
  assert.equal(DEFAULT_DAY_GRACE_FOR_NEW_MONTHS, 0);
  assert.notEqual(
    DEFAULT_DAY_GRACE_FOR_NEW_MONTHS,
    TIME_RULES.graceMinutes,
    'the two are deliberately different: the column default is what EXISTING months keep'
  );
  const db = fs.readFileSync(path.join(here, '../src/db.js'), 'utf8');
  assert.match(db, /\['day_grace_minutes', 'INTEGER NOT NULL DEFAULT 15'\]/,
    'the migration must not move a stored month');
  assert.match(db, /day_grace_minutes:\s*\n?\s*input\.day_grace_minutes === undefined/,
    'createPeriod names the new default explicitly');
});

test('an omitted grace behaves exactly as it always did', () => {
  /*
   * Every caller that does not know about months - the punch importer's own
   * defaults, a test fixture - must come out byte for byte as before.
   */
  const day = { in_time: '09:05', out_time: '18:12', code: 'P' };
  const was = minutesForMark(day, { hoursPerDay: 9, code: 'P', deductLunch: false });
  assert.equal(was, 0, 'the old 15-minute rule, unchanged');
  assert.equal(
    was,
    minutesForMark(day, { hoursPerDay: 9, code: 'P', deductLunch: false, graceMinutes: undefined })
  );
});

test('every screen that stores or shows the figure reads the month’s own grace', () => {
  /*
   * The v2.0.0 lesson, exactly: the Time tab was the one screen that did not
   * read `period.lunch_paid`, and it is the one people type into. A grace
   * applied in four places and omitted in a fifth is the same bug.
   */
  for (const [file, needle] of [
    ['components/TimeSheet.jsx', /const grace = dayGrace\(period\);/],
    ['components/Attendance.jsx', /graceMinutes: dayGrace\(period\)/],
    ['localStore.js', /graceMinutes: dayGrace\(period \|\| \{\}\)/],
    ['components/admin/Settings.jsx', /graceMinutes: dayGrace\(period\)/],
  ]) {
    assert.match(src(file), needle, `${file} must use the month's grace`);
  }
  const db = fs.readFileSync(path.join(here, '../src/db.js'), 'utf8');
  assert.match(db, /const grace = dayGrace\(month \|\| \{\}\)/, 'the server write path');
  assert.match(db, /graceMinutes: grace/);
  for (const shared of ['inOutRegister.js', 'monthlyStatus.js']) {
    assert.match(
      fs.readFileSync(path.join(here, '../../shared', shared), 'utf8'),
      /dayGrace\(period\)/,
      `shared/${shared} must use the month's grace`
    );
  }
});

/* ================================================================= *
 * through the real server
 * ================================================================= */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'daygrace-'));
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

test('end to end: a new month counts every minute, an old one still forgives', async () => {
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const emp = (await call('POST', '/api/employees', {
    company_id: company.id, name: 'Shrankhala Patel', monthly_salary: 26000, joined_on: '2024-01-01',
  })).body;

  /* A month opened now. */
  const fresh = (await call('POST', '/api/periods', { year: 2027, month: 3, lunch_paid: 1 })).body;
  assert.equal(fresh.day_grace_minutes, 0, 'every minute counts');
  await call('GET', `/api/periods/${fresh.id}/payroll`);
  /* 09:05 to 18:12 is seven minutes over a nine-hour day. */
  await call('POST', `/api/periods/${fresh.id}/attendance`, {
    entries: [{ employee_id: emp.id, day: 3, code: 'P', in_time: '09:05', out_time: '18:12' }],
  });
  const onFresh = (await call('GET', `/api/periods/${fresh.id}/payroll`)).body
    .rows.find((r) => r.employee_id === emp.id);
  assert.equal(onFresh.attendance[3].minutes, 7, 'the server stored the real figure');

  /* A month set to the old grace - which is what every live month is. */
  const old = (await call('POST', '/api/periods', {
    year: 2027, month: 4, lunch_paid: 1, day_grace_minutes: 15,
  })).body;
  assert.equal(old.day_grace_minutes, 15);
  await call('GET', `/api/periods/${old.id}/payroll`);
  await call('POST', `/api/periods/${old.id}/attendance`, {
    entries: [{ employee_id: emp.id, day: 3, code: 'P', in_time: '09:05', out_time: '18:12' }],
  });
  const onOld = (await call('GET', `/api/periods/${old.id}/payroll`)).body
    .rows.find((r) => r.employee_id === emp.id);
  assert.equal(onOld.attendance[3].minutes, 0, 'the same day, forgiven');

  /* Switching one month leaves the other where it was. */
  await call('PATCH', `/api/periods/${old.id}`, { day_grace_minutes: 0 });
  const all = (await call('GET', '/api/periods')).body;
  const rows = all.periods || all;
  assert.equal(rows.find((p) => p.id === old.id).day_grace_minutes, 0);
  assert.equal(rows.find((p) => p.id === fresh.id).day_grace_minutes, 0);

  /* AND THE CHANGED RULE DOES NOT REACH BACK. The day keeps the 0 it was
     stored with until it is saved again - which is why the Time tab has a
     button that sweeps the month. */
  const after = (await call('GET', `/api/periods/${old.id}/payroll`)).body
    .rows.find((r) => r.employee_id === emp.id);
  assert.equal(after.attendance[3].minutes, 0, 'still the stored figure, not recomputed');
});
