/*
 * The Task & Approval Desk, on the server.
 *
 * The rules are in shared/taskDesk.js. This file is the three things rules
 * cannot be: WHO somebody is, what is stored, and the checks that have to be
 * made again on the server because a screen can be walked round.
 *
 * WHO SOMEBODY IS. The desk his office ran had its own list of users. This
 * one has none - a desk person is somebody the HRMS already knows:
 *
 *   e:12   the employee with id 12
 *   u:3    the office login with id 3, when that login is not an employee
 *
 * and the key comes off the LOGIN, never a URL or a body, the rule every
 * /api/me route already follows. An office login can be tied to the employee
 * it belongs to (desk_links), and then it IS that employee here - otherwise
 * the same human would be on the list twice, and work given to one of them
 * would never be seen by the other.
 *
 * A task is a row of staff_tasks (see people.js for why it is not a table of
 * its own). An approval is a row here. NEITHER MOVES MONEY: an approved
 * amount is a decision on record and reaches no payslip, claim or ledger.
 */
import { db, getEmployee } from './db.js';
import { addDeskUpdate } from './people.js';
import { listUsers } from './users.js';
import { todayIso } from '../../shared/today.js';
import {
  DECISIONS,
  PERSON_FIELDS,
  PRIORITIES,
  STAGE_OF,
  approvalCode,
  approversFor,
  canAssign,
  canComment,
  canDecide,
  canPostOnTask,
  canSeeApproval,
  canSeeTask,
  defaultLevel,
  isLevel,
  isPersonal,
  rankOf,
  statusChoices,
  taskCode,
  taskStatus,
  waitingOn,
} from '../../shared/taskDesk.js';

db.exec(`
  -- Something sent UP for a yes, a no or a question. The amount is what is
  -- being asked about, not a payment: nothing reads this table to pay anybody.
  CREATE TABLE IF NOT EXISTS desk_approvals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    details        TEXT,
    amount         REAL,
    by_key         TEXT NOT NULL,
    by_name        TEXT,
    approver_key   TEXT NOT NULL,
    approver_name  TEXT,
    -- pending | query | approved | rejected
    status         TEXT NOT NULL DEFAULT 'pending',
    decision_note  TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    decided_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_desk_approvals_open ON desk_approvals(status, approver_key);

  -- A rank somebody SET. No row means the rank is worked out (see
  -- defaultLevel), which is what the screen marks as a guess.
  CREATE TABLE IF NOT EXISTS desk_ranks (
    person_key  TEXT PRIMARY KEY,
    level       INTEGER NOT NULL,
    set_by      TEXT,
    set_at      TEXT NOT NULL
  );

  -- "This office login is that employee." One login, one person, and one
  -- person at most one office login tied to them.
  CREATE TABLE IF NOT EXISTS desk_links (
    user_id      INTEGER PRIMARY KEY,
    employee_id  INTEGER NOT NULL UNIQUE
  );

  -- When somebody last opened their notifications.
  CREATE TABLE IF NOT EXISTS desk_seen (
    person_key  TEXT PRIMARY KEY,
    seen_at     TEXT NOT NULL
  );
`);

const nowIso = () => new Date().toISOString();

/** SQLite's own datetime('now') is UTC with a space in it; make it an ISO stamp. */
const iso = (v) => {
  if (!v) return null;
  const s = String(v);
  return s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
};

const STATUS_LABEL = { pending: 'Pending', query: 'Query', approved: 'Approved', rejected: 'Rejected' };

/* ================================================================= *
 * who is on the desk
 * ================================================================= */

const employeeKey = (id) => `e:${id}`;
const userKey = (id) => `u:${id}`;
/** Signed in with the shared key, or on an install nobody guards: there is no login to name. */
const OFFICE_KEY = 'u:0';

const linkOfUser = (userId) =>
  db.prepare(`SELECT employee_id FROM desk_links WHERE user_id = ?`).get(userId)?.employee_id || null;

/**
 * Everybody the desk knows, once per request.
 *
 * Employees who are on the staff now, and office logins that are not tied to
 * one of them. Somebody who has left is not offered - but their name still
 * resolves on the work they were part of, through `nameOf` below.
 */
export function deskDirectory() {
  const set = new Map(db.prepare(`SELECT person_key, level FROM desk_ranks`).all().map((r) => [r.person_key, r.level]));
  const links = db.prepare(`SELECT user_id, employee_id FROM desk_links`).all();
  const users = listUsers().filter((u) => u.active && u.role !== 'employee');
  const roleOfEmployee = new Map();
  const linked = new Set();
  for (const link of links) {
    const user = users.find((u) => u.id === link.user_id);
    if (!user) continue;
    roleOfEmployee.set(link.employee_id, user.role);
    linked.add(user.id);
  }

  const employees = db
    .prepare(
      `SELECT e.id, e.name, e.department, e.designation, e.reports_to_id, c.name AS company_name
       FROM employees e LEFT JOIN companies c ON c.id = e.company_id
       WHERE e.active = 1 AND COALESCE(e.is_draft, 0) = 0
       ORDER BY e.name`
    )
    .all();
  const reports = new Map();
  for (const e of employees) {
    if (e.reports_to_id) reports.set(e.reports_to_id, (reports.get(e.reports_to_id) || 0) + 1);
  }

  const people = [];
  for (const e of employees) {
    const key = employeeKey(e.id);
    const guess = defaultLevel({ role: roleOfEmployee.get(e.id) || 'employee', reports: reports.get(e.id) || 0 });
    const level = set.get(key) ?? guess;
    people.push({
      key,
      name: e.name,
      level,
      rank: rankOf(level).key,
      department: e.department || e.company_name || '',
      designation: e.designation || '',
      manager: e.reports_to_id ? employeeKey(e.reports_to_id) : null,
      office: false,
      guessed: !set.has(key),
    });
  }
  for (const u of users) {
    if (linked.has(u.id)) continue;
    const key = userKey(u.id);
    const level = set.get(key) ?? defaultLevel({ role: u.role });
    people.push({
      key,
      name: u.name,
      level,
      rank: rankOf(level).key,
      department: 'Office',
      designation: u.role,
      manager: null,
      office: true,
      guessed: !set.has(key),
    });
  }
  return people;
}

/** Only what may leave the server about a person. */
const publicPerson = (p) => Object.fromEntries(PERSON_FIELDS.map((f) => [f, p[f] ?? null]));

/**
 * The person this login is.
 *
 * Read off `req.actor`, which requireAuth built from the session - so nothing
 * a caller sends can make them somebody else.
 */
export function deskMe(actor, directory = deskDirectory()) {
  let key = OFFICE_KEY;
  if (actor?.role === 'employee' && actor.employee_id) key = employeeKey(actor.employee_id);
  else if (actor?.id) {
    const employeeId = linkOfUser(actor.id);
    key = employeeId ? employeeKey(employeeId) : userKey(actor.id);
  }
  const found = directory.find((p) => p.key === key);
  if (found) return found;
  if (key === OFFICE_KEY) {
    return { key, name: 'Office', level: 1, rank: rankOf(1).key, department: 'Office', designation: '', manager: null, office: true, guessed: true };
  }
  // A staff login for somebody since marked as left, or a draft. They can
  // still read what was theirs; they are simply not offered to anybody.
  const name = nameOf(key) || actor?.name || 'Somebody';
  return { key, name, level: 6, rank: rankOf(6).key, department: '', designation: '', manager: null, office: false, guessed: true };
}

/** A name for a key, whether or not that person is still on the desk. */
function nameOf(key) {
  if (!key) return null;
  const [kind, id] = String(key).split(':');
  if (key === OFFICE_KEY) return 'Office';
  if (kind === 'e') return db.prepare(`SELECT name FROM employees WHERE id = ?`).get(Number(id))?.name || null;
  if (kind === 'u') return db.prepare(`SELECT name FROM users WHERE id = ?`).get(Number(id))?.name || null;
  return null;
}

/* ================================================================= *
 * tasks
 * ================================================================= */

const TASK_SQL = `
  SELECT t.*, e.name AS employee_name, e.department AS employee_department, c.name AS company_name
  FROM staff_tasks t
  LEFT JOIN employees e ON e.id = t.employee_id
  LEFT JOIN companies c ON c.id = e.company_id`;

function shapeTask(row, names) {
  const to = row.assignee_key || (row.employee_id ? employeeKey(row.employee_id) : null);
  const created = iso(row.created_at);
  const task = {
    id: row.id,
    code: taskCode(row.id),
    title: row.title,
    detail: row.detail || '',
    to,
    to_name: row.employee_name || names(to) || '—',
    by: row.by_key || null,
    // An old row carries only the name somebody typed. It is shown as typed
    // and matches nobody, which is the truth about it.
    by_name: (row.by_key && names(row.by_key)) || row.assigned_by || '—',
    department: row.employee_department || row.company_name || (to && to.startsWith('u:') ? 'Office' : ''),
    priority: PRIORITIES.some(([k]) => k === row.priority) ? row.priority : 'normal',
    due_on: row.due_on || null,
    status: taskStatus(row),
    created_at: created,
    updated_at: iso(row.updated_at) || created,
    done_at: row.status === 'done' ? iso(row.done_at) || (row.done_on ? `${row.done_on}T12:00:00Z` : null) : null,
  };
  task.personal = isPersonal(task);
  return task;
}

const namesFor = (directory) => {
  const known = new Map(directory.map((p) => [p.key, p.name]));
  return (key) => (key ? known.get(key) ?? nameOf(key) : null);
};

export function deskTasks(me, directory = deskDirectory()) {
  const names = namesFor(directory);
  return db
    .prepare(`${TASK_SQL} ORDER BY t.id DESC LIMIT 2000`)
    .all()
    .map((row) => shapeTask(row, names))
    .filter((task) => canSeeTask(me, task));
}

function taskById(id, directory) {
  const row = db.prepare(`${TASK_SQL} WHERE t.id = ?`).get(Number(id));
  return row ? shapeTask(row, namesFor(directory)) : null;
}

const threadOf = (type, id) =>
  db
    .prepare(
      `SELECT id, by_key, by_name, body, status, system, created_at
       FROM desk_updates WHERE ref_type = ? AND ref_id = ? ORDER BY id`
    )
    .all(type, Number(id))
    .map((u) => ({ ...u, system: Boolean(u.system) }));

export function deskTaskDetail(actor, id) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const task = taskById(id, directory);
  // Not theirs reads as not there: this route has no business confirming a
  // task exists to somebody who may not see it.
  if (!task || !canSeeTask(me, task)) throw notFound();
  return {
    task,
    updates: threadOf('task', task.id),
    can_post: canPostOnTask(me, task),
    choices: statusChoices(me, task),
  };
}

export function createDeskTask(actor, input = {}) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const title = String(input.title || '').trim();
  if (!title) throw new Error('What needs to be done? Give it a title.');
  if (title.length > 200) throw new Error('Keep the title under 200 letters — the detail goes in the box below it.');
  const toKey = String(input.to || '').trim() || me.key;
  const to = toKey === me.key ? me : directory.find((p) => p.key === toKey);
  if (!to) throw new Error('That person is not on the desk — pick somebody from the list.');
  if (!canAssign(me, to)) {
    throw new Error(
      `You cannot give work to ${to.name}. A task goes to yourself, to somebody who reports to you, ` +
        `or — from Head of Department upward — to somebody at your level or below it.`
    );
  }
  const due = String(input.due_on || '').trim();
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('The due date is not a date.');
  const priority = PRIORITIES.some(([k]) => k === input.priority) ? input.priority : 'normal';
  const at = nowIso();
  const employeeId = to.key.startsWith('e:') ? Number(to.key.slice(2)) : null;

  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO staff_tasks
           (employee_id, title, detail, assigned_by, due_on, priority, stage, by_key, assignee_key, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(employeeId, title, String(input.detail || '').trim() || null, me.name, due || null, priority, me.key, to.key, at);
    addDeskUpdate({
      ref_type: 'task',
      ref_id: info.lastInsertRowid,
      by_key: me.key,
      by_name: me.name,
      body: to.key === me.key ? 'Personal task created' : `Task given to ${to.name}`,
      system: true,
    });
    return info.lastInsertRowid;
  })();
  return taskById(id, directory);
}

/**
 * A line on a task's thread, which may also move it.
 *
 * The words are REQUIRED even when only the status changes - "Waiting" with
 * nothing said about what it is waiting for is the update that gets chased.
 */
export function addTaskUpdate(actor, id, { text, status } = {}) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const task = taskById(id, directory);
  if (!task || !canSeeTask(me, task)) throw notFound();
  if (!canPostOnTask(me, task)) throw forbidden('This task is between the person who gave it and the person doing it.');
  const body = String(text || '').trim();
  if (!body) throw new Error('Write a line first — what happened, or what it is waiting for.');
  const move = String(status || '').trim();
  if (move && !statusChoices(me, task).includes(move)) {
    throw new Error(
      move === 'Pending'
        ? 'Putting a task back to pending is for whoever gave it.'
        : `This task cannot be moved to ${move} from ${task.status}.`
    );
  }
  db.transaction(() => {
    const at = addDeskUpdate({
      ref_type: 'task',
      ref_id: task.id,
      by_key: me.key,
      by_name: me.name,
      body,
      status: move || null,
    });
    if (move === 'Done') {
      db.prepare(
        `UPDATE staff_tasks SET status = 'done', done_on = ?, done_at = ?, done_note = ?, updated_at = ? WHERE id = ?`
      ).run(todayIso(), at, body.slice(0, 500), at, task.id);
    } else if (move) {
      db.prepare(
        `UPDATE staff_tasks SET status = 'open', stage = ?, done_on = NULL, done_at = NULL, updated_at = ? WHERE id = ?`
      ).run(STAGE_OF[move], at, task.id);
    } else {
      db.prepare(`UPDATE staff_tasks SET updated_at = ? WHERE id = ?`).run(at, task.id);
    }
  })();
  return deskTaskDetail(actor, task.id);
}

/* ================================================================= *
 * approvals
 * ================================================================= */

function shapeApproval(row, names) {
  return {
    id: row.id,
    code: approvalCode(row.id),
    title: row.title,
    details: row.details || '',
    amount: row.amount ?? null,
    by: row.by_key,
    by_name: names(row.by_key) || row.by_name || '—',
    approver: row.approver_key,
    approver_name: names(row.approver_key) || row.approver_name || '—',
    status: STATUS_LABEL[row.status] || 'Pending',
    decision_note: row.decision_note || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    decided_at: row.decided_at || null,
  };
}

export function deskApprovals(me, directory = deskDirectory()) {
  const names = namesFor(directory);
  return db
    .prepare(`SELECT * FROM desk_approvals ORDER BY id DESC LIMIT 2000`)
    .all()
    .map((row) => shapeApproval(row, names))
    .filter((a) => canSeeApproval(me, a));
}

function approvalById(id, directory) {
  const row = db.prepare(`SELECT * FROM desk_approvals WHERE id = ?`).get(Number(id));
  return row ? shapeApproval(row, namesFor(directory)) : null;
}

export function deskApprovalDetail(actor, id) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const approval = approvalById(id, directory);
  if (!approval || !canSeeApproval(me, approval)) throw notFound();
  return {
    approval,
    updates: threadOf('approval', approval.id),
    can_decide: canDecide(me, approval),
    can_comment: canComment(me, approval),
  };
}

export function createDeskApproval(actor, input = {}) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const title = String(input.title || '').trim();
  if (!title) throw new Error('What needs approval? Give it a title.');
  if (title.length > 200) throw new Error('Keep the title under 200 letters — the reason goes in the details.');
  const approver = approversFor(me, directory).find((p) => p.key === String(input.approver || ''));
  if (!approver) {
    throw new Error(
      'Pick who should approve it. A request goes to somebody above you, or to your own manager — never to yourself.'
    );
  }
  let amount = null;
  if (input.amount !== undefined && input.amount !== null && String(input.amount).trim() !== '') {
    amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('The amount is not a figure.');
  }
  const at = nowIso();
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO desk_approvals
           (title, details, amount, by_key, by_name, approver_key, approver_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(title, String(input.details || '').trim() || null, amount, me.key, me.name, approver.key, approver.name, at, at);
    addDeskUpdate({
      ref_type: 'approval',
      ref_id: info.lastInsertRowid,
      by_key: me.key,
      by_name: me.name,
      body: `Approval requested from ${approver.name}`,
      system: true,
    });
    return info.lastInsertRowid;
  })();
  return approvalById(id, directory);
}

/**
 * Yes, no, or a question.
 *
 * Only the person it was sent to, and only while it is open: an approval is
 * not decided twice, and a rejection is not quietly turned into a yes later.
 * A question needs its words - "Query" with nothing asked is a request sent
 * back for no stated reason.
 */
export function decideDeskApproval(actor, id, { decision, note } = {}) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const approval = approvalById(id, directory);
  if (!approval || !canSeeApproval(me, approval)) throw notFound();
  if (approval.approver !== me.key) throw forbidden(`This request was sent to ${approval.approver_name}. Only they can decide it.`);
  if (!canDecide(me, approval)) throw new Error(`This request is already ${approval.status.toLowerCase()}. It is not decided twice.`);
  if (!DECISIONS.includes(decision)) throw new Error('Approve it, reject it, or ask a question.');
  const words = String(note || '').trim();
  if (decision === 'Query' && !words) throw new Error('Write the question you are asking.');
  db.transaction(() => {
    const at = addDeskUpdate({
      ref_type: 'approval',
      ref_id: approval.id,
      by_key: me.key,
      by_name: me.name,
      body: words || decision,
      status: decision,
    });
    db.prepare(
      `UPDATE desk_approvals SET status = ?, decision_note = ?, decided_at = ?, updated_at = ? WHERE id = ?`
    ).run(decision.toLowerCase(), words || null, decision === 'Query' ? null : at, at, approval.id);
  })();
  return deskApprovalDetail(actor, approval.id);
}

/**
 * A line on a request's thread.
 *
 * When the person who asked answers a question, the request goes back to
 * PENDING - the next move is the approver's again. That is the only status a
 * comment can change; a comment never approves anything.
 */
export function addApprovalUpdate(actor, id, { text } = {}) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const approval = approvalById(id, directory);
  if (!approval || !canSeeApproval(me, approval)) throw notFound();
  const body = String(text || '').trim();
  if (!body) throw new Error('Write a line first.');
  const answers = approval.status === 'Query' && approval.by === me.key;
  db.transaction(() => {
    const at = addDeskUpdate({
      ref_type: 'approval',
      ref_id: approval.id,
      by_key: me.key,
      by_name: me.name,
      body,
      status: answers ? 'Pending' : null,
    });
    if (answers) {
      db.prepare(`UPDATE desk_approvals SET status = 'pending', updated_at = ? WHERE id = ?`).run(at, approval.id);
    } else {
      db.prepare(`UPDATE desk_approvals SET updated_at = ? WHERE id = ?`).run(at, approval.id);
    }
  })();
  return deskApprovalDetail(actor, approval.id);
}

/* ================================================================= *
 * what is new, and what is waiting
 * ================================================================= */

const DAY = 864e5;

/**
 * Lines other people wrote on things `me` is part of, newest first.
 *
 * `unseen` counts the ones since they last opened the list. Somebody who has
 * never opened it gets the last week rather than everything since the desk
 * was installed, and rather than nothing.
 */
function notificationsFor(me, tasks, approvals) {
  const mineT = new Map(tasks.filter((t) => t.to === me.key || t.by === me.key).map((t) => [t.id, t]));
  const mineA = new Map(approvals.filter((a) => a.by === me.key || a.approver === me.key).map((a) => [a.id, a]));
  const seenAt =
    db.prepare(`SELECT seen_at FROM desk_seen WHERE person_key = ?`).get(me.key)?.seen_at ||
    new Date(Date.now() - 7 * DAY).toISOString();
  const rows = db
    .prepare(
      `SELECT id, ref_type, ref_id, by_key, by_name, body, status, system, created_at
       FROM desk_updates WHERE COALESCE(by_key, '') <> ? ORDER BY id DESC LIMIT 400`
    )
    .all(me.key);
  const items = [];
  for (const u of rows) {
    const ref = u.ref_type === 'task' ? mineT.get(u.ref_id) : mineA.get(u.ref_id);
    if (!ref) continue;
    items.push({
      id: u.id,
      ref_type: u.ref_type,
      ref_id: u.ref_id,
      code: ref.code,
      title: ref.title,
      by_name: u.by_name || '—',
      body: u.body,
      status: u.status,
      system: Boolean(u.system),
      created_at: u.created_at,
      unseen: u.created_at > seenAt,
    });
    if (items.length >= 30) break;
  }
  return { items, unseen: items.filter((i) => i.unseen).length };
}

export function markDeskSeen(actor) {
  const me = deskMe(actor);
  db.prepare(
    `INSERT INTO desk_seen (person_key, seen_at) VALUES (?, ?)
     ON CONFLICT(person_key) DO UPDATE SET seen_at = excluded.seen_at`
  ).run(me.key, nowIso());
  return { ok: true };
}

/** Everything the screen draws, in one read. */
export function deskBootstrap(actor) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const tasks = deskTasks(me, directory);
  const approvals = deskApprovals(me, directory);
  const news = notificationsFor(me, tasks, approvals);
  return {
    // `shared` is the shared key or an unguarded install: no login to name,
    // so the desk can show them work but nobody can give them any.
    me: { ...publicPerson(me), guessed: Boolean(me.guessed), shared: me.key === OFFICE_KEY },
    people: directory.map(publicPerson),
    assignable: directory.filter((p) => p.key !== me.key && canAssign(me, p)).map((p) => p.key),
    approvers: approversFor(me, directory).map((p) => p.key),
    tasks,
    approvals,
    notifications: news.items,
    unseen: news.unseen,
    waiting: waitingOn(me, tasks, approvals),
    today: todayIso(),
    can_manage: Boolean(actor?.abilities?.includes('admin')),
  };
}

/** Just the count, for the tab - asked every minute, so it draws nothing else. */
export function deskWaiting(actor) {
  const directory = deskDirectory();
  const me = deskMe(actor, directory);
  const tasks = deskTasks(me, directory);
  const approvals = deskApprovals(me, directory);
  return { ...waitingOn(me, tasks, approvals), unseen: notificationsFor(me, tasks, approvals).unseen };
}

/* ================================================================= *
 * ranks, and which login is which person - the admin's two settings
 * ================================================================= */

export function deskSettings() {
  const directory = deskDirectory();
  const links = db.prepare(`SELECT user_id, employee_id FROM desk_links`).all();
  const logins = listUsers()
    .filter((u) => u.active && u.role !== 'employee')
    .map((u) => {
      const employeeId = links.find((l) => l.user_id === u.id)?.employee_id || null;
      return {
        user_id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        employee_id: employeeId,
        employee_name: employeeId ? nameOf(employeeKey(employeeId)) : null,
      };
    });
  return {
    people: directory.map((p) => ({ ...publicPerson(p), guessed: Boolean(p.guessed) })),
    logins,
  };
}

export function setDeskRank(actor, key, level) {
  const person = deskDirectory().find((p) => p.key === String(key));
  if (!person) throw notFound();
  if (level === null || level === '' || level === undefined) {
    db.prepare(`DELETE FROM desk_ranks WHERE person_key = ?`).run(person.key);
    return deskSettings();
  }
  if (!isLevel(level)) throw new Error('That is not one of the ranks.');
  db.prepare(
    `INSERT INTO desk_ranks (person_key, level, set_by, set_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(person_key) DO UPDATE SET level = excluded.level, set_by = excluded.set_by, set_at = excluded.set_at`
  ).run(person.key, Number(level), actor?.name || null, nowIso());
  return deskSettings();
}

/**
 * Say that an office login IS an employee - or that it is not, after all.
 *
 * Tying them moves everything that login already had on the desk onto the
 * employee, in one transaction, because the whole point is that there is one
 * of them. Untying does NOT move it back: by then the work belongs to the
 * person, and splitting it again would be a guess about which half was whose.
 */
export function linkDeskLogin(actor, userId, employeeId) {
  const user = listUsers().find((u) => u.id === Number(userId));
  if (!user || user.role === 'employee') throw notFound();
  if (!employeeId) {
    db.prepare(`DELETE FROM desk_links WHERE user_id = ?`).run(user.id);
    return deskSettings();
  }
  const employee = getEmployee(Number(employeeId));
  if (!employee) throw new Error('employee not found');
  const taken = db.prepare(`SELECT user_id FROM desk_links WHERE employee_id = ? AND user_id <> ?`).get(employee.id, user.id);
  if (taken) {
    throw new Error(`${employee.name} is already tied to another office login. One person, one login.`);
  }
  const from = userKey(user.id);
  const to = employeeKey(employee.id);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO desk_links (user_id, employee_id) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET employee_id = excluded.employee_id`
    ).run(user.id, employee.id);
    db.prepare(`UPDATE staff_tasks SET by_key = ? WHERE by_key = ?`).run(to, from);
    db.prepare(`UPDATE staff_tasks SET assignee_key = ?, employee_id = ? WHERE assignee_key = ?`).run(to, employee.id, from);
    db.prepare(`UPDATE desk_approvals SET by_key = ? WHERE by_key = ?`).run(to, from);
    db.prepare(`UPDATE desk_approvals SET approver_key = ? WHERE approver_key = ?`).run(to, from);
    db.prepare(`UPDATE desk_updates SET by_key = ? WHERE by_key = ?`).run(to, from);
    // A rank set on the login follows the person, unless the person already
    // has one of their own - that one was set knowingly and wins.
    const rank = db.prepare(`SELECT level, set_by, set_at FROM desk_ranks WHERE person_key = ?`).get(from);
    if (rank) {
      db.prepare(`INSERT OR IGNORE INTO desk_ranks (person_key, level, set_by, set_at) VALUES (?, ?, ?, ?)`).run(
        to, rank.level, rank.set_by, rank.set_at
      );
      db.prepare(`DELETE FROM desk_ranks WHERE person_key = ?`).run(from);
    }
    db.prepare(`DELETE FROM desk_seen WHERE person_key = ?`).run(from);
  })();
  return deskSettings();
}

/* ---------------- errors with a status on them ---------------- */

function notFound() {
  const err = new Error('not found');
  err.status = 404;
  return err;
}
function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}
