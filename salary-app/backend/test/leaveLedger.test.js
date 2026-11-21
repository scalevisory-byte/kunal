import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceRow, ledgerFor, ledgersFor } from '../../shared/leaveLedger.js';

/**
 * THE LEAVE LEDGER.
 *
 * Dinesh called it the most important thing in the leave brief. Two rules
 * hold it up, and both are tested here because breaking either is expensive
 * and invisible.
 */

test('WITH NOTHING POSTED, the ledger reads exactly what the app always showed', () => {
  /*
   * THE COMPATIBILITY RULE. Every balance in this app is quota minus taken.
   * A ledger that quietly moved eighty-six people's balances the day it
   * shipped would be found out at the worst possible moment.
   */
  const l = ledgerFor({
    code: 'CL',
    credits: [],
    taken: [{ year: 2026, month: 10, period_label: 'October 2026', days: 2, date: '2026-10-01' }],
    quota: 7,
    year: 2026,
  });
  assert.equal(l.summary.closing, 5);
  assert.equal(l.summary.posted, false, 'it must say the figure was not posted by anybody');
  /* And the line it stands on is marked as derived, so the screen can say
     where it came from. */
  assert.equal(l.lines[0].derived, true);
});

test('a debit is only ever a mark; the ledger never stores what was taken', () => {
  const taken = [
    { year: 2026, month: 4, period_label: 'April 2026', days: 1, date: '2026-04-01', dates: '12' },
    { year: 2026, month: 10, period_label: 'October 2026', days: 2, date: '2026-10-01', dates: '18, 19' },
  ];
  const l = ledgerFor({ code: 'CL', credits: [], taken, quota: 7, year: 2026 });
  assert.equal(l.summary.availed, 3);
  /* The days are named, so a line can be checked against the grid rather
     than taken on trust. */
  assert.match(l.lines[2].particulars, /18, 19/);
  /* The reference is the month it was marked in - where somebody goes to
     see it, and where the pay came out. */
  assert.equal(l.lines[2].reference, 'October 2026');
});

test('the running balance is a running balance, in date order', () => {
  const l = ledgerFor({
    code: 'PL',
    credits: [
      { code: 'PL', kind: 'opening', on_date: '2026-01-01', days: 4 },
      { code: 'PL', kind: 'monthly', on_date: '2026-06-01', days: 1.5 },
      { code: 'PL', kind: 'expiry', on_date: '2026-12-31', days: 2, note: 'unused, lapsed' },
    ],
    taken: [{ year: 2026, month: 3, period_label: 'March 2026', days: 1, date: '2026-03-01' }],
    quota: 12,
    year: 2026,
  });
  assert.deepEqual(l.lines.map((x) => x.balance), [4, 3, 4.5, 2.5]);
  assert.equal(l.summary.opening, 4);
  assert.equal(l.summary.credited, 5.5);
  assert.equal(l.summary.availed, 1);
  assert.equal(l.summary.expired, 2);
  assert.equal(l.summary.closing, 2.5);
  /* THE QUOTA IS IGNORED once anything is posted: the ledger is the record
     now, and two sources would disagree the first time one changed. */
  assert.equal(l.summary.posted, true);
});

test('a lapse and an encashment take leave AWAY, however they are stored', () => {
  /* Both are stored as positive days - a negative number in a column called
     "days" is how a sign gets lost - so the ledger decides the direction. */
  const l = ledgerFor({
    code: 'PL',
    credits: [
      { code: 'PL', kind: 'opening', on_date: '2026-01-01', days: 10 },
      { code: 'PL', kind: 'encashed', on_date: '2026-06-01', days: 3 },
    ],
    taken: [],
    year: 2026,
  });
  assert.equal(l.lines[1].debit, 3);
  assert.equal(l.lines[1].credit, 0);
  assert.equal(l.summary.closing, 7);
  assert.equal(l.summary.encashed, 3);
});

test('a negative balance is flagged, never hidden and never clamped', () => {
  /* Leave taken beyond the entitlement happens, and somebody has to decide
     about it. Showing it as nought would be the app deciding instead. */
  const row = balanceRow({
    employee: { id: 1, name: 'Amit Shah' },
    ledgers: ledgersFor({
      types: [{ code: 'CL' }],
      credits: [],
      takenByCode: { CL: [{ year: 2026, month: 5, days: 9, date: '2026-05-01' }] },
      quotas: { CL: 7 },
      year: 2026,
    }),
  });
  assert.equal(row.types.CL.balance, -2);
  assert.equal(row.types.CL.over, true);
});

test('the balance register is built from the same ledgers as the page behind it', () => {
  const ledgers = ledgersFor({
    types: [{ code: 'CL' }, { code: 'SL' }],
    credits: [{ code: 'CL', kind: 'opening', on_date: '2026-01-01', days: 5 }],
    takenByCode: { CL: [{ year: 2026, month: 2, days: 1, date: '2026-02-01' }] },
    quotas: { CL: 7, SL: 7 },
    year: 2026,
  });
  const row = balanceRow({ employee: { id: 1, name: 'A', code: 'BOO-001' }, ledgers });
  assert.equal(row.types.CL.balance, 4);
  /* SL has nothing posted, so it still falls back to the quota - the two
     types are independent, which is what somebody posting one expects. */
  assert.equal(row.types.SL.balance, 7);
  assert.equal(row.types.SL.posted, false);
});
