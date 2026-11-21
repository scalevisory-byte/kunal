import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, entriesFor, yearEndFor, yearEndPlan } from '../../shared/leaveYearEnd.js';
import { entitlementOf, ledgerFor } from '../../shared/leaveLedger.js';
import { leaveCalendar } from '../../shared/leaveCalendar.js';

/**
 * THE END OF A LEAVE YEAR, and the calendar.
 */

test('what carries is capped, and what does not carry lapses', () => {
  assert.deepEqual(yearEndFor({ code: 'PL', closing: 34 }), {
    code: 'PL', closing: 34, carried: 30, lapsed: 4, why: 'capped at 30',
  });
  assert.equal(yearEndFor({ code: 'PL', closing: 12 }).carried, 12);
  /* Casual leave is use-it-or-lose-it by default, and the default is only a
     default - a rule passed in wins. */
  assert.equal(yearEndFor({ code: 'CL', closing: 3 }).lapsed, 3);
  assert.equal(yearEndFor({ code: 'CL', closing: 3, rule: { carry: true, max: null } }).carried, 3);
});

test('A NEGATIVE BALANCE CARRIES NOTHING AND LAPSES NOTHING', () => {
  /*
   * Leave taken beyond the entitlement is a debt somebody has to decide
   * about. Carrying it as a negative opening would hide that decision;
   * zeroing it would forgive it. It is named and left alone.
   */
  const out = yearEndFor({ code: 'PL', closing: -2 });
  assert.equal(out.carried, 0);
  assert.equal(out.lapsed, 0);
  assert.equal(out.skipped, true);
  assert.match(out.why, /beyond the entitlement/);
});

test('UNPAID LEAVE IS NOT A BALANCE and never appears at a year end', () => {
  /*
   * There is no entitlement to unpaid leave, so its ledger closes negative
   * by however many days were taken. Without this rule the year end
   * reported everybody who ever took an unpaid day as owing leave - a debt
   * list nobody should be on. Found by running it.
   */
  assert.equal(DEFAULT_RULES.UL.balance, false);
  assert.equal(yearEndFor({ code: 'UL', closing: -3 }).ignore, true);

  const plan = yearEndPlan(
    [{ employee: { id: 1, name: 'Riya' }, ledgers: [
      { code: 'UL', summary: { closing: -3 } },
      { code: 'PL', summary: { closing: 12 } },
    ] }],
    { year: 2026 }
  );
  assert.deepEqual(plan.rows.map((r) => r.code), ['PL']);
  assert.equal(plan.totals.owing, 0);
});

test('a carried line writes TWO entries, so each year adds up on its own', () => {
  const plan = yearEndPlan(
    [{ employee: { id: 1, name: 'Amit' }, ledgers: [{ code: 'PL', summary: { closing: 34 } }] }],
    { year: 2026 }
  );
  const entries = entriesFor(plan);
  /* Out of the old year as a lapse and as a carry-out, into the new one as
     a carry-forward. Writing only the new year's credit would leave 2026
     showing days still in hand that are not there any more. */
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => `${e.kind}:${e.days}:${e.on_date}`),
    ['expiry:4:2026-12-31', 'expiry:30:2026-12-31', 'carry_forward:30:2027-01-01']
  );
  /* Every entry carries the run it came from, so it can be found again. */
  assert.ok(entries.every((e) => e.reference === 'year end 2026'));
});

/* ---------------- the calendar ---------------- */

test('approved leave and a pending application are never the same thing', () => {
  const cal = leaveCalendar({
    rows: [{ employee_id: 1, employee_name: 'Amit', attendance: { 5: { code: 'CL' } } }],
    period: { year: 2026, month: 10, label: 'October 2026' },
    requests: [
      { id: 9, employee_id: 1, employee_name: 'Amit', status: 'pending', day: 20, to_day: 21, code: 'PL' },
      { id: 10, employee_id: 1, employee_name: 'Amit', status: 'approved', day: 25, code: 'PL' },
    ],
    holidays: [{ day: 12, name: 'Diwali' }],
  });
  assert.equal(cal.days[4].on_leave.length, 1);
  assert.equal(cal.days[4].pending.length, 0);
  /* A span is spread over its days, because a calendar is read a day at a
     time. */
  assert.equal(cal.days[19].pending.length, 1);
  assert.equal(cal.days[20].pending.length, 1);
  /*
   * AN APPROVED REQUEST IS NOT DRAWN AS PENDING. It is already a mark on
   * the grid, and drawing it from the queue as well would show the same day
   * twice.
   */
  assert.equal(cal.days[24].pending.length, 0);
  assert.equal(cal.days[11].holiday, 'Diwali');
  assert.equal(cal.summary.busiest.day, 5);
});

/* ------------------------------------------------------------------
 * THE BUG THAT COST A WEEK'S LEAVE, FOUND BY DRIVING IT.
 *
 * The balance a ledger shows before anything is posted is an ASSUMPTION -
 * the yearly entitlement on the record, less what the grid shows as taken.
 * Posting ANYTHING ends that assumption. So the first thing ever written
 * onto a ledger must not be a deduction, or the year reads as a debt.
 * ------------------------------------------------------------------ */

test('closing an untouched ledger writes the entitlement down before taking it away', () => {
  const ledger = ledgerFor({ code: 'CL', credits: [], taken: [], quota: 7, year: 2026 });
  assert.equal(ledger.summary.closing, 7);
  assert.equal(ledger.summary.posted, false, 'nothing posted — the 7 is an assumption');
  assert.equal(entitlementOf(ledger), 7);

  const plan = yearEndPlan([{ employee: { id: 1, name: 'Amit Shah' }, ledgers: [ledger] }], {
    year: 2026,
  });
  const entries = entriesFor(plan);

  /* The entitlement first, THEN the lapse. Without the first entry the
     year closes at minus seven and Amit appears to owe the company a
     week of leave he never took. */
  assert.equal(entries[0].kind, 'annual');
  assert.equal(entries[0].days, 7);
  assert.equal(entries[0].on_date, '2026-01-01');
  assert.equal(entries[1].kind, 'expiry');
  assert.equal(entries[1].days, 7);

  /* And posting them leaves the year at nil, not at minus seven. */
  const after = ledgerFor({
    code: 'CL',
    credits: entries.filter((e) => e.on_date.startsWith('2026')).map((e) => ({ ...e })),
    taken: [],
    quota: 7,
    year: 2026,
  });
  assert.equal(after.summary.posted, true);
  assert.equal(after.summary.closing, 0);
});

test('a ledger somebody has already started is not given a second entitlement', () => {
  const credits = [
    { code: 'PL', kind: 'annual', on_date: '2026-01-01', days: 12 },
  ];
  const ledger = ledgerFor({ code: 'PL', credits, taken: [], quota: 12, year: 2026 });
  assert.equal(ledger.summary.posted, true);
  assert.equal(entitlementOf(ledger), 0, 'posted, so there is nothing to stand in for');

  const entries = entriesFor(
    yearEndPlan([{ employee: { id: 1, name: 'Riya Pal' }, ledgers: [ledger] }], { year: 2026 })
  );
  assert.equal(entries.filter((e) => e.kind === 'annual').length, 0);
});
