/*
 * RENEWAL MANAGEMENT (v2.40.0): licences, rent agreements and insurance
 * policies as one register of things that run out.
 *
 * All three already lived on the `licenses` table (v2.35.0 added rent and
 * insurance as kinds, so a second register would have been two lists by the
 * second fix). This module holds what the redesign brief added on top:
 *
 *   - the CATEGORY a record belongs to (software / rent / insurance), worked
 *     out from its kind, never stored, so it cannot disagree with the kind;
 *   - the renewal WORKFLOW: upcoming -> review -> approval -> payment ->
 *     renewed. Marking it renewed is the existing renewal call, which writes
 *     the old period into the renewal history first;
 *   - configurable REMINDER steps (90/60/30/7 days, the day, after) and which
 *     have come due - logged once each so none is shown twice;
 *   - the Overview's figures and the COST sums, with billing cycles turned
 *     into a monthly and a yearly figure the same way everywhere.
 *
 * The status a person reads is one of: Active, Upcoming, Review required,
 * Pending approval, Pending payment, Expired, Cancelled. "Renewed" is a row in
 * the history, not a state a record sits in: once renewed it is Active again.
 */

import { annualCost } from './licenses.js';

export const CATEGORIES = [
  { key: 'software', label: 'Licenses & Subscriptions', noun: 'licence' },
  { key: 'rent', label: 'Rent Agreements', noun: 'rent agreement' },
  { key: 'insurance', label: 'Insurance Policies', noun: 'insurance policy' },
];

export const categoryOf = (row = {}) =>
  row.kind === 'Rent agreement' ? 'rent' : row.kind === 'Insurance policy' ? 'insurance' : 'software';

export const STAGE_STEPS = {
  review: { from: [null, ''], to: 'review', label: 'Start review' },
  submit: { from: [null, '', 'review'], to: 'pending_approval', label: 'Submit for approval' },
  approve: { from: ['pending_approval'], to: 'pending_payment', label: 'Approve', approve: true },
  reject: { from: ['pending_approval'], to: 'review', label: 'Send back', approve: true, needsNote: true },
  withdraw: { from: ['review', 'pending_approval', 'pending_payment'], to: null, label: 'Drop the renewal', needsNote: true },
};

export const STAGE_LABELS = {
  review: 'Review required',
  pending_approval: 'Pending approval',
  pending_payment: 'Pending payment',
};

/** Why a step cannot be taken, or null. */
export function stageProblem(record, step, { canApprove = false, proposed_until, note } = {}) {
  const s = STAGE_STEPS[step];
  if (!record) return 'that record is not on the register';
  if (!s) return `unknown step: ${step}`;
  if (record.cancelled_on) return 'a cancelled record is not renewed — un-cancel it first';
  if (!s.from.includes(record.renewal_stage ?? null) && !s.from.includes(record.renewal_stage ?? '')) {
    return `it is ${STAGE_LABELS[record.renewal_stage] || 'not in a renewal'} — that step does not follow`;
  }
  if (s.approve && !canApprove) return 'only a Manager or an Admin can approve a renewal';
  if (s.needsNote && !String(note || '').trim()) return 'say why';
  if (step === 'submit' && !(proposed_until || record.proposed_until)) {
    return 'say the new end date before it goes for approval';
  }
  return null;
}

/** The one status a person reads, from the date and the workflow together. */
export function renewalStatus(row = {}, today) {
  if (row.cancelled_on) return { key: 'cancelled', label: 'Cancelled', tone: 'muted' };
  if (row.renewal_stage && STAGE_LABELS[row.renewal_stage]) {
    return { key: row.renewal_stage, label: STAGE_LABELS[row.renewal_stage], tone: 'warn' };
  }
  const d = row.days_left;
  if (d === null || d === undefined) {
    return row.status === 'perpetual'
      ? { key: 'active', label: 'Active', tone: 'good' }
      : { key: 'no_date', label: 'No end date', tone: 'muted' };
  }
  if (d < 0) return { key: 'expired', label: 'Expired', tone: 'bad' };
  if (d <= 60) return { key: 'upcoming', label: d <= 30 ? `Due in ${d}d` : 'Upcoming', tone: d <= 30 ? 'bad' : 'warn' };
  return { key: 'active', label: 'Active', tone: 'good' };
}

/* ------------------------------ reminders ------------------------------ */

/** The steps, in days before expiry; 0 is the day, a negative is after it. */
export const DEFAULT_REMINDER_STEPS = [90, 60, 30, 7, 0, -1];

export function cleanSteps(steps) {
  const list = (Array.isArray(steps) ? steps : DEFAULT_REMINDER_STEPS)
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n >= -30 && n <= 365);
  return [...new Set(list)].sort((a, b) => b - a);
}

export const stepLabel = (n) =>
  n > 0 ? `${n} days before` : n === 0 ? 'On the expiry date' : `${-n} day${n === -1 ? '' : 's'} after expiry`;

/**
 * The reminder step each record has reached: the SMALLEST step it has passed.
 * A record 25 days out has passed 90, 60 and 30, and the reminder that
 * matters is "30 days"; showing all three would be three nags for one fact.
 */
export function dueReminders(rows = [], steps = DEFAULT_REMINDER_STEPS) {
  const list = cleanSteps(steps);
  const out = [];
  for (const row of rows) {
    if (row.cancelled_on || !row.expires_on) continue;
    const d = row.days_left;
    if (d === null || d === undefined) continue;
    const reached = list.filter((s) => (s < 0 ? d <= s : d <= s));
    if (!reached.length) continue;
    const step = Math.min(...reached);
    out.push({ id: row.id, name: row.name, kind: row.kind, expires_on: String(row.expires_on).slice(0, 10), step, days_left: d });
  }
  return out.sort((a, b) => a.days_left - b.days_left);
}

/* -------------------------------- money -------------------------------- */

/** Monthly and yearly cost of one record, on its billing cycle. */
export function costOf(row = {}) {
  if (row.cancelled_on) return { monthly: 0, yearly: 0, known: true };
  if (categoryOf(row) === 'rent') {
    // A rent agreement's "cost" is the monthly rent: that is what is typed.
    const rent = Number(row.cost) || 0;
    return { monthly: rent, yearly: rent * 12, known: rent > 0 };
  }
  const yearly = annualCost(row);
  if (yearly === null || yearly === undefined) return { monthly: 0, yearly: 0, known: false };
  return { monthly: Math.round(yearly / 12), yearly, known: true };
}

const sumBy = (rows, keyOf) => {
  const map = new Map();
  for (const r of rows) {
    const k = String(keyOf(r) || '').trim() || '—';
    const line = map.get(k) || { key: k, n: 0, yearly: 0 };
    line.n += 1;
    line.yearly += costOf(r).yearly;
    map.set(k, line);
  }
  return [...map.values()].sort((a, b) => b.yearly - a.yearly);
};

/** The financial year (April-March) a date falls in, '2026-27'. */
export function financialYear(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const y = Number(m[1]);
  const start = Number(m[2]) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function costSummary(rows = []) {
  const live = rows.filter((r) => !r.cancelled_on);
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c.key, { monthly: 0, yearly: 0, n: 0 }]));
  let unknown = 0;
  for (const r of live) {
    const c = costOf(r);
    if (!c.known) unknown += 1;
    const line = byCat[categoryOf(r)];
    line.n += 1;
    line.monthly += c.monthly;
    line.yearly += c.yearly;
  }
  const monthly = Object.values(byCat).reduce((s, l) => s + l.monthly, 0);
  const yearly = Object.values(byCat).reduce((s, l) => s + l.yearly, 0);
  return {
    monthly,
    yearly,
    unknown,
    by_category: byCat,
    by_vendor: sumBy(live, (r) => r.vendor || r.publisher),
    by_company: sumBy(live, (r) => r.company_name),
    upcoming_cost: live
      .filter((r) => r.days_left !== null && r.days_left !== undefined && r.days_left >= 0 && r.days_left <= 90)
      .reduce((s, r) => s + (Number(r.proposed_cost) || Number(r.cost) || 0), 0),
    pending_payment: live
      .filter((r) => r.payment_status === 'pending' || r.payment_status === 'overdue' || r.renewal_stage === 'pending_payment')
      .reduce((s, r) => s + (Number(r.proposed_cost) || Number(r.cost) || 0), 0),
  };
}

/* ------------------------------- overview ------------------------------- */

export function renewalOverview(rows = []) {
  const live = rows.filter((r) => !r.cancelled_on);
  const within = (a, b) => live.filter((r) => r.days_left !== null && r.days_left !== undefined && r.days_left >= a && r.days_left <= b);
  const expired = live.filter((r) => r.days_left !== null && r.days_left !== undefined && r.days_left < 0);
  const pendingPay = live.filter((r) => r.payment_status === 'pending' || r.payment_status === 'overdue' || r.renewal_stage === 'pending_payment');
  const pendingApproval = live.filter((r) => r.renewal_stage === 'pending_approval');
  const autoSoon = within(0, 30).filter((r) => Number(r.auto_renew) === 1);
  const byCategory = CATEGORIES.map((c) => ({
    ...c,
    n: live.filter((r) => categoryOf(r) === c.key).length,
    due: within(0, 60).filter((r) => categoryOf(r) === c.key).length,
  }));
  const sort = (list) => [...list].sort((a, b) => a.days_left - b.days_left);
  return {
    active: live.filter((r) => r.days_left === null || r.days_left === undefined || r.days_left >= 0).length,
    due30: within(0, 30).length,
    due60: within(0, 60).length,
    expired: expired.length,
    pending_payments: pendingPay.length,
    pending_approvals: pendingApproval.length,
    cost: costSummary(rows),
    urgent: sort(within(0, 7)),
    upcoming: sort(within(8, 60)),
    expired_rows: sort(expired),
    pending_payment_rows: pendingPay,
    pending_approval_rows: pendingApproval,
    auto_soon: autoSoon,
    by_category: byCategory,
  };
}

/* ------------------------------- calendar ------------------------------- */

/** Every dated thing in a month, as calendar events. */
export function calendarEvents(rows = [], year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const out = [];
  for (const r of rows) {
    if (r.cancelled_on) continue;
    const exp = String(r.expires_on || '').slice(0, 10);
    if (exp.startsWith(prefix)) {
      const d = r.days_left;
      out.push({
        id: r.id,
        day: Number(exp.slice(8, 10)),
        date: exp,
        name: r.name,
        category: categoryOf(r),
        what: categoryOf(r) === 'rent' ? 'Agreement ends' : categoryOf(r) === 'insurance' ? 'Policy expires' : 'Renewal due',
        tone: r.renewal_stage ? 'pending' : d < 0 ? 'overdue' : d <= 30 ? 'soon' : 'upcoming',
      });
    }
    const prop = String(r.proposed_until || '').slice(0, 10);
    if (r.renewal_stage === 'pending_approval' && prop.startsWith(prefix)) {
      out.push({ id: r.id, day: Number(prop.slice(8, 10)), date: prop, name: r.name, category: categoryOf(r), what: 'Awaiting approval', tone: 'pending' });
    }
  }
  return out.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
}
