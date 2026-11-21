import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationStatus,
  bucketOf,
  leaveByDepartment,
  waitingDays,
} from '../../shared/leaveReports.js';

/* ---------------- leave by department ---------------- */

test('everybody is counted, not only the people who took something', () => {
  const { lines, totals } = leaveByDepartment([
    { department: 'Sales', per_day: 1000, attendance: { 18: 'CL', 19: 'CL' } },
    { department: 'Sales', per_day: 1000, attendance: {} },
    { department: 'Sales', per_day: 1000, attendance: {} },
  ]);
  const sales = lines[0];
  assert.equal(sales.people, 3, 'the headcount is everybody');
  assert.equal(sales.took, 1, 'one of them took leave');
  /* The figure that needs the headcount: 2 days across 3 people is not the
     same month as 2 days across 1, and a report without it cannot say so. */
  assert.equal(sales.per_head, 0.67);
  assert.equal(totals.total_days, 2);
});

test('paid and unpaid leave stay apart, and are priced off each person’s own rate', () => {
  const { lines } = leaveByDepartment([
    { department: 'Ops', per_day: 1000, attendance: { 3: 'PL', 4: 'UL' } },
    { department: 'Ops', per_day: 500, attendance: { 5: 'SL' } },
  ]);
  const ops = lines[0];
  assert.equal(ops.paid_days, 2, 'PL + SL');
  assert.equal(ops.unpaid_days, 1, 'UL alone');
  /* 1 PL at 1,000 + 1 SL at 500. A report that used one average rate would
     disagree with two payslips. */
  assert.equal(ops.paid_amount, 1500);
  assert.equal(ops.unpaid_amount, 1000);
});

test('nobody with no department is dropped', () => {
  const { lines } = leaveByDepartment([{ department: '', per_day: 100, attendance: { 2: 'CL' } }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].department, 'No department set');
  assert.equal(lines[0].CL, 1);
});

/* ---------------- application status and ageing ---------------- */

test('ageing runs from the last thing that happened, not from the day it was raised', () => {
  const { lines } = applicationStatus(
    [
      {
        id: 1, employee_id: 5, employee_name: 'Riya', kind: 'leave', code: 'CL',
        day: 3, status: 'recommended', created_at: '2026-11-01',
        recommended_at: '2026-11-20', recommended_by: 'Alpesh', reports_to_id: 9,
      },
    ],
    { today: '2026-11-21', managedIds: new Set([5]) }
  );
  /* It sat with the manager for 19 days and has been with the office for
     one. Reporting 20 would send somebody chasing the wrong person. */
  assert.equal(lines[0].waiting_days, 1);
  assert.equal(lines[0].with_whom, 'Office');
});

test('a pending application is with the manager only where there is one', () => {
  const rows = [
    { id: 1, employee_id: 5, kind: 'leave', day: 2, status: 'pending', created_at: '2026-11-20' },
    { id: 2, employee_id: 6, kind: 'leave', day: 2, status: 'pending', created_at: '2026-11-20' },
  ];
  const { lines, totals } = applicationStatus(rows, {
    today: '2026-11-21',
    managedIds: new Set([5]),
  });
  const byId = new Map(lines.map((l) => [l.id, l]));
  assert.equal(byId.get(1).with_whom, 'Manager');
  /* Nobody manages 6, so it can only ever be the office's - which is why HR
     can finish a pending request outright. */
  assert.equal(byId.get(2).with_whom, 'Office');
  assert.equal(totals.with_manager, 1);
  assert.equal(totals.with_office, 1);
});

test('a decided application keeps its line and stops ageing', () => {
  const { lines, totals } = applicationStatus(
    [
      {
        id: 1, employee_id: 5, kind: 'leave', day: 2, status: 'approved',
        created_at: '2026-10-01', decided_by: 'Dinesh', decided_at: '2026-10-02',
      },
    ],
    { today: '2026-11-21' }
  );
  assert.equal(lines.length, 1, '"nothing pending" and "nothing applied for" are different');
  assert.equal(lines[0].waiting_days, null, 'not waiting, so not "waiting 51 days"');
  assert.equal(lines[0].bucket, null);
  assert.equal(totals.open, 0);
  assert.equal(totals.approved, 1);
});

test('the open ones come first, oldest wait at the top', () => {
  const { lines } = applicationStatus(
    [
      { id: 1, employee_id: 1, kind: 'leave', day: 1, status: 'approved', created_at: '2026-11-20' },
      { id: 2, employee_id: 2, kind: 'leave', day: 1, status: 'pending', created_at: '2026-11-19' },
      { id: 3, employee_id: 3, kind: 'leave', day: 1, status: 'pending', created_at: '2026-11-01' },
    ],
    { today: '2026-11-21' }
  );
  assert.deepEqual(lines.map((l) => l.id), [3, 2, 1]);
});

test('a span is counted in days, and the buckets add up to what is open', () => {
  const { lines, totals } = applicationStatus(
    [
      { id: 1, employee_id: 1, kind: 'leave', day: 18, to_day: 20, status: 'pending', created_at: '2026-11-21' },
      { id: 2, employee_id: 2, kind: 'remote', day: 4, status: 'pending', created_at: '2026-11-10' },
    ],
    { today: '2026-11-21' }
  );
  assert.equal(lines.find((l) => l.id === 1).days, 3, '18th to the 20th');
  assert.equal(lines.find((l) => l.id === 2).days, 1);
  assert.equal(
    totals.buckets.reduce((n, b) => n + b.count, 0),
    totals.open,
    'every open one lands in exactly one bucket'
  );
  assert.equal(totals.oldest, 11);
});

test('a missing date is not a wait of zero days', () => {
  assert.equal(waitingDays('', '2026-11-21'), null);
  assert.equal(waitingDays('not a date', '2026-11-21'), null);
  assert.equal(bucketOf(null), null, 'not known is not "raised today"');
  assert.equal(bucketOf(0), 'today');
  assert.equal(bucketOf(8), 'over-7');
});
