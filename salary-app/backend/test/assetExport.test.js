/**
 * THE ASSET REPORT, WITH CHOSEN COLUMNS.
 *
 * What these pin:
 *
 *  - **Money goes out as a number**, so the column adds up in Excel. The old
 *    export formatted it with commas, which a spreadsheet reads as a word.
 *  - **The columns come out in the catalogue's order**, not the order
 *    somebody happened to tick them in.
 *  - An unknown column is ignored rather than crashing the report, and asking
 *    for nothing gives the sensible default rather than an empty file.
 *  - **The export is of what was on screen** — the ids the browser sends —
 *    with "everything" as a separate, explicit choice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ASSET_FIELDS,
  DEFAULT_FIELDS,
  assetExportCsv,
  buildAssetExport,
  cleanFields,
  fieldGroups,
} from '../../shared/assetExport.js';

const ASSETS = [
  {
    id: 1, code: 'BPL-ASSETS-000001', kind: 'Laptop', label: 'Dell 3420', identifier: 'DL-998',
    company_name: 'BOOKNFLY', department: 'Accounts', purchase_date: '2025-04-01',
    purchase_cost: 47500, vendor: 'Shree Computers', invoice_no: 'SC/25/118',
    warranty_until: '2026-12-03', employee_id: 7, employee_name: 'Amit Shah',
  },
  {
    id: 2, code: 'BPL-ASSETS-000002', kind: 'Chair', label: 'Godrej chair',
    company_name: 'BOOKNFLY', purchase_cost: 4200,
  },
];

test('money is a number, not a formatted string — or the column will not add up', () => {
  const built = buildAssetExport(ASSETS, { fields: ['code', 'purchase_cost'] });
  assert.deepEqual(built.rows, [['BPL-ASSETS-000001', 47500], ['BPL-ASSETS-000002', 4200]]);
  assert.equal(typeof built.rows[0][1], 'number');
  assert.deepEqual(built.totals, [null, 51700]);
  assert.equal(built.has_totals, true);
});

test('the columns come out in the catalogue order, whatever order they were ticked in', () => {
  const built = buildAssetExport(ASSETS, { fields: ['purchase_cost', 'code', 'kind'] });
  assert.deepEqual(built.headers, ['Code', 'Kind', 'Cost to buy']);
});

test('an unknown column is ignored, and asking for none gives the default', () => {
  assert.deepEqual(cleanFields(['code', 'nonsense']), ['code']);
  assert.deepEqual(cleanFields([]), DEFAULT_FIELDS);
  assert.deepEqual(cleanFields(null), DEFAULT_FIELDS);
  assert.deepEqual(cleanFields(['nonsense']), DEFAULT_FIELDS, 'never an empty report');
});

test('"in the office" is written out, because a blank cell means nobody filled it in', () => {
  const built = buildAssetExport(ASSETS, { fields: ['where', 'holder'] });
  assert.deepEqual(built.rows[0], ['Amit Shah', 'Amit Shah']);
  assert.deepEqual(built.rows[1], ['in the office', ''], 'where it is, and nobody holding it');
});

test('the group is worked out from the kind, never read off a column', () => {
  const built = buildAssetExport(ASSETS, { fields: ['group'] });
  assert.deepEqual(built.rows, [['Computer'], ['Furniture']]);
});

test('warranty days left are counted against a date that is given, not invented', () => {
  const built = buildAssetExport(ASSETS, { fields: ['warranty_days'], today: '2026-11-19' });
  assert.equal(built.rows[0][0], 14);
  assert.equal(built.rows[1][0], null, 'no date is "not recorded", never a zero');
});

test('the CSV carries a header, the rows and one total line', () => {
  const csv = assetExportCsv(buildAssetExport(ASSETS, { fields: ['code', 'label', 'purchase_cost'] }));
  const lines = csv.split('\n');
  assert.match(lines[0], /^﻿Code,What,Cost to buy$/);
  assert.equal(lines.length, 4);
  assert.match(lines[3], /TOTAL — 2 assets,,51700/);
});

test('every field in the picker can actually be built', () => {
  const groups = fieldGroups();
  const inGroups = groups.flatMap((g) => g.fields.map((f) => f.key));
  assert.deepEqual(inGroups.sort(), ASSET_FIELDS.map(([k]) => k).sort(), 'the picker and the catalogue agree');
  const built = buildAssetExport(ASSETS, { fields: inGroups });
  assert.equal(built.headers.length, ASSET_FIELDS.length);
  assert.equal(built.rows[0].length, ASSET_FIELDS.length);
});

/* ---------------- over HTTP ---------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-export-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, url, body) =>
  fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

let ids = [];

test('set up: three assets', async () => {
  const company = await (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).json();
  for (const [kind, label, cost] of [['Laptop', 'Dell 3420', 47500], ['Chair', 'Godrej', 4200], ['Printer', 'HP', 12500]]) {
    const made = await (await call('POST', '/api/people/assets', {
      company_id: company.id, kind, label, purchase_cost: cost, purchase_date: '2025-04-01',
    })).json();
    ids.push(made.id);
  }
});

test('the picker is served from the same catalogue the export uses', async () => {
  const res = await call('GET', '/api/people/assets/export/fields');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.all.length, ASSET_FIELDS.length);
  assert.ok(body.groups.length >= 4);
});

test('it exports exactly the ids the screen sent, and everything when none are sent', async () => {
  const some = await call('POST', '/api/people/assets/export', {
    format: 'csv', fields: ['code', 'label', 'purchase_cost'], ids: [ids[0], ids[2]],
  });
  const text = await some.text();
  assert.equal(some.status, 200);
  assert.match(some.headers.get('content-disposition') || '', /asset-report\.csv/);
  assert.equal(text.trim().split('\n').length, 4, 'a header, two assets and a total');
  assert.ok(!text.includes('Godrej'), 'an asset the screen had filtered out was in the report');
  assert.match(text, /TOTAL — 2 assets/);

  const all = await (await call('POST', '/api/people/assets/export', {
    format: 'csv', fields: ['code', 'label'], ids: [],
  })).text();
  assert.equal(all.trim().split('\n').length, 4, 'all three, and no total line without a money column');
  assert.ok(all.includes('Godrej'));
});

test('the spreadsheet is a real xlsx with a SUM in its footer, not a typed figure', async () => {
  const res = await call('POST', '/api/people/assets/export', {
    format: 'xlsx', fields: ['code', 'label', 'purchase_cost'], ids: [],
  });
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get('content-type') || '',
    /spreadsheetml\.sheet/,
    'it has to open as a spreadsheet, not as a download of unknown type'
  );
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.slice(0, 2).toString(), 'PK', 'an xlsx is a zip');

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Assets');
  assert.equal(ws.getRow(1).getCell(1).value, 'Code');
  /*
   * Found by the row order: the register sorts by kind and code, not by the
   * order things were added, so the laptop is not row 2. Look the row up
   * rather than counting on where it landed.
   */
  const costs = [2, 3, 4].map((r) => ws.getRow(r).getCell(3).value);
  assert.deepEqual(costs.slice().sort((a, b) => a - b), [4200, 12500, 47500]);
  for (const cost of costs) assert.equal(typeof cost, 'number', 'a number, so it can be summed');
  const footer = ws.getRow(5);
  assert.match(String(footer.getCell(1).value), /TOTAL — 3 assets/);
  assert.equal(footer.getCell(3).value.formula, 'SUM(C2:C4)', 'a live SUM, so deleting a row keeps it right');
  assert.ok(ws.autoFilter, 'the header row filters');
});
