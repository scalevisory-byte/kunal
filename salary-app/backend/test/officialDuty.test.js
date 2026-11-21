/**
 * OD - OUT ON THE COMPANY'S BUSINESS.
 *
 * A bank run, a client's office, a day at a supplier. At work, just not at
 * this desk. The office had no mark for it, so it went down as P - which
 * hides it - or as leave, which docks a day somebody spent working.
 *
 * THE CLAIM THIS RESTS ON: a day on official duty is a day worked. It is
 * paid exactly like a present day, and because nothing carries the code yet
 * NO EXISTING MONTH CAN MOVE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTENDANCE_CODES, calculateRow } from '../../shared/calc.js';
import { attendanceSummary } from '../../shared/attendanceReport.js';
import { FULL_DAY_MARKS } from '../../shared/lateEarly.js';
import { HOURS_EXPECTED } from '../../shared/timesheet.js';
import { REMOTE_MARKS, punchAllowed } from '../../shared/punchClock.js';
import { WORKED_MARKS } from '../../shared/dailyReport.js';

const PERIOD = { year: 2026, month: 11, working_days: 26, hours_per_day: 9 };
const marksOf = (codes) => Object.fromEntries(codes.map((c, i) => [i + 2, c]));

test('A DAY ON OFFICIAL DUTY IS A DAY WORKED - it costs nothing', () => {
  assert.equal(ATTENDANCE_CODES.OD.absent, 0);
  assert.equal(ATTENDANCE_CODES.OD.paid, true);
  assert.equal(ATTENDANCE_CODES.OD.sunday, 0, 'it is not Sunday duty - no extra day is owed');
});

test('...and a month pays out EXACTLY the same with OD as with P', () => {
  for (const salary of [12000, 18500, 26000, 47000]) {
    const row = { salary, attendance: marksOf(['P', 'P', 'A', 'P', 'CL', 'P']) };
    const withP = calculateRow({ ...row, attendance: marksOf(['P', 'P', 'A', 'P', 'CL', 'P']) }, PERIOD);
    const withOD = calculateRow({ ...row, attendance: marksOf(['OD', 'OD', 'A', 'OD', 'CL', 'P']) }, PERIOD);
    for (const field of [
      'gross_salary', 'net_salary', 'final_payable', 'pt', 'pf', 'esi',
      'absent_days', 'present_days', 'per_day', 'gross_after_absent',
    ]) {
      assert.equal(withOD[field], withP[field], `${field} moved at ${salary}`);
    }
  }
});

test('the absent/present report counts it as a day at work, not as leave', () => {
  const summary = attendanceSummary({
    period: PERIOD,
    rows: [{
      employee_id: 1, employee_name: 'Amit Shah', company_id: 1,
      mark_counts: { P: 18, OD: 3, A: 1 }, attendance: {}, present_days: 25, absent_days: 1,
    }],
  });
  const [line] = summary.rows;
  assert.equal(line.worked_days, 21, 'eighteen at the desk and three out on duty');
  assert.equal(line.paid_off_days, 0, 'it is not time off');
  assert.equal(line.days_lost, 1, 'only the absence costs anything');
});

test('NOBODY IS CALLED LATE FOR A DAY THEY SPENT SOMEWHERE ELSE', () => {
  /* They may have gone straight to the client at eight. Nobody here saw when
     they arrived, and "not known" is never "on time". */
  assert.ok(!FULL_DAY_MARKS.has('OD'), 'OD is not judged against this office’s hours');
  assert.ok(!HOURS_EXPECTED.has('OD'), 'and no shortfall is charged against them');
});

test('...nor asked about their uniform, which nobody here could see', () => {
  assert.ok(!WORKED_MARKS.has('OD'), 'the morning’s walk would hold open on a name nobody can tick');
});

test('THE GPS FENCE DOES NOT FLAG A DAY THE OFFICE SENT THEM OUT', () => {
  assert.ok(REMOTE_MARKS.has('OD'));
  const away = { inside_fence: false, distance_m: 4700, located: true };
  const strict = { enabled: true, requireLocation: true, allowOutsideFence: false, fenceMetres: 200 };

  assert.equal(punchAllowed(away, strict, { code: 'OD' }).ok, true, 'punching from the client is the point');
  assert.equal(punchAllowed(away, strict, { code: 'P' }).ok, false, 'an ordinary day is still judged');
  assert.equal(punchAllowed(away, strict, { code: 'A' }).ok, false, 'an absence is not official duty');
  assert.equal(punchAllowed(away, strict, { code: 'CL' }).ok, false, 'nor is leave');
});

test('...but it does not switch punching on, or excuse a punch with no location', () => {
  const nowhere = { inside_fence: null, distance_m: null, located: false };
  assert.equal(punchAllowed(nowhere, { enabled: false, requireLocation: true, allowOutsideFence: true }, { code: 'OD' }).ok, false);
  assert.equal(punchAllowed(nowhere, { enabled: true, requireLocation: true, allowOutsideFence: true }, { code: 'OD' }).ok, false);
});

/*
 * THE OFFICE'S OWN WORDS, WITHOUT A SECOND SET OF MARKS.
 *
 * Dinesh's attendance brief lists the codes as WO / H / LWP / HD and then
 * says: *"Do not introduce duplicate or conflicting leave categories."* Two
 * of those already exist here under another name, and adding an LWP beside
 * UL is the duplicate he is warning against. So the code never moves and the
 * alias is shown beside it.
 */
test('the office’s names are ALIASES, never extra marks', async () => {
  const { CODE_ALIASES } = await import('../../shared/calc.js');
  assert.deepEqual(CODE_ALIASES, { S: 'WO', PH: 'H', UL: 'LWP', HF: 'HD' });

  /* Every alias points at a mark that really exists... */
  for (const [code, alias] of Object.entries(CODE_ALIASES)) {
    assert.ok(ATTENDANCE_CODES[code], `${code} is not a mark`);
    /* ...and no alias is itself a code, which is how two names for one thing
       become two things that drift apart. */
    assert.ok(!ATTENDANCE_CODES[alias], `${alias} has been added as a SECOND mark`);
  }
});

test('S is a weekly off, not only a Sunday - the app supports alternate Saturdays', () => {
  assert.equal(ATTENDANCE_CODES.S.label, 'Weekly off');
  assert.equal(ATTENDANCE_CODES.S.absent, 0, 'and it still costs nothing');
});
