/**
 * v2.35.0, assets: the plain description sticker, the label sheet that had
 * stopped working, and rent agreements / insurance on the renewal register.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { labelSheet } from '../../shared/assetLabels.js';
import { LICENSE_KINDS, fieldWords, isAgreement, renewalNoun } from '../../shared/licenses.js';
import { digest } from '../../shared/digest.js';

const laptop = { code: 'BPL-LAP-014', kind: 'Laptop', label: 'Dell <Latitude>', identifier: 'SN-9', company_name: 'BOOKNFLY' };

test('a sheet of labels is made at all - it threw "assetLink is not defined" from the day it moved into shared/', () => {
  const qr = { create: () => ({ modules: { size: 1, get: () => true } }) };
  assert.doesNotThrow(() => labelSheet([laptop], { qr, linkFor: (a) => `https://hr.example/a/${a.code}` }));
  const html = labelSheet([laptop], { qr, linkFor: (a) => `https://hr.example/a/${a.code}` });
  assert.match(html, /https:\/\/hr\.example\/a/);
  // Offline there is no link to name, and the sentence does not invent one.
  const offline = labelSheet([laptop], { qr, linkFor: (a) => a.code });
  assert.ok(!/opens that asset/.test(offline));
});

test('the description sticker carries the code and what it is, and no QR', () => {
  const html = labelSheet([laptop], { as: 'patti' });
  assert.match(html, /class="patti"/);
  assert.match(html, /BPL-LAP-014/);
  assert.match(html, /S\/N SN-9 · BOOKNFLY/);
  assert.ok(!/<svg/.test(html), 'no code to scan on a patti');
  assert.ok(!html.includes('<Latitude>'), 'what is typed is escaped');
});

test('rent agreements and insurance are kinds on the register, in their own words', () => {
  for (const k of ['Rent agreement', 'Insurance policy']) {
    assert.ok(LICENSE_KINDS.includes(k));
    assert.equal(isAgreement(k), true);
    assert.equal(fieldWords(k).secret, false, 'no licence key or seats asked for');
  }
  assert.equal(fieldWords('Rent agreement').publisher, 'Landlord');
  assert.equal(fieldWords('Insurance policy').invoice, 'Policy number');
  assert.equal(fieldWords('Antivirus').secret, true);
  assert.equal(renewalNoun('Antivirus'), 'software licence');
});

test('the dashboard reminder names what it is, a line per kind', () => {
  const built = digest({
    licenses: [
      { name: 'GJ-06 car', kind: 'Insurance policy', status: 'expiring', expires_on: '2026-12-10' },
      { name: 'Office fire', kind: 'Insurance policy', status: 'expiring', expires_on: '2026-12-15' },
      { name: 'Alkapuri office', kind: 'Rent agreement', status: 'expired' },
      { name: 'Tally', kind: 'Accounting software', status: 'expiring', expires_on: '2026-12-01' },
    ],
    today: '2026-11-27',
  });
  const text = built.items.map((i) => i.text).join('\n');
  assert.match(text, /2 insurance policies to renew: GJ-06 car \(2026-12-10\), Office fire/);
  assert.match(text, /1 rent agreement expired: Alkapuri office/);
  assert.match(text, /1 software licence to renew: Tally/);
});
