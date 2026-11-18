import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

/*
 * ONE BAD ROW MUST NOT TAKE THE FILE DOWN.
 *
 * Six of Dinesh's thousand rows carried brackets in the asset code. The first
 * of them threw, the request died with a 500 - and 998 assets had ALREADY
 * been written. A partial import with no report is the worst outcome there
 * is: the register is wrong and nothing says where.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-import-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const auth = { authorization: `Bearer ${process.env.APP_PASSWORD}` };

const HEADER = [
  'Sr No.', 'Asset ID', 'Item Name', 'Modal', 'Status', 'Condition', 'serial No.',
  'assignee', 'seat No.', 'Room', 'Purchased Date', 'Warenty date', 'Vendor', 'price',
  'Purchase Invoice', 'location',
];

const sheetOf = async (rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(HEADER);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const send = async (buffer, write) => {
  const form = new FormData();
  form.set('file', new Blob([buffer]), 'Assets_list.xlsx');
  if (write) form.set('write', 'true');
  const res = await fetch(`${base}/api/people/assets/import`, {
    method: 'POST', headers: auth, body: form,
  });
  return { status: res.status, body: await res.json() };
};

const line = (n, code, label = 'MOUSE') => [
  String(n), code, label, 'WIRELESS', 'Available', 'NEW', '-',
  '-', '-', 'ACCOUNT', '-', '-', 'Cash', 708, '-', 'Head Office',
];

test('brackets in a code no longer stop the file', async () => {
  const buffer = await sheetOf([
    line(1, 'BNF-Assets-2456'),
    line(2, 'BNF-AST-Big Storage (Almari)-0006', 'Almari'),
    line(3, 'BNF-Assets-2457'),
  ]);
  const { status, body } = await send(buffer, true);
  assert.equal(status, 200);
  assert.equal(body.wrote, 3, 'all three, brackets included');
  assert.deepEqual(body.failed, []);

  const { assets } = await (await fetch(`${base}/api/people/assets`, { headers: auth })).json();
  /*
   * The sheet's ID is now kept as `old_code` and the asset is given one from
   * its company's series - "imported assets ko bhi naya code do". The
   * brackets are kept EXACTLY as the sheet spelled them, because that is
   * what the sticker on the desk reads.
   */
  assert.ok(
    assets.some((a) => a.old_code === 'BNF-AST-Big Storage (Almari)-0006'),
    `kept, not refused: ${assets.map((a) => a.old_code).join(', ')}`
  );
  assert.ok(
    assets.every((a) => /-ASSETS-\d{6}$/.test(a.code)),
    `every one joins a series: ${assets.map((a) => a.code).join(', ')}`
  );
});

test('a row that genuinely cannot be saved is named, and the rest still go in', async () => {
  // No code at all and nothing to make one from: the kind of row that threw.
  const buffer = await sheetOf([
    line(1, 'BNF-Assets-3001'),
    ['2', '###', '', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '', '-', ''],
    line(3, 'BNF-Assets-3002'),
  ]);
  const { status, body } = await send(buffer, true);
  assert.equal(status, 200, 'a 500 here throws away the report along with the row');
  assert.equal(body.wrote, 2);
  assert.ok(Array.isArray(body.failed));
  for (const f of body.failed) {
    assert.ok(f.row, 'a failure without a row number cannot be fixed');
    assert.ok(f.why, 'nor one without a reason');
  }
});

test('the dry run writes nothing', async () => {
  const before = (await (await fetch(`${base}/api/people/assets`, { headers: auth })).json()).assets.length;
  const buffer = await sheetOf([line(9, 'BNF-Assets-9999')]);
  const { body } = await send(buffer, false);
  assert.equal(body.create.length, 1);
  assert.equal(body.wrote, 0);
  const after = (await (await fetch(`${base}/api/people/assets`, { headers: auth })).json()).assets.length;
  assert.equal(after, before, 'a dry run that writes is not a dry run');
});
