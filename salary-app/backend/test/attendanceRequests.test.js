import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUEST_KINDS,
  canDecide,
  daysOf,
  describe as describeRequest,
  entriesFor,
  entryFor,
  spans,
  sortForReview,
  validateRequest,
} from '../../shared/attendanceRequests.js';
import { ATTENDANCE_CODES } from '../../shared/calc.js';

const base = { period_id: 1, employee_id: 7, day: 15, reason: 'Machine did not read my finger' };

test('every kind of request says what it is and what it needs', () => {
  for (const kind of REQUEST_KINDS) {
    assert.ok(kind.label && kind.hint, `${kind.key} does not explain itself`);
    assert.ok(['times', 'mark', 'both', 'minutes', 'none'].includes(kind.needs));

    /*
     * A kind that asks the employee for NOTHING has to know what approving it
     * writes, or it is a request that lands on the grid as a reason with no
     * mark - which reads as a day somebody looked at and left blank.
     */
    if (kind.needs === 'none') {
      assert.ok(kind.writes, `${kind.key} asks for nothing and names no mark`);
      assert.ok(ATTENDANCE_CODES[kind.writes], `${kind.key} writes an unknown mark`);
    }
  }
});

test('a missing punch needs a time, a correction needs a mark', () => {
  assert.equal(validateRequest({ ...base, kind: 'missing_punch', in_time: '09:30' }).ok, true);
  assert.deepEqual(
    validateRequest({ ...base, kind: 'missing_punch' }).problems,
    ['give at least one time']
  );

  assert.equal(validateRequest({ ...base, kind: 'correction', code: 'CL' }).ok, true);
  assert.deepEqual(
    validateRequest({ ...base, kind: 'correction' }).problems,
    ['pick what the day should be']
  );
});

test('a reason is required, because the office has to decide on something', () => {
  const { ok, problems } = validateRequest({ ...base, kind: 'correction', code: 'CL', reason: '  ' });
  assert.equal(ok, false);
  assert.ok(problems.includes('say why — the office has to decide on something'));
});

test('a mark this app does not know is refused rather than written through', () => {
  const { problems } = validateRequest({ ...base, kind: 'correction', code: 'ZZ' });
  assert.ok(problems.some((p) => /unknown mark: ZZ/.test(p)));
});

test('a day outside a month is refused', () => {
  assert.ok(validateRequest({ ...base, kind: 'correction', code: 'CL', day: 0 }).problems.includes('pick a day'));
  assert.ok(validateRequest({ ...base, kind: 'correction', code: 'CL', day: 45 }).problems.includes('pick a day'));
});

test('approving writes only what the request actually named', () => {
  // The same merge rule setAttendance follows: approving "in at 9:30" must
  // not blank a lunch somebody else typed.
  //
  // The reason and the approval are the two exceptions, and deliberate ones:
  // somebody asking has already said why, and a day written BY an approval is
  // approved by definition. Everything else is still only what was named.
  const why = { reason: 'Machine did not read my finger', approved: true };

  const entry = entryFor({ ...base, kind: 'missing_punch', in_time: '09:30', out_time: '18:30' });
  assert.deepEqual(entry, { employee_id: 7, day: 15, in_time: '09:30', out_time: '18:30', ...why });
  assert.equal('lunch_out' in entry, false);
  assert.equal('code' in entry, false, 'a missing punch does not change the mark');

  const mark = entryFor({ ...base, kind: 'correction', code: 'CL', in_time: '09:30' });
  assert.deepEqual(
    mark,
    { employee_id: 7, day: 15, code: 'CL', ...why },
    'a correction only moves the mark'
  );

  const both = entryFor({ ...base, kind: 'regularise', code: 'P', in_time: '09:30' });
  assert.deepEqual(both, { employee_id: 7, day: 15, code: 'P', in_time: '09:30', ...why });

  // No reason given, no reason written - never an empty string over whatever
  // the office had already typed on that day.
  const silent = entryFor({ period_id: 1, employee_id: 7, day: 15, kind: 'correction', code: 'A' });
  assert.equal('reason' in silent, false);
  assert.equal(silent.approved, true);
});

test('a request reads as one line in the approval list', () => {
  assert.match(describeRequest({ kind: 'correction', code: 'CL' }), /Casual Leave/);
  assert.match(describeRequest({ kind: 'missing_punch', in_time: '09:30' }), /in time 09:30/);
  assert.equal(describeRequest({ kind: 'missing_punch' }), 'no change named');
});

test('nothing already decided can be decided twice', () => {
  assert.equal(canDecide({ status: 'pending' }).ok, true);
  assert.equal(canDecide({ status: 'approved' }).ok, false);
  assert.match(canDecide({ status: 'rejected' }).reason, /already rejected/);
  assert.equal(canDecide(null).ok, false);
});

test('a locked month cannot be decided into', () => {
  const { ok, reason } = canDecide({ status: 'pending' }, { periodLocked: true });
  assert.equal(ok, false);
  assert.match(reason, /locked/);
});

test('the one waiting longest is the one at the top', () => {
  const sorted = sortForReview([
    { id: 3, status: 'approved', created_at: '2026-10-01' },
    { id: 1, status: 'pending', created_at: '2026-10-10' },
    { id: 2, status: 'pending', created_at: '2026-10-02' },
  ]);
  assert.deepEqual(sorted.map((r) => r.id), [2, 1, 3]);
});

/* ================================================================= *
 * A leave application: the one request that covers a run of days
 * ================================================================= */

test('a leave application covers a run of days; everything else is one day', () => {
  assert.deepEqual(daysOf({ kind: 'leave', day: 12, to_day: 15 }), [12, 13, 14, 15]);
  assert.deepEqual(daysOf({ kind: 'leave', day: 12 }), [12], 'one day is still one day');
  assert.deepEqual(daysOf({ kind: 'missing_punch', day: 12, to_day: 15 }), [12]);
  assert.equal(spans('leave'), true);
  assert.equal(spans('correction'), false);
});

test('a last day before the first is read as a typo, never as covering nothing', () => {
  assert.deepEqual(daysOf({ kind: 'leave', day: 15, to_day: 12 }), [15]);
  const { ok, problems } = validateRequest({
    kind: 'leave',
    period_id: 1,
    day: 15,
    to_day: 12,
    code: 'CL',
    reason: 'family',
  });
  assert.equal(ok, false);
  assert.match(problems.join(' '), /last day is before the first/);
});

test('a span on a kind that cannot span is refused rather than quietly dropped', () => {
  const { ok, problems } = validateRequest({
    kind: 'missing_punch',
    period_id: 1,
    day: 3,
    to_day: 8,
    in_time: '09:30',
    reason: 'machine was down',
  });
  assert.equal(ok, false);
  assert.match(problems.join(' '), /covers one day/);
});

test('a leave application has to say which kind of leave', () => {
  const bad = validateRequest({ kind: 'leave', period_id: 1, day: 3, reason: 'family wedding' });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(' '), /pick what the day should be/);

  const good = validateRequest({
    kind: 'leave',
    period_id: 1,
    day: 3,
    to_day: 5,
    code: 'CL',
    reason: 'family wedding',
  });
  assert.equal(good.ok, true);
});

test('approving a leave application writes the mark on every day it covers', () => {
  const entries = entriesFor({
    kind: 'leave',
    employee_id: 7,
    day: 12,
    to_day: 14,
    code: 'PL',
  });
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.day),
    [12, 13, 14],
  );
  assert.ok(entries.every((e) => e.code === 'PL' && e.employee_id === 7));
});

test('clock times are not repeated across a span - "in at 9:30" for a fortnight is nonsense', () => {
  const entries = entriesFor({
    kind: 'leave',
    employee_id: 7,
    day: 12,
    to_day: 14,
    code: 'SL',
    in_time: '09:30',
  });
  assert.ok(entries.every((e) => e.in_time === undefined));
});

test('the one-line summary says how many days a leave application is for', () => {
  const line = describeRequest({ kind: 'leave', day: 12, to_day: 15, code: 'CL' });
  assert.match(line, /days 12–15 \(4 days\)/);
  assert.match(line, /Casual Leave/);
});

/*
 * Working from home.
 *
 * The WH mark already existed and was paid in full; what was missing was any
 * way to ask for it.
 */

test('a work-from-home request asks for nothing but a reason', () => {
  // No mark, no times, no minutes - and that is a complete request.
  assert.equal(validateRequest({ ...base, kind: 'remote' }).ok, true);

  // The reason still is not optional: the office is deciding something.
  assert.deepEqual(
    validateRequest({ ...base, kind: 'remote', reason: '   ' }).problems,
    ['say why — the office has to decide on something']
  );

  // A week at home is one request and one decision, like leave.
  assert.equal(spans('remote'), true);
  assert.deepEqual(daysOf({ kind: 'remote', day: 10, to_day: 14 }), [10, 11, 12, 13, 14]);
});

test('approving a work-from-home request marks the day WH, whatever it carried', () => {
  const entries = entriesFor({ ...base, kind: 'remote', day: 10, to_day: 12 });
  assert.equal(entries.length, 3);
  for (const e of entries) {
    assert.equal(e.code, 'WH');
    assert.equal(e.approved, true);
    assert.equal(e.reason, base.reason);
    // Nothing about the hours: working from home is a full day's work, so
    // there is no shortfall to write and no minutes to dock.
    assert.equal(e.minutes, undefined);
  }

  /*
   * The mark belongs to the KIND, not to the request. A remote request that
   * arrives carrying `code: 'A'` - from a stale form, or from somebody poking
   * at the API - still marks the day WH and cannot write an absence.
   */
  assert.equal(entryFor({ ...base, kind: 'remote', code: 'A' }).code, 'WH');
  assert.equal(entryFor({ ...base, kind: 'remote', code: 'UL' }).code, 'WH');

  // And the approval list says what it would do without anybody opening it.
  assert.match(describeRequest({ ...base, kind: 'remote', day: 10, to_day: 12 }), /Work From Home/i);
});
