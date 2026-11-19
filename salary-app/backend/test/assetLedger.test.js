/**
 * ONE PERSON'S ASSET LEDGER.
 *
 * What these pin:
 *
 *  - **Still out comes first**, because that is what somebody opened the page
 *    for.
 *  - **An asset standing against somebody with no open handover row is "held
 *    with no slip on file"** — not "never issued", and never dropped. A
 *    thousand imported rows carry a holder and no slip.
 *  - A returned asset keeps its line: "what did he ever hold" is the other
 *    half of the question.
 *  - **The value is reported, never deducted.**
 *  - The CSV carries every line, including the returned ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assetLedger, daysBetween, ledgerCsv } from '../../shared/assetLedger.js';

const TODAY = '2026-11-19';
const AMIT = { id: 7, name: 'Amit Shah', code: 'BNF-EMP-0140', company_name: 'BOOKNFLY PRIVATE LIMITED' };

const HANDOVERS = [
  {
    id: 1, asset_id: 11, employee_id: 7, code: 'BPL-ASSETS-000001', kind: 'Laptop',
    label: 'Dell Latitude 3420', identifier: 'DL3420-9981', purchase_cost: 47500,
    issued_on: '2026-04-02', issued_by: 'Dinesh', returned_on: null, acknowledged_on: '2026-04-03',
  },
  {
    id: 2, asset_id: 12, employee_id: 7, code: 'BPL-ASSETS-000009', kind: 'Mobile',
    label: 'Redmi Note 12', identifier: '352000000000001', purchase_cost: 13999,
    issued_on: '2025-06-10', issued_by: 'Dinesh', returned_on: '2026-03-31', returned_by: 'Store',
    condition_in: 'screen scratched',
  },
];

// On the register against Amit, with no handover row at all - imported.
const REGISTER = [
  {
    id: 13, employee_id: 7, code: 'BPL-ASSETS-000044', kind: 'Chair', label: 'Godrej revolving chair',
    purchase_cost: 4200, issued_on: '2024-11-05', returned_on: null,
  },
  // Somebody else's, and a written-off one of his: neither belongs here.
  { id: 14, employee_id: 9, code: 'BPL-ASSETS-000045', label: 'Somebody else’s desk', purchase_cost: 9000 },
  {
    id: 15, employee_id: 7, code: 'BPL-ASSETS-000046', label: 'Scrapped printer',
    purchase_cost: 12500, written_off_on: '2026-02-01',
  },
];

test('what they still hold comes first, and what came back is kept below', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  assert.deepEqual(led.lines.map((l) => l.code), [
    'BPL-ASSETS-000001',       // out since April
    'BPL-ASSETS-000044',       // out since 2024, no slip
    'BPL-ASSETS-000009',       // returned
  ]);
  assert.equal(led.totals.out, 2);
  assert.equal(led.totals.returned, 1);
  assert.equal(led.totals.ever, 3);
});

test('on the register with no handover row reads "no slip on file", never "never issued"', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  const chair = led.lines.find((l) => l.code === 'BPL-ASSETS-000044');
  assert.equal(chair.source, 'register');
  assert.equal(chair.no_slip, true);
  assert.equal(chair.open, true);
  assert.equal(led.totals.no_slip, 1);
  assert.equal(led.totals.unsigned, 1, 'the laptop WAS acknowledged, so only the chair is unsigned');
});

test('an asset covered by an open handover is not listed twice', () => {
  const alsoOnRegister = [
    ...REGISTER,
    { id: 11, employee_id: 7, code: 'BPL-ASSETS-000001', label: 'Dell Latitude 3420', purchase_cost: 47500 },
  ];
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: alsoOnRegister, today: TODAY });
  assert.equal(led.lines.filter((l) => l.code === 'BPL-ASSETS-000001').length, 1);
});

test('somebody else’s asset, and a written-off one, are not on this page', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  assert.ok(!led.lines.some((l) => l.code === 'BPL-ASSETS-000045'), 'somebody else’s desk');
  assert.ok(!led.lines.some((l) => l.code === 'BPL-ASSETS-000046'), 'a scrapped printer is not held');
});

test('days held counts to today for something still out, and to the return date otherwise', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  const laptop = led.lines.find((l) => l.code === 'BPL-ASSETS-000001');
  const mobile = led.lines.find((l) => l.code === 'BPL-ASSETS-000009');
  assert.equal(laptop.days, daysBetween('2026-04-02', TODAY));
  assert.equal(mobile.days, daysBetween('2025-06-10', '2026-03-31'));
  assert.ok(laptop.days > 0 && mobile.days > 0);
});

test('the worth is what is STILL out, reported and not deducted from anything', () => {
  const led = assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY });
  assert.equal(led.totals.out_value, 47500 + 4200, 'the returned mobile is not counted against him');
  assert.equal(led.totals.oldest_out, '2024-11-05');
  // Nothing in here is a deduction, a charge or a settlement figure.
  assert.ok(!('deduct' in led.totals) && !('owed' in led.totals));
});

test('the CSV carries every line, returned ones included', () => {
  const csv = ledgerCsv(assetLedger({ employee: AMIT, handovers: HANDOVERS, assets: REGISTER, today: TODAY }));
  assert.match(csv, /^﻿Code,Kind,What/);
  assert.match(csv, /BPL-ASSETS-000009/);
  assert.match(csv, /no slip on file/);
  assert.equal(csv.trim().split('\n').length, 4, 'a header and three assets');
});

test('nobody holding anything is an empty ledger, not an error', () => {
  const led = assetLedger({ employee: AMIT, handovers: [], assets: [], today: TODAY });
  assert.equal(led.lines.length, 0);
  assert.equal(led.totals.out, 0);
  assert.equal(led.totals.out_value, 0);
  assert.equal(led.totals.oldest_out, '');
});
