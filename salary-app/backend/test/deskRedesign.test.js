/**
 * The Task Desk redesign (v2.42.0).
 *
 * The brief asked for a dashboard of six figures, two columns, a "needs
 * attention" list, and fuller forms. What these tests hold it to:
 *
 *   - progress exists ONLY where a checklist measures it - never a 0% bar on
 *     a task nobody wrote steps for;
 *   - a tick is on the thread, by name, and only the people on the task may
 *     make it, and only while the task is open;
 *   - a request's type never includes leave (leave is asked for from Leave);
 *   - the four attention piles count each task once per pile, over the work
 *     somebody gave or was given and nothing else;
 *   - the dashboard's six figures are all ways in, and the forms only offer
 *     what the server stores.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPROVAL_KINDS,
  ATTENTION_BUCKETS,
  MAX_CHECKLIST,
  attention,
  cleanChecklist,
  isDueSoon,
  matches,
  progressOf,
} from '../../shared/taskDesk.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ------------------------------ the rules ------------------------------ */

test('a checklist keeps the typed steps, drops the blanks, and starts with nothing ticked', () => {
  assert.deepEqual(cleanChecklist('Get quotes\n\n  Send for approval  \n'), [
    { text: 'Get quotes', done: false },
    { text: 'Send for approval', done: false },
  ]);
  // A step already ticked on the way in is a step nobody did.
  assert.deepEqual(cleanChecklist([{ text: 'Book hall', done: true }]), [{ text: 'Book hall', done: false }]);
  assert.deepEqual(cleanChecklist(''), []);
  assert.throws(() => cleanChecklist(Array.from({ length: MAX_CHECKLIST + 1 }, (_, i) => `step ${i}`)), /checklist/);
});

test('progress is measured only where there are steps - no checklist is null, never 0%', () => {
  assert.equal(progressOf({ checklist: [] }), null);
  assert.equal(progressOf({}), null);
  assert.deepEqual(progressOf({ checklist: [{ done: true }, { done: false }, { done: false }] }), { done: 1, total: 3, percent: 33 });
});

test('due soon is open, not late, and inside two days - today counts', () => {
  const today = '2026-11-28';
  assert.equal(isDueSoon({ status: 'Pending', due_on: '2026-11-28' }, today), true);
  assert.equal(isDueSoon({ status: 'Pending', due_on: '2026-11-30' }, today), true);
  assert.equal(isDueSoon({ status: 'Pending', due_on: '2026-12-01' }, today), false);
  assert.equal(isDueSoon({ status: 'Pending', due_on: '2026-11-27' }, today), false, 'that is overdue, a different pile');
  assert.equal(isDueSoon({ status: 'Done', due_on: '2026-11-29' }, today), false);
  assert.equal(isDueSoon({ status: 'Pending', due_on: null }, today), false);
});

test('the attention piles are the work somebody gave or was given, open, and nobody else’s', () => {
  const me = { key: 'e:1', level: 5 };
  const today = '2026-11-28';
  const now = Date.parse('2026-11-28T10:00:00Z');
  const fresh = '2026-11-28T09:00:00Z';
  const old = '2026-11-20T09:00:00Z';
  const tasks = [
    { id: 1, to: 'e:1', by: 'e:9', status: 'Pending', priority: 'high', due_on: '2026-11-25', updated_at: old },
    { id: 2, to: 'e:2', by: 'e:1', status: 'In Progress', priority: 'normal', due_on: '2026-11-29', updated_at: fresh },
    { id: 3, to: 'e:1', by: 'e:9', status: 'Done', priority: 'high', due_on: '2026-11-20', updated_at: old },
    // Somebody else's work entirely - an MD would see it on the office list, but it is not on THEIR desk.
    { id: 4, to: 'e:5', by: 'e:6', status: 'Pending', priority: 'high', due_on: '2026-11-01', updated_at: old },
  ];
  const piles = attention(me, tasks, { today, now });
  assert.deepEqual(Object.keys(piles), ATTENTION_BUCKETS.map(([k]) => k));
  assert.deepEqual(piles.overdue.map((t) => t.id), [1]);
  assert.deepEqual(piles.stale.map((t) => t.id), [1]);
  assert.deepEqual(piles.high.map((t) => t.id), [1], 'overdue AND high is in both piles, closed is in none');
  assert.deepEqual(piles.soon.map((t) => t.id), [2]);
});

test('a request is never for leave - leave is asked for from Leave, where the approval marks the days', () => {
  const keys = APPROVAL_KINDS.map(([k]) => k);
  assert.ok(!keys.some((k) => /leave/i.test(k)));
  assert.ok(!APPROVAL_KINDS.some(([, label]) => /leave/i.test(label)));
  assert.ok(keys.includes('expense') && keys.includes('other'));
});

test('search reaches a task’s category and a request’s type', () => {
  assert.equal(matches({ title: 'Renew contract', category: 'Accounts' }, 'accounts'), true);
  assert.equal(matches({ title: 'Stall advance', kind: 'payment' }, 'advance payment'), true);
});

/* --------------------------- through the server --------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-redesign-'));
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
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const admin = session();
const alpeshS = session();
const riyaS = session();
const amitS = session();
let alpesh, riya, amit, taskId;
const key = (e) => `e:${e.id}`;

test('a manager and two people who report to him', async () => {
  assert.equal((await admin('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' })).status, 201);
  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const make = (body) => admin('POST', '/api/employees', { company_id: company.id, monthly_salary: 30000, joined_on: '2024-01-01', ...body });
  alpesh = (await make({ name: 'Alpesh Shah', department: 'Sales' })).body;
  riya = (await make({ name: 'Riya Pal', department: 'Sales', reports_to_id: alpesh.id })).body;
  amit = (await make({ name: 'Amit Shah', department: 'Sales', reports_to_id: alpesh.id })).body;
  const made = (await admin('POST', '/api/auth/staff', { employee_ids: [alpesh.id, riya.id, amit.id] })).body.made;
  for (const [who, emp] of [[alpeshS, alpesh], [riyaS, riya], [amitS, amit]]) {
    const slip = made.find((m) => m.employee_id === emp.id);
    assert.equal((await who('POST', '/api/auth/login', { username: slip.username, password: slip.password })).status, 200);
    assert.equal((await who('POST', '/api/auth/password', { password: `${slip.username}-own-password` })).status, 200);
  }
});

test('a task carries its category, start date and checklist; a start after the due date is refused', async () => {
  const bad = await alpeshS('POST', '/api/desk/tasks', { title: 'X', to: key(riya), starts_on: '2026-12-10', due_on: '2026-12-01' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /start after it is due/);

  const made = await alpeshS('POST', '/api/desk/tasks', {
    title: 'Renew Goa hotel contract',
    to: key(riya),
    starts_on: '2026-11-28',
    due_on: '2026-12-05',
    priority: 'high',
    category: 'Accounts',
    checklist: ['Get three quotes', '', 'Send the best for approval'],
  });
  assert.equal(made.status, 201);
  taskId = made.body.id;
  assert.equal(made.body.category, 'Accounts');
  assert.equal(made.body.starts_on, '2026-11-28');
  assert.deepEqual(made.body.checklist.map((i) => [i.text, i.done]), [['Get three quotes', false], ['Send the best for approval', false]]);

  // An old-style task with no steps has an empty checklist, not a missing one.
  const plain = await alpeshS('POST', '/api/desk/tasks', { title: 'Call the bank', to: key(riya) });
  assert.deepEqual(plain.body.checklist, []);
  assert.equal(plain.body.category, '');
});

test('a tick is on the thread by name, counts as word on the task, and only the people on it may tick', async () => {
  const before = (await riyaS('GET', `/api/desk/tasks/${taskId}`)).body.task.updated_at;
  await new Promise((r) => setTimeout(r, 15));
  const ticked = await riyaS('POST', `/api/desk/tasks/${taskId}/checklist`, { index: 0, done: true });
  assert.equal(ticked.status, 200);
  assert.equal(ticked.body.task.checklist[0].done, true);
  assert.ok(ticked.body.task.updated_at > before, 'a tick is word on the task - it is not left looking quiet');
  const line = ticked.body.updates.at(-1);
  assert.equal(line.body, 'Ticked: Get three quotes');
  assert.equal(line.by_name, 'Riya Pal');

  // Ticking what is already ticked writes nothing twice.
  const again = await riyaS('POST', `/api/desk/tasks/${taskId}/checklist`, { index: 0, done: true });
  assert.equal(again.body.updates.filter((u) => u.body === 'Ticked: Get three quotes').length, 1);

  assert.equal((await amitS('POST', `/api/desk/tasks/${taskId}/checklist`, { index: 1, done: true })).status, 404, 'not his task');
  assert.equal((await riyaS('POST', `/api/desk/tasks/${taskId}/checklist`, { index: 7, done: true })).status, 400);

  // Done is done: the steps are the record of how it was finished.
  await riyaS('POST', `/api/desk/tasks/${taskId}/updates`, { text: 'Signed and sent', status: 'Done' });
  const late = await riyaS('POST', `/api/desk/tasks/${taskId}/checklist`, { index: 1, done: true });
  assert.equal(late.status, 400);
  assert.match(late.body.error, /reopen it/);
});

test('a request carries its type and the date it is needed by; leave is not a type', async () => {
  assert.equal((await riyaS('POST', '/api/desk/approvals', { title: 'Two days off', approver: key(alpesh), kind: 'leave' })).status, 400);
  assert.equal((await riyaS('POST', '/api/desk/approvals', { title: 'Advance', approver: key(alpesh), needed_by: 'soon' })).status, 400);
  const made = await riyaS('POST', '/api/desk/approvals', {
    title: 'Canton Fair stall advance', approver: key(alpesh), amount: 45000, kind: 'payment', needed_by: '2026-12-02',
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.kind, 'payment');
  assert.equal(made.body.needed_by, '2026-12-02');
  // The approver's desk carries it, with both fields, for the "waiting for your decision" column.
  const his = (await alpeshS('GET', '/api/desk')).body.approvals.find((a) => a.id === made.body.id);
  assert.deepEqual([his.kind, his.needed_by], ['payment', '2026-12-02']);
  // And deciding it from the dashboard is the same POST the request page makes.
  const yes = await alpeshS('POST', `/api/desk/approvals/${made.body.id}/decide`, { decision: 'Approved', note: '' });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.approval.status, 'Approved');
});

/* ------------------------------ the screen ------------------------------ */

const desk = stripComments(read('frontend/src/components/desk/TaskDesk.jsx'));

test('all six figures are ways in, including the two that used to be plain numbers', () => {
  const block = desk.slice(desk.indexOf('const kpis = ['), desk.indexOf('];', desk.indexOf('const kpis = [')));
  const lines = block.split('\n').filter((l) => l.trim().startsWith("['"));
  assert.equal(lines.length, 6);
  for (const l of lines) assert.match(l, /\(\) =>/, `every figure opens something: ${l.trim().slice(0, 50)}`);
  assert.match(block, /showAttention\('overdue'\)/);
  assert.match(block, /showAttention\('stale'\)/);
  assert.match(desk, /<button key=\{label\} type="button" className=\{`ao-kpi/);
});

test('the dashboard reads the shared piles and decides through the same route as the request page', () => {
  assert.match(desk, /attention\(me, tasks, \{ today \}\)/);
  assert.match(desk, /api\.post\(`\/desk\/approvals\/\$\{a\.id\}\/decide`/);
  // A rejection asks why before it goes.
  assert.match(desk, /window\.prompt\(`Reject/);
  // Empty states carry a way to act, not just a sentence.
  assert.match(desk, /Create a task<\/button>/);
});

test('the forms send only what the server stores, and say what the desk cannot do', () => {
  for (const field of ['starts_on', 'category', 'checklist', 'needed_by', 'kind']) assert.ok(desk.includes(field), field);
  assert.match(desk, /files cannot be attached yet/);
  assert.match(desk, /Nothing is emailed or sent/);
  assert.ok(!/type="file"/.test(desk), 'no attachment box that would go nowhere');
});

test('every new desk class has a rule in styles.css', () => {
  const css = read('frontend/src/styles.css');
  const used = new Set([...desk.matchAll(/desk-[a-z-]+/g)].map((m) => m[0]));
  for (const cls of used) {
    if (['desk-categories'].includes(cls)) continue; // a datalist id, not a class
    assert.ok(css.includes(`.${cls}`), `.${cls} has no rule`);
  }
});
