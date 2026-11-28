/**
 * Approving a write-off or a disposal (v2.48.0).
 *
 *   - A REQUEST CHANGES NOTHING: the asset stays on the register, in its
 *     holder's name, until approved;
 *   - only a Manager or an Admin decides, and never their own request;
 *   - an approver acting directly is recorded as an approval (direct);
 *   - approving a disposal brings it back from its holder, marks it disposed,
 *     and writes it off too - and it reads as disposed;
 *   - one open request per asset; a rejection needs a reason;
 *   - "disposed" can no longer be set as a plain state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { approvalEffect, decisionProblem, disposalAllowed, disposalFigures, validateDisposal } from '../../shared/assetDisposal.js';
import { assetStatus } from '../../shared/assetStatus.js';
import { digest as buildDigest } from '../../shared/digest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');

/* ------------------------------ the rules ------------------------------ */

test('what a request must say', () => {
  assert.deepEqual(validateDisposal({ action: 'write_off', reason: 'screen cracked' }), []);
  assert.match(validateDisposal({ action: 'write_off' }).join(), /say why/);
  assert.match(validateDisposal({ action: 'dispose', reason: 'old' }).join(), /how it went/);
  assert.match(validateDisposal({ action: 'dispose', reason: 'old', method: 'sold' }).join(), /how much came back/);
  assert.deepEqual(validateDisposal({ action: 'dispose', reason: 'old', method: 'sold', amount: 0 }), [], 'nothing back is 0, not blank');
  assert.deepEqual(validateDisposal({ action: 'dispose', reason: 'old', method: 'scrapped' }), [], 'scrapping asks no amount');
  assert.match(validateDisposal({ action: 'dispose', reason: 'x', method: 'sold', amount: -5 }).join(), /negative/);
  assert.match(validateDisposal({ action: 'write_off', reason: 'x', on_date: '2099-01-01' }, { today: '2026-11-28' }).join(), /future/);
});

test('what can be asked for', () => {
  assert.equal(disposalAllowed({ code: 'A1' }, 'write_off'), '');
  assert.match(disposalAllowed({ code: 'A1', written_off_on: '2026-01-01' }, 'write_off'), /already written off/);
  assert.equal(disposalAllowed({ code: 'A1', written_off_on: '2026-01-01' }, 'dispose'), '', 'written off can still be sold for scrap');
  assert.match(disposalAllowed({ code: 'A1', state: 'disposed' }, 'dispose'), /already been disposed/);
});

test('who decides', () => {
  const r = { number: 'WD-0001', status: 'pending' };
  assert.match(decisionProblem(r, 'approve', { canApprove: false }), /only a Manager or an Admin/);
  assert.match(decisionProblem(r, 'approve', { canApprove: true, isRaiser: true }), /nobody approves their own/);
  assert.equal(decisionProblem(r, 'approve', { canApprove: true }), '');
  assert.match(decisionProblem(r, 'reject', { canApprove: true }), /say why/);
  assert.equal(decisionProblem(r, 'cancel', { isRaiser: true, note: 'found it' }), '');
  assert.match(decisionProblem(r, 'cancel', { note: 'x' }), /only the person who asked/);
  assert.match(decisionProblem({ ...r, status: 'approved' }, 'approve', { canApprove: true }), /already approved/);
});

test('a disposal reads as disposed even though it is written off too', () => {
  assert.equal(assetStatus({ state: 'disposed', written_off_on: '2026-11-01' }), 'disposed');
  assert.equal(assetStatus({ written_off_on: '2026-11-01' }), 'written_off');
});

test('the confirmation says what approving does', () => {
  const said = approvalEffect(
    { action: 'dispose', method: 'sold', amount: 4000, party: 'Raju Scrap' },
    { code: 'BPL-LAP-014', label: 'ThinkPad', employee_id: 3, employee_name: 'Amit Shah' }
  );
  assert.match(said, /sold to Raju Scrap for 4,000/);
  assert.match(said, /written off too/);
  assert.match(said, /taken back from Amit Shah/);
});

test('figures count approved only, and sales money from sales only', () => {
  const f = disposalFigures([
    { status: 'pending', action: 'write_off' },
    { status: 'approved', action: 'write_off', purchase_cost: 50000 },
    { status: 'approved', action: 'dispose', method: 'sold', amount: 4000, purchase_cost: 30000 },
    { status: 'approved', action: 'dispose', method: 'scrapped', amount: 999 },
    { status: 'rejected', action: 'dispose', method: 'sold', amount: 9999 },
  ]);
  assert.deepEqual(f, { waiting: 1, written_off: 1, disposed: 2, received: 4000, book_value_off: 80000 });
});

test('the digest line is only for somebody who can decide, and opens the list', () => {
  const built = buildDigest({ asset_disposals: [{ number: 'WD-0002', asset_code: 'BPL-LAP-014' }] });
  const line = built.items.find((i) => /write-off/.test(i.text));
  assert.ok(line);
  assert.equal(line.go, 'assets');
  assert.equal(line.focus, 'disposals');
  assert.ok(!line.staff, 'the office’s own business, not a staff pop-up');
});

test('every wd- class the screens use has a rule', () => {
  const css = read('frontend/src/styles.css');
  const src = ['AssetDisposals', 'DisposalDialog', 'Assets', 'AssetHistory'].map((f) => read(`frontend/src/components/people/${f}.jsx`)).join('\n');
  const used = new Set([...src.matchAll(/\bwd-[a-z-]+/g)].map((m) => m[0]).filter((c) => c !== 'wd-action'));
  assert.ok(used.size >= 6);
  for (const cls of used) assert.ok(css.includes(`.${cls}`), `.${cls} has no rule`);
});

/* --------------------------- through the server --------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-disposals-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;
delete process.env.ALLOW_OPEN;

const { createServer } = await import('../src/server.js');
const users = await import('../src/users.js');
const db = await import('../src/db.js');
const server = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

const call = async (cookie, method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const signIn = async (username, password) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `could not sign in as ${username}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
};

users.createFirstAdmin({ name: 'Dinesh', username: 'dinesh', password: 'first-pass-123' });
const company = db.createCompany({ name: 'BOOKNFLY PVT LTD' });
const amit = db.createEmployee({ company_id: company.id, name: 'Amit Shah', monthly_salary: 26000 });
users.createUser({ name: 'Krishna', username: 'manager.login', role: 'manager', password: 'manager-pass-123' });
users.createUser({ name: 'Riya', username: 'hr.login', role: 'hr', password: 'hr-pass-123' });
users.createUser({ name: 'Nidhi', username: 'operator.login', role: 'operator', password: 'operator-pass-123' });
db.db.prepare(`UPDATE users SET must_change = 0`).run();

const admin = await signIn('dinesh', 'first-pass-123');
const manager = await signIn('manager.login', 'manager-pass-123');
const hr = await signIn('hr.login', 'hr-pass-123');
const operator = await signIn('operator.login', 'operator-pass-123');

const newAsset = async (label, cost = 40000) =>
  (await call(admin, 'POST', '/api/people/assets', { company_id: company.id, kind: 'Laptop', label, purchase_cost: cost })).body;
const assetNow = async (id) =>
  (await call(admin, 'GET', '/api/people/assets?written_off=true')).body.assets.find((a) => a.id === id);

test('HR asks: nothing changes until a Manager approves', async () => {
  const laptop = await newAsset('ThinkPad E14');
  await call(admin, 'POST', `/api/people/assets/${laptop.id}/issue`, { employee_id: amit.id });

  const asked = await call(hr, 'POST', `/api/people/assets/${laptop.id}/disposal`, { action: 'write_off', reason: 'board failed' });
  assert.equal(asked.status, 202, JSON.stringify(asked.body));
  assert.equal(asked.body.disposal.status, 'pending');
  let a = await assetNow(laptop.id);
  assert.equal(a.written_off_on, null, 'a request changes nothing');
  assert.equal(a.employee_id, amit.id, 'still in his name');
  assert.equal(a.disposal_pending, 'write_off');

  const twice = await call(hr, 'POST', `/api/people/assets/${laptop.id}/disposal`, { action: 'dispose', reason: 'x', method: 'scrapped' });
  assert.equal(twice.status, 400);
  assert.match(twice.body.error, /already has WD-0001 waiting/);

  const id = asked.body.disposal.id;
  const hrDecides = await call(hr, 'POST', `/api/people/assets/disposals/${id}/approve`, {});
  assert.equal(hrDecides.status, 403);

  const list = (await call(manager, 'GET', '/api/people/assets/disposals?status=pending')).body;
  assert.equal(list.can_approve, true);
  assert.equal(list.disposals.length, 1);
  const digest = (await call(manager, 'GET', '/api/people/digest')).body;
  assert.ok(JSON.stringify(digest).includes('WD-0001'), 'the manager is told');
  const hrDigest = (await call(hr, 'GET', '/api/people/digest')).body;
  assert.ok(!JSON.stringify(hrDigest).includes('WD-0001'), 'HR, who cannot decide, is not');

  const ok = await call(manager, 'POST', `/api/people/assets/disposals/${id}/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'approved');
  assert.equal(ok.body.decided_by, 'Krishna');
  a = await assetNow(laptop.id);
  assert.ok(a.written_off_on, 'approving is what writes it off');
  assert.equal(a.written_off_why, 'board failed');
  assert.equal(a.disposal_pending, null);
  const handover = (await call(admin, 'GET', `/api/people/assets/handovers?asset_id=${laptop.id}`)).body.handovers[0];
  assert.ok(handover.returned_on, 'taken back from Amit');

  const again = await call(manager, 'POST', `/api/people/assets/disposals/${id}/approve`, {});
  assert.equal(again.status, 400, 'decided once');
});

test('nobody approves their own; a rejection needs a reason and leaves the asset alone', async () => {
  const phone = await newAsset('Redmi 12', 12000);
  const asked = await call(manager, 'POST', `/api/people/assets/${phone.id}/disposal`, { action: 'write_off', reason: 'lost' });
  // A Manager asking is a Manager doing: done directly, recorded as approved by them.
  assert.equal(asked.status, 201);
  assert.equal(asked.body.disposal.direct, true);
  assert.equal(asked.body.disposal.decided_by, 'Krishna');
  assert.ok((await assetNow(phone.id)).written_off_on);

  const desk = await newAsset('Desk', 8000);
  const hrAsk = (await call(hr, 'POST', `/api/people/assets/${desk.id}/disposal`, { action: 'dispose', reason: 'broken leg', method: 'scrapped' })).body.disposal;
  const noReason = await call(manager, 'POST', `/api/people/assets/disposals/${hrAsk.id}/reject`, {});
  assert.equal(noReason.status, 400);
  const rejected = await call(manager, 'POST', `/api/people/assets/disposals/${hrAsk.id}/reject`, { note: 'get it repaired' });
  assert.equal(rejected.body.status, 'rejected');
  const d = await assetNow(desk.id);
  assert.equal(d.state, null);
  assert.equal(d.written_off_on, null);

  // The person who asked may cancel their own; somebody else without approve may not.
  const again = (await call(hr, 'POST', `/api/people/assets/${desk.id}/disposal`, { action: 'write_off', reason: 'really broken' })).body.disposal;
  const opCancel = await call(operator, 'POST', `/api/people/assets/disposals/${again.id}/cancel`, { note: 'no' });
  assert.equal(opCancel.status, 403);
  const hrCancel = await call(hr, 'POST', `/api/people/assets/disposals/${again.id}/cancel`, { note: 'repaired after all' });
  assert.equal(hrCancel.body.status, 'cancelled');
});

test('an approved sale: back from the holder, disposed, written off, and the money recorded', async () => {
  const pc = await newAsset('Dell Optiplex', 35000);
  await call(admin, 'POST', `/api/people/assets/${pc.id}/issue`, { employee_id: amit.id });
  const asked = (await call(hr, 'POST', `/api/people/assets/${pc.id}/disposal`, {
    action: 'dispose', reason: 'replaced', method: 'sold', party: 'Raju Traders', amount: 4000,
  })).body.disposal;
  await call(admin, 'POST', `/api/people/assets/disposals/${asked.id}/approve`, {});
  const a = await assetNow(pc.id);
  assert.equal(a.state, 'disposed');
  assert.ok(a.written_off_on, 'off the books too');
  assert.match(a.state_note, /Sold to Raju Traders for 4000/);
  assert.equal(assetStatus(a), 'disposed');

  const figures = (await call(admin, 'GET', '/api/people/assets/disposals')).body.figures;
  assert.equal(figures.received, 4000);
});

test('the old routes: write-off asks for anybody but an approver; disposed is not a plain state', async () => {
  const tab = await newAsset('Galaxy Tab', 20000);
  const hrOld = await call(hr, 'POST', `/api/people/assets/${tab.id}/write-off`, { why: 'cracked' });
  assert.equal(hrOld.status, 202);
  assert.equal(hrOld.body.pending, true);
  assert.equal(hrOld.body.written_off_on, null);

  const tab2 = await newAsset('Galaxy Tab 2', 20000);
  const adminOld = await call(admin, 'POST', `/api/people/assets/${tab2.id}/write-off`, { why: 'cracked' });
  assert.equal(adminOld.status, 200);
  assert.ok(adminOld.body.written_off_on);

  const state = await call(admin, 'POST', `/api/people/assets/${tab2.id}/state`, { state: 'disposed' });
  assert.equal(state.status, 400);
  assert.match(state.body.error, /goes through approval/);

  // An operator may ASK (that takes nothing away) but not use the old route.
  const tab3 = await newAsset('Galaxy Tab 3', 20000);
  assert.equal((await call(operator, 'POST', `/api/people/assets/${tab3.id}/write-off`, { why: 'x' })).status, 403);
  assert.equal((await call(operator, 'POST', `/api/people/assets/${tab3.id}/disposal`, { action: 'write_off', reason: 'x' })).status, 202);
});
