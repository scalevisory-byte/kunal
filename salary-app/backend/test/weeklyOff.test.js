import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY,
  describePolicy,
  isWeeklyOff,
  policyFor,
  readPolicy,
  weekOfMonth,
  weeklyOffDays,
  writePolicy,
} from '../../shared/weeklyOff.js';

test('the default is Sunday, which is what the app has always done', () => {
  assert.deepEqual(DEFAULT_POLICY.days, [0]);
  // October 2026: the 4th, 11th, 18th and 25th are Sundays.
  assert.deepEqual(weeklyOffDays(2026, 10, null), [4, 11, 18, 25]);
  assert.equal(isWeeklyOff(2026, 10, 4, null), true);
  assert.equal(isWeeklyOff(2026, 10, 5, null), false);
});

test('somebody off on Thursday instead', () => {
  const thursday = { days: [4] };
  const offs = weeklyOffDays(2026, 10, thursday);
  assert.ok(offs.includes(1), '1 October 2026 is a Thursday');
  assert.ok(!offs.includes(4), 'and Sunday is a working day for them');
  assert.equal(offs.length, 5);
});

test('alternate Saturdays, which is how half of Gujarat works', () => {
  // 2nd and 4th Saturday off, Sundays off as usual.
  const policy = { days: [0], alternate: { day: 6, weeks: [2, 4] } };
  const offs = weeklyOffDays(2026, 10, policy);
  // Saturdays in October 2026: 3, 10, 17, 24, 31 -> the 2nd and 4th are 10 and 24.
  assert.ok(offs.includes(10) && offs.includes(24));
  assert.ok(!offs.includes(3) && !offs.includes(17) && !offs.includes(31));
  // Sundays survive.
  assert.ok(offs.includes(4) && offs.includes(11));
});

test('which occurrence of a weekday a date is', () => {
  assert.equal(weekOfMonth(1), 1);
  assert.equal(weekOfMonth(7), 1);
  assert.equal(weekOfMonth(8), 2);
  assert.equal(weekOfMonth(29), 5);
});

test('a policy survives a round trip through the database', () => {
  const policy = { days: [0, 3], alternate: { day: 6, weeks: [2, 4] } };
  const back = readPolicy(writePolicy(policy));
  assert.deepEqual(back.days, [0, 3]);
  assert.deepEqual(back.alternate, { day: 6, weeks: [2, 4] });
});

test('nonsense in the column falls back to Sunday rather than throwing', () => {
  assert.deepEqual(readPolicy('not json').days, [0]);
  assert.deepEqual(readPolicy({ days: ['x', 9, -2] }).days, []);
  assert.equal(readPolicy({ days: [0], alternate: { day: 6 } }).alternate, null);
});

test('a policy reads as a sentence, not as JSON', () => {
  assert.equal(describePolicy(null), 'Sunday');
  assert.equal(describePolicy({ days: [0, 6] }), 'Sunday and Saturday');
  assert.match(describePolicy({ days: [0], alternate: { day: 6, weeks: [2, 4] } }), /2nd and 4th Saturday/);
  assert.equal(describePolicy({ days: [] }), 'no weekly off');
});

test('a person their own policy beats the company, and the company beats Sunday', () => {
  const company = { weekly_off: '{"days":[1]}' };
  assert.deepEqual(policyFor({ weekly_off: '{"days":[4]}' }, company).days, [4]);
  assert.deepEqual(policyFor({}, company).days, [1]);
  assert.deepEqual(policyFor({}, {}).days, [0]);
});
