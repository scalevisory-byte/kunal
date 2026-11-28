/**
 * Assets, part two (v2.45.0): the asset page, maintenance statuses, and a
 * stock take narrowed to one place.
 *
 *   - MONEY IS SPENT ONLY ON COMPLETED WORK: a booked, under-way or cancelled
 *     job is in no total, and completing it is the moment its cost counts;
 *   - completed work cannot be turned back into a booking;
 *   - narrowing a stock take changes what is COUNTED, never a verdict, and an
 *     asset with nothing recorded for the field is named, not dropped;
 *   - the asset page acts through the register's own handlers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanServiceStatus, isOpenService, isSpent, openWork, statusOfService } from '../../shared/serviceStatus.js';
import { looksDuplicate, ownership, spendReport } from '../../shared/maintenance.js';
import { inScope, roundFigures, scopeChoices, unplaced } from '../../shared/stockTake.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

/* ------------------------------ the rules ------------------------------ */

test('a record made before statuses existed reads as completed work', () => {
  assert.equal(statusOfService({}), 'done');
  assert.equal(statusOfService({ status: null }), 'done');
  assert.equal(isSpent({ status: null }), true);
  assert.equal(isSpent({ status: 'scheduled' }), false);
  assert.equal(isSpent({ status: 'cancelled' }), false);
  assert.equal(isOpenService({ status: 'waiting_parts' }), true);
  assert.equal(cleanServiceStatus(''), 'done');
  assert.throws(() => cleanServiceStatus('paid'), /not "paid"/);
});

test('cost of ownership counts completed work only, and reports open work apart', () => {
  const asset = { purchase_cost: 50000 };
  const services = [
    { id: 1, serviced_on: '2026-10-01', cost: 1200 },
    { id: 2, serviced_on: '2026-12-02', cost: 2500, status: 'scheduled' },
    { id: 3, serviced_on: '2026-11-20', cost: 900, status: 'cancelled' },
    { id: 4, serviced_on: '2026-11-25', cost: 4000, status: 'waiting_parts' },
  ];
  const own = ownership(asset, services, '2026-11-28');
  assert.equal(own.service, 1200);
  assert.equal(own.total, 51200);
  assert.equal(own.times, 1);
  assert.equal(own.last_service_on, '2026-10-01', 'a booking next week is not the last service');
  assert.equal(own.open_services, 2);
  assert.equal(own.open_status, 'waiting_parts', 'the soonest open job first');
  assert.deepEqual(openWork(services).map((s) => s.id), [4, 2]);
});

test('the year’s spend leaves out work not completed', () => {
  const assets = [{ id: 1, purchase_cost: 10000 }];
  const services = [
    { asset_id: 1, serviced_on: '2026-03-01', cost: 500 },
    { asset_id: 1, serviced_on: '2026-04-01', cost: 9999, status: 'in_progress' },
  ];
  const spend = spendReport(assets, services, { year: '2026' });
  assert.equal(spend.years.find((y) => y.year === '2026').cost, 500);
});

test('a cancelled job is not the bill being typed twice', () => {
  const existing = [{ id: 9, serviced_on: '2026-11-01', cost: 700, status: 'cancelled' }];
  assert.equal(looksDuplicate({ serviced_on: '2026-11-01', cost: 700 }, existing), null);
  assert.ok(looksDuplicate({ serviced_on: '2026-11-01', cost: 700 }, [{ ...existing[0], status: null }]));
});

test('a narrowed stock take counts only its part, and names what has no place recorded', () => {
  const assets = [
    { id: 1, location: 'Surat Office', verified_found: true, purchase_cost: 100 },
    { id: 2, location: 'surat office ', verified_found: false, purchase_cost: 300 },
    { id: 3, location: 'Vadodara Office', verified_found: null },
    { id: 4, location: '', verified_found: null },
  ];
  const surat = assets.filter((a) => inScope(a, { location: 'Surat Office' }));
  assert.deepEqual(surat.map((a) => a.id), [1, 2], 'case and spaces do not split one place in two');
  const f = roundFigures(surat);
  assert.deepEqual([f.found, f.missing, f.not_checked, f.missing_value], [1, 1, 0, 300]);
  assert.deepEqual(unplaced(assets, { location: 'Surat Office' }).map((a) => a.id), [4]);
  assert.deepEqual(unplaced(assets, {}), [], 'nothing narrowed, nothing left out');
  // "Not checked" is never "missing", whatever the scope.
  assert.equal(roundFigures(assets).missing, 1);
  assert.equal(roundFigures(assets).not_checked, 2);
  assert.deepEqual(scopeChoices(assets).location, ['Surat Office', 'Vadodara Office']);
});

/* --------------------------- through the server --------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-part2-'));
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
  // Leave nothing behind: a temp folder per run is how /tmp reached 30 GB.
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

let cookie = '';
const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('through the API: book a job, see it counted nowhere, complete it, see it counted once', async () => {
  await call('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' });
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const made = await call('POST', '/api/people/assets', {
    company_id: company.id, kind: 'Laptop', label: 'ThinkPad', purchase_cost: 60000, location: 'Surat Office',
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const asset = made.body;
  const spent = async () => (await call('GET', '/api/people/maintenance')).body.totals.service;

  assert.equal((await call('POST', `/api/people/assets/${asset.id}/services`, { status: 'paid' })).status, 400);
  const booked = await call('POST', `/api/people/assets/${asset.id}/services`, {
    status: 'scheduled', serviced_on: '2026-12-02', kind: 'Repair', work: 'Keyboard', cost: 2500,
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(await spent(), 0, 'a booking costs nothing yet');
  const body = (await call('GET', '/api/people/maintenance')).body;
  assert.deepEqual(body.open.map((s) => s.id), [booked.body.id]);

  const history = (await call('GET', `/api/people/assets/${asset.id}/history`)).body.events;
  const line = history.find((e) => /Repair/.test(e.what));
  assert.match(line.what, /scheduled/);
  assert.equal(line.amount, 0, 'a quote is not shown as money gone');

  const done = await call('PATCH', `/api/people/maintenance/services/${booked.body.id}`, { status: 'done', cost: 2400 });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await spent(), 2400, 'counted once, at what it actually cost');
  assert.equal((await call('GET', '/api/people/maintenance')).body.open.length, 0);

  const back = await call('PATCH', `/api/people/maintenance/services/${booked.body.id}`, { status: 'scheduled' });
  assert.equal(back.status, 400);
  assert.match(back.body.error, /already counted/);
});

test('a round can be counted for one location without touching a verdict', async () => {
  const company = (await call('GET', '/api/companies')).body[0] || (await call('GET', '/api/companies')).body.companies?.[0];
  await call('POST', '/api/people/assets', { company_id: company.id, kind: 'Chair', label: 'Chair', location: 'Vadodara Office' });
  await call('POST', '/api/people/assets', { company_id: company.id, kind: 'Desk', label: 'Desk' });
  const round = 'test round';
  const whole = (await call('GET', `/api/people/rounds/${encodeURIComponent(round)}`)).body;
  const surat = (await call('GET', `/api/people/rounds/${encodeURIComponent(round)}?location=${encodeURIComponent('Surat Office')}`)).body;
  assert.equal(whole.total, 3);
  assert.equal(surat.total, 1);
  assert.equal(surat.unplaced, 1, 'the desk with no location is named');
  assert.equal(whole.unplaced, 0);
});

/* ------------------------------ the screens ------------------------------ */

test('the asset page acts through the register’s own handlers, not copies', () => {
  const page = strip(read('frontend/src/components/people/AssetHistory.jsx'));
  for (const route of ['/issue', '/return', '/write-off', '/state']) {
    assert.ok(!page.includes(route), `the page must not call ${route} itself`);
  }
  for (const action of ['actions.issue', 'actions.back', 'actions.setState', 'actions.writeOff']) assert.ok(page.includes(action), action);
  const register = strip(read('frontend/src/components/people/Assets.jsx'));
  // v2.48.0 added dispose: still the register's own handler, handed down.
  assert.match(register, /const pageActions = \{ issue, back, setState, writeOff, dispose, label, voucher \}/);
});

test('every new class has a rule in styles.css', () => {
  const css = read('frontend/src/styles.css');
  const src = ['AssetHistory', 'Maintenance', 'StockTake'].map((f) => strip(read(`frontend/src/components/people/${f}.jsx`))).join('\n');
  const used = new Set([...src.matchAll(/\b(ah|st|mt)-[a-z-]+/g)].map((m) => m[0]));
  for (const cls of used) assert.ok(css.includes(`.${cls}`), `.${cls} has no rule`);
});
