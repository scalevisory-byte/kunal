import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocationProblem,
  assetStatus,
  financialYear,
  overdueBy,
} from '../../shared/assetStatus.js';
import { assetDashboard, matchesFilter, purchaseYears } from '../../shared/assetDashboard.js';

/*
 * The seven statuses the brief asks for.
 *
 * Three of them are FACTS this database already holds - written off, out with
 * somebody, neither - so they are worked out every time rather than stored. A
 * column saying "Assigned" beside an employee_id of null is not a status, it
 * is a second opinion, and the two drift the first time anybody returns an
 * asset through a different screen. Only the four nothing can tell us are
 * stored.
 */

test('available, assigned and written off are read, never stored', () => {
  assert.equal(assetStatus({}), 'available');
  assert.equal(assetStatus({ employee_id: 4 }), 'assigned');
  // Given back: nobody has it, so it is available again - with no column set.
  assert.equal(assetStatus({ employee_id: 4, returned_on: '2026-10-01' }), 'available');
  assert.equal(assetStatus({ written_off_on: '2026-09-01' }), 'written_off');
});

test('written off beats everything, and a stored state beats who holds it', () => {
  // Off the books, whatever else is true of it.
  assert.equal(assetStatus({ written_off_on: '2026-09-01', employee_id: 4, state: 'missing' }), 'written_off');
  /*
   * Out with somebody AND away being repaired: "under maintenance" is the
   * fact that changes what you can do with it today, so it wins.
   */
  assert.equal(assetStatus({ employee_id: 4, state: 'maintenance' }), 'maintenance');
  assert.equal(assetStatus({ state: 'damaged' }), 'damaged');
  assert.equal(assetStatus({ state: 'missing' }), 'missing');
  assert.equal(assetStatus({ state: 'disposed' }), 'disposed');
  // Anything else in that column is ignored rather than shown as a status.
  assert.equal(assetStatus({ state: 'lost in the post' }), 'available');
});

test('a refusal to allocate says WHY, because "no" alone sends people hunting', () => {
  assert.equal(allocationProblem({}), '');
  assert.match(
    allocationProblem({ code: 'BPL-LAP-014', employee_id: 4, employee_name: 'Amit Shah' }),
    /already out with Amit Shah/
  );
  assert.match(allocationProblem({ code: 'BPL-LAP-014', written_off_on: '2026-01-01' }), /written off/);
  assert.match(allocationProblem({ code: 'BPL-LAP-014', state: 'maintenance' }), /under maintenance/);
});

test('only an allocation that named a date can be overdue', () => {
  const today = '2026-11-04';
  assert.equal(overdueBy({}, today), 0, 'open-ended is how most allocations are');
  assert.equal(overdueBy({ expected_return_on: '2026-12-01' }, today), 0);
  assert.equal(overdueBy({ expected_return_on: '2026-11-04' }, today), 0, 'due today is not late');
  assert.equal(overdueBy({ expected_return_on: '2026-10-30' }, today), 5);
  // Already back, so nothing is owed however late it was.
  assert.equal(overdueBy({ expected_return_on: '2026-01-01', returned_on: '2026-02-01' }, today), 0);
});

test('the financial year is April to March, the way India writes it', () => {
  assert.equal(financialYear('2026-04-01'), '2026-27');
  assert.equal(financialYear('2027-03-31'), '2026-27');
  assert.equal(financialYear('2026-03-31'), '2025-26');
  assert.equal(financialYear('2026-01-15'), '2025-26');
  assert.equal(financialYear(''), '');
  assert.equal(financialYear(null), '');
  assert.equal(financialYear('not a date'), '');
});

test('every dashboard card hands back the filter that produced it', () => {
  const assets = [
    { id: 1, purchase_cost: 50000, employee_id: 7 },
    { id: 2, purchase_cost: 30000 },
    { id: 3, purchase_cost: 20000, state: 'maintenance' },
    { id: 4, purchase_cost: 10000, written_off_on: '2026-01-01' },
  ];
  const { cards, spent } = assetDashboard({ assets, today: '2026-11-04' });
  const card = (key) => cards.find((c) => c.key === key);
  /*
   * "Registered" means ON the register, so NOT the written-off one - the
   * register itself says those are not on it any more. It used to count all
   * four while the list it opens showed three, which is the one thing this
   * module's own comment promises cannot happen.
   */
  assert.equal(card('all').n, 3);
  assert.equal(card('assigned').n, 1);
  assert.equal(card('available').n, 1);
  assert.equal(card('maintenance').n, 1);
  assert.equal(card('written_off').n, 1);
  // A written-off laptop was still bought, so it counts towards what was spent.
  assert.equal(spent, 110000);

  // And the filter each card carries really selects what the card counted.
  for (const c of cards) {
    const picked = assets.filter((a) => matchesFilter(a, c.filter));
    if (c.key === 'written_off') continue; // that card folds in 'disposed' too
    assert.equal(picked.length, c.n, `the ${c.key} card and its filter disagree`);
  }
});

test('warranty alerts look ahead, and ignore anything off the books', () => {
  const today = '2026-11-04';
  const { alerts } = assetDashboard({
    assets: [
      { id: 1, warranty_until: '2026-11-20' },             // soon
      { id: 2, warranty_until: '2026-01-01' },             // gone
      { id: 3, warranty_until: '2027-06-01' },             // fine
      { id: 4, warranty_until: '2026-01-01', written_off_on: '2026-02-01' }, // off the books
      { id: 5 },                                            // no warranty at all
    ],
    today,
  });
  const alert = (key) => alerts.find((a) => a.key === key);
  assert.equal(alert('warranty_soon').n, 1);
  assert.equal(alert('warranty_gone').n, 1, 'the written-off one is not chased');
});

test('a service is due only when the person who did the work said so', () => {
  const today = '2026-11-04';
  const assets = [{ id: 1 }];
  const quiet = assetDashboard({
    assets,
    services: [{ asset_id: 1, serviced_on: '2026-05-01', cost: 900 }],
    today,
  });
  assert.equal(quiet.alerts.find((a) => a.key === 'service_due'), undefined);

  const due = assetDashboard({
    assets,
    services: [
      { asset_id: 1, serviced_on: '2026-01-01', next_service_on: '2026-02-01' },
      { asset_id: 1, serviced_on: '2026-05-01', next_service_on: '2026-11-10' },
    ],
    today,
  });
  assert.equal(due.alerts.find((a) => a.key === 'service_due').n, 1, 'the latest one only');
});

test('a stock take separates NOT CHECKED from NOT FOUND, as it always has', () => {
  const { alerts } = assetDashboard({
    assets: [{ id: 1 }, { id: 2 }, { id: 3 }],
    verifications: [
      { asset_id: 1, round: 'Nov 2026', found: true },
      { asset_id: 2, round: 'Nov 2026', found: false },
    ],
    round: 'Nov 2026',
    today: '2026-11-04',
  });
  assert.equal(alerts.find((a) => a.key === 'verify_pending').n, 1, 'nobody looked at #3 yet');
  assert.equal(alerts.find((a) => a.key === 'verify_missing').n, 1);
});

test('the years offered are the years something was actually bought in', () => {
  assert.deepEqual(
    purchaseYears([
      { purchase_date: '2026-05-01' },
      { purchase_date: '2026-02-01' },
      { purchase_date: '2026-09-01' },
      { purchase_date: null },
    ]),
    ['2026-27', '2025-26']
  );
});
