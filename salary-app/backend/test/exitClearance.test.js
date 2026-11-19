/**
 * EXIT CLEARANCE.
 *
 * What these pin:
 *
 *  - **What the app can work out, it works out.** Assets still out, a loan
 *    still owed, a claim unpaid, a login still live — none of them can be
 *    ticked off by hand, so "assets: cleared" beside a register listing three
 *    things still out cannot happen.
 *  - **Not looked at is not refused.** An untouched step is `pending`.
 *  - **It is a checklist, not a gate**: nothing here blocks the full and
 *    final, and nothing it says changes a rupee.
 *  - A step handed back to "not looked at" keeps no date.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLEARANCE_STEPS, exitClearance } from '../../shared/exitClearance.js';

/* ---------------- the engine ---------------- */

test('an untouched checklist is pending, never refused — and nothing is cleared by default', () => {
  const list = exitClearance({});
  for (const item of list.signed) {
    assert.equal(item.state, 'pending', item.key);
    assert.equal(item.open, true);
  }
  assert.equal(list.outstanding, CLEARANCE_STEPS.length, 'the computed half is clear when there is nothing to clear');
  assert.equal(list.ready, false);
});

test('with nothing outstanding anywhere, the computed half clears itself', () => {
  const list = exitClearance({});
  const assets = list.checked.find((i) => i.key === 'assets');
  assert.equal(assets.state, 'given');
  assert.equal(assets.open, false);
  assert.equal(list.checked.find((i) => i.key === 'login').state, 'na', 'most people never had a login');
});

test('the computed lines cannot be ticked off — they say what the registers say', () => {
  const list = exitClearance({
    assets_out: [
      { code: 'BPL-ASSETS-000001', label: 'Dell 3420', purchase_cost: 47500 },
      { code: 'BPL-ASSETS-000002', label: 'Phone', purchase_cost: 13999 },
    ],
    loans: [{ id: 1, amount: 20000, repaid: 12000, outstanding: 8000 }],
    claims: [{ id: 1, status: 'approved', amount: 1200 }],
    login: { id: 3, username: 'amit.shah', active: 1 },
    // ...and every person HAS signed. The computed half must still be open.
    signed: CLEARANCE_STEPS.map(([key]) => ({ step: key, state: 'given', by_whom: 'Dinesh', cleared_on: '2026-11-19' })),
  });

  assert.equal(list.signed.every((i) => !i.open), true, 'the people have all signed');
  assert.equal(list.ready, false, 'and the checklist is still not clear, because the registers are not');

  const assets = list.checked.find((i) => i.key === 'assets');
  assert.equal(assets.state, 'blocked');
  assert.match(assets.detail, /2 still with them/);
  assert.match(assets.detail, /61,499/, 'valued at cost');
  assert.match(assets.note, /never deducted/);

  assert.match(list.checked.find((i) => i.key === 'loan').detail, /8,000 outstanding/);
  assert.match(list.checked.find((i) => i.key === 'claims').detail, /1 raised and not paid/);
  assert.match(list.checked.find((i) => i.key === 'login').detail, /still works/);
  assert.deepEqual(list.blocking, ['Company property back', 'Loans and advances', 'Expense claims', 'Staff login']);
});

test('a login that was switched off is cleared, and no login at all is not an item', () => {
  assert.equal(
    exitClearance({ login: { username: 'amit.shah', active: 0 } }).checked.find((i) => i.key === 'login').state,
    'given'
  );
  assert.equal(exitClearance({ login: null }).checked.find((i) => i.key === 'login').open, false);
});

test('"does not apply" is a decision, so it counts as dealt with', () => {
  const list = exitClearance({ signed: [{ step: 'it', state: 'na' }] });
  assert.equal(list.signed.find((i) => i.key === 'it').open, false);
  const blocked = exitClearance({ signed: [{ step: 'it', state: 'blocked' }] });
  assert.equal(blocked.signed.find((i) => i.key === 'it').open, true, 'something pending is still open');
});

/* ---------------- over HTTP, and against the money ---------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-clearance-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let amit = 0;

test('set up: somebody leaving, holding a laptop', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  const made = await api('POST', '/api/employees', {
    name: 'Amit Shah', company_id: company.body.id, monthly_salary: 26000, joined_on: '2024-01-05',
  });
  amit = made.body.id;
  const asset = await api('POST', '/api/people/assets', {
    company_id: company.body.id, kind: 'Laptop', label: 'Dell 3420', purchase_cost: 47500,
  });
  await api('POST', `/api/people/assets/${asset.body.id}/issue`, { employee_id: amit, issued_on: '2024-02-01' });
  await api('PUT', `/api/people/exits/${amit}`, {
    type: 'resigned', resigned_on: '2026-11-01', last_working_day: '2026-11-30',
  });
});

test('the checklist rides along with the exit, and names what is open', async () => {
  const got = await api('GET', `/api/people/exits/${amit}`);
  assert.equal(got.status, 200);
  const list = got.body.clearance;
  assert.ok(list, 'the exit page would have had to ask twice');
  assert.equal(list.ready, false);
  assert.ok(list.blocking.includes('Company property back'));
  assert.equal(list.signed.every((i) => i.state === 'pending'), true);
});

test('signing a step records who and when, and handing it back clears the date', async () => {
  const given = await api('PUT', `/api/people/exits/${amit}/clearance/it`, {
    state: 'given', by: 'Krishna', on: '2026-11-18', note: 'email closed, laptop wiped',
  });
  assert.equal(given.status, 200);
  const it = given.body.clearance.signed.find((i) => i.key === 'it');
  assert.equal(it.state, 'given');
  assert.equal(it.by_whom, 'Krishna');
  assert.equal(it.on, '2026-11-18');
  assert.equal(it.open, false);

  const back = await api('PUT', `/api/people/exits/${amit}/clearance/it`, { state: 'pending' });
  const again = back.body.clearance.signed.find((i) => i.key === 'it');
  assert.equal(again.state, 'pending');
  assert.equal(again.on, '', 'a step nobody has looked at has no date to carry');
  assert.equal(again.by_whom, '');
});

test('an unknown step is refused rather than quietly stored', async () => {
  const no = await api('PUT', `/api/people/exits/${amit}/clearance/canteen`, { state: 'given' });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /unknown clearance step/);
});

test('taking the laptop back clears its line, with nobody ticking anything', async () => {
  const before = await api('GET', `/api/people/exits/${amit}/clearance`);
  assert.equal(before.body.clearance.checked.find((i) => i.key === 'assets').state, 'blocked');

  const out = await api('GET', `/api/people/assets?out=true`);
  const laptop = out.body.assets.find((a) => a.employee_id === amit);
  await api('POST', '/api/people/assets/return-many', { asset_ids: [laptop.id], returned_on: '2026-11-30' });

  const after = await api('GET', `/api/people/exits/${amit}/clearance`);
  assert.equal(after.body.clearance.checked.find((i) => i.key === 'assets').state, 'given');
});

test('IT IS NOT A GATE: the full and final can still be settled, and nothing it says moves a rupee', async () => {
  const before = await api('GET', `/api/people/exits/${amit}`);
  const net = before.body.settlement.net;
  assert.ok(before.body.clearance.outstanding > 0, 'steps are still unsigned');

  const paid = await api('POST', `/api/people/exits/${amit}/settle`, {});
  assert.equal(paid.status, 200, 'an unfinished checklist refused the payment');

  const after = await api('GET', `/api/people/exits/${amit}`);
  assert.equal(after.body.settlement.net, net, 'the clearance changed the settlement figure');
});
