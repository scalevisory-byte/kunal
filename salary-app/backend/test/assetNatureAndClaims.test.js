/**
 * Fixed or movable, and what staff say they hold.
 *
 * Dinesh: "Fixed / Movable assets different group", "asset add karne ka
 * option employee wise" and "employee ke paas kitni asset hai wo add kar sake".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guessNature, matchesNature, natureOf, natureTally, tidyNature } from '../../shared/assetNature.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-nature-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;
const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const session = () => {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  };
  return call;
};

test('the kind gives a starting answer, what somebody said always wins, and an unknown kind gets none', () => {
  assert.equal(guessNature('Laptop'), 'movable');
  assert.equal(guessNature('Desktop'), 'fixed', 'both are "Computer" - which is why this is not the group');
  assert.equal(guessNature('Furniture'), 'fixed');
  assert.equal(guessNature('SIM card'), 'movable');
  assert.equal(guessNature('Other'), '', 'not said is a pile somebody can clear; a wrong guess is not');
  assert.deepEqual(natureOf({ kind: 'Laptop' }), { nature: 'movable', guessed: true });
  assert.deepEqual(natureOf({ kind: 'Laptop', nature: 'fixed' }), { nature: 'fixed', guessed: false });
  assert.deepEqual(natureOf({ kind: 'Other' }), { nature: '', guessed: false });
  assert.equal(tidyNature(''), null);
  assert.equal(tidyNature(' Fixed '), 'fixed');
  assert.throws(() => tidyNature('semi'), /fixed or movable/);

  const list = [{ kind: 'Laptop' }, { kind: 'Furniture' }, { kind: 'Other' }, { kind: 'Other', nature: 'movable' }];
  const tally = natureTally(list);
  assert.deepEqual(tally, { fixed: 1, movable: 2, unsaid: 1, guessed: 2 });
  assert.equal(tally.fixed + tally.movable + tally.unsaid, list.length, 'every asset is under exactly one chip');
  assert.equal(list.filter((a) => matchesNature(a, 'unsaid')).length, 1);
  assert.equal(list.filter((a) => matchesNature(a, '')).length, 4);
});

test('through the server: stored, validated, set in bulk, and an asset added FOR somebody is a handover', async () => {
  const office = session();
  await office('POST', '/api/auth/setup', { username: 'dinesh', password: 'a-long-password-1', name: 'Dinesh' });
  const company = (await office('POST', '/api/companies', { name: 'BNF' })).body;
  const riya = (await office('POST', '/api/employees', { name: 'Riya Pal', company_id: company.id, monthly_salary: 26000 })).body;
  const amit = (await office('POST', '/api/employees', { name: 'Amit Shah', company_id: company.id, monthly_salary: 26000 })).body;

  const desk = (await office('POST', '/api/people/assets', { label: 'Corner desk', kind: 'Other', company_id: company.id })).body;
  assert.equal(desk.nature, null, 'nobody said');
  assert.equal((await office('PATCH', `/api/people/assets/${desk.id}`, { nature: 'semi' })).status, 400);
  assert.equal((await office('PATCH', `/api/people/assets/${desk.id}`, { nature: 'fixed' })).body.nature, 'fixed');

  const chair = (await office('POST', '/api/people/assets', { label: 'Chair', kind: 'Other', company_id: company.id })).body;
  const bulk = await office('POST', '/api/people/assets/nature', { ids: [desk.id, chair.id], nature: 'movable' });
  assert.deepEqual(bulk.body, { changed: 2, nature: 'movable' });
  assert.equal((await office('POST', '/api/people/assets/nature', { ids: [], nature: 'fixed' })).status, 400);
  // Handing the answer back to the kind.
  await office('POST', '/api/people/assets/nature', { ids: [chair.id], nature: '' });
  const all = (await office('GET', '/api/people/assets')).body.assets;
  assert.equal(all.find((a) => a.id === chair.id).nature, null);

  // Employee-wise: added in their name is out with them, and on the log.
  const laptop = (
    await office('POST', '/api/people/assets', {
      label: 'Dell Latitude', kind: 'Laptop', identifier: 'SN-1', company_id: company.id, employee_id: riya.id, issued_on: '2026-11-27',
    })
  ).body;
  assert.equal(laptop.employee_id, riya.id);
  const history = (await office('GET', `/api/people/assets/${laptop.id}/history`)).body;
  assert.ok(history.events.some((e) => /Riya Pal/.test(JSON.stringify(e))), 'the handover is on the asset’s own history');

  /* ---- what staff say they hold ---- */
  const made = (await office('POST', '/api/auth/staff', { employee_ids: [riya.id, amit.id] })).body.made;
  const login = async (id) => {
    const cred = made.find((m) => m.employee_id === id);
    const s = session();
    await s('POST', '/api/auth/login', { username: cred.username, password: cred.password });
    await s('POST', '/api/auth/password', { password: 'my-own-password-9' });
    return s;
  };
  const asRiya = await login(riya.id);
  const asAmit = await login(amit.id);

  const mine = (await asRiya('GET', '/api/me/assets')).body;
  assert.deepEqual(mine.assets.map((a) => a.code), [laptop.code]);
  assert.ok(!('purchase_cost' in mine.assets[0]) && !('vendor' in mine.assets[0]), 'what it cost is the office’s');

  // Already on the register in her name: nothing to tell.
  assert.match((await asRiya('POST', '/api/me/assets/declare', { label: 'my laptop', identifier: 'sn-1' })).body.error, /already on the register in your name/);
  assert.equal((await asRiya('POST', '/api/me/assets/declare', { label: '  ' })).status, 400);

  const sim = await asRiya('POST', '/api/me/assets/declare', { kind: 'SIM card', label: 'Jio SIM', identifier: '8991', note: 'given in June', employee_id: amit.id });
  assert.equal(sim.status, 201);
  assert.equal(sim.body.status, 'pending');
  assert.match((await asRiya('POST', '/api/me/assets/declare', { kind: 'SIM card', label: 'Jio sim again', identifier: '8991' })).body.error, /already told the office/);

  // THE RULE: telling the office puts nothing on the register.
  const after = (await office('GET', '/api/people/assets')).body.assets;
  assert.equal(after.length, 3, 'still the three the office added');
  const waiting = (await office('GET', '/api/people/assets/claims?status=pending')).body.claims;
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].employee_name, 'Riya Pal', 'filed against the LOGIN, whoever the body named');

  // A staff login cannot decide one - not even their own.
  assert.equal((await asRiya('POST', `/api/people/assets/claims/${waiting[0].id}/decide`, { action: 'add' })).status, 403);
  // Nor take back somebody else's.
  assert.equal((await asAmit('DELETE', `/api/me/assets/declared/${waiting[0].id}`)).status, 404);

  // Add it: now it is on the register, in her name.
  const added = await office('POST', `/api/people/assets/claims/${waiting[0].id}/decide`, { action: 'add' });
  assert.equal(added.body.status, 'added');
  const held = (await asRiya('GET', '/api/me/assets')).body;
  assert.equal(held.assets.length, 2);
  assert.equal(held.declared[0].status, 'added');
  // Decided once.
  assert.equal((await office('POST', `/api/people/assets/claims/${waiting[0].id}/decide`, { action: 'dismiss', note: 'x' })).status, 400);
  // And she cannot take back one that has been dealt with.
  assert.equal((await asRiya('DELETE', `/api/me/assets/declared/${waiting[0].id}`)).status, 400);

  // Amit says he has the laptop Riya holds: refused BY NAME, never passed across.
  const claim = (await asAmit('POST', '/api/me/assets/declare', { kind: 'Laptop', label: 'Dell laptop' })).body;
  const clash = await office('POST', `/api/people/assets/claims/${claim.id}/decide`, { action: 'match', asset_id: laptop.id });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /Riya Pal/);
  assert.equal((await office('GET', '/api/people/assets')).body.assets.find((a) => a.id === laptop.id).employee_id, riya.id);
  // Tied to the chair, which is in the office: it goes out to him.
  const tied = await office('POST', `/api/people/assets/claims/${claim.id}/decide`, { action: 'match', asset_id: chair.id });
  assert.equal(tied.body.status, 'matched');
  assert.equal((await office('GET', '/api/people/assets')).body.assets.find((a) => a.id === chair.id).employee_id, amit.id);

  // Turning one down needs the reason they will read.
  const third = (await asAmit('POST', '/api/me/assets/declare', { label: 'My own charger' })).body;
  assert.equal((await office('POST', `/api/people/assets/claims/${third.id}/decide`, { action: 'dismiss' })).status, 400);
  const no = await office('POST', `/api/people/assets/claims/${third.id}/decide`, { action: 'dismiss', note: 'That one is yours, not the company’s' });
  assert.equal(no.body.status, 'dismissed');
  assert.match((await asAmit('GET', '/api/me/assets')).body.declared.find((c) => c.id === third.id).decision_note, /yours/);

  // A serial already on the register is that asset, not a second one.
  const fourth = (await asAmit('POST', '/api/me/assets/declare', { label: 'a SIM', identifier: '8991' })).body;
  assert.match((await office('POST', `/api/people/assets/claims/${fourth.id}/decide`, { action: 'add' })).body.error, /tie this to that asset/);
});

test('the screens: chips, the row’s own box, employee-wise add, and a page on the portal', () => {
  const read = (f) => fs.readFileSync(new URL(`../../frontend/src/${f}`, import.meta.url), 'utf8');
  const reg = read('components/people/Assets.jsx');
  assert.match(reg, /matchesNature\(a, nature\)/);
  assert.match(reg, /<NaturePick asset=\{asset\}/);
  assert.match(reg, /Add an asset for /);
  assert.match(reg, /<AssetClaims /);
  const page = read('components/MyPage.jsx');
  assert.match(page, /\['assets', 'My assets'/);
  assert.match(read('components/my/MyAssets.jsx'), /not added by this/);
  const css = read('styles.css');
  for (const cls of ['nature-pick', 'nature-bulk', 'asset-claims', 'claim-decide']) assert.ok(css.includes(cls), `${cls} has a rule`);
});
