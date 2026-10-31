import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LATE_RULES,
  POLICY,
  applyConcession,
  dayLateEarly,
  describeConcession,
  lateEarlyLine,
  monthLateEarly,
  onConcession,
  readLateRules,
  shiftFor,
} from '../../shared/lateEarly.js';
import { calculateRow } from '../../shared/calc.js';

const SHIFT = { start: '09:30', end: '18:30' };

test('the concession is 300 minutes, which is Dinesh’s figure', () => {
  assert.equal(DEFAULT_LATE_RULES.concession_minutes, 300);
  // Deliberately zero: a monthly pool plus a daily grace would give away a
  // second allowance nobody decided on.
  assert.equal(DEFAULT_LATE_RULES.grace_minutes, 0);
});

test('a day with no clock times is not judged - not "on time", not known', () => {
  const judged = dayLateEarly('P', SHIFT);
  assert.equal(judged.judged, false);
  assert.equal(judged.late, 0);
  assert.equal(judged.reason, 'no clock times');
});

test('late and early minutes are counted to the minute', () => {
  const day = dayLateEarly({ code: 'P', in_time: '09:47', out_time: '18:10' }, SHIFT);
  assert.deepEqual([day.late, day.early, day.judged], [17, 20, true]);
});

test('early in and late out cost nothing', () => {
  const day = dayLateEarly({ code: 'P', in_time: '09:10', out_time: '19:30' }, SHIFT);
  assert.deepEqual([day.late, day.early], [0, 0]);
});

test('a half day, leave, a holiday or an absence is never late', () => {
  for (const code of ['HF', 'CL', 'SL', 'PL', 'UL', 'PH', 'A', 'AD', 'S']) {
    const day = dayLateEarly({ code, in_time: '11:30', out_time: '15:00' }, SHIFT);
    assert.equal(day.judged, false, `${code} should not be judged`);
    assert.equal(day.late, 0);
  }
});

test('a full day with no mark yet is judged - somebody who clocked in was here', () => {
  const day = dayLateEarly({ code: '', in_time: '10:00', out_time: '18:30' }, SHIFT);
  assert.deepEqual([day.late, day.early, day.judged], [30, 0, true]);
});

test('work from home and Sunday work are judged like any other full day', () => {
  for (const code of ['WH', 'SP', 'HP']) {
    const day = dayLateEarly({ code, in_time: '10:00', out_time: '18:30' }, SHIFT);
    assert.equal(day.late, 30, code);
  }
});

test('an overnight shift is not an early finish', () => {
  const day = dayLateEarly(
    { code: 'P', in_time: '21:00', out_time: '06:00' },
    { start: '21:00', end: '06:00' },
  );
  assert.equal(day.early, 0);
  assert.equal(day.late, 0);
});

test('a daily grace, when set, forgives the whole lateness under it', () => {
  const inside = dayLateEarly({ code: 'P', in_time: '09:40' }, { ...SHIFT, grace: 15 });
  const outside = dayLateEarly({ code: 'P', in_time: '09:50' }, { ...SHIFT, grace: 15 });
  assert.equal(inside.late, 0);
  assert.equal(outside.late, 20, 'past the grace, every minute counts, not just the excess');
});

test('a month pools the minutes and names the days', () => {
  const month = monthLateEarly(
    {
      1: { code: 'P', in_time: '09:30', out_time: '18:30' },
      2: { code: 'P', in_time: '10:00', out_time: '18:30' },
      3: { code: 'P', in_time: '09:30', out_time: '18:00' },
      4: { code: 'A' },
      5: 'P',
    },
    SHIFT,
  );
  assert.equal(month.late_minutes, 30);
  assert.equal(month.early_minutes, 30);
  assert.equal(month.total_minutes, 60);
  assert.deepEqual([month.late_days, month.early_days, month.judged_days], [1, 1, 3]);
  assert.deepEqual(
    month.days.map((d) => d.day),
    [2, 3],
  );
});

test('the concession frees the first 300 minutes and never earns credit', () => {
  assert.deepEqual(applyConcession(0, 300), { total: 0, allowed: 300, used: 0, left: 300, chargeable: 0 });
  assert.deepEqual(applyConcession(300, 300), { total: 300, allowed: 300, used: 300, left: 0, chargeable: 0 });
  assert.deepEqual(applyConcession(372, 300), { total: 372, allowed: 300, used: 300, left: 0, chargeable: 72 });
  assert.equal(applyConcession(-50, 300).chargeable, 0);
});

test('a concession of zero charges every minute', () => {
  assert.equal(applyConcession(45, 0).chargeable, 45);
});

test('a person’s own shift wins over the office’s', () => {
  const rules = readLateRules({ shift_in: '10:00', shift_out: '19:00' });
  assert.deepEqual(shiftFor({}, rules), { in: '10:00', out: '19:00' });
  assert.deepEqual(shiftFor({ shift_in: '21:00', shift_out: '06:00' }, rules), {
    in: '21:00',
    out: '06:00',
  });
});

test('nonsense rules fall back to the defaults rather than judging against null', () => {
  const rules = readLateRules({ shift_in: 'whenever', late_concession_minutes: '' });
  assert.equal(rules.shift_in, DEFAULT_LATE_RULES.shift_in);
  assert.equal(rules.concession_minutes, 300);
});

test('onConcession is false unless the period says so', () => {
  assert.equal(onConcession({}), false);
  assert.equal(onConcession({ late_policy: 'hours' }), false);
  assert.equal(onConcession({ late_policy: POLICY.concession }), true);
  assert.equal(onConcession({ late_policy: 'Concession' }), true);
});

/* ------------------------------------------------------------------ *
 * The property the whole design hangs on: turning the policy on is a
 * decision, and until it is taken nobody's pay moves by a rupee.
 * ------------------------------------------------------------------ */

const month = () => {
  const days = {};
  for (let d = 1; d <= 26; d++) days[d] = { code: 'P', in_time: '09:52', out_time: '18:20' };
  return days;
};
const ROW = { salary: 26000, pf: 0, esi: 0 };

test('the default policy charges nothing, however late the month was', () => {
  const attendance = month();
  const before = calculateRow(ROW, { hours_per_day: 9 }, attendance);
  assert.equal(before.late_salary, 0);
  assert.equal(before.late_policy, 'hours');
  // ...but it still says what the month was, so the panel can price a switch.
  assert.equal(before.late_minutes, 26 * 22);
  assert.equal(before.early_minutes, 26 * 10);
  assert.ok(before.late_computed > 0);
});

test('switching to the concession policy moves the month by exactly the charge', () => {
  const attendance = month();
  const period = { hours_per_day: 9 };
  const before = calculateRow(ROW, period, attendance);
  const after = calculateRow(ROW, { ...period, late_policy: 'concession' }, attendance);

  const total = 26 * 32; // 832 minutes late or early
  assert.equal(after.late_total_minutes, total);
  assert.equal(after.late_chargeable_minutes, total - 300);
  const perMinute = 26000 / 26 / 9 / 60;
  assert.equal(after.late_salary, Math.round((total - 300) * perMinute * 100) / 100);
  assert.equal(before.gross_salary - after.gross_salary, Math.round(after.late_salary));
  assert.ok(after.net_salary < before.net_salary);
});

test('a month inside the concession costs nothing even on the strict policy', () => {
  const attendance = {};
  for (let d = 1; d <= 26; d++) attendance[d] = { code: 'P', in_time: '09:40', out_time: '18:30' };
  const row = calculateRow(ROW, { hours_per_day: 9, late_policy: 'concession' }, attendance);
  assert.equal(row.late_total_minutes, 260);
  assert.equal(row.late_chargeable_minutes, 0);
  assert.equal(row.late_salary, 0);
  assert.equal(row.late_concession_left, 40);
});

test('the same minutes are never charged twice', () => {
  // One day, in half an hour late, out on time: the hours rule already makes
  // the day 30 minutes short. On the concession policy that shortfall must not
  // be deducted on top of the late charge.
  const attendance = { 1: { code: 'P', in_time: '10:00', out_time: '18:30', minutes: -30 } };
  const period = { hours_per_day: 9, late_policy: 'concession', late_concession_minutes: 0 };
  const row = calculateRow(ROW, period, attendance);
  assert.equal(row.ot_minutes, 0, 'the shortfall is not charged again');
  assert.equal(row.late_chargeable_minutes, 30);
  const perMinute = 26000 / 26 / 9 / 60;
  assert.equal(row.late_salary, Math.round(30 * perMinute * 100) / 100);
});

test('overtime is still paid on the concession policy', () => {
  const attendance = { 1: { code: 'P', in_time: '09:30', out_time: '20:30', minutes: 120 } };
  const row = calculateRow(ROW, { hours_per_day: 9, late_policy: 'concession' }, attendance);
  assert.equal(row.ot_minutes, 120);
  assert.ok(row.ot_salary > 0);
});

test('a typed OT figure still wins on either policy', () => {
  const attendance = { 1: { code: 'P', in_time: '10:00', out_time: '18:30', minutes: -30 } };
  const row = calculateRow(
    { ...ROW, ot_minutes_override: -90 },
    { hours_per_day: 9, late_policy: 'concession' },
    attendance,
  );
  assert.equal(row.ot_minutes, -90);
});

test('describeConcession reads as a sentence', () => {
  assert.equal(describeConcession({ total: 0 }), 'nothing late or early this month');
  assert.equal(
    describeConcession(lateEarlyLine(month(), { rules: {}, per_minute: 1 })),
    '13h 52m late or early, 5h 00m free, 8h 52m charged',
  );
});
