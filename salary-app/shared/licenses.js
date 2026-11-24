import { todayIso } from './today.js';
/**
 * SOFTWARE LICENCES - what we are licensed to run, on how many machines,
 * and when it has to be paid again.
 *
 * Dinesh's dashboard mock-up had a "License" tab and nothing behind it. Asked
 * what belonged in it, he said: *"license me software license ki detail
 * rahegi"*. So this is Tally, Windows, Office, the antivirus, eTimeTrackLite,
 * the domain, the SSL certificate - each with its key, its seats and its
 * renewal date.
 *
 * FOUR RULES THE WHOLE MODULE RESTS ON.
 *
 *   **NO RENEWAL DATE IS NOT AN EXPIRED LICENCE.** A perpetual licence bought
 *   in 2019 has no date and never will; a blank date read as "overdue" would
 *   put half the register on a reminder list every morning, which is how a
 *   reminder list stops being read. `licenseStatus` answers `perpetual` for
 *   it, and `expired` only for a date that has actually passed. The flip side
 *   is also said out loud: a SUBSCRIPTION with no date is not perpetual, it is
 *   a licence nobody can plan for, and it gets its own line in the alerts.
 *
 *   **SEATS IN USE ARE COUNTED, NEVER STORED.** A `used_seats` column would
 *   disagree with the assignments the first time somebody left and their seat
 *   was released. Exactly the mistake shared/assetStatus.js and
 *   shared/assetGroups.js exist to avoid.
 *
 *   **OVER-ALLOCATION IS RECORDED AND FLAGGED, NEVER REFUSED.** Eleven
 *   installs on a ten-seat licence is the thing an audit finds and the thing
 *   this register exists to show. Refusing the eleventh does not uninstall it;
 *   it only means the office keeps that fact in somebody's head instead. Same
 *   reasoning as a punch outside the GPS fence.
 *
 *   **THE KEY IS A SECRET, NOT A FIELD.** It never travels in a list and never
 *   reaches an export. It is masked to its last four characters everywhere but
 *   one deliberate reveal, which is on the audit trail - a key that has left
 *   the building cannot be called back, so who asked for it has to have an
 *   answer.
 *
 * Dependency-free, like the rest of shared/.
 */

/** The kinds, for the picker. Free text still works - it is a register, not a form. */
export const LICENSE_KINDS = [
  'Accounting software',
  'Operating system',
  'Office suite',
  'Antivirus',
  'Attendance software',
  'Tally / GST utility',
  'Design software',
  'Cloud / SaaS subscription',
  'Domain name',
  'Hosting',
  'SSL certificate',
  'Email',
  'Other',
];

/**
 * How it is held. The key, what to call it, and what it means for renewal.
 *
 * The third column is not decoration: it is what the screen says underneath
 * the picker, because "perpetual" and "perpetual with an AMC" look the same
 * until somebody explains that only one of them stops working.
 */
export const LICENSE_TERMS = [
  ['perpetual', 'Bought once (perpetual)', 'Yours to keep. No renewal date, so it never expires.'],
  ['subscription', 'Subscription', 'Has to be renewed. It stops working — or stops being legal — when it lapses.'],
  ['amc', 'Perpetual + AMC', 'The licence is yours; the support contract renews. The date here is the AMC’s.'],
  ['trial', 'Trial', 'Ends on its date, and is not a licence to carry on using it.'],
  ['free', 'Free / open source', 'Nothing to renew and nothing to pay.'],
];

export const TERM_KEYS = LICENSE_TERMS.map(([key]) => key);

export const termLabel = (key) => LICENSE_TERMS.find(([k]) => k === key)?.[1] || 'Subscription';
export const termNote = (key) => LICENSE_TERMS.find(([k]) => k === key)?.[2] || '';

/** A term we do not recognise is a subscription: the reading that still reminds. */
export const cleanTerm = (value) => (TERM_KEYS.includes(value) ? value : 'subscription');

/** The terms that are supposed to carry a renewal date. */
export const RENEWING_TERMS = new Set(['subscription', 'amc', 'trial']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round0 = (n) => Math.round(num(n));
const DAY = 24 * 60 * 60 * 1000;
const day = (v) => String(v ?? '').slice(0, 10);

/** Days from today until a date. Negative is the past; null for no date. */
export function daysUntil(date, today = todayIso()) {
  if (!date) return null;
  const then = new Date(`${day(date)}T00:00:00Z`);
  const now = new Date(`${day(today)}T00:00:00Z`);
  if (Number.isNaN(then.getTime()) || Number.isNaN(now.getTime())) return null;
  return Math.round((then - now) / DAY);
}

/**
 * The key, as it is allowed to be seen.
 *
 * The last four characters only, which is enough for somebody holding a
 * sticker or an invoice to tell whether it is the same key, and not enough to
 * install anything.
 */
export function maskKey(key) {
  const value = String(key ?? '').trim();
  if (!value) return '';
  const tail = value.slice(-4);
  return `•••• ${tail}`;
}

/**
 * How many seats are in use, free, and over.
 *
 * `seats` null means nobody is counting - a site licence, or a licence where
 * the count is genuinely unknown. That is a third answer, not zero: a site
 * licence must never be reported as over-allocated, and "unknown" must never
 * be reported as "all free".
 */
export function seatUse(license = {}, seats = []) {
  const open = seats.filter((s) => !s.released_on);
  const total = license.seats === null || license.seats === undefined || license.seats === ''
    ? null
    : Math.max(0, Math.round(num(license.seats)));
  return {
    seats: total,
    counted: total !== null,
    used: open.length,
    free: total === null ? null : total - open.length,
    over: total !== null && open.length > total,
    over_by: total !== null ? Math.max(0, open.length - total) : 0,
    released: seats.length - open.length,
  };
}

/**
 * Where this licence stands today.
 *
 * `soon` is how many days ahead counts as "coming up" - 30 by default, which
 * is enough notice to raise a purchase order and not so much that everything
 * is always amber.
 */
export function licenseStatus(license = {}, today = todayIso(), { soon = 30 } = {}) {
  const term = cleanTerm(license.term);
  const expires = day(license.expires_on) || null;
  const days = daysUntil(expires, today);

  if (license.cancelled_on) {
    return { status: 'cancelled', label: 'Cancelled', days, expires_on: expires, term, renews: false };
  }

  if (!expires) {
    // A subscription with no date is NOT perpetual. Saying so is the whole
    // point: it is the one state nobody can act on, so it is named.
    if (RENEWING_TERMS.has(term)) {
      return { status: 'no_date', label: 'No renewal date', days: null, expires_on: null, term, renews: true };
    }
    return { status: 'perpetual', label: 'Does not expire', days: null, expires_on: null, term, renews: false };
  }

  if (days !== null && days < 0) {
    return { status: 'expired', label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`, days, expires_on: expires, term, renews: true };
  }
  if (days !== null && days <= soon) {
    return {
      status: 'expiring',
      label: days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} left`,
      days,
      expires_on: expires,
      term,
      renews: true,
    };
  }
  return { status: 'active', label: `${days} days left`, days, expires_on: expires, term, renews: true };
}

export const STATUS_LABELS = new Map([
  ['active', 'In date'],
  ['expiring', 'Expiring soon'],
  ['expired', 'Expired'],
  ['no_date', 'No renewal date'],
  ['perpetual', 'Perpetual'],
  ['cancelled', 'Cancelled'],
]);

export const statusLabel = (key) => STATUS_LABELS.get(key) || key;

/**
 * What a licence costs in a year.
 *
 * Only when both the cost and the length of the period are known - a cost with
 * no period is a number nobody can annualise, and guessing twelve months would
 * quietly treble a quarterly bill.
 *
 * A perpetual licence annualises to NOTHING, not to its purchase price: it was
 * paid once and will not be paid again. Its AMC, if it has one, is the figure
 * that recurs, and that is held as the AMC's own cost.
 */
export function annualCost(license = {}) {
  const term = cleanTerm(license.term);
  if (term === 'free') return 0;
  const months = Math.round(num(license.renew_every_months));
  const cost = round0(license.cost);
  if (term === 'perpetual') return round0(license.amc_cost);
  if (!cost || months <= 0) return null;
  return Math.round((cost * 12) / months);
}

/**
 * A licence with its figures worked out: status, seats, yearly cost.
 *
 * Everything that reads a licence goes through this, so a tile, a row and an
 * export cannot come to three different conclusions about the same licence.
 */
export function dressLicense(license = {}, seats = [], today = todayIso(), options = {}) {
  const status = licenseStatus(license, today, options);
  const use = seatUse(license, seats);
  /*
   * The key is dropped here as a second fence. The first one is in the
   * database layer, which does not select the column at all - it selects
   * whether there IS one and its last four characters. Both, because this
   * function is also handed rows built by hand in the offline build and in
   * tests, and one fence is one place to forget.
   */
  const typed = String(license.key ?? license.license_key ?? '').trim();
  return {
    ...license,
    key: undefined,
    license_key: undefined,
    key_masked: typed ? maskKey(typed) : license.key_tail ? `•••• ${license.key_tail}` : '',
    has_key: Boolean(typed) || Boolean(license.has_key),
    term: cleanTerm(license.term),
    term_label: termLabel(license.term),
    status: status.status,
    status_label: status.label,
    days_left: status.days,
    seat_use: use,
    annual_cost: annualCost(license),
  };
}

/**
 * Everything worth a reminder, across the register.
 *
 * Separate lists rather than one count, because they need different things
 * doing about them: an expired antivirus needs buying today, a licence with no
 * key recorded needs somebody to find the invoice, and eleven installs on a
 * ten-seat licence needs a decision.
 */
export function licenseAlerts(rows = [], today = todayIso(), { soon = 30 } = {}) {
  const expired = [];
  const expiring = [];
  const over = [];
  const noDate = [];
  const nothingOnFile = [];

  for (const row of rows) {
    if (row.cancelled_on) continue;         // cancelled is settled, not pending.
    const status = row.status || licenseStatus(row, today, { soon }).status;
    const use = row.seat_use || seatUse(row, row.seats_list || []);
    if (status === 'expired') expired.push(row);
    else if (status === 'expiring') expiring.push(row);
    else if (status === 'no_date') noDate.push(row);
    if (use.over) over.push(row);
    /*
     * NOTHING RECORDED TO RENEW OR REINSTALL WITH - neither a key nor the
     * account it sits under.
     *
     * Not simply "no key": a domain, a hosting plan and a SaaS subscription
     * have no key at all, and flagging those put five of seven licences on
     * the list the first time it was run against real-looking data. A list
     * that flags everything is a list nobody reads. What actually hurts is a
     * licence where there is nothing on file either way, because then nobody
     * can rebuild the machine OR log in to renew.
     */
    if (!row.has_key && !String(row.account_email || '').trim() && cleanTerm(row.term) !== 'free') {
      nothingOnFile.push(row);
    }
  }

  const byDate = (a, b) => String(a.expires_on || '').localeCompare(String(b.expires_on || ''));

  return {
    expired: expired.sort(byDate),
    expiring: expiring.sort(byDate),
    over_allocated: over,
    no_date: noDate,
    nothing_on_file: nothingOnFile,
    // What somebody has to DO something about. Missing paperwork is
    // housekeeping, not a deadline, so it is reported and left out of the
    // count.
    count: expired.length + expiring.length + over.length,
  };
}

/** What the register adds up to. Cancelled licences are left out of the money. */
export function licenseTotals(rows = []) {
  const live = rows.filter((r) => !r.cancelled_on);
  const yearly = live.reduce((sum, r) => sum + num(r.annual_cost), 0);
  const unknown = live.filter((r) => r.annual_cost === null && cleanTerm(r.term) !== 'perpetual' && cleanTerm(r.term) !== 'free');
  return {
    licenses: live.length,
    cancelled: rows.length - live.length,
    seats: live.reduce((n, r) => n + (r.seat_use?.counted ? r.seat_use.seats : 0), 0),
    used: live.reduce((n, r) => n + (r.seat_use?.used || 0), 0),
    // Site licences counted apart, because folding them in as zero seats makes
    // "48 seats across 11 licences" read as the whole truth when it is not.
    uncounted: live.filter((r) => r.seat_use && !r.seat_use.counted).length,
    spent: live.reduce((n, r) => n + round0(r.cost) + round0(r.amc_cost), 0),
    yearly: round0(yearly),
    // How many of those yearly figures we could not work out. A total with a
    // silent hole in it is worse than a total that names the hole.
    yearly_unknown: unknown.length,
    perpetual: live.filter((r) => cleanTerm(r.term) === 'perpetual').length,
  };
}

/**
 * The register as a CSV.
 *
 * THE KEY IS NOT A COLUMN, and there is a test asserting it. An export is
 * emailed, dropped in a shared folder and opened on somebody's home laptop;
 * that is precisely the journey a licence key must not make.
 */
export const LICENSE_COLUMNS = [
  ['Software', (l) => l.name || ''],
  ['Kind', (l) => l.kind || ''],
  ['Publisher', (l) => l.publisher || ''],
  ['Version', (l) => l.version || ''],
  ['Held as', (l) => termLabel(l.term)],
  ['Company', (l) => l.company_name || ''],
  ['Seats', (l) => (l.seat_use?.counted ? l.seat_use.seats : 'not counted')],
  ['In use', (l) => l.seat_use?.used ?? 0],
  ['Free', (l) => (l.seat_use?.counted ? l.seat_use.free : '')],
  ['Bought', (l) => l.purchased_on || ''],
  ['Expires', (l) => l.expires_on || ''],
  ['Where it stands', (l) => statusLabel(l.status)],
  ['Days left', (l) => (l.days_left === null || l.days_left === undefined ? '' : l.days_left)],
  ['Cost', (l) => round0(l.cost)],
  ['Renewed every (months)', (l) => (l.renew_every_months ? Math.round(num(l.renew_every_months)) : '')],
  ['Cost a year', (l) => (l.annual_cost === null ? '' : l.annual_cost)],
  ['AMC cost', (l) => round0(l.amc_cost)],
  ['Vendor', (l) => l.vendor || ''],
  ['Invoice', (l) => l.invoice_no || ''],
  ['Key on file', (l) => (l.has_key ? 'yes' : '')],
  ['Cancelled', (l) => l.cancelled_on || ''],
  ['Note', (l) => l.note || ''],
];

/** One line per seat: who or what is using a licence. */
export const SEAT_COLUMNS = [
  ['Software', (s) => s.license_name || ''],
  ['Key on file', (s) => (s.has_key ? 'yes' : '')],
  ['Used by', (s) => s.employee_name || ''],
  ['On', (s) => s.device || s.asset_label || ''],
  ['Asset code', (s) => s.asset_code || ''],
  ['Assigned', (s) => s.assigned_on || ''],
  ['Released', (s) => s.released_on || ''],
  ['Note', (s) => s.note || ''],
];

const escape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  const lines = [columns.map(([head]) => escape(head)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => escape(get(row))).join(','));
  return `﻿${lines.join('\n')}`;
}

export const licensesCsv = (rows = []) => toCsv(LICENSE_COLUMNS, rows);
export const seatsCsv = (rows = []) => toCsv(SEAT_COLUMNS, rows);

/**
 * Is this licence worth saving, and what is missing?
 *
 * Only the NAME is required. Everything else - the key, the seats, the date -
 * is something somebody has to go and find, and a form that refuses to save
 * until all of it is in hand is a form that gets abandoned with the register
 * still empty. What is missing is said on the row instead.
 */
export function licenseProblem(input = {}) {
  if (!String(input.name || '').trim()) return 'what software is it? A name is the one thing needed.';
  if (input.seats !== null && input.seats !== undefined && input.seats !== '') {
    const seats = Number(input.seats);
    if (!Number.isFinite(seats) || seats < 0) return 'seats is a number, or blank for a licence nobody is counting.';
  }
  if (input.renew_every_months !== null && input.renew_every_months !== undefined && input.renew_every_months !== '') {
    const months = Number(input.renew_every_months);
    if (!Number.isFinite(months) || months < 0) return 'how many months between renewals is a number, or blank.';
  }
  if (num(input.cost) < 0) return 'a cost is not a negative number.';
  if (input.expires_on && input.purchased_on && day(input.expires_on) < day(input.purchased_on)) {
    return 'it cannot expire before it was bought — check the two dates.';
  }
  return null;
}

/** What a seat has to name, so a seat is never "somebody, somewhere". */
export function seatProblem(input = {}) {
  const hasSomebody = Number(input.employee_id) > 0;
  const hasAsset = Number(input.asset_id) > 0;
  const hasDevice = Boolean(String(input.device || '').trim());
  if (!hasSomebody && !hasAsset && !hasDevice) {
    return 'who or which machine is this seat on? Pick a person, pick an asset, or type the machine’s name.';
  }
  return null;
}

/**
 * The renewal period a licence should move to.
 *
 * Worked out from what it already carries, as a SUGGESTION the form fills in -
 * never applied on its own. A renewal is a payment somebody made on a date,
 * and this app has never guessed one of those.
 */
export function suggestRenewal(license = {}, today = todayIso()) {
  const months = Math.round(num(license.renew_every_months)) || 12;
  // From the day it expires, if that has not passed; otherwise from today,
  // because backdating a renewal into a lapsed period would say the office was
  // covered during weeks when it was not.
  const from = license.expires_on && day(license.expires_on) >= day(today) ? day(license.expires_on) : day(today);
  const at = new Date(`${from}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return { from, to: null, months };
  at.setUTCMonth(at.getUTCMonth() + months);
  return { from, to: at.toISOString().slice(0, 10), months, cost: round0(license.cost) || null };
}
