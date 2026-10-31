import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUEST_KINDS,
  canDecide,
  describe as describeRequest,
  entryFor,
  sortForReview,
  validateRequest,
} from '../../shared/attendanceRequests.js';

const base = { period_id: 1, employee_id: 7, day: 15, reason: 'Machine did not read my finger' };

test('every kind of request says what it is and what it needs', () => {
  for (const kind of REQUEST_KINDS) {
    assert.ok(kind.label && kind.hint, `${kind.key} does not explain itself`);
    assert.ok(['times', 'mark', 'both'].includes(kind.needs));
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
  const entry = entryFor({ ...base, kind: 'missing_punch', in_time: '09:30', out_time: '18:30' });
  assert.deepEqual(entry, { employee_id: 7, day: 15, in_time: '09:30', out_time: '18:30' });
  assert.equal('lunch_out' in entry, false);
  assert.equal('code' in entry, false, 'a missing punch does not change the mark');

  const mark = entryFor({ ...base, kind: 'correction', code: 'CL', in_time: '09:30' });
  assert.deepEqual(mark, { employee_id: 7, day: 15, code: 'CL' }, 'a correction only moves the mark');

  const both = entryFor({ ...base, kind: 'regularise', code: 'P', in_time: '09:30' });
  assert.deepEqual(both, { employee_id: 7, day: 15, code: 'P', in_time: '09:30' });
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
