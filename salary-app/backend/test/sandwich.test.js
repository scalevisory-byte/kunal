import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TRIGGERS,
  LEAVE_TRIGGERS,
  entriesToApply,
  sandwichReport,
  sandwichedDays,
} from '../../shared/sandwich.js';

// November 2026: the 1st is a Sunday, so Sundays are 1, 8, 15, 22, 29.
const NOV = { year: 2026, month: 11, days_in_month: 30 };

const marks = (pairs) => {
  const out = {};
  for (const [day, code] of pairs) out[day] = code;
  return out;
};

test('absent either side of a Sunday costs the Sunday too', () => {
  const found = sandwichedDays(marks([[7, 'A'], [9, 'A']]), { ...NOV, per_day: 1000 });
  assert.equal(found.days.length, 1);
  assert.equal(found.days[0].day, 8);
  assert.equal(found.days[0].before, 7);
  assert.equal(found.days[0].after, 9);
  assert.equal(found.days_lost, 1);
  assert.equal(found.amount, 1000);
});

test('absent on one side only is not a sandwich', () => {
  assert.equal(sandwichedDays(marks([[7, 'A']]), NOV).days.length, 0);
  assert.equal(sandwichedDays(marks([[9, 'A']]), NOV).days.length, 0);
});

test('paid leave either side does not sandwich by default', () => {
  const found = sandwichedDays(marks([[7, 'CL'], [9, 'CL']]), NOV);
  assert.equal(found.days.length, 0);
  assert.deepEqual(found.triggers, DEFAULT_TRIGGERS);
});

test('the harsher reading can be asked for, and then it does', () => {
  const found = sandwichedDays(marks([[7, 'CL'], [9, 'CL']]), {
    ...NOV,
    triggers: LEAVE_TRIGGERS,
  });
  assert.equal(found.days.length, 1);
  assert.equal(found.days[0].day, 8);
  assert.equal(found.days[0].before_mark, 'CL');
});

test('a day actually worked is never sandwiched', () => {
  // Worked the Sunday: SP, paid extra. It cannot also be docked.
  const found = sandwichedDays(marks([[7, 'A'], [8, 'SP'], [9, 'A']]), NOV);
  assert.equal(found.days.length, 0);
});

test('a whole run of off days goes together, or none of it does', () => {
  // A Saturday+Sunday weekend: 2nd and 4th Saturdays off in this policy.
  const policy = { days: [0, 6], alternate: null };
  // Nov 2026: 7th is a Saturday, 8th a Sunday. Absent the 6th and the 9th.
  const found = sandwichedDays(marks([[6, 'A'], [9, 'A']]), { ...NOV, policy, per_day: 1000 });
  assert.deepEqual(
    found.days.map((d) => d.day),
    [7, 8],
  );
  assert.equal(found.days_lost, 2);
  assert.equal(found.amount, 2000);
});

test('a Sunday against a festival holiday is one run', () => {
  // 8th is a Sunday; mark the 9th a paid holiday. Absent the 7th and the 10th.
  const found = sandwichedDays(marks([[7, 'A'], [9, 'PH'], [10, 'A']]), NOV);
  assert.deepEqual(
    found.days.map((d) => d.day),
    [8, 9],
  );
  assert.equal(found.days[1].label, 'Paid Holiday');
});

test('a day off at the very edge of the month is named, never guessed at', () => {
  // The 1st is a Sunday. Whatever happened on 31 October is in another month.
  const found = sandwichedDays(marks([[2, 'A']]), NOV);
  assert.equal(found.days.length, 0);
  assert.deepEqual(found.edges, [1]);

  // And the other end: the 29th is a Sunday, the 30th a working Monday.
  const end = sandwichedDays(marks([[28, 'A'], [30, 'A']]), NOV);
  assert.equal(end.days.length, 1, 'the 29th is inside the month and judged');
  assert.equal(end.days[0].day, 29);
});

test('an unmarked working day between two absences is not a day off', () => {
  // The 10th and 12th absent, the 11th a Wednesday with nothing on it. Not a
  // weekly off, so not sandwiched - an unmarked working day is a different
  // problem and the absent/present report already names it.
  const found = sandwichedDays(marks([[10, 'A'], [12, 'A']]), NOV);
  assert.equal(found.days.length, 0);
});

test('somebody off on Thursday has their Thursday sandwiched, not a Sunday', () => {
  const policy = { days: [4], alternate: null };
  // Nov 2026: the 5th is a Thursday. Absent the 4th and the 6th.
  const found = sandwichedDays(marks([[4, 'A'], [6, 'A']]), { ...NOV, policy });
  assert.deepEqual(
    found.days.map((d) => d.day),
    [5],
  );
  // And the Sunday is left alone, because it is a working day for them.
  const sunday = sandwichedDays(marks([[7, 'A'], [9, 'A']]), { ...NOV, policy });
  assert.equal(sunday.days.length, 0);
});

test('the report adds the month up and orders by who lost most', () => {
  const rows = [
    {
      employee_id: 1,
      employee_name: 'Riya Pal',
      per_day: 1000,
      attendance: marks([[7, 'A'], [9, 'A']]),
    },
    {
      employee_id: 2,
      employee_name: 'Mahesh Shinde',
      per_day: 800,
      attendance: marks([[14, 'A'], [16, 'A'], [21, 'UL'], [23, 'UL']]),
    },
    { employee_id: 3, employee_name: 'Nobody Absent', per_day: 900, attendance: marks([[3, 'P']]) },
  ];
  const report = sandwichReport(rows, NOV);
  assert.equal(report.people.length, 2);
  assert.equal(report.people[0].employee_name, 'Mahesh Shinde', 'two days lost, so first');
  assert.equal(report.days_lost, 3);
  assert.equal(report.amount, 1000 + 1600);
});

test('applying writes unpaid leave, not plain absence', () => {
  const report = sandwichReport(
    [{ employee_id: 1, employee_name: 'Riya Pal', per_day: 1000, attendance: marks([[7, 'A'], [9, 'A']]) }],
    NOV,
  );
  assert.deepEqual(entriesToApply(report), [{ employee_id: 1, day: 8, code: 'UL' }]);
  // UL costs the same day's pay as A but is counted apart, so a month's
  // absences are not inflated by days the rule docked.
  assert.deepEqual(entriesToApply(report, { code: 'A' }), [{ employee_id: 1, day: 8, code: 'A' }]);
});

test('nothing is applied for a month with nothing sandwiched', () => {
  assert.deepEqual(entriesToApply(sandwichReport([], NOV)), []);
  assert.deepEqual(entriesToApply(null), []);
});
