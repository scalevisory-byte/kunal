import test from 'node:test';
import assert from 'node:assert/strict';
import { PUNCH_LOG_COLUMNS, PUNCH_LOG_LIMIT, punchLog, punchTimes, showPunches } from '../../shared/punchLog.js';

const STAFF = [
  { id: 1, name: 'AMIT SHAH', code: 'BNF-EMP-0043', device_code: '37', company_name: 'BNF', active: 1 },
  { id: 2, name: 'RIYA PAL', code: '45', device_code: '', company_name: 'BNF', active: 1 },
  { id: 3, name: 'KIRAN DESAI', code: 'BNF-EMP-0099', device_code: '', company_name: 'BNF', active: 1 },
];
const PUNCHES = [
  { code: '37', at: '2026-11-20 09:12:01', source: 'Bizcompass spool' },
  { code: '37', at: '2026-11-20 13:37:00', source: 'Bizcompass spool' },
  { code: '0037', at: '2026-11-21 09:05:00', source: 'IN gate' },
  { code: '45', at: '2026-11-21 09:30:00', source: 'IN gate' },
  { code: '188', at: '2026-11-21 10:00:00', source: 'IN gate' },
];

test('every punch gets a line, newest first', () => {
  const { rows, total, counts } = punchLog(PUNCHES, STAFF);
  assert.equal(total, 5);
  assert.equal(rows.length, 5);
  // Newest first: somebody opening this is nearly always asking about today.
  assert.equal(rows[0].date, '2026-11-21');
  assert.equal(rows[rows.length - 1].time, '09:12:01', 'to the second - it is the raw record');
  assert.equal(counts.people, 2, 'Amit and Riya; 188 is nobody');
  assert.equal(counts.days, 2);
});

test('a leading zero is the same enrolment', () => {
  const { rows } = punchLog(PUNCHES, STAFF);
  const amit = rows.filter((r) => r.employee_id === 1);
  assert.equal(amit.length, 3, '0037 and 37 are one number');
});

test("somebody with no punch ID but a numeric employee code is still matched", () => {
  const { rows } = punchLog(PUNCHES, STAFF);
  const riya = rows.find((r) => r.punch_id === '45');
  assert.equal(riya.employee_name, 'RIYA PAL');
});

test('A PUNCH NOBODY CARRIES IS LISTED, NEVER DROPPED', () => {
  // It is the whole reason somebody opens this: attendance arriving for a
  // person it can never reach. Dropping it would hide the one fact worth
  // reading.
  const { rows, counts } = punchLog(PUNCHES, STAFF);
  const orphan = rows.find((r) => r.punch_id === '188');
  assert.ok(orphan, 'it is on the list');
  assert.equal(orphan.employee_id, null, 'null, not a name and not an empty id');
  assert.equal(orphan.employee_name, '');
  assert.equal(counts.unmatched, 1);
  assert.equal(counts.unknownIds, 1);
});

test('a stamp that cannot be read is counted and left off, never guessed at', () => {
  const { total, counts } = punchLog([...PUNCHES, { code: '37', at: 'rubbish' }], STAFF);
  assert.equal(total, 5, 'not listed');
  assert.equal(counts.unreadable, 1, 'but counted');
});

test('it narrows to one day and to one person', () => {
  assert.equal(punchLog(PUNCHES, STAFF, { day: 20 }).total, 2);
  assert.equal(punchLog(PUNCHES, STAFF, { employeeId: 2 }).total, 1);
  assert.equal(punchLog(PUNCHES, STAFF, { day: 21, employeeId: 1 }).total, 1);
});

test('a capped list SAYS how much it left off', () => {
  // A list silently cut short reads as "that is all there was", which on a
  // punch log sends somebody hunting for a feed that is working perfectly.
  const many = Array.from({ length: 12 }, (_, i) => ({
    code: '37',
    at: `2026-11-20 09:${String(i).padStart(2, '0')}:00`,
    source: 'IN gate',
  }));
  const got = punchLog(many, STAFF, { limit: 5 });
  assert.equal(got.rows.length, 5);
  assert.equal(got.shown, 5);
  assert.equal(got.total, 12);
  assert.equal(got.more, 7);
});

test('nothing at all is an empty list, not a thrown error', () => {
  const got = punchLog([], STAFF);
  assert.deepEqual(got.rows, []);
  assert.equal(got.counts.punches, 0);
  assert.equal(got.more, 0);
});

test('the columns carry no salary and nothing statutory', () => {
  const keys = PUNCH_LOG_COLUMNS.map((c) => c.key);
  for (const banned of ['monthly_salary', 'salary', 'pan', 'aadhaar', 'bank_account', 'dob', 'net_salary']) {
    assert.ok(!keys.includes(banned), `${banned} has no business on a punch log`);
  }
  assert.ok(PUNCH_LOG_LIMIT > 0);
});

/*
 * showPunches: the rule v2.0.0 broke.
 *
 * It was "more than two", on the reasoning that two punches ARE the in and
 * the out. Then a one-punch day and a back-from-lunch day had their out time
 * suppressed, so a punch existed with nothing on screen showing it - which is
 * what Dinesh reported as "employee me bhi nahi dikh rahe".
 */
test('a day shows its punches whenever In and Out do not account for them', () => {
  const some = (n) => Array.from({ length: n }, () => ({ at: '09:00' }));
  assert.equal(showPunches({ in_time: '09:00', out_time: '18:00' }, some(3)), true);
  assert.equal(showPunches({ in_time: '09:00', out_time: '18:00' }, some(2)), false, 'they are the two ends');
  assert.equal(showPunches({ in_time: '09:00', out_time: '18:00' }, some(0)), false);
  assert.equal(showPunches({ in_time: '09:00', out_time: '' }, some(1)), false, 'the In column says it');
});

test('A SUPPRESSED OUT TIME STILL SHOWS ITS PUNCH', () => {
  // The bug itself: back from lunch, or one punch written into both columns.
  // The out column reads a dash and the second punch must not vanish with it.
  const two = [{ at: '10:50' }, { at: '14:16' }];
  assert.equal(showPunches({ in_time: '10:50', out_time: '' }, two), true);
});

test('a repeated minute shows its seconds, and nothing else does', () => {
  /*
   * Two touches of the door forty seconds apart printed as "10:50 · 10:50",
   * which reads as a fault rather than as what happened - and that is exactly
   * the day whose out time is blank and most needs explaining.
   */
  assert.equal(punchTimes([{ at: '10:50:00' }, { at: '10:50:40' }]), '10:50:00 · 10:50:40');
  assert.equal(
    punchTimes([{ at: '09:12:01' }, { at: '13:30:00' }, { at: '14:05:00' }, { at: '18:02:44' }]),
    '09:12 · 13:30 · 14:05 · 18:02',
    'an ordinary day stays in minutes - seconds would be noise'
  );
  assert.equal(punchTimes([]), '');
  assert.equal(punchTimes(), '');
});
