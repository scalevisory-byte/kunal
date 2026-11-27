/**
 * The Task & Approval Desk.
 *
 * Dinesh sent the desk his office ran on a Google Sheet and said "ye bhi add
 * karo". The rules are in shared/taskDesk.js; the server is backend/src/desk.js.
 * What these tests hold it to:
 *
 *   - who somebody is comes off the LOGIN, never a body;
 *   - work goes down the ladder (or to your own reports), requests go up it;
 *   - a task and an approval are seen by the people on them and nobody else;
 *   - an approval is decided once, by the person it was sent to;
 *   - the desk's tasks are the SAME rows People > Tasks shows;
 *   - an approved amount moves no money.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PERSON_FIELDS,
  RANKS,
  approversFor,
  canAssign,
  canDecide,
  defaultLevel,
  deskFigures,
  isStale,
  matches,
  sortTasks,
  statusChoices,
  tally,
  taskStatus,
  waitingOn,
  waitingSentence,
} from '../../shared/taskDesk.js';

/* ------------------------------ the rules ------------------------------ */

const person = (key, level, manager = null) => ({ key, level, manager, name: key });

test('the ladder is his five rungs and one more for everybody else', () => {
  assert.deepEqual(RANKS.map((r) => r.key), ['MD', 'CEO', 'GM', 'SM', 'HOD', 'Staff']);
  assert.deepEqual(RANKS.map((r) => r.level), [1, 2, 3, 4, 5, 6]);
});

test('a rank nobody set is worked out from the login, or from who reports to them', () => {
  assert.equal(defaultLevel({ role: 'admin' }), 1);
  assert.equal(defaultLevel({ role: 'manager' }), 3);
  assert.equal(defaultLevel({ role: 'hr' }), 4);
  assert.equal(defaultLevel({ role: 'employee', reports: 2 }), 5);
  assert.equal(defaultLevel({ role: 'employee', reports: 0 }), 6);
});

test('work goes to yourself, to your own reports, or down the ladder from HOD up', () => {
  const md = person('u:1', 1);
  const hod = person('e:1', 5);
  const otherHod = person('e:2', 5);
  const staff = person('e:3', 6, 'e:1');
  const otherStaff = person('e:4', 6);
  assert.equal(canAssign(staff, staff), true, 'a personal reminder');
  assert.equal(canAssign(hod, staff), true, 'their own report');
  assert.equal(canAssign(hod, otherHod), true, 'his desk let a peer hand work to a peer');
  assert.equal(canAssign(hod, md), false, 'never up the ladder');
  assert.equal(canAssign(md, otherStaff), true);
  // The line his desk never needed: one member of staff giving work to another.
  assert.equal(canAssign(staff, otherStaff), false);
  // ...unless that person reports to them, whatever the ranks say.
  assert.equal(canAssign(person('e:9', 6), person('e:8', 6, 'e:9')), true);
});

test('a request goes up: the manager first, then the nearest rung, and never to yourself', () => {
  const people = [person('u:1', 1), person('e:1', 5), person('e:2', 4), person('e:3', 6, 'e:1'), person('e:4', 6)];
  const riya = people[3];
  assert.deepEqual(approversFor(riya, people).map((p) => p.key), ['e:1', 'e:2', 'u:1']);
  assert.deepEqual(approversFor(people[0], people), [], 'nobody is above the top');
  // A manager on the same rung is still somebody to ask.
  const peer = person('e:7', 6, 'e:4');
  assert.ok(approversFor(peer, [...people, peer]).some((p) => p.key === 'e:4'));
});

test('the doer moves a task along; putting it back to pending is for whoever gave it', () => {
  const giver = person('e:1', 5);
  const doer = person('e:3', 6);
  const task = { by: 'e:1', to: 'e:3', status: 'Pending' };
  assert.deepEqual(statusChoices(doer, task), ['In Progress', 'Waiting', 'Done']);
  assert.deepEqual(statusChoices(doer, { ...task, status: 'In Progress' }), ['Waiting', 'Done']);
  assert.deepEqual(statusChoices(giver, { ...task, status: 'Waiting' }), ['In Progress', 'Done', 'Pending']);
  assert.deepEqual(statusChoices(doer, { ...task, status: 'Done' }), [], 'the doer does not reopen their own');
  assert.deepEqual(statusChoices(giver, { ...task, status: 'Done' }), ['Pending']);
  assert.deepEqual(statusChoices(person('e:5', 6), task), [], 'not on the task at all');
  // A personal task: its owner is both.
  assert.deepEqual(statusChoices(doer, { by: 'e:3', to: 'e:3', status: 'Done' }), ['Pending']);
});

test('the old open / done / dropped still reads, and open is one of three', () => {
  assert.equal(taskStatus({ status: 'open', stage: 'pending' }), 'Pending');
  assert.equal(taskStatus({ status: 'open', stage: 'progress' }), 'In Progress');
  assert.equal(taskStatus({ status: 'open', stage: 'waiting' }), 'Waiting');
  assert.equal(taskStatus({ status: 'open' }), 'Pending', 'a row from before the desk');
  assert.equal(taskStatus({ status: 'done', stage: 'progress' }), 'Done');
  assert.equal(taskStatus({ status: 'dropped' }), 'Dropped');
});

test('no word for two days is flagged; a finished task and an unreadable date are not', () => {
  const now = Date.parse('2026-11-27T10:00:00Z');
  assert.equal(isStale({ status: 'Pending', updated_at: '2026-11-24T10:00:00Z' }, now), true);
  assert.equal(isStale({ status: 'Pending', updated_at: '2026-11-26T12:00:00Z' }, now), false);
  assert.equal(isStale({ status: 'Done', updated_at: '2026-11-01T10:00:00Z' }, now), false);
  assert.equal(isStale({ status: 'Pending', updated_at: 'nonsense' }, now), false);
});

test('what is waiting on somebody is their next move, not everything open', () => {
  const me = person('e:3', 6);
  const tasks = [
    { to: 'e:3', by: 'e:1', status: 'Pending' },
    { to: 'e:3', by: 'e:1', status: 'In Progress' }, // picked up: not waiting on anybody
    { to: 'e:3', by: 'e:3', status: 'Pending' }, // their own reminder
  ];
  const approvals = [
    { by: 'e:3', approver: 'e:1', status: 'Query' },
    { by: 'e:3', approver: 'e:1', status: 'Pending' },
    { by: 'e:9', approver: 'e:3', status: 'Pending' },
  ];
  assert.deepEqual(waitingOn(me, tasks, approvals), { tasks: 1, approvals: 1, queries: 1, total: 3 });
  assert.equal(waitingSentence({ tasks: 1, approvals: 2, queries: 0, total: 3 }), '1 new task · 2 approvals to decide');
  assert.equal(waitingSentence({ total: 0 }), '');
});

test('a week with nothing in it has no completion figure, rather than nought per cent', () => {
  const me = person('e:3', 6);
  assert.equal(deskFigures(me, [], [], { today: '2026-11-27' }).week_percent, null);
  const now = Date.parse('2026-11-27T10:00:00Z');
  const figures = deskFigures(
    me,
    [
      { to: 'e:3', by: 'e:1', status: 'Done', done_at: '2026-11-26T10:00:00Z' },
      { to: 'e:3', by: 'e:1', status: 'Pending', due_on: '2026-11-20', updated_at: '2026-11-20T10:00:00Z' },
      { to: 'e:9', by: 'e:3', status: 'Pending', updated_at: '2026-11-27T09:00:00Z' },
    ],
    [],
    { today: '2026-11-27', now }
  );
  assert.equal(figures.week_percent, 50);
  assert.deepEqual([figures.my_open, figures.given_open, figures.overdue, figures.stale], [1, 1, 1, 1]);
});

test('sorting, the tally and the search', () => {
  const list = [
    { id: 1, status: 'Done', priority: 'high' },
    { id: 2, status: 'Pending', priority: 'low', due_on: '2026-12-01' },
    { id: 3, status: 'Pending', priority: 'low', due_on: '2026-11-01' },
    { id: 4, status: 'Pending', priority: 'high', due_on: '2026-12-05' },
  ];
  assert.deepEqual(sortTasks(list, '2026-11-27').map((t) => t.id), [3, 4, 2, 1]);
  const lines = tally(list, (t) => (t.id < 3 ? 'Accounts' : 'Sales'), { today: '2026-11-27' });
  assert.deepEqual(lines.map((l) => [l.key, l.open, l.overdue]), [['Sales', 2, 1], ['Accounts', 1, 0]]);
  assert.equal(matches({ title: 'Renew Goa hotel contract', to_name: 'Riya Pal' }, 'goa riya'), true);
  assert.equal(matches({ title: 'Renew Goa hotel contract', to_name: 'Riya Pal' }, 'goa amit'), false);
});

test('what the desk says about a person is a name and where they sit - nothing else', () => {
  for (const field of ['salary', 'monthly_salary', 'pan', 'aadhaar', 'bank_account', 'phone', 'mobile', 'email', 'dob']) {
    assert.ok(!PERSON_FIELDS.includes(field), `${field} must never be in the desk's directory`);
  }
});

/* --------------------------- through the server --------------------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'task-desk-'));
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
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  };
}

const admin = session();
const alpeshS = session();
const riyaS = session();
const amitS = session();
const kiranS = session();
const hrS = session();
let alpesh, riya, amit, kiran, krupa, periodId, hrUser;
const key = (e) => `e:${e.id}`;

test('an office, a manager, his two reports, somebody who reports to nobody, and an HR login', async () => {
  assert.equal((await admin('POST', '/api/auth/setup', { username: 'dinesh', name: 'Dinesh', password: 'a-long-enough-password' })).status, 201);
  const company = (await admin('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const make = (body) => admin('POST', '/api/employees', { company_id: company.id, monthly_salary: 48000, joined_on: '2024-01-01', ...body });
  alpesh = (await make({ name: 'Alpesh Shah', department: 'Sales' })).body;
  riya = (await make({ name: 'Riya Pal', department: 'Sales', reports_to_id: alpesh.id })).body;
  amit = (await make({ name: 'Amit Shah', department: 'Sales', reports_to_id: alpesh.id })).body;
  kiran = (await make({ name: 'Kiran Desai', department: 'Accounts' })).body;
  krupa = (await make({ name: 'Krupa Mehta', department: 'HR' })).body;
  periodId = (await admin('POST', '/api/periods', { year: 2026, month: 11 })).body.id;
  await admin('GET', `/api/periods/${periodId}/payroll`);

  const made = (await admin('POST', '/api/auth/staff', { employee_ids: [alpesh.id, riya.id, amit.id, kiran.id] })).body.made;
  for (const [who, emp] of [[alpeshS, alpesh], [riyaS, riya], [amitS, amit], [kiranS, kiran]]) {
    const slip = made.find((m) => m.employee_id === emp.id);
    assert.equal((await who('POST', '/api/auth/login', { username: slip.username, password: slip.password })).status, 200);
    assert.equal((await who('POST', '/api/auth/password', { password: `${slip.username}-own-password` })).status, 200);
  }
  const hr = await admin('POST', '/api/auth/users', { username: 'krupa.hr', name: 'Krupa (HR)', role: 'hr', password: 'first-password-22' });
  assert.ok(hr.status === 200 || hr.status === 201, JSON.stringify(hr.body));
  hrUser = hr.body.user || hr.body;
  await hrS('POST', '/api/auth/login', { username: 'krupa.hr', password: 'first-password-22' });
  await hrS('POST', '/api/auth/password', { password: 'my-own-password-33', current: 'first-password-22' });
});

test('nobody signed in has no desk', async () => {
  assert.equal((await session()('GET', '/api/desk')).status, 401);
});

test('a staff login is the employee it belongs to, and is told nothing but names', async () => {
  const desk = await riyaS('GET', '/api/desk');
  assert.equal(desk.status, 200);
  assert.equal(desk.body.me.key, key(riya));
  assert.equal(desk.body.me.rank, 'Staff');
  assert.equal(desk.body.me.manager, key(alpesh));
  for (const p of desk.body.people) {
    assert.deepEqual(Object.keys(p).sort(), [...PERSON_FIELDS].sort());
  }
  // Everybody is on 48,000 and none of it may travel.
  assert.ok(!/48000|monthly_salary|bank_account|"pan"/.test(desk.text));
  // A member of staff can give work to nobody but themselves.
  assert.deepEqual(desk.body.assignable, []);
  // Their manager is first on the list of who to ask; the office is on it too.
  assert.equal(desk.body.approvers[0], key(alpesh));
  assert.equal(desk.body.can_manage, false);

  const boss = (await alpeshS('GET', '/api/desk')).body;
  assert.equal(boss.me.rank, 'HOD', 'somebody with people reporting to them');
  assert.ok(boss.assignable.includes(key(riya)) && boss.assignable.includes(key(amit)));
  assert.ok(boss.assignable.includes(key(kiran)), 'HOD and above give work down the ladder');

  const office = (await admin('GET', '/api/desk')).body;
  assert.equal(office.me.rank, 'MD');
  assert.equal(office.me.office, true);
  assert.deepEqual(office.approvers, [], 'nobody is above the top');
  assert.equal(office.can_manage, true);
});

let personalId;
let taskId;

test('a personal reminder is its owner’s and nobody else’s - not even the office list’s', async () => {
  const made = await riyaS('POST', '/api/desk/tasks', { title: 'Renew my passport', due_on: '2026-12-10' });
  assert.equal(made.status, 201);
  assert.equal(made.body.personal, true);
  assert.equal(made.body.to, key(riya));
  assert.equal(made.body.code, `T-${String(made.body.id).padStart(4, '0')}`);
  personalId = made.body.id;

  // Her manager, the top of the ladder and the office's flat list all leave it alone.
  assert.equal((await alpeshS('GET', `/api/desk/tasks/${personalId}`)).status, 404);
  assert.ok(!(await admin('GET', '/api/desk')).body.tasks.some((t) => t.id === personalId));
  assert.ok(!(await admin('GET', '/api/people/tasks')).body.tasks.some((t) => t.id === personalId));
  // ...and it does not count as work waiting on her.
  assert.equal((await riyaS('GET', '/api/desk/waiting')).body.tasks, 0);
});

test('one member of staff cannot hand work to another, whatever the request says', async () => {
  const no = await riyaS('POST', '/api/desk/tasks', { title: 'Do my filing', to: key(amit) });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /cannot give work to Amit Shah/);
  // Naming somebody else as the giver does nothing: who she is comes off the login.
  const sly = await riyaS('POST', '/api/desk/tasks', { title: 'Sly', to: key(riya), by: key(alpesh), by_key: key(alpesh), employee_id: amit.id });
  assert.equal(sly.status, 201);
  assert.equal(sly.body.by, key(riya));
  assert.equal(sly.body.to, key(riya));
  assert.equal((await riyaS('POST', '/api/desk/tasks', { title: '' })).status, 400);
  assert.equal((await riyaS('POST', '/api/desk/tasks', { title: 'x', to: 'e:99999' })).status, 400);
});

test('a manager gives a task; the person it is for sees it, and nobody else on the floor does', async () => {
  const made = await alpeshS('POST', '/api/desk/tasks', {
    title: 'Renew Goa hotel contract', to: key(riya), due_on: '2026-11-20', priority: 'high', detail: 'Rates for the season',
  });
  assert.equal(made.status, 201);
  taskId = made.body.id;
  assert.deepEqual([made.body.status, made.body.by, made.body.to, made.body.department], ['Pending', key(alpesh), key(riya), 'Sales']);

  const hers = (await riyaS('GET', '/api/desk')).body;
  assert.ok(hers.tasks.some((t) => t.id === taskId));
  assert.equal(hers.waiting.tasks, 1);
  assert.ok(hers.unseen >= 1, 'she is told');
  assert.equal(hers.notifications[0].body, 'Task given to Riya Pal');

  assert.equal((await amitS('GET', `/api/desk/tasks/${taskId}`)).status, 404);
  assert.equal((await kiranS('GET', `/api/desk/tasks/${taskId}`)).status, 404);
  assert.equal((await amitS('POST', `/api/desk/tasks/${taskId}/updates`, { text: 'me too' })).status, 404);
  // The top of the ladder sees the whole office's work.
  assert.ok((await admin('GET', '/api/desk')).body.tasks.some((t) => t.id === taskId));

  // Opening her notifications clears the count.
  await riyaS('POST', '/api/desk/seen');
  assert.equal((await riyaS('GET', '/api/desk/waiting')).body.unseen, 0);
});

test('the thread moves the task, needs words, and only the giver puts it back', async () => {
  const silent = await riyaS('POST', `/api/desk/tasks/${taskId}/updates`, { text: '  ', status: 'In Progress' });
  assert.equal(silent.status, 400);
  assert.match(silent.body.error, /Write a line first/);

  const started = await riyaS('POST', `/api/desk/tasks/${taskId}/updates`, { text: 'Called the hotel, waiting for rates', status: 'Waiting' });
  assert.equal(started.status, 201);
  assert.equal(started.body.task.status, 'Waiting');
  assert.equal((await riyaS('GET', '/api/desk/waiting')).body.tasks, 0, 'picked up is not waiting on her');
  assert.ok((await alpeshS('GET', '/api/desk')).body.unseen >= 1, 'the giver is told');

  const back = await riyaS('POST', `/api/desk/tasks/${taskId}/updates`, { text: 'undo', status: 'Pending' });
  assert.equal(back.status, 400);
  assert.match(back.body.error, /for whoever gave it/);

  const done = await riyaS('POST', `/api/desk/tasks/${taskId}/updates`, { text: 'Signed and filed', status: 'Done' });
  assert.equal(done.body.task.status, 'Done');
  assert.deepEqual(done.body.choices, [], 'the doer does not reopen');
  // THE SAME ROW the office's list shows.
  const office = (await admin('GET', '/api/people/tasks')).body.tasks.find((t) => t.id === taskId);
  assert.equal(office.status, 'done');
  assert.equal(office.employee_id, riya.id);
  assert.equal(office.done_note, 'Signed and filed');

  const reopened = await alpeshS('POST', `/api/desk/tasks/${taskId}/updates`, { text: 'The rates are last year’s', status: 'Pending' });
  assert.equal(reopened.body.task.status, 'Pending');
  assert.equal((await admin('GET', '/api/people/tasks')).body.tasks.find((t) => t.id === taskId).status, 'open');
  assert.deepEqual(reopened.body.updates.map((u) => u.status), [null, 'Waiting', 'Done', 'Pending']);
});

test('a task ticked off through the office’s old list shows on the desk’s thread', async () => {
  const res = await admin('POST', `/api/people/tasks/${taskId}/status`, { status: 'done' });
  assert.equal(res.status, 200);
  const detail = (await riyaS('GET', `/api/desk/tasks/${taskId}`)).body;
  assert.equal(detail.task.status, 'Done');
  const last = detail.updates.at(-1);
  assert.equal(last.system, true);
  assert.match(last.body, /Marked done/);
  await admin('POST', `/api/people/tasks/${taskId}/status`, { status: 'open' });
  assert.equal((await riyaS('GET', `/api/desk/tasks/${taskId}`)).body.task.status, 'Pending');
});

test('a task made in the office’s old list is on the desk of the person it is for', async () => {
  const old = await admin('POST', '/api/people/tasks', { employee_id: amit.id, title: 'Bring the Aadhaar copy', assigned_by: 'Front desk' });
  assert.equal(old.status, 201);
  const his = (await amitS('GET', '/api/desk')).body.tasks.find((t) => t.id === old.body.id);
  assert.ok(his, 'it reaches his desk');
  assert.deepEqual([his.to, his.by, his.by_name, his.personal], [key(amit), null, 'Front desk', false]);
  // He can move it along; there is nobody to put it back but the top.
  assert.deepEqual((await amitS('GET', `/api/desk/tasks/${his.id}`)).body.choices, ['In Progress', 'Waiting', 'Done']);
});

let approvalId;

test('a request goes UP, and only to somebody who may be asked', async () => {
  assert.equal((await riyaS('POST', '/api/desk/approvals', { title: 'Stall advance', approver: key(amit), amount: 5000 })).status, 400);
  assert.equal((await riyaS('POST', '/api/desk/approvals', { title: 'Stall advance', approver: key(riya), amount: 5000 })).status, 400);
  assert.equal((await riyaS('POST', '/api/desk/approvals', { title: 'Stall advance', approver: key(alpesh), amount: -5 })).status, 400);
  const made = await riyaS('POST', '/api/desk/approvals', {
    title: 'Canton Fair stall booking advance', approver: key(alpesh), amount: 45000, details: 'Vendor wants half up front',
  });
  assert.equal(made.status, 201);
  approvalId = made.body.id;
  assert.deepEqual([made.body.status, made.body.by, made.body.approver, made.body.amount], ['Pending', key(riya), key(alpesh), 45000]);
  assert.equal(made.body.code, `A-${String(approvalId).padStart(4, '0')}`);

  assert.equal((await alpeshS('GET', '/api/desk/waiting')).body.approvals, 1);
  assert.equal((await amitS('GET', `/api/desk/approvals/${approvalId}`)).status, 404, 'not his to read');
  assert.equal((await kiranS('GET', '/api/desk')).body.approvals.length, 0);
  assert.ok((await admin('GET', '/api/desk')).body.approvals.some((a) => a.id === approvalId), 'the top sees every request');
});

test('a question needs its words, and answering it hands the request back', async () => {
  const net = async () => (await admin('GET', `/api/periods/${periodId}/payroll?sync=false`)).body.rows.find((r) => r.employee_id === riya.id).net_salary;
  const before = await net();

  // She asked; she does not decide.
  assert.equal((await riyaS('POST', `/api/desk/approvals/${approvalId}/decide`, { decision: 'Approved' })).status, 403);
  // Nor does the top of the ladder: it was sent to Alpesh.
  assert.equal((await admin('POST', `/api/desk/approvals/${approvalId}/decide`, { decision: 'Approved' })).status, 403);

  const blank = await alpeshS('POST', `/api/desk/approvals/${approvalId}/decide`, { decision: 'Query' });
  assert.equal(blank.status, 400);
  assert.match(blank.body.error, /Write the question/);
  const asked = await alpeshS('POST', `/api/desk/approvals/${approvalId}/decide`, { decision: 'Query', note: 'Which vendor?' });
  assert.equal(asked.body.approval.status, 'Query');
  assert.equal(asked.body.can_decide, true, 'a query is still open');
  assert.equal((await riyaS('GET', '/api/desk/waiting')).body.queries, 1);

  const answered = await riyaS('POST', `/api/desk/approvals/${approvalId}/updates`, { text: 'Expo Services, the same as last year' });
  assert.equal(answered.status, 201);
  assert.equal(answered.body.approval.status, 'Pending');
  assert.equal((await riyaS('GET', '/api/desk/waiting')).body.queries, 0);

  const yes = await alpeshS('POST', `/api/desk/approvals/${approvalId}/decide`, { decision: 'Approved', note: 'Go ahead' });
  assert.equal(yes.body.approval.status, 'Approved');
  assert.ok(yes.body.approval.decided_at);
  assert.equal(yes.body.can_decide, false);
  // Decided once.
  const again = await alpeshS('POST', `/api/desk/approvals/${approvalId}/decide`, { decision: 'Rejected', note: 'changed my mind' });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /not decided twice/);
  // A comment afterwards changes nothing.
  const after = await riyaS('POST', `/api/desk/approvals/${approvalId}/updates`, { text: 'Thank you' });
  assert.equal(after.body.approval.status, 'Approved');

  // AN APPROVAL PAYS NOBODY: 45,000 was approved and no payslip moved.
  assert.equal(await net(), before);
});

test('ranks are an Admin’s to set, and a rank decides whose work somebody sees', async () => {
  assert.equal((await riyaS('GET', '/api/desk/settings')).status, 403);
  assert.equal((await hrS('PUT', `/api/desk/ranks/${key(kiran)}`, { level: 1 })).status, 403);

  assert.ok(!(await kiranS('GET', '/api/desk')).body.tasks.some((t) => t.id === taskId));
  const set = await admin('PUT', `/api/desk/ranks/${key(kiran)}`, { level: 3 });
  assert.equal(set.status, 200);
  const k = set.body.people.find((p) => p.key === key(kiran));
  assert.deepEqual([k.rank, k.guessed], ['GM', false]);
  const sees = (await kiranS('GET', '/api/desk')).body;
  assert.ok(sees.tasks.some((t) => t.id === taskId), 'a GM sees the office’s work');
  assert.ok(!sees.tasks.some((t) => t.id === personalId), '...but never somebody’s own reminder');
  assert.ok(!sees.approvals.some((a) => a.id === approvalId), 'requests are for the top two rungs');
  assert.equal((await admin('PUT', `/api/desk/ranks/${key(kiran)}`, { level: 9 })).status, 400);
  // Handing it back to the guess.
  const back = await admin('PUT', `/api/desk/ranks/${key(kiran)}`, { level: null });
  assert.equal(back.body.people.find((p) => p.key === key(kiran)).guessed, true);
});

test('an office login tied to its employee becomes ONE person, and takes its work with it', async () => {
  const hrKey = `u:${hrUser.id}`;
  const before = (await admin('GET', '/api/desk')).body;
  assert.ok(before.people.some((p) => p.key === hrKey), 'until then she is on the list twice');
  assert.ok(before.people.some((p) => p.key === key(krupa)));

  const given = await admin('POST', '/api/desk/tasks', { title: 'Send the November muster', to: hrKey });
  assert.equal(given.status, 201);
  assert.ok((await hrS('GET', '/api/desk')).body.tasks.some((t) => t.id === given.body.id));

  const tied = await admin('PUT', `/api/desk/logins/${hrUser.id}`, { employee_id: krupa.id });
  assert.equal(tied.status, 200);
  assert.equal(tied.body.logins.find((l) => l.user_id === hrUser.id).employee_name, 'Krupa Mehta');
  assert.ok(!tied.body.people.some((p) => p.key === hrKey), 'one of her now');

  const hers = (await hrS('GET', '/api/desk')).body;
  assert.equal(hers.me.key, key(krupa));
  const moved = hers.tasks.find((t) => t.id === given.body.id);
  assert.equal(moved.to, key(krupa));
  // It is on her employee record now, so the office's list names her.
  assert.equal((await admin('GET', '/api/people/tasks')).body.tasks.find((t) => t.id === given.body.id).employee_id, krupa.id);
  // She keeps the rung her office role gives her, not a member of staff's.
  assert.equal(hers.me.rank, 'SM');

  // One person, one office login.
  const second = await admin('POST', '/api/auth/users', { username: 'other.hr', name: 'Other', role: 'hr', password: 'first-password-22' });
  const other = second.body.user || second.body;
  const clash = await admin('PUT', `/api/desk/logins/${other.id}`, { employee_id: krupa.id });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /already tied to another office login/);
});
