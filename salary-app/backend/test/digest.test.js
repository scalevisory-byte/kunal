import test from 'node:test';
import assert from 'node:assert/strict';

import { digest } from '../../shared/digest.js';

test('a quiet day says nothing rather than padding', () => {
  const d = digest({ today: '2026-11-01' });
  assert.equal(d.count, 0);
  assert.equal(d.lines.length, 0);
  assert.equal(d.heading, 'Nothing waiting');
  assert.equal(d.text, 'Nothing waiting.');
});

test('pending decisions are counted and the people named', () => {
  const d = digest({
    requests: [
      { status: 'pending', employee_name: 'Riya Pal' },
      { status: 'pending', employee_name: 'Mahesh Shinde' },
      { status: 'approved', employee_name: 'Already done' },
    ],
    claims: [
      { status: 'pending', employee_name: 'Vaibhav Gupta', amount: 1450 },
      { status: 'approved', employee_name: 'Riya Pal', amount: 3200 },
    ],
    tickets: [{ waiting: true, employee_name: 'Anchal Tiwari' }, { waiting: false, employee_name: 'Answered' }],
    today: '2026-11-01',
  });
  assert.equal(d.count, 4);
  assert.match(d.text, /2 attendance requests waiting: Riya Pal, Mahesh Shinde/);
  assert.match(d.text, /1 expense claim to approve, ₹1,450: Vaibhav Gupta/);
  assert.match(d.text, /1 claim approved but not paid, ₹3,200/);
  assert.match(d.text, /1 question from staff unanswered: Anchal Tiwari/);
  assert.equal(d.heading, '4 things need doing');
});

test('one thing reads as one thing', () => {
  const d = digest({ requests: [{ status: 'pending', employee_name: 'Riya Pal' }], today: '2026-11-01' });
  assert.equal(d.heading, '1 thing needs doing');
});

test('a long list of names is cut short rather than running to a paragraph', () => {
  const d = digest({
    requests: Array.from({ length: 9 }, (_, i) => ({ status: 'pending', employee_name: `Person ${i + 1}` })),
    today: '2026-11-01',
  });
  assert.match(d.text, /Person 1, Person 2, Person 3, Person 4 and 5 more/);
});

test('overdue jobs are told apart from jobs wanted today', () => {
  const d = digest({
    tasks: [
      { status: 'open', due_on: '2026-10-20', title: 'Chase the PF challan' },
      { status: 'open', due_on: '2026-11-01', title: 'Send the ESIC file' },
      { status: 'open', due_on: '2026-12-01', title: 'Not yet' },
      { status: 'done', due_on: '2026-10-01', title: 'Finished' },
    ],
    today: '2026-11-01',
  });
  assert.match(d.text, /1 job past its date: Chase the PF challan/);
  assert.match(d.text, /1 job wanted today: Send the ESIC file/);
  assert.equal(d.count, 2, 'the future one and the finished one are not news');
});

test('a month with nothing marked says so once, not person by person', () => {
  const rows = [
    { employee_name: 'A', attendance: {}, status: '', net_salary: 100, uan: '1', esic_no: '1' },
    { employee_name: 'B', attendance: {}, status: '', net_salary: 100, uan: '1', esic_no: '1' },
  ];
  const d = digest({ period: { label: 'November 2026' }, rows, today: '2026-11-01' });
  assert.match(d.text, /November 2026: nothing marked yet for anybody/);
  assert.equal(
    /people with no attendance at all/.test(d.text),
    false,
    'the per-person line would be saying the same thing twice',
  );
});

test('unpaid salaries carry their total; paid ones are not mentioned', () => {
  const rows = [
    { employee_name: 'A', attendance: { 1: 'P' }, status: 'Paid', net_salary: 20000, uan: '1', esic_no: '1' },
    { employee_name: 'B', attendance: { 1: 'P' }, status: '', net_salary: 18000, uan: '1', esic_no: '1' },
  ];
  const d = digest({ period: { label: 'November 2026' }, rows, today: '2026-11-01' });
  assert.match(d.text, /1 salary unpaid, ₹18,000/);
});

test('a missing UAN is reported but does not count as something to do today', () => {
  const rows = [{ employee_name: 'A', attendance: { 1: 'P' }, status: 'Paid', net_salary: 1, uan: '', esic_no: '' }];
  const d = digest({ period: { label: 'November 2026' }, rows, today: '2026-11-01' });
  assert.match(d.text, /1 person still without a UAN or ESIC number/);
  assert.equal(d.count, 0, 'it is a standing gap, not a job for today');
});

test('an unsettled exit and an asset still out with a leaver are both named', () => {
  const d = digest({
    exits: [
      { employee_name: 'Anchal Tiwari', settled_on: null },
      { employee_name: 'Settled Already', settled_on: '2026-10-01' },
    ],
    assets_out: [{ label: 'Dell Latitude', employee_name: 'Anchal Tiwari' }],
    today: '2026-11-01',
  });
  assert.match(d.text, /1 full and final not settled: Anchal Tiwari/);
  assert.match(d.text, /1 asset still out with somebody who has left: Dell Latitude \(Anchal Tiwari\)/);
  assert.equal(d.count, 2);
});


test('each line says what kind it is, so a caller can take only its part', () => {
  const d = digest({
    requests: [{ status: 'pending', employee_name: 'Riya Pal' }],
    claims: [{ status: 'pending', employee_name: 'Vaibhav Gupta', amount: 1450 }],
    period: { label: 'November 2026' },
    rows: [{ employee_name: 'A', attendance: {}, status: '', net_salary: 100, uan: '', esic_no: '' }],
    today: '2026-11-01',
  });
  const kinds = d.items.map((i) => i.kind);
  assert.equal(kinds.filter((k) => k === 'queue').length, 2, 'the request and the claim');
  assert.ok(kinds.includes('payroll'), 'and the month lines are marked apart');
  assert.equal(d.waiting, 2, 'which is what the dashboard tile counts');
  // The text still reads as a sentence, with the bullet taken off.
  assert.ok(d.items.every((i) => !i.text.startsWith('\u2022')), 'the bullet is taken off the item text');
  assert.equal(d.lines.length, d.items.length, 'and nothing is lost either way');
});
