/**
 * THE THREE LEVELS, THE ONE-CAUSE RULE, AND THE ATTENDANCE LINE.
 *
 * Dinesh, looking at the salary sheet: the alert bar read **"Important
 * Alerts (4 Critical)"** over a list naming two people. Three things were
 * behind that, and each one is a group below.
 *
 *   1. There were three levels in the code but only two were counted, and
 *      the third had nothing in it. The chips could not add up to the
 *      headline because the headline was counting something else.
 *   2. ONE PROBLEM WAS REPORTED TWICE. A day rate of nought makes the net
 *      nought; a net below nought IS a deduction bigger than the gross.
 *      Listing both says there are two things wrong when there is one.
 *   3. THE ATTENDANCE CHECK COUNTED THE CALENDAR. On the 21st it wanted
 *      twenty marks - Sundays included, which the office does not mark - so
 *      everybody was flagged every month. And a month that had ENDED was
 *      never checked at all, because the running-month branch was the only
 *      one there was.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCEPTION_KINDS,
  SEVERITIES,
  exceptionSummary,
  expectedWorkingDays,
  payrollExceptions,
} from '../../shared/payrollExceptions.js';

const NOV = { year: 2026, month: 11 };           // 30 days, 1 Nov is a Sunday
const person = (over = {}) => ({
  row: {
    id: 1, employee_id: 1, employee_name: 'Amit Shah', company_name: 'BNF',
    salary: 26000, status: 'pending', attendance: {}, ...over.row,
  },
  calc: {
    per_day: 1000, net_salary: 20000, gross_salary: 24000,
    working_days: 26, absent_days: 0, ...over.calc,
  },
  employee: { ...over.employee },
});
const codes = (list) => list.map((e) => e.code);

/* ---------------- 1. three levels, counted ---------------- */

test('EVERY CHECK CARRIES ONE OF THE THREE LEVELS, AND ONLY THOSE THREE', () => {
  const allowed = new Set(SEVERITIES.map(([key]) => key));
  assert.deepEqual([...allowed], ['critical', 'warning', 'info']);
  for (const [code, , severity] of EXCEPTION_KINDS) {
    assert.ok(allowed.has(severity), `${code} carries "${severity}"`);
  }
});

test('money that is wrong or missing is CRITICAL; everything else is not', () => {
  const level = Object.fromEntries(EXCEPTION_KINDS.map(([c, , s]) => [c, s]));
  for (const code of ['no_salary', 'zero_per_day', 'negative_net', 'zero_net', 'absent_over_days']) {
    assert.equal(level[code], 'critical', `${code} blocks the payroll`);
  }
  /* Nothing payable is CRITICAL now. It was a warning, which is how a month
     with somebody on zero went through without anybody being asked. */
  assert.equal(level.zero_net, 'critical');

  for (const code of ['part_attendance', 'no_attendance', 'pf_no_uan', 'no_bank_details', 'paid_without_details']) {
    assert.equal(level[code], 'warning', `${code} is worth a look, not a block`);
  }
  for (const code of ['on_hold', 'awaiting_approval']) {
    assert.equal(level[code], 'info', `${code} is a status, not a problem`);
  }
});

test('THE THREE COUNTS ADD UP TO WHAT IS OPEN', () => {
  const s = exceptionSummary([
    { severity: 'critical', state: 'open', employee_id: 1 },
    { severity: 'warning', state: 'open', employee_id: 2 },
    { severity: 'info', state: 'open', employee_id: null },
    { severity: 'critical', state: 'ignored', employee_id: 3 },
    { severity: 'warning', state: 'resolved', employee_id: 4 },
  ]);
  assert.equal(s.open, 3);
  assert.equal(s.critical + s.warning + s.info, s.open, '"4 Critical" over a list of two is this sum failing');
  assert.equal(s.resolved, 1);
  assert.equal(s.ignored, 1);
  assert.equal(s.total, 5);
});

/* ---------------- 2. one cause, one flag ---------------- */

test('A NOUGHT DAY RATE IS ONE PROBLEM, NOT TWO', () => {
  const list = payrollExceptions(
    [person({ calc: { per_day: 0, net_salary: 0 } })],
    { period: NOV, today: '2026-12-05' }
  );
  assert.ok(codes(list).includes('zero_per_day'));
  assert.ok(!codes(list).includes('zero_net'), 'the nought net is the SAME problem');
});

test('no salary explains both the nought day rate and the nought net', () => {
  const list = payrollExceptions(
    [person({ row: { salary: 0 }, calc: { per_day: 0, net_salary: 0, gross_salary: 0 } })],
    { period: NOV, today: '2026-12-05' }
  );
  const found = codes(list).filter((c) => ['no_salary', 'zero_per_day', 'zero_net'].includes(c));
  assert.deepEqual(found, ['no_salary'], 'one line, naming the cause');
});

test('a negative net is not also reported as a large deduction', () => {
  const list = payrollExceptions(
    [person({ calc: { net_salary: -500, gross_salary: 10000, deduction: 10500 } })],
    { period: NOV, today: '2026-12-05' }
  );
  assert.ok(codes(list).includes('negative_net'));
  assert.ok(!codes(list).includes('big_deduction'));
});

test('...but a large deduction on a healthy net is still its own flag', () => {
  const list = payrollExceptions(
    [person({ calc: { net_salary: 4000, gross_salary: 10000, deduction: 6000 } })],
    { period: NOV, today: '2026-12-05' }
  );
  assert.ok(codes(list).includes('big_deduction'), 'nothing explains this one away');
});

test('the suppression is per PERSON - one man’s zero salary does not hide another’s', () => {
  const a = person({ row: { salary: 0, employee_id: 1, employee_name: 'A' }, calc: { per_day: 0, net_salary: 0, gross_salary: 0 } });
  const b = person({ row: { employee_id: 2, employee_name: 'B' }, calc: { per_day: 769, net_salary: 0 } });
  const list = payrollExceptions([a, b], { period: NOV, today: '2026-12-05' });
  assert.ok(list.some((e) => e.employee_id === 1 && e.code === 'no_salary'));
  assert.ok(list.some((e) => e.employee_id === 2 && e.code === 'zero_net'), 'B’s nought net is B’s own');
});

/* ---------------- 3. attendance, against days actually due ---------------- */

test('A DAY THAT HAS NOT HAPPENED IS NOT A MISSING MARK', () => {
  /* The 10th of November. Only the 1st to the 9th can have been marked. */
  const upTo9 = expectedWorkingDays({ period: NOV, today: '2026-11-10', employee: {}, company: {} });
  /* 1 Nov 2026 is a Sunday, and so is the 8th: nine days less two. */
  assert.equal(upTo9, 7);

  const wholeMonth = expectedWorkingDays({ period: NOV, today: '2026-12-01', employee: {}, company: {} });
  assert.equal(wholeMonth, 30 - 5, 'November 2026 has five Sundays');
  assert.ok(wholeMonth > upTo9, 'the whole month expects more than nine days of it');
});

test('a Sunday is not a day anybody failed to attend', () => {
  /* 21 November 2026 is a Saturday. The old check wanted twenty marks off
     the calendar; three Sundays had gone by, so everybody was flagged. */
  const expected = expectedWorkingDays({ period: NOV, today: '2026-11-21', employee: {}, company: {} });
  assert.equal(expected, 20 - 3, 'the 1st, 8th and 15th were Sundays');
});

test('a holiday is not a gap - and only for the people it covers', () => {
  const holidays = [{ day: 10, name: 'Diwali', religions: ['Hindu'] }];
  const hindu = expectedWorkingDays({ period: NOV, today: '2026-11-21', employee: { religion: 'Hindu' }, company: {}, holidays });
  const muslim = expectedWorkingDays({ period: NOV, today: '2026-11-21', employee: { religion: 'Muslim' }, company: {}, holidays });
  assert.equal(hindu, 16, 'the office was shut for them');
  assert.equal(muslim, 17, 'it was an ordinary working day for them');

  const everyone = [{ day: 10, name: 'Republic Day', religions: [] }];
  assert.equal(
    expectedWorkingDays({ period: NOV, today: '2026-11-21', employee: { religion: 'Muslim' }, company: {}, holidays: everyone }),
    16,
    'no religions means the whole office'
  );
});

test('nobody is asked about a day before they joined or after they left', () => {
  const joined = expectedWorkingDays({
    period: NOV, today: '2026-12-01', employee: { joined_on: '2026-11-16' }, company: {},
  });
  assert.equal(joined, 13, 'the 16th to the 30th is fifteen days, less the 22nd and the 29th');

  const left = expectedWorkingDays({
    period: NOV, today: '2026-12-01', employee: { left_on: '2026-11-10' }, company: {},
  });
  assert.equal(left, 8, 'the 1st to the 10th, less two Sundays');
});

test('alternate Saturdays off are off, because that is how Gujarat works', () => {
  const policy = JSON.stringify({ days: [0], alternate: { day: 6, weeks: [2, 4] } });
  const plain = expectedWorkingDays({ period: NOV, today: '2026-12-01', employee: {}, company: {} });
  const withSat = expectedWorkingDays({ period: NOV, today: '2026-12-01', employee: { weekly_off: policy }, company: {} });
  assert.ok(withSat < plain, 'two Saturdays come out of the count');
});

test('a month that has not started expects nothing at all', () => {
  assert.equal(expectedWorkingDays({ period: NOV, today: '2026-10-20', employee: {}, company: {} }), 0);
});

test('UNFINISHED ATTENDANCE IS MEASURED AGAINST THE DAYS DUE, NOT THE CALENDAR', () => {
  /* Seven working days have passed by the 10th; six are marked. */
  const marks = {};
  for (const day of [2, 3, 4, 5, 6, 7]) marks[day] = 'P';
  const list = payrollExceptions([person({ row: { attendance: marks } })], { period: NOV, today: '2026-11-10' });
  const flag = list.find((e) => e.code === 'part_attendance');
  assert.ok(flag, 'one day short, and it says so');
  assert.match(flag.detail, /6 of 7 working day/);
  assert.match(flag.detail, /so far this month/);
});

test('...and a month marked up to date is NOT flagged, though half the calendar is blank', () => {
  const marks = {};
  /* Every working day to the 9th: the 1st and 8th are Sundays. */
  for (const day of [2, 3, 4, 5, 6, 7, 9]) marks[day] = 'P';
  const list = payrollExceptions([person({ row: { attendance: marks } })], { period: NOV, today: '2026-11-10' });
  assert.ok(!codes(list).includes('part_attendance'), 'the Sundays are not gaps and the future is not a gap');
});

test('AFTER THE MONTH ENDS THE WHOLE MONTH IS CHECKED - it never was before', () => {
  const marks = {};
  for (const day of [2, 3, 4, 5, 6]) marks[day] = 'P';
  const list = payrollExceptions([person({ row: { attendance: marks } })], { period: NOV, today: '2026-12-05' });
  const flag = list.find((e) => e.code === 'part_attendance');
  assert.ok(flag, 'five marks on a closed month is not a finished month');
  assert.match(flag.detail, /5 of 25 working day/);
  assert.match(flag.detail, /whole month/);
});

test('leave, a holiday and a weekly off all COUNT as marked - a gap is a day nobody spoke about', () => {
  const marks = { 2: 'CL', 3: 'PH', 4: { code: 'P' }, 5: 'SL', 6: 'A', 7: 'WH' };
  const list = payrollExceptions([person({ row: { attendance: marks } })], { period: NOV, today: '2026-11-10' });
  const flag = list.find((e) => e.code === 'part_attendance');
  assert.ok(flag, 'the 9th is still unmarked');
  assert.match(flag.detail, /6 of 7 working day/);
});

test('nothing marked at all is its own flag, and not ALSO an unfinished one', () => {
  const list = payrollExceptions([person()], { period: NOV, today: '2026-12-05' });
  assert.ok(codes(list).includes('no_attendance'));
  assert.ok(!codes(list).includes('part_attendance'), 'one cause, one flag');
});

/* ---------------- the informational level has something in it ---------------- */

test('a month waiting for approval is said ONCE, not once per employee', () => {
  const rows = [1, 2, 3].map((id) => person({ row: { employee_id: id, employee_name: `P${id}`, attendance: { 2: 'P' } } }));
  const list = payrollExceptions(rows, { period: NOV, today: '2026-11-03' });
  const waiting = list.filter((e) => e.code === 'awaiting_approval');
  assert.equal(waiting.length, 1, 'eighty-five identical lines is how a list stops being read');
  assert.equal(waiting[0].employee_id, null, 'it belongs to the month, not to anybody');
  assert.equal(waiting[0].severity, 'info');
});

test('...and an approved month does not say it is waiting', () => {
  const list = payrollExceptions([person({ row: { attendance: { 2: 'P' } } })], {
    period: { ...NOV, approved_at: '2026-12-01 10:00:00' }, today: '2026-11-03',
  });
  assert.ok(!codes(list).includes('awaiting_approval'));
});

test('a row on hold is a DECISION, listed but never counted against the month', () => {
  const list = payrollExceptions(
    [person({ row: { status: 'hold', remark: 'bank details awaited', attendance: { 2: 'P' } } })],
    { period: NOV, today: '2026-11-03' }
  );
  const flag = list.find((e) => e.code === 'on_hold');
  assert.ok(flag);
  assert.equal(flag.severity, 'info');
  assert.match(flag.detail, /bank details awaited/);
  assert.equal(exceptionSummary(list).critical, 0, 'a hold does not block the month');
});

test('a bank transfer with no account is a warning; cash is not', () => {
  const bank = payrollExceptions(
    [person({ row: { payment_mode: 'Bank', attendance: { 2: 'P' } }, employee: { bank_account: '', ifsc: '' } })],
    { period: NOV, today: '2026-11-03' }
  );
  assert.ok(codes(bank).includes('no_bank_details'));

  const cash = payrollExceptions(
    [person({ row: { payment_mode: 'Cash', attendance: { 2: 'P' } } })],
    { period: NOV, today: '2026-11-03' }
  );
  assert.ok(!codes(cash).includes('no_bank_details'), 'cash needs no IFSC');

  const undecided = payrollExceptions(
    [person({ row: { payment_mode: '', attendance: { 2: 'P' } } })],
    { period: NOV, today: '2026-11-03' }
  );
  assert.ok(!codes(undecided).includes('no_bank_details'), 'no mode yet is not a fault');
});

test('THE ENGINE STILL CHANGES NOTHING', () => {
  const rows = [person({ row: { salary: 0 } })];
  const before = JSON.stringify(rows);
  payrollExceptions(rows, { period: NOV, today: '2026-11-21' });
  assert.equal(JSON.stringify(rows), before, 'not one figure moved');
});
