import test from 'node:test';
import assert from 'node:assert/strict';
import { amountOf, dateOf, detectLayout, kindOf, planAssetImport } from '../../shared/assetImport.js';

/*
 * Reading an office's existing asset list out of Excel.
 *
 * What these pin is the two ways an import lies: by quietly creating a second
 * copy of something already on the register, and by dropping a row it could
 * not read so that a hundred and twenty assets come in as a hundred and
 * sixteen with nothing saying so.
 */

const SHEET = [
  ['BOOKNFLY — Asset list as on 31.03.2026'],
  [],
  ['Sr No', 'Asset Name', 'Type', 'Serial No', 'Asset Code', 'Cost', 'Purchase Date', 'Vendor', 'Issued To'],
  [1, 'Dell Latitude 3420', 'Laptop', 'DL7788', 'BPL-LAP-001', '₹ 42,000.00', '14/03/2024', 'Rajesh Computers', 'ALPESH SHUKLA'],
  [2, 'HP LaserJet', '', 'HP1122', '', '18500', '02-07-2023', 'Shah Systems', ''],
  [3, '', '', 'XX999', '', '1000', '', '', ''],
  [4, 'Office chair', 'Furniture', '', '', '2,400', '', '', 'NOBODY HERE'],
  [5, 'Dell Latitude 3420', 'Laptop', 'DL7788', '', '42000', '', '', ''],
  [],
  ['TOTAL', '', '', '', '', '105900'],
];

const EMPLOYEES = [{ id: 7, name: 'ALPESH SHUKLA' }, { id: 8, name: 'ARQAM SAIYED' }];
const COMPANIES = [{ id: 1, name: 'BOOKNFLY PRIVATE LIMITED' }];

test('it finds the header wherever it is and maps the office’s own words', () => {
  const { headerRow, columns } = detectLayout(SHEET);
  assert.equal(headerRow, 2, 'not row 1 - these files start with a title');
  assert.equal(columns.label, 1);
  assert.equal(columns.identifier, 3);
  assert.equal(columns.code, 4);
  assert.equal(columns.purchase_cost, 5);
  assert.equal(columns.holder, 8);
});

test('a sheet with no recognisable header is a problem, not an empty import', () => {
  const plan = planAssetImport({ rows: [['a', 'b'], [1, 2]] });
  assert.equal(plan.create.length, 0);
  assert.match(plan.problem, /header/i);
});

test('it creates what is new and names every row it could not take', () => {
  const plan = planAssetImport({ rows: SHEET, employees: EMPLOYEES, companies: COMPANIES });
  assert.deepEqual(plan.create.map((a) => a.label), [
    'Dell Latitude 3420',
    'HP LaserJet',
    'Office chair',
  ]);
  assert.deepEqual(
    plan.skipped.map((s) => s.why),
    ['no asset name', 'the same code or serial appears earlier in this file', 'a total row'],
    'each one said out loud, never dropped'
  );
});

test('something already on the register is an update, never a second copy', () => {
  const existing = [{ id: 3, code: 'BPL-LAP-001', label: 'Dell Latitude 3420' }];
  const plan = planAssetImport({ rows: SHEET, existing, employees: EMPLOYEES });
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].id, 3);
  assert.ok(!plan.create.some((a) => a.code === 'BPL-LAP-001'));

  // And matched on the serial where the sheet carries no code.
  const bySerial = planAssetImport({
    rows: SHEET,
    existing: [{ id: 9, identifier: 'HP1122', label: 'Some printer' }],
    employees: EMPLOYEES,
  });
  assert.equal(bySerial.update[0].id, 9, 'two printers cannot share a serial');
});

test('a holder the staff list does not have is reported, not invented', () => {
  const plan = planAssetImport({ rows: SHEET, employees: EMPLOYEES, companies: COMPANIES });
  const chair = plan.create.find((a) => a.label === 'Office chair');
  assert.equal(chair.employee_id, null);
  assert.equal(chair.holder_name, 'NOBODY HERE');
  assert.equal(chair.holder_unknown, true);
  assert.deepEqual(plan.holders_unknown.map((a) => a.holder_name), ['NOBODY HERE']);

  const laptop = plan.create.find((a) => a.code === 'BPL-LAP-001');
  assert.equal(laptop.employee_id, 7, 'and a name it does have is matched');
  assert.equal(laptop.holder_unknown, false);
});

test('money and dates are read as the office writes them', () => {
  assert.equal(amountOf('₹ 42,000.00'), 42000);
  assert.equal(amountOf('2,400'), 2400);
  assert.equal(amountOf(''), 0);
  assert.equal(amountOf('n/a'), 0, 'unreadable is nothing, never a guess');

  // Day first. 03/04/2024 in this office is 3 April, not 4 March.
  assert.equal(dateOf('14/03/2024'), '2024-03-14');
  assert.equal(dateOf('03/04/2024'), '2024-04-03');
  assert.equal(dateOf('02-07-2023'), '2023-07-02');
  assert.equal(dateOf('2024-03-14'), '2024-03-14');
  assert.equal(dateOf('whenever'), '', 'unreadable is blank, never today');
  assert.equal(dateOf(''), '');
});

test('the kind comes from the sheet, or from the item’s own name', () => {
  assert.equal(kindOf('Laptop', 'Dell Latitude'), 'laptop');
  assert.equal(kindOf('', 'Dell Latitude 3420 laptop'), 'laptop');
  assert.equal(kindOf('', 'HP LaserJet printer'), 'printer');
  assert.equal(kindOf('', 'Something odd'), 'other');
  assert.equal(kindOf('Air conditioner', 'AC unit'), 'air-conditioner', 'a kind it does not know is kept');
});

test('a blank line in the middle of a sheet is not a problem', () => {
  const plan = planAssetImport({ rows: SHEET });
  assert.ok(!plan.skipped.some((s) => s.why === 'no asset name' && s.row === 9));
});
