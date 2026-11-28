/**
 * v2.40.0: renewal management - licences, rent and insurance as one register.
 *
 *   - the workflow walks review -> approval -> payment, approval is a
 *     Manager's or an Admin's, and "renewed" writes the old term into the
 *     history before the new expiry replaces it;
 *   - reminders: the smallest step reached, logged once each;
 *   - costs: billing cycles turned into a month and a year the same way
 *     everywhere, rent's amount read as a month.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { categoryOf, costOf, costSummary, dueReminders, renewalStatus, stageProblem, cleanSteps } from '../../shared/renewals.js';

test('the category comes from the kind, never stored', () => {
  assert.equal(categoryOf({ kind: 'Rent agreement' }), 'rent');
  assert.equal(categoryOf({ kind: 'Insurance policy' }), 'insurance');
  assert.equal(categoryOf({ kind: 'Antivirus' }), 'software');
});

test('costs follow the billing cycle; rent is a monthly figure', () => {
  assert.deepEqual(costOf({ term: 'subscription', cost: 3000, renew_every_months: 3 }), { monthly: 1000, yearly: 12000, known: true });
  assert.equal(costOf({ kind: 'Rent agreement', cost: 85000, renew_every_months: 11 }).yearly, 1020000);
  assert.equal(costOf({ term: 'subscription', cost: 5000 }).known, false, 'no cycle is not guessed at twelve months');
  assert.equal(costOf({ cost: 5000, renew_every_months: 12, cancelled_on: '2026-01-01' }).yearly, 0);
  const sum = costSummary([
    { kind: 'Rent agreement', cost: 10000 },
    { kind: 'Insurance policy', term: 'subscription', cost: 12000, renew_every_months: 12, payment_status: 'pending' },
  ]);
  assert.equal(sum.yearly, 132000);
  assert.equal(sum.pending_payment, 12000);
});

test('the workflow: approval is somebody with the right, and a step must follow', () => {
  assert.match(stageProblem({ renewal_stage: null }, 'submit', {}), /new end date/);
  assert.equal(stageProblem({ renewal_stage: null }, 'submit', { proposed_until: '2027-12-01' }), null);
  assert.match(stageProblem({ renewal_stage: 'pending_approval' }, 'approve', {}), /Manager or an Admin/);
  assert.equal(stageProblem({ renewal_stage: 'pending_approval' }, 'approve', { canApprove: true }), null);
  assert.match(stageProblem({ renewal_stage: 'pending_approval' }, 'reject', { canApprove: true }), /say why/);
  assert.match(stageProblem({ renewal_stage: null }, 'approve', { canApprove: true }), /does not follow/);
  assert.match(stageProblem({ cancelled_on: '2026-01-01' }, 'review', {}), /cancelled/);
  assert.equal(renewalStatus({ renewal_stage: 'pending_payment' }).label, 'Pending payment');
  assert.equal(renewalStatus({ days_left: -3 }).key, 'expired');
});

test('reminders: the smallest step reached, nothing for a record far off or cancelled', () => {
  const due = dueReminders(
    [
      { id: 1, name: 'a', expires_on: '2026-12-20', days_left: 25 },
      { id: 2, name: 'b', expires_on: '2027-06-01', days_left: 185 },
      { id: 3, name: 'c', expires_on: '2026-11-20', days_left: -8 },
      { id: 4, name: 'd', expires_on: '2026-11-29', days_left: 1, cancelled_on: '2026-11-01' },
    ],
    [90, 60, 30, 7, 0, -1]
  );
  assert.deepEqual(due.map((d) => [d.id, d.step]), [[3, -1], [1, 30]]);
  assert.deepEqual(cleanSteps([7, '30', 30, 'x', 900]), [30, 7]);
});

/* ------------------------------- the API ------------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'renewals-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function session() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('through the API: a renewal walks to renewed, keeps its history, and reminds once', async () => {
  const admin = session();
  const hr = session();
  await admin('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' });
  await admin('POST', '/api/auth/users', { username: 'hr.one', name: 'HR One', role: 'hr', password: 'another-long-password' });
  await hr('POST', '/api/auth/login', { username: 'hr.one', password: 'another-long-password' });

  const rent = (await admin('POST', '/api/people/licenses', {
    name: 'Alkapuri office', kind: 'Rent agreement', publisher: 'Mr Shah', cost: 85000, renew_every_months: 11,
    expires_on: plus(20), security_deposit: 255000, notice_days: 60, escalation_pct: 5,
  })).body;
  assert.equal(rent.security_deposit, 255000);
  assert.equal(rent.notice_days, 60);

  // Reminders: logged once, never twice.
  const first = (await admin('GET', '/api/people/licenses/overview')).body;
  assert.equal(first.fresh_reminders, 1);
  assert.equal(first.reminders[0].step, 30);
  assert.equal((await admin('GET', '/api/people/licenses/overview')).body.fresh_reminders, 0);
  assert.equal(first.overview.due30, 1);
  assert.equal(first.overview.cost.yearly, 1020000);

  // HR proposes; HR cannot approve; the admin can.
  assert.equal((await hr('POST', `/api/people/licenses/${rent.id}/stage`, { step: 'submit', proposed_cost: 89250, proposed_until: plus(355) })).status, 200);
  assert.equal((await hr('POST', `/api/people/licenses/${rent.id}/stage`, { step: 'approve' })).status, 403);
  const approved = (await admin('POST', `/api/people/licenses/${rent.id}/stage`, { step: 'approve' })).body;
  assert.equal(approved.renewal_stage, 'pending_payment');
  assert.equal(approved.payment_status, 'pending');

  // Renewed: the old term is in the history, the new one is current.
  const renewed = (await hr('POST', `/api/people/licenses/${rent.id}/renew`, {
    period_from: rent.expires_on, period_to: plus(355), cost: 89250,
  })).body;
  assert.equal(renewed.expires_on, plus(355));
  assert.equal(renewed.cost, 89250);
  assert.equal(renewed.renewal_stage, null);
  assert.equal(renewed.payment_status, 'paid');
  assert.equal(renewed.renewals.length, 1);

  // The activity trail names every step.
  const trail = (await admin('GET', `/api/people/licenses/${rent.id}/activity`)).body.activity.map((a) => a.action);
  for (const step of ['created', 'submit', 'approve']) assert.ok(trail.includes(step), `${step} missing from ${trail}`);

  // Reminder steps are an approver's to change.
  assert.equal((await hr('PUT', '/api/people/licenses/reminders', { steps: [30] })).status, 403);
  assert.deepEqual((await admin('PUT', '/api/people/licenses/reminders', { steps: [60, 15] })).body.rule.steps, [60, 15]);
});
