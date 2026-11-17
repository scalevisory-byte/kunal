import test from 'node:test';
import assert from 'node:assert/strict';
import { planAssetImport, serialLost, stateOf } from '../../shared/assetImport.js';

/*
 * The asset list this office actually keeps.
 *
 * Dinesh sent a 1,008-row register and almost none of its columns were being
 * read: "Item Name", "Modal", "assignee", "Purchased Date", "Warenty date",
 * "Purchase Invoice" and "location" all went past the importer. A column is
 * matched on what it SAYS, not on what it should have said.
 */

const HEADER = [
  'Sr No.', 'Asset ID', 'Item Name', 'Modal', 'Status', 'Condition', 'serial No.',
  'assignee', 'seat No.', 'Room', 'Purchased Date', 'Warenty date', 'Vendor', 'price',
  'Purchase Invoice', 'location',
];

const row = (over = {}) => {
  const cells = [
    '1', 'BNF-Assets-2456', 'MOUSE', 'WIRELESS', 'Allocated', 'NEW', '-',
    'Amit Shah', '-', 'TICKTING', new Date('2026-09-17'), '-', 'Deepak gandhi', 708,
    'SI/26-27/0354', 'Head Office',
  ];
  for (const [i, v] of Object.entries(over)) cells[Number(i)] = v;
  return cells;
};

const plan = (rows, opts = {}) => planAssetImport({ rows: [HEADER, ...rows], ...opts });

test('every column of his sheet is recognised', () => {
  const { columns, create } = plan([row()]);
  for (const field of [
    'code', 'label', 'model', 'status', 'condition', 'identifier', 'holder',
    'floor_room', 'purchase_date', 'warranty_until', 'vendor', 'purchase_cost',
    'invoice_no', 'location',
  ]) {
    assert.ok(columns[field] !== undefined, `${field} was not found in the header`);
  }
  assert.equal(create.length, 1);
  assert.deepEqual(
    {
      label: create[0].label, model: create[0].model, location: create[0].location,
      floor_room: create[0].floor_room, condition: create[0].condition,
      vendor: create[0].vendor, invoice_no: create[0].invoice_no,
      purchase_cost: create[0].purchase_cost, purchase_date: create[0].purchase_date,
      holder_name: create[0].holder_name,
    },
    {
      label: 'MOUSE', model: 'WIRELESS', location: 'Head Office',
      floor_room: 'TICKTING', condition: 'NEW',
      vendor: 'Deepak gandhi', invoice_no: 'SI/26-27/0354',
      purchase_cost: 708, purchase_date: '2026-09-17',
      holder_name: 'Amit Shah',
    }
  );
});

test('a dash is not a value', () => {
  // This office fills empty cells with "-" and a few with "0". Read
  // literally, 550 assets arrive with a condition of "-" said confidently.
  const [asset] = plan([row({ 3: '-', 5: '-', 6: '-', 12: '-', 14: '0', 9: '-' })]).create;
  assert.equal(asset.model, '');
  assert.equal(asset.condition, '');
  assert.equal(asset.identifier, '');
  assert.equal(asset.vendor, '');
  assert.equal(asset.invoice_no, '');
  assert.equal(asset.floor_room, '');
  assert.equal(asset.label, 'MOUSE', 'and the real values are untouched');
});

test('a price of zero is a price, not a placeholder', () => {
  const [asset] = plan([row({ 13: 0 })]).create;
  assert.equal(asset.purchase_cost, 0);
  assert.equal(asset.label, 'MOUSE', 'the row is still imported');
});

test('only the states that cannot be derived are carried across', () => {
  assert.equal(stateOf('In Repair'), 'maintenance');
  assert.equal(stateOf('Retired'), 'disposed');
  assert.equal(stateOf('Damaged'), 'damaged');
  // Available and Assigned are worked out from the holder - writing them
  // would be a second opinion that drifts the first time one is returned.
  assert.equal(stateOf('Available'), '');
  assert.equal(stateOf('Allocated'), '');
  assert.equal(stateOf('Occupied'), '');
  assert.equal(stateOf(''), '');
});

test('a serial Excel has already rounded off is not a serial', () => {
  // A 15-digit IMEI in a plain cell is saved as 3.52E+14, and what the file
  // carries is 352000000000000. The real number is gone before we see it.
  assert.equal(serialLost(352000000000000), true);
  assert.equal(serialLost(86500000000000), true);
  // A ten-digit mobile number is not mangled, and neither is a short serial.
  assert.equal(serialLost(7436033033), false);
  assert.equal(serialLost(352869041234567), false);
  assert.equal(serialLost('IMEI352869041234567'), false);
  assert.equal(serialLost(''), false);
});

test('two phones Excel rounded to the same number are still two phones', () => {
  const rows = [
    row({ 1: 'BNF-Assets-2380', 2: 'MOBILE', 6: 352000000000000 }),
    row({ 1: 'BNF-Assets-2335', 2: 'MOBILE', 6: 352000000000000 }),
  ];
  const { create, skipped, serials_lost: lost } = plan(rows);
  assert.equal(
    create.length,
    2,
    'skipping the second one loses a real asset because of a cell format'
  );
  assert.equal(skipped.length, 0);
  assert.equal(lost.length, 2, 'and both are named so the IMEIs can be typed back in');
  assert.ok(create.every((a) => a.identifier === ''), 'never imported with the wrong serial');
});

test('a genuine repeat in the file is still caught', () => {
  const rows = [row({ 1: 'BNF-Assets-2455' }), row({ 1: 'BNF-Assets-2455' })];
  const { create, skipped } = plan(rows);
  assert.equal(create.length, 1);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].why, /same code or serial/);
});

test('the assignee is matched to the staff list, and never invented', () => {
  const employees = [{ id: 7, name: 'Amit Shah' }];
  const { create } = plan([row(), row({ 1: 'BNF-Assets-2457', 7: 'Nobody Here' })], { employees });
  assert.equal(create[0].employee_id, 7);
  assert.equal(create[0].holder_unknown, false);
  assert.equal(create[1].employee_id, null);
  assert.equal(create[1].holder_unknown, true, 'somebody is holding it - say so, do not guess');
});
