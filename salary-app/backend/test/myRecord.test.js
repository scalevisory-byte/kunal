import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOWN_NOTE_KINDS,
  penaltyReached,
  recordSummary,
  theirNote,
  theirPenalty,
  visibleNotes,
  visiblePenalties,
} from '../../shared/myRecord.js';

/**
 * THE EMPLOYEE'S OWN COPY OF THEIR RECORD.
 *
 * Dinesh: *"emp[loyee me unke achvemnet and penlatlites bhi dikhe esa karo"*.
 *
 * One rule: the portal shows what was ISSUED to them. These tests pin each
 * of its three consequences, because each is a judgement somebody could
 * reasonably change and none of them should change by accident.
 */

test('a warning and an appreciation are theirs; the office’s own jotting is not', () => {
  assert.deepEqual(SHOWN_NOTE_KINDS, ['warning', 'appreciation']);
  const notes = visibleNotes([
    { id: 1, kind: 'appreciation', subject: 'Dubai group', dated: '2026-09-04' },
    { id: 2, kind: 'warning', subject: 'Late four times', dated: '2026-10-02' },
    { id: 3, kind: 'note', subject: 'Thinking of moving him to Surat', dated: '2026-10-05' },
  ]);
  assert.deepEqual(notes.map((n) => n.id), [1, 2]);
  /*
   * A plain note was never handed to anybody. Publishing it would turn a
   * jotting into a document, and the office would simply stop writing them -
   * which costs the record more than it gains the employee.
   */
  assert.ok(!JSON.stringify(notes).includes('Surat'));
});

test('a penalty is shown once told, or once money has come out of it', () => {
  assert.equal(penaltyReached({ told_on: '2026-10-10' }), true);
  assert.equal(penaltyReached({ recovered: 500 }), true);
  /* Recorded, never mentioned, nothing deducted: still being considered, and
     a fine under consideration can still be waived. */
  assert.equal(penaltyReached({ told_on: null, recovered: 0 }), false);
  /* `recovered` missing is not `recovered: 0` by accident - it must still
     read as nothing having come out. */
  assert.equal(penaltyReached({}), false);

  const shown = visiblePenalties(
    [
      { id: 1, amount: 500, note: 'quiet', told_on: null, recovered: 0 },
      { id: 2, amount: 2000, note: 'chair', told_on: '2026-10-10', recovered: 0 },
      { id: 3, amount: 300, note: 'taken', told_on: null, recovered: 300 },
    ],
    () => []
  );
  assert.deepEqual(shown.map((p) => p.id), [2, 3]);
});

test('both lists travel through a whitelist, not a strip', () => {
  const note = theirNote({
    id: 7, kind: 'warning', subject: 'x', dated: '2026-10-02T00:00:00Z',
    employee_id: 4, created_at: 'whenever', some_future_column: 'leaked',
  });
  assert.ok(!('employee_id' in note));
  assert.ok(!('some_future_column' in note));
  /* A date is a date, not a timestamp. */
  assert.equal(note.dated, '2026-10-02');

  const penalty = theirPenalty(
    {
      id: 9, amount: '1500', note: 'n', status: 'open', outstanding: 1000, recovered: 500,
      employee_id: 4, employee_name: 'Amit Shah', company_name: 'BOOKNFLY', months: '3',
    },
    [{ period_label: 'October 2026', year: 2026, month: 10, amount: '500', penalty_id: 9 }]
  );
  assert.ok(!('employee_id' in penalty));
  assert.ok(!('employee_name' in penalty));
  assert.equal(penalty.amount, 1500);
  assert.equal(penalty.months, 3);
  /* The recovery rows are the months and the amounts, nothing else. */
  assert.deepEqual(Object.keys(penalty.recoveries[0]).sort(),
    ['amount', 'month', 'period_label', 'year']);
  assert.equal(penalty.recoveries[0].amount, 500);
});

test('the summary counts what is still to come out, and what cannot be undone', () => {
  const notes = [
    { kind: 'appreciation', dated: '2026-09-04' },
    { kind: 'warning', dated: '2026-10-02', acknowledged_on: '2026-10-03' },
    { kind: 'warning', dated: '2026-10-20', acknowledged_on: null },
  ];
  const penalties = [
    { status: 'open', outstanding: 1000, recovered: 500, told_on: '2026-10-10' },
    { status: 'waived', outstanding: 0, recovered: 0, told_on: '2026-09-01' },
    { status: 'recovered', outstanding: 0, recovered: 300, told_on: '2026-08-01' },
  ];
  const sum = recordSummary({ notes, penalties });
  assert.equal(sum.appreciations, 1);
  assert.equal(sum.warnings, 2);
  assert.equal(sum.warnings_unacknowledged, 1);
  assert.equal(sum.penalties, 3);
  assert.equal(sum.penalties_open, 1);
  /* OUTSTANDING is what is still to come out of their salary - a waived one
     and a settled one are not on that figure. */
  assert.equal(sum.outstanding, 1000);
  assert.equal(sum.recovered, 800);
  assert.equal(sum.latest, '2026-10-20');
  assert.equal(sum.empty, false);
});

test('nothing on either list reads as empty, not as nought', () => {
  const sum = recordSummary({});
  assert.equal(sum.empty, true);
  assert.equal(sum.appreciations, 0);
  assert.equal(sum.outstanding, 0);
  /* No date to report is null, never today. */
  assert.equal(sum.latest, null);
});
