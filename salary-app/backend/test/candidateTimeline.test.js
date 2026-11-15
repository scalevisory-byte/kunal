import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, toTime } from '../../shared/candidateTimeline.js';

/*
 * The candidate's story, A to Z. It assembles and nothing else: every date
 * here was written by the screen that owns it.
 */

const file = {
  candidate: { created_at: '2026-11-01 10:00', source: 'walk-in' },
  applications: [
    {
      id: 1, created_at: '2026-11-02 09:00', job_title: 'Travel Consultant',
      company_name: 'BOOKNFLY', employee_id: 7, joining_date: '2026-12-01',
    },
  ],
  screenings: [
    { verdict: 'Eligible', screened_on: '2026-11-03', remarks: 'good spoken English' },
  ],
  attempts: [
    { id: 11, assigned_at: '2026-11-04 11:00', paper_name: 'Accounts test' },
    {
      id: 11, assigned_at: null, submitted_at: '2026-11-05 12:00', paper_name: 'Accounts test',
      percentage: 70, right_count: 14, wrong_count: 6,
    },
  ],
  history: [
    {
      interview_id: 3, at: '2026-11-06 15:00', round: 1, round_name: 'HR round',
      interviewer: 'Alpesh', mode: 'In person',
      form_submitted: '2026-11-06 16:00', decision: 'Selected',
      approved_at: '2026-11-07 10:00', recommendation: 'Hire', approved_by: 'Dinesh',
    },
  ],
  offers: [
    {
      id: 2, created_at: '2026-11-08 09:00', designation: 'Travel Consultant', salary: 25000,
      approved_at: '2026-11-08 12:00', approved_by: 'Dinesh',
      sent_at: '2026-11-09 09:00', accepted_at: '2026-11-10 09:00',
    },
  ],
};

test('every step is there, oldest first', () => {
  const events = buildTimeline(file);
  assert.deepEqual(
    events.map((e) => e.what),
    [
      'Added to the list',
      'Applied',
      'Screening: Eligible',
      'Test paper drawn',
      'Test sat — 70%',
      'Interview — HR round',
      'Particulars form filled in',
      'Evaluation approved — Hire',
      'Offer drafted',
      'Offer approved',
      'Offer sent',
      'Offer accepted',
      'Put on the payroll',
    ]
  );
});

test('the dates run forwards', () => {
  const events = buildTimeline(file);
  const dates = events.map((e) => e.at);
  assert.deepEqual([...dates].sort(), dates, 'a story told backwards is the hardest way to read one');
});

test('a step with no date recorded is left out, never given a plausible one', () => {
  const events = buildTimeline({
    candidate: { created_at: '2026-11-01' },
    offers: [{ id: 1, created_at: '2026-11-02', designation: 'X', sent_at: null, accepted_at: null }],
  });
  assert.deepEqual(events.map((e) => e.what), ['Added to the list', 'Offer drafted']);
  assert.ok(!events.some((e) => !e.at), 'nothing undated reaches the list');
});

test('a sat paper carries the way back to its answer sheet', () => {
  const sat = buildTimeline(file).find((e) => e.what.startsWith('Test sat'));
  assert.equal(sat.attemptId, 11, 'the record has to open the paper itself, not just name it');
});

test('an empty file is empty, not a story about nothing', () => {
  assert.deepEqual(buildTimeline({}), []);
  assert.deepEqual(buildTimeline({ candidate: {} }), []);
});

test('a rejection says why', () => {
  const events = buildTimeline({
    screenings: [{ verdict: 'Rejected', screened_on: '2026-11-03', rejection_reason: 'no experience' }],
  });
  assert.equal(events[0].what, 'Screening: Rejected');
  assert.equal(events[0].detail, 'no experience');
});

test('SQLite dates and ISO dates sort together, not half a day apart', () => {
  // The exact pair that comes out of the app: SQLite's datetime('now') for
  // the application, an ISO string for the submission, the same minute.
  const events = buildTimeline({
    candidate: { created_at: '2026-11-15 09:00:00' },
    applications: [{ id: 1, created_at: '2026-11-15 10:00:00', job_title: 'Travel Consultant' }],
    attempts: [
      { id: 1, assigned_at: '2026-11-15 11:00:00', paper_name: 'Accounts test' },
      {
        id: 1, submitted_at: '2026-11-15T11:30:00.000Z', paper_name: 'Accounts test',
        percentage: 60, right_count: 3, wrong_count: 2,
      },
    ],
  });
  assert.deepEqual(events.map((e) => e.what), [
    'Added to the list',
    'Applied',
    'Test paper drawn',
    'Test sat — 60%',
  ]);
});

test('a SQLite timestamp is read as UTC, which is what SQLite wrote', () => {
  assert.equal(toTime('2026-11-15 17:40:31'), Date.parse('2026-11-15T17:40:31Z'));
  assert.equal(toTime('2026-11-15T17:40:31.000Z'), Date.parse('2026-11-15T17:40:31Z'));
  assert.ok(Number.isNaN(toTime('')), 'nothing is not a date');
});
