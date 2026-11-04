/**
 * One person's whole picture, assembled from records that already exist.
 *
 * The People tab was panel-first: a screen per record type, each listing
 * everybody. That is the right shape for "which claims are waiting", and it
 * stays. It is the wrong shape for the question an office actually asks -
 * "what is going on with Vaibhav?" - which needed six screens and a memory.
 *
 * This module answers that question. It ASSEMBLES, it never recalculates and
 * it stores nothing: every figure here was written by the panel that owns it.
 * It deliberately does NOT duplicate the employee master, the documents on the
 * employee record, attendance, payroll, leave or the asset register - those
 * have their own modules and this points at them.
 */

/** What still wants doing for this person, worst first. */
export function pendingFor(file = {}, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const {
    employee = {},
    notes = [],
    appraisals = [],
    claims = [],
    tasks = [],
    tickets = [],
    exit = null,
    documents = [],
  } = file;

  const out = [];
  const add = (urgency, text, go) => out.push({ urgency, text, go });

  /*
   * An exit in progress outranks everything: dates are running and the last
   * payslip is about to be the last chance to recover anything.
   */
  if (exit && !exit.settled_on) {
    const when = exit.last_working_day || exit.resigned_on;
    add(
      when && when < today ? 'now' : 'soon',
      when && when < today
        ? `Left on ${when} and the full and final is not settled`
        : `Leaving${when ? ` on ${when}` : ''} — settlement not done`,
      'leaving'
    );
  }

  const unacknowledged = notes.filter((n) => n.kind === 'warning' && !n.acknowledged_on);
  if (unacknowledged.length) {
    add(
      'soon',
      `${count(unacknowledged.length, 'warning')} not acknowledged — a warning they never saw is not much of a warning`,
      'records'
    );
  }

  const overdue = tasks.filter((t) => t.status === 'open' && t.due_on && t.due_on < today);
  if (overdue.length) add('now', `${count(overdue.length, 'job')} past its date`, 'tasks');
  const openTasks = tasks.filter((t) => t.status === 'open' && !(t.due_on && t.due_on < today));
  if (openTasks.length) add('later', `${count(openTasks.length, 'job')} still open`, 'tasks');

  const pendingClaims = claims.filter((c) => c.status === 'pending');
  if (pendingClaims.length) {
    add('now', `${count(pendingClaims.length, 'claim')} waiting on a decision, ${rupees(sum(pendingClaims))}`, 'claims');
  }
  const approved = claims.filter((c) => c.status === 'approved');
  if (approved.length) {
    add('soon', `${count(approved.length, 'claim')} approved and not paid, ${rupees(sum(approved))}`, 'claims');
  }

  // Waiting on US, which is the only kind worth chasing.
  const waiting = tickets.filter((t) => t.status === 'open');
  if (waiting.length) add('now', `${count(waiting.length, 'question')} unanswered`, 'helpdesk');

  if (employee.probation_until) {
    if (employee.probation_until < today) {
      add('soon', `Probation finished on ${employee.probation_until} and nobody has confirmed them`, 'overview');
    } else {
      add('later', `Probation ends on ${employee.probation_until}`, 'overview');
    }
  }

  const nextReview = appraisals
    .map((a) => a.next_review_on)
    .filter(Boolean)
    .sort()
    .pop();
  if (nextReview && nextReview <= today) add('soon', `Appraisal was due on ${nextReview}`, 'appraisals');

  const expired = documents.filter((d) => d.expires_on && d.expires_on < today);
  if (expired.length) add('now', `${count(expired.length, 'document')} expired`, 'documents');

  const RANK = { now: 0, soon: 1, later: 2 };
  return out.sort((a, b) => RANK[a.urgency] - RANK[b.urgency]);
}

/**
 * What has happened to this person lately, in one list.
 *
 * Built from the records themselves and not from the audit trail, because the
 * trail says what somebody CHANGED and this says what HAPPENED - a warning
 * issued matters whether or not anybody edited it afterwards.
 */
export function recentFor(file = {}, { limit = 12 } = {}) {
  const { notes = [], appraisals = [], claims = [], tasks = [], tickets = [], exit = null } = file;
  const events = [];

  for (const n of notes) {
    events.push({ on: n.dated, what: label(n.kind), text: n.subject, go: 'records' });
  }
  for (const a of appraisals) {
    events.push({
      on: a.reviewed_on,
      what: 'Appraisal',
      text: [a.cycle, a.rating && `rated ${a.rating}`, a.applied_at && 'increment applied']
        .filter(Boolean)
        .join(' · ') || 'reviewed',
      go: 'appraisals',
    });
  }
  for (const c of claims) {
    events.push({ on: c.spent_on, what: 'Claim', text: `${c.kind} ${rupees(c.amount)} — ${c.status}`, go: 'claims' });
  }
  for (const t of tasks) {
    events.push({
      on: t.done_on || t.due_on || day(t.created_at),
      what: 'Task',
      text: `${t.title} — ${t.status}`,
      go: 'tasks',
    });
  }
  for (const t of tickets) {
    events.push({ on: day(t.created_at), what: 'Helpdesk', text: `${t.subject} — ${t.status}`, go: 'helpdesk' });
  }
  if (exit) {
    events.push({
      on: exit.last_working_day || exit.resigned_on,
      what: 'Leaving',
      text: exit.settled_on ? `settled ${exit.settled_on}` : 'settlement not done',
      go: 'leaving',
    });
  }

  return events
    .filter((e) => e.on)
    .sort((a, b) => String(b.on).localeCompare(String(a.on)))
    .slice(0, limit);
}

/** The headline figures the overview shows, each from the panel that owns it. */
export function summaryFor(file = {}) {
  const { notes = [], appraisals = [], claims = [], tasks = [], tickets = [] } = file;
  const applied = appraisals.filter((a) => a.applied_at);
  return {
    warnings: notes.filter((n) => n.kind === 'warning').length,
    appreciations: notes.filter((n) => n.kind === 'appreciation').length,
    open_tasks: tasks.filter((t) => t.status === 'open').length,
    open_tickets: tickets.filter((t) => t.status !== 'closed').length,
    claims_pending: claims.filter((c) => c.status === 'pending').length,
    claims_paid_total: sum(claims.filter((c) => c.status === 'paid')),
    increments: applied.length,
    // The last rise actually paid, not the latest proposal.
    last_increment: applied
      .slice()
      .sort((a, b) => String(a.reviewed_on).localeCompare(String(b.reviewed_on)))
      .pop() || null,
  };
}

/**
 * Employment status, in the words an office uses.
 *
 * Read off the master and the exit, never stored: a second copy of "is this
 * person still here" is how two screens end up disagreeing.
 */
export function statusOf(employee = {}, exit = null, today = new Date().toISOString().slice(0, 10)) {
  if (employee.active === 0 || employee.left_on) return { key: 'left', label: 'Left' };
  if (exit && !exit.settled_on) return { key: 'leaving', label: 'Serving notice' };
  if (employee.probation_until && employee.probation_until >= today) {
    return { key: 'probation', label: 'On probation' };
  }
  return { key: 'working', label: 'Working' };
}

/** How long they have been here, said the way a person would say it. */
export function serviceOf(joinedOn, today = new Date().toISOString().slice(0, 10)) {
  if (!joinedOn) return '';
  const from = new Date(`${String(joinedOn).slice(0, 10)}T00:00:00Z`);
  const to = new Date(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return '';
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years && rest) return `${years}y ${rest}m`;
  if (years) return `${years}y`;
  return `${Math.max(rest, 0)}m`;
}

/* ---------------- small helpers ---------------- */

const sum = (rows) => rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);
const day = (at) => String(at || '').slice(0, 10);
const label = (kind) =>
  kind === 'warning' ? 'Warning' : kind === 'appreciation' ? 'Appreciation' : 'Note';

function count(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function rupees(value) {
  const n = Math.round(Number(value) || 0);
  return `₹${n.toLocaleString('en-IN')}`;
}
