/**
 * v2.35.0: three things that come to somebody instead of waiting to be found.
 *
 *   - the office's "staff are waiting" box: up now, again an hour after it
 *     was put away, at once when something NEW arrives, never with nothing;
 *   - the employee's party for a raise: only an applied rise, recent, their
 *     own, and in the fewest fields;
 *   - the digest marks which lines are staff waiting on the office, so the
 *     box does not pop up over a licence renewal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REMIND_EVERY_MS, reminderDue, reminderSignature } from '../../shared/requestReminder.js';
import { CELEBRATION_FIELDS, celebrationFor } from '../../shared/celebration.js';
import { digest } from '../../shared/digest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(path.join(here, '..', '..', 'frontend', 'src', p), 'utf8');

/* --------------------------- the hourly box --------------------------- */

const one = [{ text: '1 attendance request waiting: Amit Shah', staff: true }];
const two = [...one, { text: '1 expense claim to approve, ₹500: Priya Nair', staff: true }];
const T = Date.parse('2026-11-27T10:00:00Z');

test('nothing waiting is never a box', () => {
  assert.equal(reminderDue([], null, T), false);
  assert.equal(reminderDue(undefined, null, T), false);
});

test('never put away comes up now', () => {
  assert.equal(reminderDue(one, null, T), true);
});

test('put away, it stays away for the hour and comes back after it', () => {
  const seen = { at: T, signature: reminderSignature(one) };
  assert.equal(reminderDue(one, seen, T + 10 * 60 * 1000), false);
  assert.equal(reminderDue(one, seen, T + REMIND_EVERY_MS - 1), false);
  assert.equal(reminderDue(one, seen, T + REMIND_EVERY_MS), true);
});

test('something new does not wait out the hour', () => {
  const seen = { at: T, signature: reminderSignature(one) };
  assert.equal(reminderDue(two, seen, T + 60 * 1000), true);
});

test('one fewer is not news: deciding something does not throw the box back up', () => {
  const seen = { at: T, signature: reminderSignature(two) };
  assert.equal(reminderDue(one, seen, T + 60 * 1000), false);
});

test('the digest marks staff waiting on the office, and nothing of the office’s own', () => {
  const built = digest({
    requests: [{ status: 'pending', employee_name: 'Amit Shah' }],
    claims: [{ status: 'pending', amount: 500, employee_name: 'Priya Nair' }],
    tickets: [{ waiting: true, employee_name: 'Kiran' }],
    tasks: [{ title: 'File GST', due_on: '2026-11-01', status: 'open' }],
    today: '2026-11-27',
  });
  const staff = built.items.filter((i) => i.staff);
  assert.equal(staff.length, 3, JSON.stringify(built.items));
  assert.ok(staff.some((i) => i.go === 'reports' && i.focus === 'approvals'));
  assert.ok(staff.some((i) => i.go === 'people' && i.focus === 'claims'));
  assert.ok(staff.some((i) => i.go === 'people' && i.focus === 'helpdesk'));
  // A job past its date is the office's own, and does not pop up.
  const job = built.items.find((i) => /past its date/.test(i.text));
  assert.ok(job && !job.staff);
});

test('the box is only for office logins, and the People tab honours the panel it was sent to', () => {
  const app = src('App.jsx');
  assert.match(app, /me\?\.role !== 'employee' \? \(\s*<RequestReminder/);
  const people = src('components/people/People.jsx');
  assert.match(people, /focus && PANELS\.some/);
  // Every staff line's focus names a panel that exists.
  for (const panel of ['claims', 'helpdesk']) assert.match(people, new RegExp(`\\['${panel}',`));
});

/* ---------------------------- the party ---------------------------- */

const applied = (over) => ({
  id: 1,
  cycle: '2026-27',
  kind: 'increment',
  from_salary: 20000,
  to_salary: 23000,
  effective_from: '2026-12-01',
  applied_at: '2026-11-20 10:00:00',
  summary: 'Reviewer’s private words',
  rating: 'B',
  reviewed_by: 'Dinesh',
  ...over,
});

test('an applied rise in the last sixty days is a party, in the fewest fields', () => {
  const c = celebrationFor([applied()], { today: '2026-11-27' });
  assert.equal(c.increment, 3000);
  assert.equal(c.increment_pct, 15);
  assert.equal(c.to_salary, 23000);
  assert.deepEqual(Object.keys(c).sort(), [...CELEBRATION_FIELDS].sort());
  assert.ok(!JSON.stringify(c).includes('private'), 'the reviewer’s summary does not travel');
  assert.equal(c.rating, undefined);
});

test('a proposal, a cut, an old rise and no change are not parties', () => {
  assert.equal(celebrationFor([applied({ applied_at: null })], { today: '2026-11-27' }), null);
  assert.equal(celebrationFor([applied({ to_salary: 19000 })], { today: '2026-11-27' }), null);
  assert.equal(celebrationFor([applied({ to_salary: 20000 })], { today: '2026-11-27' }), null);
  assert.equal(celebrationFor([applied({ applied_at: '2026-08-01 10:00:00' })], { today: '2026-11-27' }), null);
});

test('of two, the newest is the one celebrated', () => {
  const c = celebrationFor(
    [applied({ id: 1, applied_at: '2026-10-01 09:00:00' }), applied({ id: 2, to_salary: 25000, applied_at: '2026-11-25 09:00:00' })],
    { today: '2026-11-27' }
  );
  assert.equal(c.id, 2);
});

test('the dashboard card and the party are on the employee’s own dashboard', () => {
  const dash = src('components/my/MyDashboard.jsx');
  assert.match(dash, /<Celebration name=/);
  assert.match(dash, /<MyTasksCard onGo=\{onGo\} \/>/);
  // The card reads the same desk the tab does, and changes nothing.
  assert.match(dash, /api\s*\.get\('\/desk'\)/);
  const card = dash.slice(dash.indexOf('function MyTasksCard'));
  assert.ok(!/api\.post|api\.patch/.test(card), 'the card never changes a task');
});

/* --------------------------- through the API --------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'popups-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function session() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

test('the portal sees its own applied rise and nobody else’s', async () => {
  const admin = session();
  const harish = session();
  await admin('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' });
  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const him = (await admin('POST', '/api/employees', { company_id: company.id, name: 'Harish Gupta', monthly_salary: 20000 })).body;
  const her = (await admin('POST', '/api/employees', { company_id: company.id, name: 'Riya Pal', monthly_salary: 30000 })).body;
  const staff = await admin('POST', '/api/auth/staff', { employee_ids: [him.id] });
  const slip = staff.body.made[0];
  assert.equal((await harish('POST', '/api/auth/login', { username: slip.username, password: slip.password })).status, 200);

  // A proposal is not a party.
  const proposal = (await admin('POST', '/api/people/appraisals', {
    employee_id: him.id, kind: 'increment', to_salary: 23000, summary: 'between us',
  })).body;
  assert.equal((await harish('GET', '/api/me/celebration')).body.celebration, null);

  // Somebody else's applied rise is not his party either.
  const hers = (await admin('POST', '/api/people/appraisals', { employee_id: her.id, kind: 'increment', to_salary: 36000 })).body;
  await admin('POST', `/api/people/appraisals/${hers.id ?? hers.appraisal?.id}/apply`);
  assert.equal((await harish('GET', '/api/me/celebration')).body.celebration, null);

  await admin('POST', `/api/people/appraisals/${proposal.id ?? proposal.appraisal?.id}/apply`);
  const got = (await harish('GET', '/api/me/celebration')).body.celebration;
  assert.equal(got.increment, 3000);
  assert.equal(got.to_salary, 23000);
  assert.ok(!JSON.stringify(got).includes('between us'));
  assert.ok(!JSON.stringify(got).includes('36000'));
});
