/**
 * THE EMPLOYEE'S OWN DASHBOARD.
 *
 * Dinesh's brief for the self-service portal says it twice: *"All values must
 * be fetched from actual employee-specific data. Never use static demo
 * numbers"* and *"If some dashboard data is unavailable, display a proper
 * empty state instead of inventing values."*
 *
 * So the rule these tests exist to hold is: WHERE THERE IS NO ANSWER THE
 * ANSWER IS NULL, never nought. A nought reads as "you worked no hours
 * today" when the truth is "nobody has marked today yet", and the person
 * reading it is the person it is about.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { comingUp, leaveFor, monthFor, todayFor, trendFor } from '../../shared/myDashboard.js';

const NOV = { year: 2026, month: 11 };
const on = (code, times = {}) => ({ attendance: { 21: { code, ...times } }, period: NOV, today: '2026-11-21', hoursPerDay: 9 });

/* ---------------- today ---------------- */

test('A DAY NOBODY HAS MARKED IS NOT AN ABSENCE', () => {
  const t = todayFor({ attendance: {}, period: NOV, today: '2026-11-21' });
  assert.equal(t.state, 'not-marked');
  assert.equal(t.code, '');
  assert.equal(t.worked_minutes, null, 'not nought');
  assert.equal(t.remaining_minutes, null);
});

test('...and the states are told apart, each from its own mark', () => {
  assert.equal(todayFor(on('P')).state, 'at-work');
  assert.equal(todayFor(on('WH')).state, 'at-work', 'work from home is at work');
  assert.equal(todayFor(on('OD')).state, 'at-work', 'so is official duty');
  assert.equal(todayFor(on('CL')).state, 'on-leave');
  assert.equal(todayFor(on('A')).state, 'absent');
  assert.equal(todayFor(on('UL')).state, 'absent');
  assert.equal(todayFor(on('S')).state, 'weekly-off');
  assert.equal(todayFor(on('PH')).state, 'holiday');
});

test('CLOCKED IN AND NOT OUT: the hours are NOT KNOWN, and the card says so', () => {
  /* `expected - null` is `expected`, so this reported the whole day still to
     do - which reads as "you have done nothing" rather than "we cannot tell
     yet". It is the one figure on the card the person checks at 4pm. */
  const t = todayFor(on('P', { in_time: '09:30' }));
  assert.equal(t.still_in, true);
  assert.equal(t.worked_minutes, null);
  assert.equal(t.remaining_minutes, null, 'not the whole day');

  const done = todayFor(on('P', { in_time: '09:30', out_time: '17:00' }));
  assert.equal(done.worked_minutes, 450);
  assert.equal(done.remaining_minutes, 90);
  assert.equal(done.still_in, false);
});

test('a month that is not this month has no "today" at all', () => {
  const t = todayFor({ attendance: { 21: { code: 'P' } }, period: { year: 2026, month: 10 }, today: '2026-11-21' });
  assert.equal(t.state, 'other-month');
  assert.equal(t.day, null);
});

/* ---------------- leave ---------------- */

test('leave counts what is left, and unpaid leave has NO quota to be over', () => {
  const l = leaveFor({ quotas: { CL: 12, SL: 6, PL: 15 }, taken: { CL: 3, SL: 0, PL: 1, UL: 2 } }, 1);
  assert.equal(l.total_quota, 33);
  assert.equal(l.total_used, 4);
  assert.equal(l.total_left, 29);
  assert.equal(l.pending, 1);
  /* Reported on its own: it was taken anyway and docked, and showing it
     against a quota of nought would read as being over an allowance that
     never existed. */
  assert.equal(l.unpaid_taken, 2);
  assert.ok(!l.kinds.some((k) => k.code === 'UL'));
});

test('...and somebody over their quota is flagged, not hidden', () => {
  const l = leaveFor({ quotas: { CL: 6 }, taken: { CL: 8 } });
  const cl = l.kinds.find((k) => k.code === 'CL');
  assert.equal(cl.left, -2);
  assert.equal(cl.over, true);
});

/* ---------------- the month and the trend ---------------- */

test('the month counts the marks the absent/present report counts', () => {
  const m = monthFor({ marks: { P: 18, WH: 2, OD: 1, CL: 1, A: 2, HF: 1, S: 4 }, payable_days: 23.5, worked_minutes: 9800 });
  assert.equal(m.at_work, 22, 'present, work from home, official duty and the half day');
  assert.equal(m.on_leave, 1);
  assert.equal(m.absent, 2);
  assert.equal(m.weekly_off, 4);
  assert.equal(m.payable_days, 23.5, "the sheet's own figure");
});

test('A MONTH NOBODY MARKED IS NOT A PERFECT MONTH', () => {
  const [blank] = trendFor([{ period: { id: 1, label: 'November 2026' }, marks: {} }]);
  assert.equal(blank.percent, null, 'not 100, and not 0');
  assert.equal(blank.marked_days, 0);

  const [real] = trendFor([{ period: { id: 2, label: 'October 2026' }, marks: { P: 20, A: 2, CL: 1 } }]);
  assert.equal(real.percent, 87, '20 at work out of 23 days expected');
});

/* ---------------- what is coming ---------------- */

test('UPCOMING IS THEIR OWN ONLY - no other person appears', () => {
  const list = comingUp({
    holidays: [{ date: '2026-11-28', name: 'Diwali', applied: true }],
    employee: { dob: '1994-12-03', joined_on: '2021-11-25', name: 'Amit' },
    today: '2026-11-21',
  });
  assert.deepEqual(list.map((e) => e.kind), ['anniversary', 'holiday', 'birthday']);
  assert.equal(list[0].note, '5 years');
  assert.equal(list[1].days_away, 7);
  /* Nothing on this list belongs to anybody else. The employee portal is the
     one screen in the app that must not leak sideways. */
  assert.ok(!JSON.stringify(list).includes('employee_id'));
});

test('a holiday the office has not put on the grid yet is PLANNED, not a day off', () => {
  const [h] = comingUp({
    holidays: [{ date: '2026-11-28', name: 'Diwali', applied: false }],
    employee: {}, today: '2026-11-21',
  });
  assert.match(h.note, /not marked on the grid yet/);
});

test('nothing in the past, and nothing beyond the window', () => {
  const list = comingUp({
    holidays: [
      { date: '2026-11-01', name: 'Gone', applied: true },
      { date: '2027-06-01', name: 'Far off', applied: true },
      { date: '2026-12-25', name: 'Christmas', applied: true },
    ],
    employee: {}, today: '2026-11-21',
  });
  assert.deepEqual(list.map((e) => e.title), ['Christmas']);
});

test('no date to work from means an empty list, not a guess', () => {
  assert.deepEqual(comingUp({ holidays: [{ date: '2026-12-25', name: 'X' }], employee: {}, today: '' }), []);
  assert.deepEqual(comingUp({}), []);
});
