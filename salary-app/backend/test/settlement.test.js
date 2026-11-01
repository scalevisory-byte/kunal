import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXIT_TYPE,
  SETTLEMENT_RULES,
  daysBetween,
  gratuityOf,
  leaveEncashment,
  noticeOf,
  serviceLength,
  settlement,
} from '../../shared/settlement.js';

/* ---------------- service length ---------------- */

test('service length counts years, months and days', () => {
  const s = serviceLength('2020-04-01', '2026-10-31');
  assert.deepEqual([s.years, s.months, s.days], [6, 6, 30]);
  assert.equal(s.known, true);
});

test('a part year over six months counts as a year for gratuity, under it does not', () => {
  assert.equal(serviceLength('2021-01-01', '2026-07-15').gratuity_years, 6);
  assert.equal(serviceLength('2021-01-01', '2026-05-15').gratuity_years, 5);
});

test('no joining date is "not known", never zero years', () => {
  const s = serviceLength(null, '2026-10-31');
  assert.equal(s.known, false);
  assert.equal(s.gratuity_years, 0);
});

test('a last day before the joining date is not negative service', () => {
  assert.equal(serviceLength('2026-10-01', '2026-01-01').known, false);
});

test('daysBetween is null when either end is missing', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-31'), 30);
  assert.equal(daysBetween(null, '2026-10-31'), null);
  assert.equal(daysBetween('2026-10-01', 'not a date'), null);
});

/* ---------------- notice ---------------- */

test('notice served in full means nobody owes anything', () => {
  const n = noticeOf({ type: 'resigned', resigned_on: '2026-09-01', last_working_day: '2026-10-05' });
  assert.equal(n.required, 30);
  assert.equal(n.served, 34);
  assert.equal(n.short, 0);
  assert.equal(n.owed_by, 'nobody');
});

test('somebody who resigns and leaves early owes the shortfall', () => {
  const n = noticeOf({ type: 'resigned', resigned_on: '2026-10-01', last_working_day: '2026-10-11' });
  assert.equal(n.short, 20);
  assert.equal(n.owed_by, 'employee');
});

test('an employer who terminates without notice owes it instead', () => {
  const n = noticeOf({ type: 'terminated', resigned_on: '2026-10-01', last_working_day: '2026-10-11' });
  assert.equal(n.short, 20);
  assert.equal(n.owed_by, 'employer');
  assert.equal(EXIT_TYPE.terminated.notice_from, 'employer');
});

test('a retirement or a contract simply ending owes no notice either way', () => {
  for (const type of ['retired', 'contract_ended']) {
    const n = noticeOf({ type, resigned_on: '2026-10-01', last_working_day: '2026-10-02' });
    assert.equal(n.owed_by, 'nobody', type);
  }
});

test('no dates means the notice is not known, not that it was served', () => {
  const n = noticeOf({ type: 'resigned', resigned_on: '2026-10-01' });
  assert.equal(n.known, false);
  assert.equal(n.short, null);
});

/* ---------------- leave encashment ---------------- */

test('only privilege leave is encashed, and CL/SL are shown as lapsing', () => {
  const e = leaveEncashment({
    quotas: { CL: 12, SL: 6, PL: 15 },
    taken: { CL: 4, SL: 1, PL: 5 },
    per_day: 1000,
  });
  assert.equal(e.days, 10);
  assert.equal(e.amount, 10000);
  const cl = e.lines.find((l) => l.code === 'CL');
  assert.equal(cl.left, 8, 'the balance is still shown');
  assert.equal(cl.encashed, 0, 'but it is not paid out');
  assert.equal(cl.paid, false);
});

test('which kinds are encashed is a setting, not a guess', () => {
  const e = leaveEncashment({
    quotas: { CL: 12, SL: 6, PL: 15 },
    taken: {},
    per_day: 1000,
    rules: { encash_codes: ['CL', 'PL'] },
  });
  assert.equal(e.days, 27);
});

test('leave taken over the quota never produces a negative payout', () => {
  const e = leaveEncashment({ quotas: { PL: 5 }, taken: { PL: 9 }, per_day: 1000 });
  assert.equal(e.days, 0);
  assert.equal(e.amount, 0);
});

test('a cap limits the payout without hiding the balance', () => {
  const e = leaveEncashment({
    quotas: { PL: 30 },
    taken: {},
    per_day: 1000,
    rules: { encash_cap_days: 15 },
  });
  assert.equal(e.days, 30);
  assert.equal(e.capped_days, 15);
  assert.equal(e.amount, 15000);
});

/* ---------------- gratuity ---------------- */

test('gratuity is 15 days per completed year on a 26-day month', () => {
  const g = gratuityOf({
    basic: 20000,
    service: serviceLength('2019-01-01', '2026-10-31'),
  });
  assert.equal(g.eligible, true);
  assert.equal(g.years, 8);
  assert.equal(g.amount, Math.round((20000 * 15 * 8) / 26));
  assert.equal(g.on, 'basic');
  // The Act's rounding reads as a contradiction unless it is said out loud:
  // 7 years 10 months is paid for 8, and the note says both figures.
  assert.match(g.note, /7 years 9 months of service, counted as 8/);
});

test('under five years it is reported as not due, with the service length', () => {
  const g = gratuityOf({ basic: 20000, service: serviceLength('2024-01-01', '2026-10-31') });
  assert.equal(g.eligible, false);
  assert.equal(g.amount, 0);
  assert.match(g.note, /under the 5 the Act asks for/);
  assert.match(g.note, /2 years 9 months of service/);
});

test('with no breakup set the monthly salary stands in, and it says so', () => {
  const g = gratuityOf({
    monthly_salary: 26000,
    service: serviceLength('2015-01-01', '2026-10-31'),
  });
  assert.equal(g.on, 'monthly salary');
  assert.equal(g.wages, 26000);
});

test('no joining date means gratuity is not worked out, and says why', () => {
  const g = gratuityOf({ basic: 20000, service: serviceLength(null, '2026-10-31') });
  assert.equal(g.eligible, false);
  assert.match(g.note, /not known/);
});

/* ---------------- the whole settlement ---------------- */

const EMPLOYEE = { monthly_salary: 26000, basic: 13000, joined_on: '2018-06-01' };
const FINAL = { net_salary: 18400, per_day: 1000, earned_basic: 13000 };

test('a settlement adds up and names what is still open', () => {
  const s = settlement({
    employee: EMPLOYEE,
    exit: { type: 'resigned', resigned_on: '2026-09-15', last_working_day: '2026-10-31' },
    final_month: FINAL,
    final_month_label: 'October 2026',
    leave: { quotas: { CL: 12, SL: 6, PL: 15 }, taken: { PL: 3 } },
    loan_outstanding: 4000,
    claims: [{ amount: 1200 }],
  });

  assert.equal(s.notice.short, 0, '46 days of notice against 30');
  assert.equal(s.encashment.days, 12);
  assert.equal(s.encashment.amount, 12000);
  assert.equal(s.gratuity.eligible, true);
  // 18,400 salary + 12,000 leave + gratuity + 1,200 claims, less 4,000 loan
  const expected = 18400 + 12000 + s.gratuity.amount + 1200 - 4000;
  assert.equal(s.net, expected);
  assert.equal(s.payable - s.recoverable, s.net);
  assert.deepEqual(s.open, []);
});

test('short notice is recovered at the day rate the app pays on', () => {
  const s = settlement({
    employee: EMPLOYEE,
    exit: { type: 'resigned', resigned_on: '2026-10-21', last_working_day: '2026-10-31' },
    final_month: FINAL,
    leave: { quotas: {}, taken: {} },
  });
  assert.equal(s.notice.short, 20);
  const line = s.recovers.find((l) => l.label.startsWith('Short notice'));
  assert.equal(line.amount, 20 * 1000);
});

test('an unreturned asset is listed and valued, never deducted', () => {
  const s = settlement({
    employee: EMPLOYEE,
    exit: { type: 'resigned', resigned_on: '2026-09-01', last_working_day: '2026-10-31' },
    final_month: FINAL,
    leave: { quotas: {}, taken: {} },
    assets: [{ label: 'Dell Latitude', value: 42000 }],
  });
  assert.equal(s.assets_value, 42000);
  assert.equal(
    s.recovers.some((l) => /Dell/.test(l.label)),
    false,
    'the laptop must not appear as a deduction',
  );
  assert.match(s.open.join(' '), /1 asset is still out/);
});

test('without the final month calculated the settlement says so rather than guessing', () => {
  const s = settlement({
    employee: EMPLOYEE,
    exit: { type: 'resigned', resigned_on: '2026-09-01', last_working_day: '2026-10-31' },
    leave: { quotas: { PL: 15 }, taken: {} },
  });
  assert.match(s.open.join(' '), /final month has not been calculated/);
  assert.equal(s.pays[0].missing, true);
  // The day rate still falls back to salary / 26, so leave is still valued.
  assert.equal(s.per_day, 1000);
  assert.equal(s.encashment.amount, 15000);
});

test('a hand-added line can pay or recover, by its sign', () => {
  const s = settlement({
    employee: EMPLOYEE,
    exit: { type: 'resigned', resigned_on: '2026-09-01', last_working_day: '2026-10-31' },
    final_month: FINAL,
    leave: { quotas: {}, taken: {} },
    extras: [
      { label: 'Performance bonus', amount: 5000 },
      { label: 'Uniform not returned', amount: -800 },
    ],
  });
  assert.ok(s.pays.some((l) => l.label === 'Performance bonus' && l.amount === 5000));
  assert.ok(s.recovers.some((l) => l.label === 'Uniform not returned' && l.amount === 800));
});

test('an absconding exit still owes the notice', () => {
  const s = settlement({
    employee: EMPLOYEE,
    exit: { type: 'absconded', resigned_on: '2026-10-30', last_working_day: '2026-10-31' },
    final_month: FINAL,
    leave: { quotas: {}, taken: {} },
  });
  assert.equal(s.notice.owed_by, 'employee');
  assert.equal(s.notice.short, 29);
});

test('the default notice is 30 days and can be negotiated per exit', () => {
  assert.equal(SETTLEMENT_RULES.notice_days, 30);
  const s = settlement({
    employee: EMPLOYEE,
    exit: {
      type: 'resigned',
      resigned_on: '2026-10-21',
      last_working_day: '2026-10-31',
      notice_days: 7,
    },
    final_month: FINAL,
    leave: { quotas: {}, taken: {} },
  });
  assert.equal(s.notice.short, 0);
});
