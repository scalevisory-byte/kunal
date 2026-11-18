import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * HIS ASSET CODE SERIES: BNF-ASSETS-000001.
 *
 * One running number per COMPANY, six digits, the middle word fixed,
 * prefixes set by the office. The rules he wrote down, each one pinned here:
 * unique, never reused, never editable, per-company, and safe when two people
 * press Add in the same second.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-series-'));
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

const bnf = db.createCompany({ name: 'BOOKNFLY PVT LTD' });
const bnv = db.createCompany({ name: 'BOOKNFLY VENTURE LLP' });
people.setAssetPrefix(bnf.id, 'BNF');
people.setAssetPrefix(bnv.id, 'BNV');

const add = (company_id, label = 'Laptop') =>
  people.createAsset({ company_id, kind: 'laptop', label });

test('the format is his, and the series starts at one', () => {
  assert.equal(add(bnf.id).code, 'BNF-ASSETS-000001');
  assert.equal(add(bnf.id).code, 'BNF-ASSETS-000002');
  assert.equal(add(bnf.id).code, 'BNF-ASSETS-000003');
});

test('each company counts on its own', () => {
  assert.equal(add(bnv.id).code, 'BNV-ASSETS-000001');
  assert.equal(add(bnf.id).code, 'BNF-ASSETS-000004', 'and the other one carries on where it was');
});

test('a number is never handed out twice, even after a delete', () => {
  const made = add(bnf.id);
  assert.equal(made.code, 'BNF-ASSETS-000005');
  db.db.prepare(`DELETE FROM assets WHERE id = ?`).run(made.id);
  assert.equal(
    add(bnf.id).code,
    'BNF-ASSETS-000006',
    'an old service bill and a signed handover slip still name 000005'
  );
});

test('a written-off asset keeps its code and its number', () => {
  const made = add(bnf.id);
  people.writeOffAsset(made.id, { why: 'dropped', on: '2026-11-18', by: 'office' });
  const after = people.getAsset(made.id);
  assert.equal(after.code, made.code, 'the sticker still reads the same');
  assert.notEqual(add(bnf.id).code, made.code);
});

test('codes already on the register count towards the series', () => {
  // His imported stickers are BNF-ASSETS-2456 and the like. The next new
  // asset must not land on one of them.
  people.createAsset({ company_id: bnf.id, kind: 'mouse', label: 'Imported', code: 'BNF-ASSETS-002456' });
  assert.equal(add(bnf.id).code, 'BNF-ASSETS-002457');
});

test('the same code cannot be on two assets, whatever the spelling', () => {
  assert.throws(
    () => people.createAsset({ company_id: bnf.id, kind: 'mouse', label: 'Twin', code: 'bnf-assets-002456' }),
    /already on something else/
  );
});

test('the database refuses a duplicate even if nothing above catches it', () => {
  // The index is the real protection: a check and an insert have a gap
  // between them, however small.
  assert.throws(
    () => db.db.prepare(`INSERT INTO assets (code, kind, label) VALUES (?, 'mouse', 'Sneaked in')`)
      .run('BNF-ASSETS-002456'),
    /UNIQUE constraint failed/
  );
});

test('a code drawn by the app is redrawn when it loses a race', () => {
  /*
   * Simulated by taking the number the app is about to use, between working
   * it out and inserting. The loser must not see an error - nothing is wrong
   * with their asset, the number simply moved on.
   */
  const next = people.nextAssetCode(bnf.id);
  db.db.prepare(`INSERT INTO assets (code, kind, label, company_id) VALUES (?, 'mouse', 'Got there first', ?)`)
    .run(next, bnf.id);
  const mine = add(bnf.id);
  assert.notEqual(mine.code, next);
  assert.match(mine.code, /^BNF-ASSETS-\d{6}$/);
});

test('the form is shown the next code, and looking at it reserves nothing', async () => {
  const first = await api('GET', `/api/people/assets/next-code?company_id=${bnf.id}`);
  const second = await api('GET', `/api/people/assets/next-code?company_id=${bnf.id}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.code, second.body.code, 'two people with the form open see the same number');
  assert.match(first.body.code, /^BNF-ASSETS-\d{6}$/);
  assert.equal(add(bnf.id).code, first.body.code, 'and the first to save gets it');
});

test('a prefix is per company, and cannot be two companies at once', async () => {
  const clash = await api('PUT', `/api/people/assets/prefixes/${bnv.id}`, { prefix: 'BNF' });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /already/);
  assert.match(
    (await api('PUT', `/api/people/assets/prefixes/${bnv.id}`, { prefix: 'b' })).body.error,
    /too short/
  );
});

test('changing a prefix never rewrites a code already issued', async () => {
  const before = people.getAsset(add(bnv.id).id);
  assert.match(before.code, /^BNV-/);

  const changed = await api('PUT', `/api/people/assets/prefixes/${bnv.id}`, { prefix: 'SENA' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.prefix, 'SENA');

  assert.equal(people.getAsset(before.id).code, before.code, 'that sticker has not changed');
  assert.equal(add(bnv.id).code, 'SENA-ASSETS-000001', 'a new prefix is a new series');
});

test('a company with no prefix chosen still gets a code', () => {
  const quiet = db.createCompany({ name: 'SCALE VISORY' });
  const made = add(quiet.id);
  assert.match(made.code, /^SV-ASSETS-000001$|^SCA-ASSETS-000001$/, made.code);
});

test('the prefix list says what is chosen and what is merely derived', () => {
  const rows = people.assetPrefixes();
  const bnfRow = rows.find((r) => r.id === bnf.id);
  assert.equal(bnfRow.chosen, 'BNF');
  assert.match(bnfRow.next, /^BNF-ASSETS-\d{6}$/);
  const derived = rows.find((r) => r.name === 'SCALE VISORY');
  assert.equal(derived.chosen, '', 'blank means nobody chose one, and the initials are being used');
  assert.ok(derived.prefix, 'but a prefix is still shown');
});
