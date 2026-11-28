/**
 * Licence paperwork and the licence import (v2.47.0).
 *
 *   - NO KEY IS READ FROM A SHEET: a key column is noticed, reported as
 *     ignored, and never reaches a record or the preview;
 *   - a row that looks like a record already here (same name and company, a
 *     different end date) is HELD BACK and named, added only if asked;
 *   - a row repeated inside the sheet is named against the row it repeats;
 *   - nothing is written by a look;
 *   - a document goes out as an expiring signed link, never a path, and a
 *     licence link cannot open an asset document or the other way round;
 *   - a record with papers attached is not deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LICENSE_TEMPLATE_HEADINGS, detectLicenseLayout, licenseKindOf, planLicenseImport } from '../../shared/licenseImport.js';
import { cleanDocKind, docKindsFor } from '../../shared/renewals.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');

/* ------------------------------ the planner ------------------------------ */

const HEAD = ['Name', 'Type', 'Company', 'Expiry date', 'Cost', 'Licence key', 'Purchase date'];

test('every heading on the blank template is a column the import reads', () => {
  const { headerRow, columns } = detectLicenseLayout([LICENSE_TEMPLATE_HEADINGS]);
  assert.equal(headerRow, 0);
  assert.equal(Object.keys(columns).length, LICENSE_TEMPLATE_HEADINGS.length);
  assert.equal(columns.license_key, undefined, 'the template carries no key column');
});

test('a key column is noticed, reported, and never reaches a record', () => {
  const plan = planLicenseImport({
    rows: [HEAD, ['Tally Prime', '', '', '2027-03-31', '54000', 'SECRET-KEY-123', '2026-04-01']],
  });
  assert.equal(plan.create.length, 1);
  assert.match(plan.notes.join(' '), /key column was found and IGNORED/);
  assert.ok(!JSON.stringify(plan).includes('SECRET-KEY-123'), 'the key appears nowhere in the plan');
  assert.ok(!plan.columns.includes('license_key'));
});

test('kinds are read off the words, and the register the sheet is for wins', () => {
  assert.equal(licenseKindOf('', 'Office rent - Alkapuri', ''), 'Rent agreement');
  assert.equal(licenseKindOf('', 'Car insurance GJ06', ''), 'Insurance policy');
  assert.equal(licenseKindOf('', 'Tally Prime Gold', ''), 'Tally / GST utility');
  assert.equal(licenseKindOf('', 'Something odd', ''), 'Other');
  assert.equal(licenseKindOf('', 'Tally Prime Gold', 'insurance'), 'Insurance policy');
});

test('rows it cannot place are named with the reason, never dropped', () => {
  const plan = planLicenseImport({
    rows: [
      HEAD,
      ['', 'Antivirus', '', '2027-01-01', '', '', ''],
      ['Quick Heal', '', '', '2025-01-01', '', '', '2026-01-01'],
      ['Domain', '', '', '2027-01-01', '-500', '', ''],
      ['Tally', '', '', '2027-03-31', '', '', ''],
      ['Tally', '', '', '2027-03-31', '', '', ''],
    ],
  });
  const why = plan.skipped.map((s) => `${s.line}:${s.why}`);
  assert.deepEqual(why, [
    '2:no name on this row',
    '3:it expires (2025-01-01) before it was bought (2026-01-01)',
    '4:a negative cost',
    '6:the same as row 5',
  ]);
  assert.equal(plan.create.length, 1);
});

test('the same name and company with a different end date is held back, not added', () => {
  const existing = [{ id: 7, name: 'Tally Prime Gold', company_id: 1, expires_on: '2026-12-03' }];
  const companies = [{ id: 1, name: 'BOOKNFLY' }];
  const plan = planLicenseImport({
    rows: [
      HEAD,
      ['Tally Prime Gold', '', 'BOOKNFLY', '2027-03-31', '', '', ''],
      ['Tally Prime Gold', '', 'BOOKNFLY', '2026-12-03', '', '', ''],
      ['Tally Prime Gold', '', 'BOOKNFLY', '2027-03-31', '', '', ''],
      ['Tally Prime Gold', '', '', '2027-03-31', '', '', ''],
    ],
    existing,
    companies,
  });
  assert.equal(plan.similar.length, 1, 'a term later is a renewal of the record here');
  assert.equal(plan.similar[0].existing_id, 7);
  assert.deepEqual(plan.skipped.map((s) => s.why), ['already on the register', 'the same as row 2']);
  assert.equal(plan.create.length, 1, 'no company is a different record');
});

test('an unknown company or person is said once and comes in blank', () => {
  const plan = planLicenseImport({
    rows: [['Name', 'Company', 'Responsible'], ['A', 'Nowhere Ltd', 'Somebody'], ['B', 'Nowhere Ltd', 'Somebody']],
  });
  assert.equal(plan.notes.length, 2);
  assert.equal(plan.create[0].company_id, null);
  assert.equal(plan.create[0].responsible_id, null);
});

test('document kinds follow the record: no rent receipt on a software licence', () => {
  const software = docKindsFor('software').map(([k]) => k);
  const rent = docKindsFor('rent').map(([k]) => k);
  const insurance = docKindsFor('insurance').map(([k]) => k);
  assert.ok(software.includes('invoice') && !software.includes('police'));
  assert.ok(rent.includes('agreement') && rent.includes('police'));
  assert.ok(insurance.includes('policy') && insurance.includes('claim'));
  assert.equal(cleanDocKind('police', 'software'), 'other');
});

test('every lic- and rn- class the screens use has a rule', () => {
  const css = read('frontend/src/styles.css');
  const src = read('frontend/src/components/people/Licenses.jsx') + read('frontend/src/components/people/Renewals.jsx');
  const used = new Set();
  for (const m of src.matchAll(/className=["{`']([^"}`']+)/g)) {
    for (const c of m[1].split(/\s+/)) if (/^(lic-doc|rn-import|rn-bulk)/.test(c)) used.add(c);
  }
  assert.ok(used.size >= 4, [...used].join(','));
  for (const c of used) assert.ok(css.includes(`.${c}`), `no rule for .${c}`);
});

/* --------------------------- through the server --------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-docs-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;
const { createServer } = await import('../src/server.js');
const server = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

let cookie = '';
const call = async (method, url, body) => {
  const isForm = body instanceof FormData;
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
  const text = await res.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* a file */ }
  return { status: res.status, body: parsed, headers: res.headers };
};

const csvForm = (text, extra = {}) => {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/csv' }), 'licences.csv');
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
};

test('through the API: look, write, hold back the near-twin, attach a paper, refuse a delete', async () => {
  await call('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' });
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const tally = await call('POST', '/api/people/licenses', {
    name: 'Tally Prime Gold', kind: 'Tally / GST utility', company_id: company.id, expires_on: '2026-12-03', cost: 54000,
  });
  assert.equal(tally.status, 201, JSON.stringify(tally.body));

  const template = await call('GET', '/api/people/licenses/import-template.csv');
  assert.equal(template.status, 200);
  assert.match(template.headers.get('content-disposition'), /licence-import-template\.csv/);

  const sheet = [
    'Name,Company,Expiry date,Cost,Licence key',
    'Tally Prime Gold,BOOKNFLY,2027-03-31,60000,SECRET-KEY-9',
    'Microsoft 365 Business,BOOKNFLY,2027-06-30,86400,',
  ].join('\n');

  const look = await call('POST', '/api/people/licenses/import', csvForm(sheet));
  assert.equal(look.status, 200, JSON.stringify(look.body));
  assert.equal(look.body.wrote, 0);
  assert.equal(look.body.create.length, 1);
  assert.equal(look.body.similar.length, 1);
  assert.ok(!JSON.stringify(look.body).includes('SECRET-KEY-9'));
  assert.equal((await call('GET', '/api/people/licenses')).body.licenses.length, 1, 'a look writes nothing');

  const wrote = await call('POST', '/api/people/licenses/import', csvForm(sheet, { write: 'true' }));
  assert.equal(wrote.body.wrote, 1, 'the near-twin stays out unless asked');
  const all = (await call('GET', '/api/people/licenses')).body.licenses;
  assert.equal(all.length, 2);
  assert.ok(all.every((l) => !l.license_key), 'no key arrived from the sheet');

  const again = await call('POST', '/api/people/licenses/import', csvForm(sheet, { write: 'true', include_similar: 'true' }));
  assert.equal(again.body.wrote, 1, 'asked for, the near-twin goes in; the one already added is named');
  assert.equal(again.body.skipped[0].why, 'already on the register');

  // A paper on the record.
  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'invoice.pdf');
  form.append('kind', 'invoice');
  form.append('valid_until', '2027-03-31');
  const up = await call('POST', `/api/people/licenses/${tally.body.id}/documents`, form);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const doc = up.body.document;
  assert.equal(doc.file_path, undefined, 'never the path');
  assert.equal(doc.kind, 'invoice');

  const listed = (await call('GET', `/api/people/licenses/${tally.body.id}/documents`)).body;
  assert.equal(listed.documents.length, 1);
  assert.ok(listed.kinds.some(([k]) => k === 'invoice'));
  assert.equal((await call('GET', '/api/people/licenses')).body.licenses.find((l) => l.id === tally.body.id).documents, 1);

  const file = await fetch(`${base}${doc.link.url}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /invoice\.pdf/);
  const forged = await fetch(`${base}${doc.link.url.replace(/sig=[^&]+/, 'sig=00')}`);
  assert.equal(forged.status, 403);
  const elsewhere = await fetch(`${base}${doc.link.url.replace('/files/license-doc/', '/files/asset-doc/')}`);
  assert.notEqual(elsewhere.status, 200, 'a licence link does not open an asset document');

  const refused = await call('DELETE', `/api/people/licenses/${tally.body.id}`);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /document/i);

  const removed = await call('DELETE', `/api/people/licenses/${tally.body.id}/documents/${doc.id}`);
  assert.equal(removed.status, 204);
  assert.equal((await call('DELETE', `/api/people/licenses/${tally.body.id}`)).status, 200);
});
