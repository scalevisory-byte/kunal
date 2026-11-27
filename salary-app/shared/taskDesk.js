/*
 * The Task & Approval Desk - the rules, with nothing of the screen or the
 * database in them.
 *
 * Dinesh sent the desk his office already runs as a Google Sheets web app
 * ("Book N Fly Task Desk") and said *"ye bhi add karo"*. What it does: work is
 * given to somebody with a date on it and talked through in one thread until
 * it is done; and a spend or a decision is sent UP to somebody for a yes, a no
 * or a question. This module is those rules, read by the server, the office
 * screen and the staff portal alike, so the three cannot disagree about who
 * may give work to whom.
 *
 * THREE THINGS IT IS NOT, said here because each would be easy to assume:
 *
 *  - It is not the People > Tasks list done twice. It is the SAME rows
 *    (staff_tasks); that list is the office's flat view of them and this is
 *    everybody's own.
 *  - An approval here PAYS NOBODY. It is a decision on record. A petrol bill
 *    is still paid from People > Claims into a named month, which is the one
 *    door money reaches a payslip through.
 *  - Nothing here sends anything. The desk it came from emails people; this
 *    app has no channel (see shared/digest.js for why), so what is waiting on
 *    somebody is shown to them on screen and counted on the tab.
 */

/**
 * The ladder, as his sheet has it, plus one rung his sheet did not need.
 *
 * His desk listed only the senior people - MD, CEO, GM, SM, HOD. Here every
 * employee can be signed in, so there is a sixth rung for everybody else.
 * A LOWER number is a HIGHER rank, as in his sheet.
 */
export const RANKS = [
  { level: 1, key: 'MD', label: 'Managing Director' },
  { level: 2, key: 'CEO', label: 'CEO' },
  { level: 3, key: 'GM', label: 'General Manager' },
  { level: 4, key: 'SM', label: 'Senior Manager' },
  { level: 5, key: 'HOD', label: 'Head of Department' },
  { level: 6, key: 'Staff', label: 'Staff' },
];

export const STAFF_LEVEL = 6;
/** MD and CEO see every approval and may speak on any task. */
export const SEES_ALL_APPROVALS = 2;
/** Through GM: the whole office's tasks, and the department view. */
export const SEES_ALL_TASKS = 3;

export const rankOf = (level) => RANKS.find((r) => r.level === Number(level)) || RANKS[RANKS.length - 1];
export const isLevel = (level) => RANKS.some((r) => r.level === Number(level));

/**
 * Where somebody stands when nobody has said.
 *
 * A guess, and marked as one on the screen that sets ranks: the office login's
 * role, or - for an employee - whether anybody reports to them. It exists so
 * the desk works the day it is installed instead of after eighty-six ranks
 * have been typed in; any of them can be set properly afterwards.
 */
export function defaultLevel({ role = '', reports = 0 } = {}) {
  if (role === 'admin') return 1;
  if (role === 'manager') return 3;
  if (role && role !== 'employee') return 4;
  return reports > 0 ? 5 : STAFF_LEVEL;
}

/* ---------------- tasks ---------------- */

export const TASK_STATUSES = ['Pending', 'In Progress', 'Waiting', 'Done'];

/** The three ways a task can be open. Stored beside the old open/done/dropped. */
export const STAGE_OF = { Pending: 'pending', 'In Progress': 'progress', Waiting: 'waiting' };
const STATUS_OF_STAGE = { pending: 'Pending', progress: 'In Progress', waiting: 'Waiting' };

/** Stored as low/normal/high since People > Tasks was built; shown as his desk shows them. */
export const PRIORITIES = [
  ['high', 'High'],
  ['normal', 'Medium'],
  ['low', 'Low'],
];
export const priorityLabel = (p) => PRIORITIES.find(([k]) => k === p)?.[1] || 'Medium';
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

/** No word on a task for this long and it is flagged - his desk's own figure. */
export const STALE_DAYS = 2;
const DAY = 864e5;

/**
 * What a stored row is called on the desk.
 *
 * `dropped` is not one of his four. It is this app's own, and it stays: a task
 * that was done is never deleted here, only dropped, so the word has to show.
 */
export function taskStatus(row) {
  if (row.status === 'done') return 'Done';
  if (row.status === 'dropped') return 'Dropped';
  return STATUS_OF_STAGE[row.stage] || 'Pending';
}

export const isClosed = (task) => task.status === 'Done' || task.status === 'Dropped';

/** Given to yourself: a reminder, and nobody else's business. */
export const isPersonal = (task) => Boolean(task.by) && task.by === task.to;

export const isOverdue = (task, today) =>
  !isClosed(task) && Boolean(task.due_on) && String(task.due_on) < String(today);

/** Open, and nobody has said anything about it for two days. */
export function isStale(task, now = Date.now()) {
  if (isClosed(task)) return false;
  const last = Date.parse(task.updated_at || task.created_at || '');
  if (!Number.isFinite(last)) return false;
  return now - last >= STALE_DAYS * DAY;
}

/**
 * May `me` give work to `other`?
 *
 *  - yourself, always: that is a personal reminder;
 *  - anybody who reports to you, whatever rank either of you holds;
 *  - from HOD upward, anybody at your rank or below it - his desk's rule.
 *
 * What it refuses is the part his desk never had to think about, because only
 * senior people were on it: one member of staff handing work to another.
 * Without that line every one of eighty-six logins could assign to the other
 * eighty-five.
 */
export function canAssign(me, other) {
  if (!me || !other) return false;
  if (me.key === other.key) return true;
  if (other.manager && other.manager === me.key) return true;
  return me.level < STAFF_LEVEL && other.level >= me.level;
}

/**
 * Who `me` can send a request up to: anybody above them, and their own
 * manager whatever the ranks say. Their manager first, then the nearest rung.
 *
 * Nobody approves their own request - there is no rung above yourself - so
 * the person at the top has an empty list, and the form says so.
 */
export function approversFor(me, people = []) {
  if (!me) return [];
  return people
    .filter((p) => p.key !== me.key && (p.level < me.level || (me.manager && p.key === me.manager)))
    .sort(
      (a, b) =>
        Number(b.key === me.manager) - Number(a.key === me.manager) ||
        b.level - a.level ||
        String(a.name).localeCompare(String(b.name))
    );
}

export const canSeeTask = (me, task) =>
  task.to === me.key || task.by === me.key || (me.level <= SEES_ALL_TASKS && !isPersonal(task));

/** Who may write on a task's thread: the two people on it, and the top two rungs. */
export const canPostOnTask = (me, task) =>
  task.to === me.key || task.by === me.key || (me.level <= SEES_ALL_APPROVALS && !isPersonal(task));

/**
 * The statuses `me` may move this task to.
 *
 * Whoever is doing it moves it along. Putting it BACK to pending - including
 * reopening one that was marked done - belongs to whoever gave it, because
 * "it is not done after all" is their call and not the doer's.
 */
export function statusChoices(me, task) {
  if (!canPostOnTask(me, task)) return [];
  const giver = task.by === me.key || (me.level <= SEES_ALL_APPROVALS && !isPersonal(task));
  if (isClosed(task)) return giver ? ['Pending'] : [];
  const out = ['In Progress', 'Waiting', 'Done'].filter((s) => s !== task.status);
  if (giver && task.status !== 'Pending') out.push('Pending');
  return out;
}

/** Open first, overdue first among those, then priority, then the date. */
export function sortTasks(list, today) {
  return [...list].sort(
    (a, b) =>
      Number(isClosed(a)) - Number(isClosed(b)) ||
      Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
      (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1) ||
      String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')) ||
      b.id - a.id
  );
}

/* ---------------- approvals ---------------- */

export const APPROVAL_STATUSES = ['Pending', 'Query', 'Approved', 'Rejected'];
export const DECISIONS = ['Approved', 'Rejected', 'Query'];

/** Still waiting on somebody. A query is open: it is waiting on the asker. */
export const approvalOpen = (a) => a.status === 'Pending' || a.status === 'Query';

export const canSeeApproval = (me, a) =>
  a.by === me.key || a.approver === me.key || me.level <= SEES_ALL_APPROVALS;

/** Only the person it was sent to, and only while it is open. Nothing is decided twice. */
export const canDecide = (me, a) => a.approver === me.key && approvalOpen(a);

export const canComment = (me, a) => canSeeApproval(me, a);

/* ---------------- the figures ---------------- */

/**
 * The six figures at the top of the desk and the week's completion ring.
 *
 * Counted off the same list the views draw, so a figure and the list it opens
 * cannot disagree.
 */
export function deskFigures(me, tasks = [], approvals = [], { today, now = Date.now() } = {}) {
  const mine = tasks.filter((t) => t.to === me.key);
  const given = tasks.filter((t) => t.by === me.key && t.to !== me.key);
  const myOpen = mine.filter((t) => !isClosed(t));
  const mineOrGiven = tasks.filter((t) => t.to === me.key || t.by === me.key);
  const weekAgo = now - 7 * DAY;
  const doneThisWeek = mine.filter((t) => t.status === 'Done' && Date.parse(t.done_at || '') > weekAgo);
  const base = myOpen.length + doneThisWeek.length;
  return {
    my_open: myOpen.length,
    given_open: given.filter((t) => !isClosed(t)).length,
    to_decide: approvals.filter((a) => canDecide(me, a)).length,
    my_requests_open: approvals.filter((a) => a.by === me.key && approvalOpen(a)).length,
    my_queries: approvals.filter((a) => a.by === me.key && a.status === 'Query').length,
    overdue: mineOrGiven.filter((t) => isOverdue(t, today)).length,
    stale: mineOrGiven.filter((t) => isStale(t, now)).length,
    done_week: doneThisWeek.length,
    // Nothing given and nothing done is not "0% of the week" - it is no week
    // to measure, so it is null and the ring says so.
    week_percent: base ? Math.round((doneThisWeek.length / base) * 100) : null,
  };
}

/**
 * What is waiting ON `me`, for the count on the tab.
 *
 * Deliberately not "everything open": a task somebody is halfway through is
 * not waiting on anybody. These are the three where the next move is theirs -
 * work given to them and not yet picked up, a request for them to decide, and
 * a question asked about a request of theirs.
 */
export function waitingOn(me, tasks = [], approvals = []) {
  const fresh = tasks.filter(
    (t) => t.to === me.key && t.by !== me.key && t.status === 'Pending'
  ).length;
  const decide = approvals.filter((a) => canDecide(me, a)).length;
  const queries = approvals.filter((a) => a.by === me.key && a.status === 'Query').length;
  return { tasks: fresh, approvals: decide, queries, total: fresh + decide + queries };
}

/** One line of it, or '' when there is nothing. */
export function waitingSentence(w) {
  if (!w || !w.total) return '';
  const bits = [];
  if (w.tasks) bits.push(`${w.tasks} new task${w.tasks === 1 ? '' : 's'}`);
  if (w.approvals) bits.push(`${w.approvals} approval${w.approvals === 1 ? '' : 's'} to decide`);
  if (w.queries) bits.push(`${w.queries} question${w.queries === 1 ? '' : 's'} on your request${w.queries === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

/**
 * Open / overdue / gone quiet / done this week, grouped by whatever `keyOf`
 * returns - a department, or a person. Worst first.
 *
 * Personal reminders are left out by the caller: they are nobody's workload
 * but their owner's.
 */
export function tally(tasks = [], keyOf, { today, now = Date.now() } = {}) {
  const weekAgo = now - 7 * DAY;
  const out = new Map();
  for (const task of tasks) {
    const key = keyOf(task) || '—';
    const line = out.get(key) || { key, open: 0, overdue: 0, stale: 0, done: 0, total: 0 };
    line.total += 1;
    if (!isClosed(task)) {
      line.open += 1;
      if (isOverdue(task, today)) line.overdue += 1;
      if (isStale(task, now)) line.stale += 1;
    } else if (task.status === 'Done' && Date.parse(task.done_at || '') > weekAgo) {
      line.done += 1;
    }
    out.set(key, line);
  }
  return [...out.values()].sort(
    (a, b) => b.overdue - a.overdue || b.open - a.open || String(a.key).localeCompare(String(b.key))
  );
}

/** Every word of the search has to land somewhere on the item. */
export function matches(item, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [item.code, item.title, item.detail, item.details, item.to_name, item.by_name, item.approver_name, item.department, item.status]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

export const taskCode = (id) => `T-${String(id).padStart(4, '0')}`;
export const approvalCode = (id) => `A-${String(id).padStart(4, '0')}`;

/**
 * The whole of what the desk says about a person.
 *
 * A name, where they sit and their rung. The directory goes to every signed-in
 * employee, so it must never grow a salary, a phone number or an identifier -
 * there is a test that reads this list.
 */
export const PERSON_FIELDS = ['key', 'name', 'rank', 'level', 'department', 'designation', 'manager', 'office'];
