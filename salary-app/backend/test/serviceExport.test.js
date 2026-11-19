/**
 * THE MAINTENANCE REPORT, WITH CHOSEN COLUMNS.
 *
 * What these pin:
 *
 *  - **Two reports, because two questions get asked**: one line per service,
 *    and one line per asset's running cost. One table cannot answer both.
 *  - Money is a **number**, so the column adds up.
 *  - A column from the wrong report cannot sneak in, and asking for nothing
 *    gives that report's own default.
 *  - The ids the screen sends are what comes out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REPORTS,
  buildServiceExport,
  cleanServiceFields,
  serviceExportCsv,
  serviceFieldGroups,
} from '../../shared/serviceExport.js';

const SERVICES = [
  { id: 1, serviced_on: '2026-05-04', code: 'BPL-ASSETS-000001', label: 'Dell 3420', asset_kind: 'Laptop', kind: 'Repair', work: 'keyboard', vendor: 'Shree', cost: 2400, under_warranty: 0, next_service_on: '2026-11-04' },
  { id: 2, serviced_on: '2026-08-11', code: 'BPL-ASSETS-000003', label: 'HP LaserJet', asset_kind: 'Printer', kind: 'Service', vendor: 'Shree', cost: 0, under_warranty: 1 },
];

const OWNED = [
  { id: 1, code: 'BPL-ASSETS-000001', kind: 'Laptop', label: 'Dell 3420', purchase_date: '2025-04-01',
    ownership: { purchase: 47500, service: 2400, total: 49900, times: 1, service_share: 5.1, last_service_on: '2026-05-04', next_service_on: '2026-11-04' } },
  { id: 3, code: 'BPL-ASSETS-000003', kind: 'Printer', label: 'HP LaserJet',
    ownership: { purchase: 12500, service: 0, total: 12500, times: 1, service_share: 0, last_service_on: '2026-08-11', next_service_on: null } },
];

/* Columns come out in the CATALOGUE's order, not the order they were asked
   for, so every assertion looks its column up by header. */
const at = (built, header) => built.headers.indexOf(header);

test('the service report is one line per repair, with money as a number', () => {
  const built = buildServiceExport(SERVICES, { report: 'services', fields: ['serviced_on', 'code', 'cost'] });
  assert.deepEqual(built.headers, ['Date', 'Cost', 'Asset code']);
  const cost = at(built, 'Cost');
  assert.equal(built.rows[0][cost], 2400);
  assert.equal(typeof built.rows[0][cost], 'number');
  assert.equal(built.totals[cost], 2400);
});

test('free work under warranty is still a service, at zero', () => {
  const built = buildServiceExport(SERVICES, { report: 'services', fields: ['code', 'cost', 'under_warranty'] });
  const cost = at(built, 'Cost');
  const free = built.rows.find((r) => r[cost] === 0);
  assert.ok(free, 'a no-cost service was dropped');
  assert.equal(free[at(built, 'Under warranty')], 'yes');
});

test('the ownership report is one line per asset, and keeps buying apart from keeping', () => {
  const built = buildServiceExport(OWNED, { report: 'ownership', fields: ['code', 'purchase', 'service', 'total'] });
  assert.deepEqual(built.headers, ['Code', 'Cost to buy', 'Cost to keep', 'Total so far']);
  assert.deepEqual(built.rows[0], ['BPL-ASSETS-000001', 47500, 2400, 49900]);
  assert.deepEqual(built.totals, [null, 60000, 2400, 62400]);
  // And the label lands on the first column that is NOT a total.
  const csv = serviceExportCsv(built);
  assert.match(csv, /TOTAL — 2 assets,60000,2400,62400/);
});

test('a column from the other report cannot sneak in', () => {
  // `work` belongs to the service report, `purchase` to the ownership one.
  assert.deepEqual(cleanServiceFields('ownership', ['purchase', 'work']), ['purchase']);
  assert.deepEqual(cleanServiceFields('services', ['work', 'purchase']), ['work']);
  assert.deepEqual(cleanServiceFields('services', []), REPORTS.services.defaults);
  assert.deepEqual(cleanServiceFields('ownership', ['nonsense']), REPORTS.ownership.defaults);
});

test('every field in each picker can be built', () => {
  for (const key of Object.keys(REPORTS)) {
    const fields = serviceFieldGroups(key).flatMap((g) => g.fields.map((f) => f.key));
    const built = buildServiceExport(key === 'services' ? SERVICES : OWNED, { report: key, fields });
    assert.equal(built.headers.length, REPORTS[key].fields.length, key);
    assert.equal(built.rows[0].length, REPORTS[key].fields.length, key);
  }
});

test('the CSV names what it counted', () => {
  const csv = serviceExportCsv(buildServiceExport(SERVICES, { report: 'services', fields: ['code', 'cost'] }));
  assert.match(csv, /TOTAL — 2 services/);
  const one = serviceExportCsv(buildServiceExport([SERVICES[0]], { report: 'services', fields: ['code', 'cost'] }));
  /*
   * Cost comes FIRST in the catalogue, so this is also the case that caught
   * the label being hard-coded to column one: the footer read "2400" with
   * nothing saying what it was.
   */
  assert.match(one, /2400,TOTAL — 1 service/, 'one service, not "1 services", and the label not lost');
});

/* ---------------- over HTTP ---------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-svc-export-'));
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

test('both pickers are served, and both reports export', async () => {
  const company = await (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).json();
  const asset = await (await call('POST', '/api/people/assets', {
    company_id: company.id, kind: 'Laptop', label: 'Dell 3420', purchase_cost: 47500,
  })).json();
  await call('POST', `/api/people/assets/${asset.id}/services`, {
    serviced_on: '2026-05-04', kind: 'Repair', work: 'keyboard', vendor: 'Shree', cost: 2400,
  });

  const fields = await (await call('GET', '/api/people/maintenance/export/fields?report=ownership')).json();
  assert.equal(fields.report, 'ownership');
  assert.equal(fields.reports.length, 2);

  const services = await (await call('POST', '/api/people/maintenance/export', {
    report: 'services', format: 'csv', fields: ['serviced_on', 'code', 'work', 'cost'],
  })).text();
  assert.match(services, /keyboard/);
  assert.match(services, /TOTAL — 1 service,/);

  const owned = await call('POST', '/api/people/maintenance/export', {
    report: 'ownership', format: 'xlsx', fields: ['code', 'purchase', 'service', 'total'],
  });
  assert.match(owned.headers.get('content-disposition') || '', /asset-ownership\.xlsx/);
  const buffer = Buffer.from(await owned.arrayBuffer());
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Cost of ownership');
  assert.ok(ws, 'the sheet is named for the report it holds');
  assert.equal(ws.getRow(2).getCell(2).value, 47500);
  assert.equal(ws.getRow(2).getCell(3).value, 2400);
  assert.match(String(ws.getRow(3).getCell(1).value), /TOTAL — 1 asset\b/);
  assert.equal(ws.getRow(3).getCell(4).value.formula, 'SUM(D2:D2)');
});
