import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

/*
 * "IMPORTED ASSETS KO BHI NAYA CODE DO."
 *
 * So an imported asset joins its company's series - and the ID its own
 * spreadsheet carried is KEPT, which is not optional. The sticker is already
 * on the desk, and the import recognises rows by their code: drop it and the
 * same file imported twice makes a thousand duplicates.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-renumber-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const people = await import('../src/people.js');
const db = await import('../src/db.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const auth = { authorization: `Bearer ${process.env.APP_PASSWORD}` };
const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const company = db.createCompany({ name: 'BOOKNFLY PVT LTD' });
people.setAssetPrefix(company.id, 'BNF');

const HEADER = ['Sr No.', 'Asset ID', 'Item Name', 'serial No.', 'price', 'location'];
const sheet = async (rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(HEADER);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const importIt = async (buffer, { write = true, companyId = company.id } = {}) => {
  const form = new FormData();
  form.set('file', new Blob([buffer]), 'Assets.xlsx');
  if (write) form.set('write', 'true');
  if (companyId) form.set('company_id', String(companyId));
  const res = await fetch(`${base}/api/people/assets/import`, { method: 'POST', headers: auth, body: form });
  return res.json();
};

const FILE = await sheet([
  ['1', 'BNF-Assets-2456', 'MOUSE', '-', 708, 'Head Office'],
  ['2', 'BNF-AST-Big Storage (Almari)-0006', 'Almari', '-', 5000, 'Head Office'],
]);

test('an imported asset joins the series and keeps its sheet ID', async () => {
  const done = await importIt(FILE);
  assert.equal(done.wrote, 2);
  const { assets } = (await api('GET', '/api/people/assets')).body;
  assert.deepEqual(assets.map((a) => a.code).sort(), ['BNF-ASSETS-000001', 'BNF-ASSETS-000002']);
  /*
   * KEPT EXACTLY AS THE SHEET SPELLED IT - brackets, spaces, mixed case and
   * all - because that is what the sticker on the desk reads. Tidying it
   * would make the stored value and the label disagree, which is the one
   * thing keeping it is for.
   */
  assert.deepEqual(
    assets.map((a) => a.old_code).sort(),
    ['BNF-AST-Big Storage (Almari)-0006', 'BNF-Assets-2456'].sort()
  );
});

test('the same file again recognises them instead of making duplicates', async () => {
  const again = await importIt(FILE);
  assert.equal(again.wrote, 0, 'a thousand duplicates is what dropping the old code would cost');
  assert.equal(again.updated, 2);
  assert.equal((await api('GET', '/api/people/assets')).body.assets.length, 2);
});

test('a sticker still on the desk can be looked up', async () => {
  const found = await api('GET', '/api/people/assets/by-code/BNF-Assets-2456');
  assert.equal(found.status, 200, 'somebody holding the mouse has only the sticker');
  assert.equal(found.body.code, 'BNF-ASSETS-000001');
  assert.equal(found.body.old_code, 'BNF-Assets-2456', 'as the sheet spelled it');

  const awkward = await api(
    'GET',
    `/api/people/assets/by-code/${encodeURIComponent('BNF-AST-Big Storage (Almari)-0006')}`
  );
  assert.equal(awkward.status, 200, 'punctuation must not keep two spellings apart');
});

test('a sheet with no company puts them where the import says', async () => {
  // His own 1,008-row list has no company column at all, so every row used
  // to arrive belonging to nobody - invisible to the company filter, and
  // with a GEN- code because there was no company series to join.
  const { assets } = (await api('GET', '/api/people/assets')).body;
  assert.ok(assets.every((a) => a.company_id === company.id));
  assert.ok(assets.every((a) => a.code.startsWith('BNF-')));
});

test('renumbering says what it would do before it does it', async () => {
  people.createAsset({ company_id: company.id, kind: 'mouse', label: 'Typed by hand', code: 'BNF-OLD-99' });
  const { body } = await api('GET', '/api/people/assets/renumber');
  assert.equal(body.total, 3);
  assert.equal(body.already, 2, 'the imported ones are in the series already');
  assert.equal(body.changing, 1);
  assert.equal(body.examples[0].from, 'BNF-OLD-99', 'named, because "1 will change" is a number');
});

test('renumbering keeps the old code on every one it touches', async () => {
  const done = await api('POST', '/api/people/assets/renumber', {});
  assert.equal(done.body.changed, 1);
  const moved = (await api('GET', '/api/people/assets')).body.assets.find(
    (a) => a.old_code === 'BNF-OLD-99'
  );
  assert.match(moved.code, /^BNF-ASSETS-\d{6}$/);
  assert.equal(moved.old_code, 'BNF-OLD-99');
  assert.equal(
    (await api('GET', '/api/people/assets/by-code/BNF-OLD-99')).status,
    200,
    'and the label it still wears finds it'
  );
});

test('running it again changes nothing', async () => {
  const { body } = await api('POST', '/api/people/assets/renumber', {});
  assert.equal(body.changed, 0);
  assert.equal(body.changing, 0);
});

test('a written-off asset is left alone', async () => {
  const gone = people.createAsset({ company_id: company.id, kind: 'mouse', label: 'Scrapped', code: 'OLD-SHAPE-1' });
  people.writeOffAsset(gone.id, { why: 'dropped', on: '2026-11-18', by: 'office' });
  await api('POST', '/api/people/assets/renumber', {});
  assert.equal(
    people.getAsset(gone.id).code,
    'OLD-SHAPE-1',
    'its code is on a disposal note and a final service bill'
  );
});

test('an asset belonging to nobody is named, not given a GEN- code', async () => {
  people.createAsset({ kind: 'mouse', label: 'No company', code: 'LOOSE-1' });
  const { body } = await api('GET', '/api/people/assets/renumber');
  assert.ok(body.no_company >= 1, 'there is no series for it to join — say so');
  const before = people.getAssetByCode('LOOSE-1');
  await api('POST', '/api/people/assets/renumber', {});
  assert.equal(people.getAsset(before.id).code, 'LOOSE-1', 'and it is left exactly as it was');
});

test('every code is still unique afterwards', () => {
  const codes = people.listAssets({ written_off: true }).map((a) => a.code);
  assert.equal(new Set(codes.map((c) => c.toUpperCase())).size, codes.length);
});
