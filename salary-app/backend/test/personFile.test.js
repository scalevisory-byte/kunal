import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pendingFor,
  recentFor,
  serviceOf,
  statusOf,
  summaryFor,
} from '../../shared/personFile.js';

/*
 * One person's file. It ASSEMBLES from records the panels already own and
 * stores nothing - so these tests are about what it says, and about never
 * inventing a figure that somebody else is responsible for.
 */

const TODAY = '2026-11-04';
const person = { id: 1, name: 'Vaibhav Gupta', joined_on: '2018-06-01', active: 1 };

test('what needs doing is ordered by how much it is costing', () => {
  const pending = pendingFor(
    {
      employee: person,
      claims: [
        { status: 'pending', amount: 1200 },
        { status: 'approved', amount: 800 },
      ],
      tasks: [{ status: 'open', due_on: '2026-10-01' }],
      tickets: [{ status: 'open' }],
      notes: [{ kind: 'warning', acknowledged_on: null }],
    },
    { today: TODAY }
  );
  const urgencies = pending.map((p) => p.urgency);
  assert.deepEqual([...urgencies].sort(), urgencies, 'the worst is first');
  assert.ok(pending.some((p) => /past its date/.test(p.text)));
  assert.ok(pending.some((p) => /waiting on a decision/.test(p.text) && /1,200/.test(p.text)));
  assert.ok(pending.some((p) => /approved and not paid/.test(p.text)));
  assert.ok(pending.some((p) => /unanswered/.test(p.text)));
  assert.ok(pending.some((p) => /not acknowledged/.test(p.text)));
});

test('an unsettled exit outranks everything, and a past date is harsher', () => {
  const leaving = pendingFor(
    { employee: person, exit: { last_working_day: '2026-10-31', settled_on: null } },
    { today: TODAY }
  );
  assert.equal(leaving[0].urgency, 'now');
  assert.match(leaving[0].text, /full and final is not settled/);

  const future = pendingFor(
    { employee: person, exit: { last_working_day: '2026-12-31', settled_on: null } },
    { today: TODAY }
  );
  assert.equal(future[0].urgency, 'soon');

  // Settled: nothing left to chase.
  const done = pendingFor(
    { employee: person, exit: { last_working_day: '2026-10-31', settled_on: '2026-11-02' } },
    { today: TODAY }
  );
  assert.deepEqual(done, []);
});

test('a quiet file is quiet - nothing is invented to fill the screen', () => {
  assert.deepEqual(pendingFor({ employee: person }, { today: TODAY }), []);
  assert.deepEqual(recentFor({ employee: person }), []);
});

test('probation reads differently before and after the date', () => {
  const during = pendingFor(
    { employee: { ...person, probation_until: '2026-12-01' } },
    { today: TODAY }
  );
  assert.equal(during[0].urgency, 'later');
  assert.match(during[0].text, /Probation ends/);

  const after = pendingFor(
    { employee: { ...person, probation_until: '2026-09-01' } },
    { today: TODAY }
  );
  assert.equal(after[0].urgency, 'soon');
  assert.match(after[0].text, /nobody has confirmed them/);
});

test('an appraisal is only due when a next date was set', () => {
  const unset = pendingFor(
    { employee: person, appraisals: [{ reviewed_on: '2025-04-01' }] },
    { today: TODAY }
  );
  assert.deepEqual(unset, [], 'not scheduled is not the same as overdue');

  const due = pendingFor(
    { employee: person, appraisals: [{ reviewed_on: '2025-04-01', next_review_on: '2026-04-01' }] },
    { today: TODAY }
  );
  assert.match(due[0].text, /Appraisal was due/);
});

test('what happened reads newest first, across every kind of record', () => {
  const recent = recentFor({
    employee: person,
    notes: [{ kind: 'warning', dated: '2026-01-10', subject: 'Late' }],
    appraisals: [{ reviewed_on: '2026-04-01', cycle: '2026-27', rating: 'A', applied_at: 'x' }],
    claims: [{ spent_on: '2026-10-15', kind: 'Petrol', amount: 900, status: 'paid' }],
    tickets: [{ created_at: '2026-11-01 10:00:00', subject: 'PF query', status: 'open' }],
  });
  assert.deepEqual(recent.map((e) => e.on), ['2026-11-01', '2026-10-15', '2026-04-01', '2026-01-10']);
  assert.equal(recent[0].what, 'Helpdesk');
  assert.match(recent[2].text, /increment applied/);
});

test('the summary counts each thing once, from the record that owns it', () => {
  const totals = summaryFor({
    notes: [
      { kind: 'warning' },
      { kind: 'warning' },
      { kind: 'appreciation' },
      { kind: 'note' },
    ],
    appraisals: [
      { reviewed_on: '2025-04-01', applied_at: 'x', from_salary: 20000, to_salary: 22000 },
      { reviewed_on: '2026-04-01', applied_at: 'x', from_salary: 22000, to_salary: 26000 },
      { reviewed_on: '2026-10-01' }, // a proposal, not yet applied
    ],
    claims: [{ status: 'paid', amount: 900 }, { status: 'pending', amount: 400 }],
    tasks: [{ status: 'open' }, { status: 'done' }],
    tickets: [{ status: 'open' }, { status: 'closed' }],
  });
  assert.equal(totals.warnings, 2);
  assert.equal(totals.appreciations, 1, 'a plain note is neither');
  assert.equal(totals.increments, 2, 'a proposal is not an increment');
  assert.equal(totals.last_increment.to_salary, 26000, 'the latest one actually applied');
  assert.equal(totals.open_tasks, 1);
  assert.equal(totals.open_tickets, 1);
  assert.equal(totals.claims_paid_total, 900);
});

test('status is read, never stored - so two screens cannot disagree', () => {
  assert.equal(statusOf({ active: 1 }).key, 'working');
  assert.equal(statusOf({ active: 0 }).key, 'left');
  assert.equal(statusOf({ active: 1, left_on: '2026-10-31' }).key, 'left');
  assert.equal(statusOf({ active: 1 }, { settled_on: null }).key, 'leaving');
  // Settled means the exit is finished; they are simply gone or still here.
  assert.equal(statusOf({ active: 1 }, { settled_on: '2026-11-01' }).key, 'working');
  assert.equal(statusOf({ active: 1, probation_until: '2026-12-01' }, null, TODAY).key, 'probation');
  assert.equal(statusOf({ active: 1, probation_until: '2026-09-01' }, null, TODAY).key, 'working');
});

test('service length is said the way a person would say it', () => {
  assert.equal(serviceOf('2018-06-01', '2026-11-04'), '8y 5m');
  assert.equal(serviceOf('2026-06-01', '2026-11-04'), '5m');
  assert.equal(serviceOf('2025-11-04', '2026-11-04'), '1y');
  // A day short of the month does not round up.
  assert.equal(serviceOf('2026-10-05', '2026-11-04'), '0m');
  assert.equal(serviceOf(null), '');
  assert.equal(serviceOf('2027-01-01', '2026-11-04'), '', 'a joining date in the future says nothing');
});
