/**
 * People panels (v2.46.0): helpdesk priority and who has it, claims by
 * category, penalty and clearance progress, three notice states, and the
 * appraisal form in groups.
 *
 *   - a ticket's priority and holder can be SET now (they were stored and
 *     printed, never settable), and a closed ticket is not re-routed;
 *   - a notice is scheduled, showing or ended - and "showing" is exactly
 *     isLive, so the two cannot disagree;
 *   - claims group by category without regard to case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isLive, noticeState } from '../../shared/announcements.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

test('a notice is scheduled, showing or ended - and showing is exactly isLive', () => {
  const today = '2026-11-28';
  const now = new Date('2026-11-28T10:00:00');
  const cases = [
    [{ from_on: '2026-12-05' }, 'scheduled'],
    [{ from_on: '2026-11-01', until_on: '2026-11-20' }, 'ended'],
    [{}, 'live'],
    [{ until_on: '2026-11-28' }, 'live'],
  ];
  for (const [a, want] of cases) {
    assert.equal(noticeState(a, today, now), want, JSON.stringify(a));
    assert.equal(noticeState(a, today, now) === 'live', isLive(a, today, now));
  }
});

test('the helpdesk sets priority and holder through one call, and the claims group ignores case', () => {
  const desk = strip(read('frontend/src/components/people/Helpdesk.jsx'));
  assert.match(desk, /api\.patch\(`\/people\/tickets\/\$\{ticket\.id\}`, patch\)/);
  assert.match(desk, /disabled=\{ticket\.status === 'closed'\}/);
  const claims = strip(read('frontend/src/components/people/Claims.jsx'));
  assert.match(claims, /String\(k \|\| 'other'\)\.trim\(\)\.toLowerCase\(\)/);
});

test('every new class has a rule in styles.css', () => {
  const css = read('frontend/src/styles.css');
  const src = ['Helpdesk', 'Claims', 'Penalties', 'ExitClearance', 'Noticeboard', 'Appraisals']
    .map((f) => strip(read(`frontend/src/components/people/${f}.jsx`)))
    .join('\n');
  const used = new Set([...src.matchAll(/\b(hd|cl|pn|ex|nb|ap)-[a-z-]+/g)].map((m) => m[0]));
  for (const cls of used) assert.ok(css.includes(`.${cls}`), `.${cls} has no rule`);
});

/* --------------------------- through the server --------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'people-panels-'));
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
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('through the API: route a ticket, refuse nonsense, refuse a closed one', async () => {
  await call('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' });
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const emp = (await call('POST', '/api/employees', { company_id: company.id, name: 'Riya Pal', monthly_salary: 20000, joined_on: '2024-01-01' })).body;
  const t = (await call('POST', '/api/people/tickets', { employee_id: emp.id, category: 'Salary', subject: 'PF missing' })).body;
  assert.equal(t.priority, 'normal');
  assert.equal(t.assigned_to, null);

  const routed = await call('PATCH', `/api/people/tickets/${t.id}`, { priority: 'high', assigned_to: '  Krupa (HR) ' });
  assert.equal(routed.status, 200, JSON.stringify(routed.body));
  assert.deepEqual([routed.body.priority, routed.body.assigned_to], ['high', 'Krupa (HR)']);

  // Blank hands it back to nobody; an unknown priority is refused by name.
  assert.equal((await call('PATCH', `/api/people/tickets/${t.id}`, { assigned_to: '' })).body.assigned_to, null);
  const bad = await call('PATCH', `/api/people/tickets/${t.id}`, { priority: 'urgent' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not "urgent"/);
  assert.equal((await call('PATCH', '/api/people/tickets/9999', { priority: 'low' })).status, 404);

  await call('POST', `/api/people/tickets/${t.id}/close`, {});
  const closed = await call('PATCH', `/api/people/tickets/${t.id}`, { priority: 'low' });
  assert.equal(closed.status, 400);
  assert.match(closed.body.error, /closed/);
  assert.equal((await call('GET', `/api/people/tickets/${t.id}`)).body.priority, 'high', 'a closed ticket keeps what it was closed with');
});
