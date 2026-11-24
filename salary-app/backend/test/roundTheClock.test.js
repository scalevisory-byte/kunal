import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ATTENDANCE_CODES, calculateRow, daysPresent } from '../../shared/calc.js';
import { HOURS_EXPECTED, HOURS_NOT_READ, PAID_BY_THE_DAY, minutesForMark } from '../../shared/timesheet.js';
import { FULL_DAY_MARKS } from '../../shared/lateEarly.js';
import { WORKED_MARKS } from '../../shared/dailyReport.js';
import { PUNCH_MAY_SET } from '../../shared/bizcompassLogs.js';
import { REQUEST_KINDS, entriesFor } from '../../shared/attendanceRequests.js';
import { problemOf } from '../../shared/missingPunch.js';

/**
 * THE PEOPLE WHO DO NOT GO HOME, AND THE PEOPLE WHO ARE NOT HERE.
 *
 * Dinesh: *"Kuch log work from home karte he / Kuch log out of office se kam
 * karte he / Kuch log 24 hours ofc me rehte he / Unki punching kese hogi"*.
 *
 * Work from home was already whole. The other two:
 *
 *   OD  the mark and the GPS exemption existed; NOBODY COULD ASK for it, so a
 *       field day happened only if the office remembered to type it.
 *   DD  did not exist at all. The day went down as P, which owes nine hours
 *       the clock cannot measure on somebody who never leaves.
 */

const period = { year: 2026, month: 11, hours_per_day: 9, late_policy: 'hours', lunch_paid: 1 };
const employee = { salary: 26000 };

/** A month built the way `setAttendance` builds it - the mark decides the minutes. */
const monthOf = (code, days = 26, times = null) => {
  const out = {};
  for (let d = 1; d <= days; d++) {
    out[d] = {
      code,
      ...(times || {}),
      minutes: times ? minutesForMark(times, { code, hoursPerDay: 9, deductLunch: false }) : 0,
    };
  }
  return out;
};

test('A 24-HOUR DUTY DAY IS WORTH EXACTLY ONE DAY - no more and no less', () => {
  const asP = calculateRow({ ...employee }, period, monthOf('P'));
  const asDD = calculateRow({ ...employee }, period, monthOf('DD'));
  for (const key of ['gross_salary', 'net_salary', 'pt', 'absent_days', 'present_days', 'final_payable']) {
    assert.equal(asDD[key], asP[key], `${key} differs between a DD month and a P month`);
  }
  assert.equal(ATTENDANCE_CODES.DD.absent, 0);
  assert.equal(ATTENDANCE_CODES.DD.paid, true);
});

test('THE CLOCK IS NOT READ ON IT - 24 hours is not 15 hours of overtime', () => {
  const allDay = { in_time: '09:00', out_time: '23:59' };
  /* As P this is nearly six hours of overtime; the point is that DD is not. */
  assert.ok(minutesForMark(allDay, { code: 'P', hoursPerDay: 9, deductLunch: false }) > 300);
  assert.equal(minutesForMark(allDay, { code: 'DD', hoursPerDay: 9, deductLunch: false }), 0);
  /* And a short day on it is not charged either - the clock says nothing. */
  assert.equal(minutesForMark({ in_time: '09:00', out_time: '11:00' }, { code: 'DD', hoursPerDay: 9 }), 0);
  assert.ok(HOURS_NOT_READ.has('DD'));
});

test('...and that is a SECOND set, because the reason is not the Sunday one', () => {
  /* PAID_BY_THE_DAY is paid by the Sunday register, so the clock would pay
     twice. DD is paid by the monthly salary; the clock simply cannot describe
     it. Folding them together would lose both reasons. */
  assert.ok(!PAID_BY_THE_DAY.has('DD'), 'DD is not paid off the Sunday register');
  for (const code of PAID_BY_THE_DAY) assert.ok(!HOURS_NOT_READ.has(code));
});

test('a month-long duty adds nothing to the monthly hours target either', () => {
  assert.ok(!HOURS_EXPECTED.has('DD'), 'it would owe nine hours a day it never clocks');
  const monthly = { ...period, late_policy: 'monthly_late' };
  const asDD = calculateRow({ ...employee }, monthly, monthOf('DD'));
  assert.equal(asDD.ot_salary, 0, 'nothing is charged and nothing is paid for the hours');
  assert.equal(asDD.net_salary, calculateRow({ ...employee }, monthly, monthOf('P')).net_salary);
});

test('NOBODY LIVING ON THE PREMISES IS CALLED LATE, or chased for a punch', () => {
  assert.ok(!FULL_DAY_MARKS.has('DD'), 'they are always there; late has no meaning');
  assert.ok(!WORKED_MARKS.has('DD'), 'one punch and no departure would be chased every morning');
  /* The missing-punch report only looks at days somebody came and went. */
  assert.equal(problemOf({ code: 'DD', in_time: '09:00', out_time: '' }, { code: 'DD' }), null);
});

test('and a punch may not turn a 24-hour duty into an ordinary present day', () => {
  /* The importer may only set a blank day or a plain P/A/HF - `protectDecided`
     in reverse. A decision somebody made outranks what a reader saw. */
  assert.ok(!PUNCH_MAY_SET.has('DD'));
});

test('ONE HELPER COUNTS DAYS PRESENT, so the grid and the muster cannot disagree', () => {
  assert.equal(daysPresent({ P: 10, WH: 2, OD: 3, DD: 4 }), 19);
  assert.equal(daysPresent({}), 0);
  const grid = readFileSync(new URL('../../frontend/src/components/Attendance.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(
    !/counts\.P \|\| 0\) \+ \(counts\.WH/.test(grid) && !/tally\(l, 'P', 'WH'/.test(grid),
    'the present-days list is written out by hand again - v2.24.0 happened exactly this way'
  );
  assert.equal((grid.match(/daysPresent\(/g) || []).length, 2, 'both the grid row and the printed muster read it');
});

test('EVERY MARK THE CLOCK IS NOT READ ON IS ALSO NOT A FULL WORKING DAY', () => {
  /* Otherwise somebody would be judged late on a day whose hours are ignored,
     which is a verdict with nothing behind it. */
  for (const code of HOURS_NOT_READ) {
    assert.ok(!FULL_DAY_MARKS.has(code), `${code} is judged late but its clock is not read`);
    assert.ok(ATTENDANCE_CODES[code], `${code} is not a real mark`);
  }
});

test('WORKING OUT OF OFFICE CAN BE ASKED FOR - the half OD was missing', () => {
  const kind = REQUEST_KINDS.find((k) => k.key === 'official_duty');
  assert.ok(kind, 'nobody can apply for a field day');
  assert.equal(kind.needs, 'none', 'the mark is always OD; a picker is only a chance to get it wrong');
  assert.equal(kind.writes, 'OD');
  assert.equal(kind.span, true, 'a three-day trip is one request and one decision');
});

test('...and the KIND names the mark, so a stale form cannot write something else', () => {
  const entries = entriesFor(
    { kind: 'official_duty', employee_id: 7, day: 4, to_day: 6, code: 'A', reason: 'client visit' },
    {}
  );
  assert.equal(entries.length, 3, 'a span is written whole');
  for (const entry of entries) {
    assert.equal(entry.code, 'OD', 'an absence reached the grid through an out-of-office request');
  }
});

test('work from home and out of office stay APART - both paid, not the same day', () => {
  const remote = REQUEST_KINDS.find((k) => k.key === 'remote');
  assert.equal(remote.writes, 'WH');
  assert.notEqual(remote.writes, REQUEST_KINDS.find((k) => k.key === 'official_duty').writes);
});
