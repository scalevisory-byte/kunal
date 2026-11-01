/**
 * Asset maintenance — and the three figures the brief asked to be tested, which
 * until now had nothing to test:
 *
 *   - service cost
 *   - total cost of ownership
 *   - duplicate service cost entries
 *
 * The rule the module is built around: **a duplicate is caught when it is
 * typed, not in a report.** Catching it in a report means somebody has already
 * closed a month on a wrong figure. And it ASKS rather than refuses, because two
 * identical repairs on one day do happen, and a system that will not record the
 * truth gets worked around.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  daysUntil,
  looksDuplicate,
  maintenanceAlerts,
  maintenanceTotals,
  ownership,
  spendReport,
} from '../../shared/maintenance.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-maint-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: 'Bearer the-key',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
};

/* ================================================================= *
 * the engine
 * ================================================================= */

test('total cost of ownership keeps its parts', () => {
  const own = ownership(
    { purchase_cost: 42000 },
    [{ serviced_on: '2026-08-01', cost: 3500 }, { serviced_on: '2026-09-15', cost: 1200 }],
    '2026-11-01'
  );
  assert.equal(own.purchase, 42000, 'what it cost to buy');
  assert.equal(own.service, 4700, 'what it has cost to keep');
  assert.equal(own.total, 46700, 'and the two together');
  assert.equal(own.times, 2);
  assert.equal(own.service_share, 11.2, 'keeping it has cost 11.2% of buying it');
  assert.equal(own.last_service_on, '2026-09-15');
});

test('an asset that cost nothing to buy has no percentage, not a divide by zero', () => {
  // A SIM card, a gifted desk. Plenty of assets cost nothing to acquire.
  const own = ownership({ purchase_cost: 0 }, [{ serviced_on: '2026-08-01', cost: 500 }]);
  assert.equal(own.service, 500);
  assert.equal(own.service_share, null);
});

test('nothing serviced has a zero service cost, not a missing one', () => {
  const own = ownership({ purchase_cost: 9500 }, []);
  assert.equal(own.service, 0);
  assert.equal(own.total, 9500);
  assert.equal(own.times, 0);
  assert.equal(own.last_service_on, null);
  assert.equal(own.next_service_on, null, 'and no date is invented');
});

test('the next service date is the latest one somebody actually gave', () => {
  const own = ownership(
    {},
    [
      { serviced_on: '2026-03-01', cost: 100, next_service_on: '2026-09-01' },
      { serviced_on: '2026-09-02', cost: 100, next_service_on: '2027-03-01' },
      { serviced_on: '2026-10-01', cost: 100 },
    ],
    '2026-11-01'
  );
  assert.equal(own.next_service_on, '2027-03-01', 'not the most recent service, the latest date given');
  assert.equal(own.service_due, false);
  assert.equal(own.service_soon, false);
});

test('a service due, due soon, and long overdue are told apart', () => {
  const on = (date) => ownership({}, [{ serviced_on: '2026-01-01', cost: 1, next_service_on: date }], '2026-11-01');
  assert.equal(on('2026-10-01').service_due, true, 'a month ago');
  assert.equal(on('2026-11-01').service_due, true, 'today counts as due');
  assert.equal(on('2026-11-20').service_soon, true, 'inside a month');
  assert.equal(on('2026-11-20').service_due, false);
  assert.equal(on('2027-06-01').service_soon, false, 'and next year is not news');
});

test('warranty and AMC are separate contracts with separate dates', () => {
  const own = ownership({ warranty_until: '2026-11-20', amc_until: '2026-06-01' }, [], '2026-11-01');
  assert.equal(own.under_warranty, true);
  assert.equal(own.warranty_in_days, 19);
  assert.equal(own.under_amc, false, 'the AMC ran out in June');
  assert.equal(own.amc_in_days, -153);
});

test('no date means not known, never expired', () => {
  const own = ownership({}, []);
  assert.equal(own.warranty_in_days, null);
  assert.equal(own.under_warranty, false);
  assert.equal(daysUntil(null), null);
  assert.equal(daysUntil('not a date'), null);
});

test('a duplicate is the same asset, same date, same amount — not the same note', () => {
  const existing = [{ id: 1, serviced_on: '2026-08-01', cost: 3500, work: 'battery' }];
  // The note is where somebody types "battery" one time and "Battery
  // replacement" the next for the identical bill, so it is not part of the test.
  assert.equal(looksDuplicate({ serviced_on: '2026-08-01', cost: 3500, work: 'Battery replacement' }, existing).id, 1);
  assert.equal(looksDuplicate({ serviced_on: '2026-08-02', cost: 3500 }, existing), null, 'a day later is not it');
  assert.equal(looksDuplicate({ serviced_on: '2026-08-01', cost: 3400 }, existing), null, 'a different amount is not it');
  assert.equal(looksDuplicate({ serviced_on: '', cost: 3500 }, existing), null, 'and no date cannot be judged');
});

test('a row is never a duplicate of itself, so editing one is not blocked', () => {
  const existing = [{ id: 7, serviced_on: '2026-08-01', cost: 3500 }];
  assert.equal(looksDuplicate({ id: 7, serviced_on: '2026-08-01', cost: 3500 }, existing), null);
});

test('the alerts are four lists, because each needs something different doing', () => {
  const rows = [
    { code: 'A', purchase_cost: 100, services: [{ serviced_on: '2026-01-01', cost: 1, next_service_on: '2026-09-01' }] },
    { code: 'B', purchase_cost: 100, services: [{ serviced_on: '2026-01-01', cost: 1, next_service_on: '2026-11-15' }] },
    { code: 'C', purchase_cost: 100, warranty_until: '2026-01-01', services: [] },
    { code: 'D', purchase_cost: 100, amc_until: '2026-02-01', services: [] },
    { code: 'E', purchase_cost: 100, warranty_until: '2026-01-01', written_off_on: '2026-05-01', services: [] },
  ];
  const alerts = maintenanceAlerts(rows, '2026-11-01');
  assert.deepEqual(alerts.overdue.map((a) => a.code), ['A']);
  assert.deepEqual(alerts.soon.map((a) => a.code), ['B']);
  assert.deepEqual(alerts.warranty_gone.map((a) => a.code), ['C']);
  assert.deepEqual(alerts.amc_gone.map((a) => a.code), ['D']);
  assert.equal(alerts.count, 2, 'only the two that need a service');
  assert.equal(
    alerts.warranty_gone.some((a) => a.code === 'E'),
    false,
    'a written-off asset is not worth an alert',
  );
});

test('the totals name what has cost more to keep than to buy', () => {
  const rows = [
    { code: 'A', purchase_cost: 10000, services: [{ serviced_on: '2026-01-01', cost: 12000 }] },
    { code: 'B', purchase_cost: 40000, services: [{ serviced_on: '2026-01-01', cost: 1000 }] },
    { code: 'C', purchase_cost: 0, services: [{ serviced_on: '2026-01-01', cost: 900 }] },
  ].map((r) => ({ ...r, ownership: ownership(r, r.services) }));
  const totals = maintenanceTotals(rows);
  assert.equal(totals.purchase, 50000);
  assert.equal(totals.service, 13900);
  assert.equal(totals.total, 63900);
  assert.equal(totals.services, 3);
  assert.deepEqual(totals.costing_more_than_bought.map((a) => a.code), ['A'], 'the one to replace, not repair again');
});

/* ================================================================= *
 * end to end
 * ================================================================= */

let companyId;
let laptop;

test('set the scene', async () => {
  companyId = (await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' })).body.id;
  const made = await api('POST', '/api/people/assets', {
    company_id: companyId,
    kind: 'Laptop',
    label: 'Dell Latitude 3420',
    purchase_cost: 42000,
    purchase_date: '2026-07-01',
    warranty_until: '2029-07-01',
    amc_until: '2026-10-01',
    amc_vendor: 'Rajhans Computers',
    amc_cost: 4000,
  });
  assert.equal(made.status, 201);
  laptop = made.body.id;
  assert.equal(made.body.amc_until, '2026-10-01');
  assert.equal(made.body.amc_cost, 4000);
});

test('a service is recorded with what was done, by whom, and what it cost', async () => {
  const res = await api('POST', `/api/people/assets/${laptop}/services`, {
    serviced_on: '2026-08-01',
    kind: 'Repair',
    work: 'Keyboard replaced',
    vendor: 'Rajhans Computers',
    invoice_no: 'RC/26-27/204',
    cost: 3500,
    next_service_on: '2027-02-01',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.cost, 3500);
  assert.equal(res.body.work, 'Keyboard replaced');
});

test('the same service typed twice is caught when it is typed, and asks', async () => {
  const again = await api('POST', `/api/people/assets/${laptop}/services`, {
    serviced_on: '2026-08-01',
    kind: 'Repair',
    work: 'Keyboard replacement',  // worded differently, same bill
    cost: 3500,
  });
  assert.equal(again.status, 409, 'not a silent accept and not a flat refusal');
  assert.match(again.body.error, /already has a ₹3,?500 service on 2026-08-01/);
  assert.match(again.body.error, /Add it anyway\?/);
  assert.equal(again.body.duplicate.work, 'Keyboard replaced', 'and it names the one it resembles');

  // Nothing was written.
  const { body } = await api('GET', `/api/people/maintenance/services?asset_id=${laptop}`);
  assert.equal(body.services.length, 1);
});

test('but a genuine second bill on the same day gets through when confirmed', async () => {
  const forced = await api('POST', `/api/people/assets/${laptop}/services`, {
    serviced_on: '2026-08-01',
    kind: 'Parts',
    work: 'Charger',
    cost: 3500,
    force: true,
  });
  assert.equal(forced.status, 201);
  const { body } = await api('GET', `/api/people/maintenance/services?asset_id=${laptop}`);
  assert.equal(body.services.length, 2);
});

test('a different amount on the same day is not a duplicate at all', async () => {
  const res = await api('POST', `/api/people/assets/${laptop}/services`, {
    serviced_on: '2026-08-01',
    kind: 'Service',
    work: 'Cleaning',
    cost: 300,
  });
  assert.equal(res.status, 201, 'no confirmation needed');
});

test('a negative cost is refused', async () => {
  const res = await api('POST', `/api/people/assets/${laptop}/services`, {
    serviced_on: '2026-09-01',
    cost: -100,
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not a negative number/);
});

test('work done free under warranty still goes on the record', async () => {
  const res = await api('POST', `/api/people/assets/${laptop}/services`, {
    serviced_on: '2026-09-10',
    kind: 'Repair',
    work: 'Hinge, under warranty',
    cost: 0,
    under_warranty: true,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.under_warranty, true);
  // An asset serviced four times for free is still an asset serviced four times.
  const { body } = await api('GET', '/api/people/maintenance');
  const asset = body.assets.find((a) => a.id === laptop);
  assert.equal(asset.ownership.times, 4);
  assert.equal(asset.ownership.service, 7300, '3500 + 3500 + 300 + 0');
});

test('the register carries each asset’s running cost and what is due', async () => {
  const { body } = await api('GET', '/api/people/maintenance');
  const asset = body.assets.find((a) => a.id === laptop);
  assert.equal(asset.ownership.purchase, 42000);
  assert.equal(asset.ownership.total, 49300);
  assert.equal(asset.ownership.next_service_on, '2027-02-01');
  assert.equal(asset.ownership.under_warranty, true, 'warranty runs to 2029');
  assert.equal(asset.ownership.under_amc, false, 'the AMC ran out on 1 October');
  assert.equal(body.totals.service, 7300);
  assert.equal(body.totals.total, 49300);
  assert.ok(body.alerts.amc_gone.some((a) => a.id === laptop), 'and the lapsed AMC is an alert');
});

test('a service can be corrected, and removing one takes its cost back out', async () => {
  const { body } = await api('GET', `/api/people/maintenance/services?asset_id=${laptop}`);
  const cleaning = body.services.find((s) => s.work === 'Cleaning');

  const fixed = await api('PATCH', `/api/people/maintenance/services/${cleaning.id}`, { cost: 500 });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.cost, 500);
  let register = await api('GET', '/api/people/maintenance');
  assert.equal(register.body.assets.find((a) => a.id === laptop).ownership.service, 7500);

  assert.equal((await api('DELETE', `/api/people/maintenance/services/${cleaning.id}`)).body.deleted, true);
  register = await api('GET', '/api/people/maintenance');
  assert.equal(register.body.assets.find((a) => a.id === laptop).ownership.service, 7000);
});

test('the services ride onto the asset’s own timeline', async () => {
  const { body } = await api('GET', `/api/people/assets/${laptop}/history`);
  const what = body.events.map((e) => `${e.on} ${e.what}`);
  assert.ok(what.includes('2026-07-01 Bought'));
  assert.ok(what.includes('2026-08-01 Repair'));
  assert.ok(what.includes('2026-09-10 Repair'));
  // In date order, with the amounts on them.
  const repair = body.events.find((e) => e.what === 'Repair' && e.on === '2026-08-01');
  assert.equal(repair.amount, 3500);
  assert.match(repair.detail, /Keyboard replaced/);
  const free = body.events.find((e) => e.on === '2026-09-10');
  assert.match(free.detail, /under warranty/);
});

test('both maintenance reports download as CSV', async () => {
  const services = await fetch(`${base}/api/people/maintenance/services.csv`, {
    headers: { authorization: 'Bearer the-key' },
  });
  assert.equal(services.status, 200);
  const bytes = Buffer.from(await services.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM for Excel');
  const csv = bytes.toString('utf8');
  assert.match(csv, /Date,Code,What,Company,Kind of work,Work/);
  // The asset's kind and the service's kind are different things, and both are
  // on the report rather than one quietly replacing the other.
  assert.match(csv, /Laptop Dell Latitude 3420/);
  assert.match(csv, /Repair/);
  assert.match(csv, /Keyboard replaced/);

  const own = await api('GET', '/api/people/maintenance/ownership.csv');
  assert.equal(own.status, 200);
  assert.match(own.text, /Cost to buy,Services,Cost to keep,Total so far/);
  assert.match(own.text, /42000/);
});

test('the trail carries the services, by asset code and amount', async () => {
  const { body } = await api('GET', `/api/people/audit?entity=assets&entity_id=${laptop}`);
  const serviced = body.entries.filter((e) => e.action === 'serviced');
  assert.ok(serviced.length >= 3);
  assert.match(serviced[0].label, /BPL-LAP-001/);
  assert.ok(body.entries.some((e) => e.action === 'service removed'));
});

test('deleting an asset takes its services with it, which is why it refuses to', async () => {
  // The laptop has handovers? No - but it has services, and deleting is still
  // allowed for something never issued. The services go with it, which is the
  // reason write-off exists.
  const spare = await api('POST', '/api/people/assets', {
    company_id: companyId,
    kind: 'Other',
    label: 'Spare',
    purchase_cost: 100,
  });
  await api('POST', `/api/people/assets/${spare.body.id}/services`, { serviced_on: '2026-10-01', cost: 50 });
  assert.equal((await api('DELETE', `/api/people/assets/${spare.body.id}`)).body.deleted, true);
  const { body } = await api('GET', `/api/people/maintenance/services?asset_id=${spare.body.id}`);
  assert.equal(body.services.length, 0, 'gone with it');
});

/*
 * What the kit costs to keep. The register already said what one asset had
 * cost; what was missing is the office's own question - how much is going out
 * on the things nobody is holding, and on which of them.
 */
const SPEND_ASSETS = [
  { id: 1, code: 'BPL-PC-001', kind: 'Desktop', purchase_cost: 46000, amc_cost: 3000, employee_id: null },
  { id: 2, code: 'BPL-LAP-001', kind: 'Laptop', purchase_cost: 42000, employee_id: 7, employee_name: 'ALPESH' },
  { id: 3, code: 'BPL-SIM-001', kind: 'SIM card', purchase_cost: 0, employee_id: null },
  { id: 4, code: 'BPL-OLD-001', kind: 'Printer', purchase_cost: 9000, employee_id: null, written_off_on: '2026-01-05' },
];
const SPEND_SERVICES = [
  { asset_id: 1, cost: 2500, serviced_on: '2026-03-04' },
  { asset_id: 1, cost: 1800, serviced_on: '2025-11-20' },
  { asset_id: 2, cost: 900, serviced_on: '2026-06-01' },
  { asset_id: 1, cost: 400, serviced_on: '' },
  { asset_id: 3, cost: 300, serviced_on: '2026-02-02' },
  // Written off: it is not the office's running cost any more.
  { asset_id: 4, cost: 5000, serviced_on: '2026-04-01' },
];

test('the office kit is counted on its own, and a written-off asset is not counted at all', () => {
  const r = spendReport(SPEND_ASSETS, SPEND_SERVICES);
  assert.equal(r.totals.assets, 3, 'the written-off printer is off the register');
  assert.equal(r.totals.service, 5900, '2500 + 1800 + 900 + 400 + 300, and not the printer');

  // Nobody holding it is the whole meaning of "general".
  assert.equal(r.office.assets, 2);
  assert.equal(r.office.service, 5000, 'the desktop and the SIM, not ALPESH’s laptop');
});

test('AMC sits beside the repairs, never inside them', () => {
  const r = spendReport(SPEND_ASSETS, SPEND_SERVICES);
  const pc = r.items.find((i) => i.code === 'BPL-PC-001');
  assert.equal(pc.service, 4700, 'repairs only');
  assert.equal(pc.amc, 3000);
  assert.equal(pc.upkeep, 7700, 'and the two together is what it costs to keep');
  // A year of one AMC and no breakdowns must not read as a year of repairs.
  assert.equal(r.totals.service + r.totals.amc, r.totals.upkeep);
});

test('a year comes off the date the work was done, and an undated bill is not dropped', () => {
  assert.deepEqual(
    spendReport(SPEND_ASSETS, SPEND_SERVICES).years,
    [
      { year: '2026', cost: 3700, times: 3 },
      { year: '2025', cost: 1800, times: 1 },
    ]
  );
  // The 400 with no date is held apart rather than dated today or lost.
  assert.equal(spendReport(SPEND_ASSETS, SPEND_SERVICES).undated, 400);

  const only2026 = spendReport(SPEND_ASSETS, SPEND_SERVICES, { year: '2026' });
  assert.equal(only2026.totals.service, 3700);
  // The AMC is a standing cost and is reported whichever year is asked for.
  assert.equal(only2026.totals.amc, 3000);
});

test('a share is null, not infinity, for kit that cost nothing to get', () => {
  const r = spendReport(SPEND_ASSETS, SPEND_SERVICES);
  const sim = r.items.find((i) => i.code === 'BPL-SIM-001');
  assert.equal(sim.purchase, 0);
  assert.equal(sim.service, 300);
  assert.equal(sim.share, null);

  // And one that has cost more to keep than to buy reads over 100.
  const dear = spendReport(
    [{ id: 9, code: 'X', kind: 'Mobile', purchase_cost: 9500, employee_id: null }],
    [{ asset_id: 9, cost: 10800, serviced_on: '2026-05-05' }]
  );
  assert.ok(dear.items[0].share > 100, `expected over 100, got ${dear.items[0].share}`);
});
