/**
 * v2.39.0, the Assets redesign (part one).
 *
 *   - purchase requests: one line of steps, approval by the approve ability
 *     and never by the person who asked, a reason to reject or cancel, every
 *     step on the request's own history, and nothing registered or bought by
 *     an approval;
 *   - warranty buckets: every asset in exactly one, "no date" its own pile;
 *   - the nine sections keep every screen that was there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stepProblem, stepsFor, validatePurchaseRequest, requestNumber } from '../../shared/purchaseRequest.js';
import { warrantyBucket, warrantySummary, alertStep } from '../../shared/warrantyBuckets.js';

test('a request walks one line, and approving is somebody else’s', () => {
  const r = { status: 'submitted' };
  assert.equal(stepProblem(r, 'approve', { canApprove: false }), 'only a Manager or an Admin can approve or reject a purchase request');
  assert.equal(stepProblem(r, 'approve', { canApprove: true, isRequester: true }), 'nobody approves their own purchase request');
  assert.equal(stepProblem(r, 'approve', { canApprove: true }), null);
  assert.match(stepProblem(r, 'reject', { canApprove: true }), /needs a reason/);
  assert.match(stepProblem({ status: 'draft' }, 'order'), /cannot be moved/);
  assert.match(stepProblem({ status: 'completed' }, 'cancel', { note: 'x' }), /cannot be moved/);
  assert.deepEqual(stepsFor({ status: 'submitted' }, { canApprove: true, isRequester: true }).map((s) => s.key), ['cancel']);
});

test('a request says what, how many and why', () => {
  assert.equal(validatePurchaseRequest({ kind: 'Laptop', quantity: 1, purpose: 'new joiner' }).ok, true);
  const bad = validatePurchaseRequest({ kind: '', quantity: 0, purpose: '', estimated_cost: 'lots' });
  assert.equal(bad.problems.length, 4);
  assert.equal(requestNumber(7), 'PR-0007');
});

test('every asset lands in exactly one warranty bucket, and no date is its own', () => {
  const today = '2026-11-28';
  assert.equal(warrantyBucket('', today), 'none');
  assert.equal(warrantyBucket('2026-11-27', today), 'expired');
  assert.equal(warrantyBucket('2026-11-28', today), 'd30');
  assert.equal(warrantyBucket('2027-01-10', today), 'd60');
  assert.equal(warrantyBucket('2027-02-20', today), 'd90');
  assert.equal(warrantyBucket('2028-01-01', today), 'active');
  const sum = warrantySummary(
    [{ warranty_until: '' }, { warranty_until: '2026-12-01', amc_until: '2026-10-01' }, { warranty_until: '2030-01-01' }],
    today
  );
  assert.equal(Object.values(sum.counts).reduce((a, b) => a + b, 0), 3);
  assert.equal(sum.amc, 1);
  assert.equal(sum.amcExpired, 1);
  assert.equal(alertStep('2026-11-28', today), 'today');
  assert.equal(alertStep('2026-12-03', today), '7');
  assert.equal(alertStep('2027-06-01', today), null);
});

test('the nine sections keep every screen that was there', () => {
  const src = fs.readFileSync(new URL('../../frontend/src/components/people/Assets.jsx', import.meta.url), 'utf8');
  for (const [key, label] of [
    ['dashboard', 'Overview'], ['register', 'Asset Register'], ['slips', 'Assignments'], ['stock', 'Stock Audit'],
    ['maintenance', 'Maintenance & Repairs'], ['warranty', 'Warranty & AMC'], ['purchases', 'Purchase Requests'],
    ['statement', 'Reports'], ['masters', 'Settings'],
  ]) {
    assert.ok(src.includes(`['${key}', '${label}']`), `${label} is missing`);
  }
  // Paging and sorting work on what is filtered, never on a second filter.
  assert.match(src, /\[\.\.\.shown\]\.sort/);
  assert.match(src, /paged\.map\(\(asset, at\)/);
});

/* ------------------------------- the API ------------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-redesign-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
/* Listening is awaited: a request sent before the socket is bound is
   refused, which is how this file failed one run in three. */
const server = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function session() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      // (debug)
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch((e) => { throw new Error(`${method} ${url}: ${e.cause?.message || e.message}`); });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

test('through the API: raise, refuse self-approval, approve, order, receive, complete', async () => {
  const admin = session();
  const hr = session();
  await admin('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' });
  const made = await admin('POST', '/api/auth/users', { username: 'hr.one', name: 'HR One', role: 'hr', password: 'another-long-password' });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.body));
  await hr('POST', '/api/auth/login', { username: 'hr.one', password: 'another-long-password' });

  const before = (await admin('GET', '/api/people/assets')).body.assets.length;

  const raised = await hr('POST', '/api/people/assets/requests', {
    kind: 'Laptop', quantity: 2, estimated_cost: 130000, purpose: 'two joiners', submit: true,
  });
  assert.equal(raised.status, 201, JSON.stringify(raised.body));
  assert.equal(raised.body.status, 'submitted');
  assert.equal(raised.body.number, 'PR-0001');
  const id = raised.body.id;

  // HR has no approve ability.
  const hrApprove = await hr('POST', `/api/people/assets/requests/${id}/approve`, {});
  assert.equal(hrApprove.status, 403);

  // A draft raised by the admin cannot be approved by that admin.
  const own = (await admin('POST', '/api/people/assets/requests', { kind: 'Chair', quantity: 1, purpose: 'x', submit: true })).body;
  const self = await admin('POST', `/api/people/assets/requests/${own.id}/approve`, {});
  assert.equal(self.status, 403);
  assert.match(self.body.error, /nobody approves their own/);

  assert.equal((await admin('POST', `/api/people/assets/requests/${id}/approve`, { note: 'ok' })).status, 200);
  assert.equal((await hr('PATCH', `/api/people/assets/requests/${id}`, { quantity: 9 })).status, 400, 'only a draft is edited');
  assert.equal((await hr('POST', `/api/people/assets/requests/${id}/order`, { vendor: 'Croma' })).status, 200);
  assert.equal((await hr('POST', `/api/people/assets/requests/${id}/receive`, {})).status, 200);
  const done = await hr('POST', `/api/people/assets/requests/${id}/complete`, { asset_codes: 'BPL-LAP-001, BPL-LAP-002' });
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.vendor, 'Croma');
  assert.deepEqual(
    done.body.events.map((e) => e.to_status),
    ['draft', 'submitted', 'approved', 'ordered', 'received', 'completed']
  );

  // An approval registered nothing: the register is exactly as it was.
  assert.equal((await admin('GET', '/api/people/assets')).body.assets.length, before);

  // A completed request is history: not deleted, not cancelled.
  assert.equal((await admin('DELETE', `/api/people/assets/requests/${id}`)).status, 400);
  assert.equal((await admin('POST', `/api/people/assets/requests/${id}/cancel`, { note: 'x' })).status, 400);

  // The overview counts what waits for a decision.
  const dash = (await admin('GET', '/api/people/assets/dashboard')).body;
  assert.equal(dash.pending.purchases, 1, 'the chair is still waiting');
  assert.ok(dash.overview && Array.isArray(dash.overview.by_category));
});
