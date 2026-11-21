/**
 * ONE PERSON'S MONTH, DAY BY DAY.
 *
 * Dinesh: *"Clicking an employee name should open their monthly attendance
 * statement"*. The data was all there; the name in the grid was plain text,
 * which is not a way in - the fifth time that exact shape has come up.
 *
 * THE RULE: IT ASSEMBLES, IT NEVER RECALCULATES. The mark is the mark the
 * grid shows and the sheet is paid from; the hours come from `timesToDay`,
 * the same function the Time tab and the punch import use; `payable_days` is
 * the sheet's own figure. A statement that worked out its own answer would
 * be a second opinion on somebody's pay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceStatement } from '../../shared/attendanceStatement.js';

const NOV = { year: 2026, month: 11, hours_per_day: 9, label: 'November 2026' };
const AMIT = {
  employee_id: 7, employee_name: 'Amit Shah', employee_code: 'E007',
  company_name: 'BOOKNFLY', department: 'Accounts', present_days: 24,
  attendance: {
    2: { code: 'P', in_time: '09:30', out_time: '18:30' },
    3: { code: 'P', in_time: '10:20', out_time: '18:30', minutes: -50 },
    4: { code: 'OD', reason: 'Bank work' },
    5: { code: 'CL', reason: 'wedding', approved: 1 },
    6: { code: 'A', reason: 'no call', approved: 0 },
    7: { code: 'HF' },
    9: { code: 'P', in_time: '09:30', out_time: '20:00', minutes: 90 },
  },
};

test('every day of the month is a line, marked or not', () => {
  const stm = attendanceStatement(AMIT, NOV);
  assert.equal(stm.days.length, 30);
  assert.equal(stm.days[0].day, 1);
  assert.equal(stm.days[29].day, 30);
  assert.equal(stm.summary.marked_days, 7);
  assert.equal(stm.summary.unmarked_days, 23);
});

test('A WEEKLY OFF IS A FACT ABOUT THE CALENDAR, NOT A MARK', () => {
  const stm = attendanceStatement(AMIT, NOV);
  /* 1, 8, 15, 22 and 29 November 2026 are Sundays. */
  for (const day of [1, 8, 15, 22, 29]) {
    assert.equal(stm.days[day - 1].weekly_off, true, `${day} is a Sunday`);
    assert.equal(stm.days[day - 1].code, '', 'and nobody marked it, which is fine');
  }
  assert.equal(stm.days[1].weekly_off, false, 'the 2nd is a Monday');
});

test('...and it follows THEIR policy, not just Sunday', () => {
  const satOff = { ...AMIT, weekly_off: JSON.stringify({ days: [0, 6], alternate: null }) };
  const stm = attendanceStatement(satOff, NOV);
  assert.equal(stm.days[6].weekly_off, true, 'the 7th is a Saturday and theirs is off');
});

test('A HOLIDAY IS NAMED, and only for the people it covers', () => {
  const holidays = [{ day: 10, name: 'Diwali', religions: ['Hindu'] }];
  const hindu = attendanceStatement({ ...AMIT, religion: 'Hindu' }, NOV, { holidays });
  const muslim = attendanceStatement({ ...AMIT, religion: 'Muslim' }, NOV, { holidays });
  assert.equal(hindu.days[9].holiday, 'Diwali');
  assert.equal(muslim.days[9].holiday, '', 'an ordinary working day for them');
});

test('THE HOURS ARE THE CLOCK’S, and a day nobody clocked is NOT KNOWN', () => {
  const stm = attendanceStatement(AMIT, NOV);
  assert.equal(stm.days[1].worked_minutes, 540, '09:30 to 18:30 is nine hours');
  assert.equal(stm.days[2].worked_minutes, 490, 'in at 10:20 is fifty minutes short');
  assert.equal(
    stm.days[3].worked_minutes, null,
    'a day on official duty has no clock here - null, never 0, which would read as a day spent doing nothing'
  );
  assert.equal(stm.days[0].worked_minutes, null, 'and neither does an unmarked Sunday');
});

test('OT and short hours are the day’s own minutes - the column the sheet pays from', () => {
  const stm = attendanceStatement(AMIT, NOV);
  assert.equal(stm.days[2].ot_minutes, -50);
  assert.equal(stm.days[8].ot_minutes, 90);
  assert.equal(stm.summary.overtime_minutes, 90);
  assert.equal(stm.summary.short_minutes, 50, 'shown as a positive figure, labelled "short"');
});

test('THE SUMMARY COUNTS WHAT THE REPORT COUNTS', () => {
  const stm = attendanceStatement(AMIT, NOV).summary;
  /* P, P, P, OD and the half day are all days at work. */
  assert.equal(stm.at_work, 5);
  assert.equal(stm.paid_off, 1, 'the casual leave');
  /* Days of PAY, not days on the calendar: the absence is 1 and the half
     day is 0.5 - the same arithmetic the absent/present report uses. */
  assert.equal(stm.days_lost, 1.5);
  assert.deepEqual(stm.counts, { P: 3, OD: 1, CL: 1, A: 1, HF: 1 });
});

test('payable days is the SHEET’S figure, never one of this page’s own', () => {
  assert.equal(attendanceStatement(AMIT, NOV).summary.payable_days, 24);
  /* And a row that carries none says so rather than inventing a number. */
  const { present_days, ...bare } = AMIT;
  assert.equal(attendanceStatement(bare, NOV).summary.payable_days, null);
});

test('a reason and a decision ride onto the day, three-state as they are stored', () => {
  const stm = attendanceStatement(AMIT, NOV);
  assert.equal(stm.days[4].reason, 'wedding');
  assert.equal(stm.days[4].approved, true);
  assert.equal(stm.days[5].approved, false, 'refused is not the same as not looked at');
  assert.equal(stm.days[1].approved, null, 'and nobody has decided about the 2nd');
});

test('it works nothing out of its own - no month, no days', () => {
  assert.equal(attendanceStatement(AMIT, {}).days.length, 0);
  assert.equal(attendanceStatement({}, NOV).summary.marked_days, 0);
});

test('and it changes nothing it was handed', () => {
  const before = JSON.stringify(AMIT);
  attendanceStatement(AMIT, NOV, { holidays: [{ day: 10, name: 'Diwali', religions: [] }] });
  assert.equal(JSON.stringify(AMIT), before);
});

/*
 * A DAY SOMEBODY STARTED AND DID NOT FINISH.
 *
 * In at 09:30 and no out time reads exactly like a day nobody clocked at all:
 * both give "—" for the hours, which is right (they are not known) and tells
 * nobody why. The warning says which it is, and the hours stay unknown — it
 * is a flag, never a guess at when they left.
 */
test('the statement says what is wrong with a day’s times, and still guesses nothing', () => {
  const stm = attendanceStatement(
    { attendance: { 1: { code: 'P', in_time: '09:30' }, 2: { code: 'P', in_time: '09:30', out_time: '18:30' } } },
    { year: 2026, month: 10, hours_per_day: 9 }
  );
  const unfinished = stm.days[0];
  assert.equal(unfinished.time_warning, 'no out time');
  assert.equal(unfinished.worked_minutes, null, 'not nought — not known');

  // A whole day carries no warning at all.
  assert.equal(stm.days[1].time_warning, '');
  assert.equal(stm.days[1].worked_minutes, 9 * 60);

  // And a day nobody clocked is not "wrong", it is simply empty.
  assert.equal(stm.days[2].time_warning, '');
  assert.equal(stm.days[2].worked_minutes, null);
});
