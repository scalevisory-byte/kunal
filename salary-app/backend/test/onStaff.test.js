import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ON_STAFF_EVIDENCE, isoDay, lastSeenDay, onStaffThatDay, staffOn } from '../../shared/onStaff.js';
import { ATTENDANCE_CODES, calculateRow } from '../../shared/calc.js';
import { dailyReport } from '../../shared/dailyReport.js';

/**
 * WHO WAS ON THE STAFF THAT DAY.
 *
 * Dinesh, off the live roll call: *"isme left wale bhi aa rahe he absent me"* -
 * seventeen names under Absent where HR's own message listed ten. Somebody
 * who leaves mid-month stays on the month's payroll (they are owed for the
 * part they worked), and the roll call never read the leaving date.
 */

const NOV = { year: 2026, month: 11 };
const on = (person, day) => onStaffThatDay(person, { ...NOV, day }).on;

test('SOMEBODY WHO HAS LEFT IS NOT ON THE ROLL AFTER THEIR LAST DAY', () => {
  const leaver = { active: 0, left_on: '2026-11-10' };
  assert.equal(on(leaver, 9), true);
  assert.equal(on(leaver, 10), true, 'the last working day is still a working day');
  assert.equal(on(leaver, 11), false);
  assert.equal(on(leaver, 25), false);
  assert.match(onStaffThatDay(leaver, { ...NOV, day: 25 }).why, /left on 2026-11-10/);
});

test('a leaving date that has not come yet changes nothing - they are serving notice', () => {
  const noticed = { active: 1, left_on: '2026-11-30' };
  for (const day of [1, 15, 30]) assert.equal(on(noticed, day), true);
});

test('gone before the month began: off every day of it', () => {
  const old = { active: 0, left_on: '2026-10-20' };
  for (const day of [1, 15, 30]) assert.equal(on(old, day), false);
});

test('NOBODY IS ABSENT BEFORE THEY JOINED', () => {
  const joiner = { active: 1, joined_on: '2026-11-18' };
  assert.equal(on(joiner, 17), false);
  assert.equal(on(joiner, 18), true);
  assert.match(onStaffThatDay(joiner, { ...NOV, day: 3 }).why, /joins on 2026-11-18/);
});

test('MARKED AS LEFT WITH NO DATE: on the roll up to the last day they were seen', () => {
  const gone = {
    active: 0,
    attendance: { 3: { code: 'A' }, 11: { code: 'P' }, 12: { code: 'CL' }, 13: { code: 'A' }, 25: { code: 'A' } },
  };
  assert.equal(lastSeenDay(gone.attendance), 12);
  assert.equal(on(gone, 3), true, 'a real absence BEFORE they went is still an absence');
  assert.equal(on(gone, 12), true);
  assert.equal(on(gone, 13), false);
  assert.equal(on(gone, 25), false);
  /* It is an inference and has to say so. */
  assert.match(onStaffThatDay(gone, { ...NOV, day: 25 }).why, /no leaving date on record/);
});

test('...and with nothing but absences on the month, off the whole of it', () => {
  const never = { active: 0, attendance: { 4: { code: 'A' }, 25: { code: 'A' } } };
  assert.equal(lastSeenDay(never.attendance), 0);
  for (const day of [1, 4, 25]) assert.equal(on(never, day), false);
});

test('a clock-in is evidence even with no mark on the day', () => {
  assert.equal(lastSeenDay({ 14: { code: '', in_time: '10:05' } }), 14);
});

test('AN ABSENCE, A WEEKLY OFF AND A HOLIDAY ARE NOT EVIDENCE', () => {
  /* The absence is the thing in question; S and PH are filled across the whole
     grid in one press and say nothing about one person. */
  for (const code of ['A', 'UL', 'AD', 'S', 'PH']) {
    assert.ok(!ON_STAFF_EVIDENCE.has(code), `${code} is being read as proof somebody was still here`);
    assert.equal(lastSeenDay({ 20: { code } }), 0);
  }
  for (const code of ON_STAFF_EVIDENCE) assert.ok(ATTENDANCE_CODES[code], `${code} is not a real mark`);
});

test('ONLY AN EXPLICIT "LEFT" COUNTS - an ordinary employee is never dropped', () => {
  const marks = { attendance: { 25: { code: 'A' } } };
  assert.equal(on({ active: 1, ...marks }, 25), true);
  assert.equal(on({ ...marks }, 25), true, 'a row with no active field is not somebody who left');
  assert.equal(on({ active: null, ...marks }, 25), true);
});

test('a day that cannot be named leaves everybody on, which is what it always did', () => {
  assert.equal(isoDay({}, 5), '');
  assert.equal(onStaffThatDay({ active: 0, left_on: '2026-11-01' }, { day: 5 }).on, true);
});

test('staffOn keeps who it left out, with the reason', () => {
  const rows = [
    { employee_name: 'Here', active: 1 },
    { employee_name: 'Gone', active: 0, left_on: '2026-11-10' },
  ];
  const { staff, gone } = staffOn(rows, { ...NOV, day: 25 });
  assert.deepEqual(staff.map((r) => r.employee_name), ['Here']);
  assert.equal(gone[0].row.employee_name, 'Gone');
  assert.match(gone[0].why, /left on/);
});

test('IT DECIDES WHO IS LISTED, NEVER WHAT ANYBODY IS PAID', () => {
  /* The leaving date is on the row either way; the last month must price the
     same marks to the same rupee. */
  const period = { ...NOV, hours_per_day: 9, late_policy: 'none' };
  const attendance = {};
  for (let d = 1; d <= 10; d++) attendance[d] = { code: 'P', minutes: 0 };
  for (let d = 11; d <= 26; d++) attendance[d] = { code: 'A', minutes: 0 };
  const plain = calculateRow({ salary: 26000 }, period, attendance);
  const dated = calculateRow({ salary: 26000, active: 0, left_on: '2026-11-10' }, period, attendance);
  for (const key of ['gross_salary', 'net_salary', 'absent_days', 'present_days', 'pt']) {
    assert.equal(dated[key], plain[key], `${key} moved because of a leaving date`);
  }
  const calc = readFileSync(new URL('../../shared/calc.js', import.meta.url), 'utf8');
  assert.ok(!/onStaff/.test(calc), 'the calculation has started reading who is on the roll');
});

test('THE DAILY MESSAGE DOES NOT LIST A LEAVER AS ABSENT', () => {
  const rows = [
    { employee_name: 'STILL HERE', active: 1, attendance: { 25: { code: 'A', reason: 'fever' } } },
    { employee_name: 'LEFT ON THE TENTH', active: 0, left_on: '2026-11-10', attendance: { 25: { code: 'A' } } },
    { employee_name: 'AT HER DESK', active: 1, attendance: { 25: { code: 'P' } } },
  ];
  const built = dailyReport({ period: NOV, rows, day: 25, date: '2026-11-25', standard: { in: '09:30', out: '18:30' } });
  assert.match(built.text, /STILL HERE/);
  assert.ok(!/LEFT ON THE TENTH/.test(built.text), 'somebody who left a fortnight ago went out to the group as absent');
  assert.equal(built.counts.absent, 1);
  assert.equal(built.counts.people, 2);
  assert.equal(built.counts.not_on_staff, 1);
  /* ...and on a day they were still here, they are in it. */
  const earlier = dailyReport({
    period: NOV,
    rows: [{ employee_name: 'LEFT ON THE TENTH', active: 0, left_on: '2026-11-10', attendance: { 9: { code: 'A' } } }],
    day: 9,
    date: '2026-11-09',
    standard: { in: '09:30', out: '18:30' },
  });
  assert.match(earlier.text, /LEFT ON THE TENTH/);
});

test('the roll call, the trend and the message all read the ONE rule', () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const dash = strip(readFileSync(new URL('../../frontend/src/components/Dashboard.jsx', import.meta.url), 'utf8'));
  const report = strip(readFileSync(new URL('../../shared/dailyReport.js', import.meta.url), 'utf8'));
  assert.ok((dash.match(/onStaffThatDay\(/g) || []).length >= 2, 'the roll call and the trend must both ask');
  assert.match(report, /onStaffThatDay\(/);
  /* And the list says who it left out, rather than quietly getting shorter. */
  assert.match(dash, /roll\.gone\.length \?/);
});
