/**
 * WARRANTIES AND AMCs RUNNING OUT.
 *
 * Dinesh: *"asset me bhi warranty expire ka alert aise hi do"* — the same
 * treatment the licence register got.
 *
 * What these pin:
 *
 *  - **No warranty date is not an expired warranty.** Most of a thousand
 *    imported rows carry no date; reading a blank as "lapsed" would put the
 *    whole register on a reminder list every morning.
 *  - **A warranty that ran out years ago is not news.** Only one that has
 *    just lapsed can still be acted on, so recent and long-gone are apart and
 *    only the recent ones are counted.
 *  - **A written-off asset is out of all of it.**
 *  - The maintenance panel and the register ask the SAME module, so they
 *    cannot disagree about one laptop.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assetAlerts, nameSome } from '../../shared/assetAlerts.js';
import { maintenanceAlerts } from '../../shared/maintenance.js';

const TODAY = '2026-11-19';
const shift = (days) => {
  const at = new Date(`${TODAY}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

const REGISTER = [
  { id: 1, code: 'BNF-ASSETS-000001', warranty_until: shift(12) },          // runs out soon
  { id: 2, code: 'BNF-ASSETS-000002', warranty_until: shift(-20) },         // just lapsed
  { id: 3, code: 'BNF-ASSETS-000003', warranty_until: shift(-800) },        // 2024's laptop
  { id: 4, code: 'BNF-ASSETS-000004' },                                     // nobody has said
  { id: 5, code: 'BNF-ASSETS-000005', warranty_until: shift(400) },         // in date, quiet
  { id: 6, code: 'BNF-ASSETS-000006', warranty_until: shift(-5), written_off_on: shift(-2) },
  { id: 7, code: 'BNF-ASSETS-000007', amc_until: shift(-3) },               // AMC just lapsed
  { id: 8, code: 'BNF-ASSETS-000008', amc_until: shift(8) },                // AMC due
];

test('a blank date is "nobody has said", never "expired"', () => {
  const alerts = assetAlerts(REGISTER, TODAY);
  assert.deepEqual(alerts.no_warranty_date.map((a) => a.id), [4, 7, 8]);
  for (const list of ['warranty_soon', 'warranty_just_gone', 'warranty_long_gone']) {
    assert.ok(!alerts[list].some((a) => a.id === 4), `a dateless asset was put on ${list}`);
  }
});

test('a warranty that ran out years ago is counted, not chased', () => {
  const alerts = assetAlerts(REGISTER, TODAY);
  assert.deepEqual(alerts.warranty_just_gone.map((a) => a.id), [2]);
  assert.deepEqual(alerts.warranty_long_gone.map((a) => a.id), [3]);
  // The count is what somebody has to DO something about today.
  assert.equal(alerts.count, 4, 'warranty soon + just gone, AMC soon + just gone');
  assert.ok(
    !alerts.warranty_long_gone.some((a) => alerts.count === 0),
    'the old ones are reported'
  );
});

test('the AMC is its own contract, counted beside the warranty', () => {
  const alerts = assetAlerts(REGISTER, TODAY);
  assert.deepEqual(alerts.amc_just_gone.map((a) => a.id), [7]);
  assert.deepEqual(alerts.amc_soon.map((a) => a.id), [8]);
  // ...and an AMC date is not a warranty date.
  assert.ok(!alerts.warranty_soon.some((a) => a.id === 8));
});

test('a written-off asset is on none of the lists', () => {
  const alerts = assetAlerts(REGISTER, TODAY);
  const everywhere = [
    ...alerts.warranty_soon, ...alerts.warranty_just_gone, ...alerts.warranty_long_gone,
    ...alerts.no_warranty_date, ...alerts.amc_soon, ...alerts.amc_just_gone,
  ];
  assert.ok(!everywhere.some((a) => a.id === 6), 'nobody renews cover on a scrapped laptop');
});

test('an asset in date is on no list at all', () => {
  const alerts = assetAlerts(REGISTER, TODAY);
  const everywhere = [
    ...alerts.warranty_soon, ...alerts.warranty_just_gone, ...alerts.warranty_long_gone,
    ...alerts.no_warranty_date,
  ];
  assert.ok(!everywhere.some((a) => a.id === 5));
});

test('the lines name a few and then say how many more', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    id: 100 + i,
    code: `BNF-ASSETS-${String(i).padStart(6, '0')}`,
    warranty_until: shift(-10 - i),
  }));
  const said = nameSome(assetAlerts(many, TODAY).warranty_just_gone);
  assert.match(said, /BNF-ASSETS-000008/);
  assert.match(said, /and 4 more/);
  assert.match(said, /\(\d{4}-\d{2}-\d{2}\)/, 'with the date, which is what makes it actionable');
});

test('the maintenance panel and the register ask the same module', () => {
  // Same rows, both routes, same answer - they were computed in two places.
  const mine = assetAlerts(REGISTER, TODAY);
  const theirs = maintenanceAlerts(REGISTER, TODAY);
  assert.deepEqual(
    theirs.warranty_gone.map((a) => a.id).sort(),
    mine.warranty_gone.map((a) => a.id).sort()
  );
  assert.deepEqual(theirs.amc_soon.map((a) => a.id), mine.amc_soon.map((a) => a.id));
});

test('today is not "already expired"', () => {
  const alerts = assetAlerts([{ id: 1, warranty_until: TODAY }], TODAY);
  assert.equal(alerts.warranty_just_gone.length, 0);
  assert.deepEqual(alerts.warranty_soon.map((a) => a.id), [1], 'it runs out today, which is soon');
});

/* ---------------- the dashboard hears about it ---------------- */

test('the digest says what can be acted on, and not the 2024 laptop', async () => {
  const { digest } = await import('../../shared/digest.js');
  const built = digest({ asset_dates: assetAlerts(REGISTER, TODAY), today: TODAY });
  const texts = built.items.map((i) => i.text);

  const justGone = built.items.find((i) => /warranty just run out|warranties just run out/.test(i.text));
  assert.ok(justGone, 'a warranty that lapsed last week was nowhere on the dashboard');
  assert.equal(justGone.go, 'assets', 'and it has to open the register');
  assert.equal(justGone.kind, 'dates');
  assert.match(justGone.text, /BNF-ASSETS-000002/);

  assert.ok(
    !texts.some((t) => t.includes('BNF-ASSETS-000003')),
    'the laptop out of warranty since 2024 was on the dashboard — it will be tomorrow too'
  );
  assert.ok(
    !texts.some((t) => t.includes('BNF-ASSETS-000004')),
    'an asset with no warranty date was reported as lapsed'
  );
  assert.ok(built.items.some((i) => /AMC/.test(i.text)), 'the AMC is its own line');
});

test('no asset register, no asset lines — a login without it is told nothing', async () => {
  const { digest } = await import('../../shared/digest.js');
  const built = digest({ asset_dates: null, today: TODAY });
  assert.ok(!built.items.some((i) => /warranty/i.test(i.text)));
});
