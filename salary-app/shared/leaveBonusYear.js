/**
 * THE YEARLY LEAVE BONUS — the "Paid Leave Structure" in the Book N Fly
 * employment contract (v2.48.0).
 *
 * The contract, word for word:
 *
 *   Total Leave - 20
 *   Below 20 Leaves - Full 20 days Bonus will be credited ... as per 30 days.
 *   21 - 30 Days - 75% of 20 days Bonus ...
 *   31 - 40 Days - 50% of 20 days Bonus ...
 *   41 days or more - No bonus allowed.
 *
 * and, above it: annual leave is counted in a CALENDAR year; in the first
 * year all leave is unpaid; after one year the 20 days are earned PRO RATA.
 *
 * So: 20 days' pay at the monthly salary divided by 30, scaled by how many
 * leaves the year saw, once a year. This sits BESIDE the monthly bonus in
 * leaveBonus.js (a reward for a month with no leave), not instead of it -
 * they are different promises and an office may run either.
 *
 * Read the contract's figures this way, and the panel says so:
 *
 *   - "Below 20" and "21 - 30" leave 20 itself unplaced; 20 is the
 *     entitlement, so 20 is still the full bonus. Bands are "up to and
 *     including". A half day makes 20.5, which is in the 75% band.
 *   - "as per 30 days" is the day rate: monthly salary / 30, not / 26.
 *   - Leaves are counted the way the sheet docks them - a half day is half,
 *     an absence without approval (AD) is two, which is the contract's own
 *     "2 days' leave for every 1 day taken".
 *   - Pro rata applies to the 20 days, never to the bands: somebody who
 *     reached a year in July earns half of the 20 days, judged on the leave
 *     they actually took.
 *
 * SAME TWO RULES AS EVERY BONUS HERE: working it out pays nobody (the money
 * reaches a payslip only through the pay call that names a month), and a
 * year with nothing marked for somebody is NOT a year with no leave.
 */

import { DEFAULT_BREAKS, BREAKABLE, daysOff } from './leaveBonus.js';

export const DEFAULT_YEAR_RULE = {
  /** The 20 days of the contract. */
  base_days: 20,
  /** "as per 30 days": the day rate is the monthly salary over this. */
  divisor: 30,
  /** Up to and including `upto` leaves, `pct` of the bonus. Past the last: nothing. */
  slabs: [
    { upto: 20, pct: 100 },
    { upto: 30, pct: 75 },
    { upto: 40, pct: 50 },
  ],
  /** Which marks are "leave". Half day counts half, AD counts two. */
  breaks: [...DEFAULT_BREAKS],
  half_counts_half: true,
  /** "In the first year, all leave is unpaid" - no bonus until a year's service. */
  min_service_months: 12,
  /** "...on a pro-rata basis". */
  pro_rata: true,
};

const n = (v) => Number(v) || 0;

export function normaliseYearRule(rule = {}) {
  const slabs = (Array.isArray(rule.slabs) ? rule.slabs : DEFAULT_YEAR_RULE.slabs)
    .map((s) => ({ upto: Math.max(0, n(s.upto)), pct: Math.min(100, Math.max(0, n(s.pct))) }))
    .filter((s) => s.upto > 0)
    .sort((a, b) => a.upto - b.upto);
  const asked = Array.isArray(rule.breaks) ? rule.breaks.filter((c) => BREAKABLE.includes(c)) : [];
  return {
    base_days: Math.max(0, n(rule.base_days ?? DEFAULT_YEAR_RULE.base_days)),
    divisor: Math.max(1, n(rule.divisor ?? DEFAULT_YEAR_RULE.divisor) || DEFAULT_YEAR_RULE.divisor),
    slabs: slabs.length ? slabs : DEFAULT_YEAR_RULE.slabs.map((s) => ({ ...s })),
    // An empty list would make everybody "no leave" - the same hole the monthly bonus closed.
    breaks: asked.length ? asked : [...DEFAULT_BREAKS],
    half_counts_half: rule.half_counts_half !== false,
    min_service_months: Math.max(0, Math.round(n(rule.min_service_months ?? DEFAULT_YEAR_RULE.min_service_months))),
    pro_rata: rule.pro_rata !== false,
  };
}

/** Which band a count of leaves falls in: its percentage, and the band in words. */
export function slabFor(leaves, rule) {
  const r = normaliseYearRule(rule);
  let from = 0;
  for (const s of r.slabs) {
    if (leaves <= s.upto) return { pct: s.pct, band: from === 0 ? `up to ${s.upto}` : `${from + 1}–${s.upto}` };
    from = s.upto;
  }
  return { pct: 0, band: `more than ${from}` };
}

const iso = (d) => d.toISOString().slice(0, 10);
const addMonths = (isoDate, months) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1 + months, d));
  // 31 Jan + 1 month is 3 Mar in JS; hold it to the month's last day instead.
  if (out.getUTCDate() !== d) out.setUTCDate(0);
  return iso(out);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

/**
 * What share of the year counts: from the first anniversary (or 1 Jan) to
 * 31 Dec (or the day they left). Null with a reason when it cannot be known.
 */
export function serviceShare(employee = {}, year, rule) {
  const r = normaliseYearRule(rule);
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const joined = /^\d{4}-\d{2}-\d{2}$/.test(String(employee.joined_on || '')) ? employee.joined_on : null;
  if (!joined) return { share: null, why: 'no joining date on the record, so the first year cannot be checked' };
  const eligibleFrom = r.min_service_months ? addMonths(joined, r.min_service_months) : joined;
  const left = /^\d{4}-\d{2}-\d{2}$/.test(String(employee.left_on || '')) ? employee.left_on : null;
  const until = left && left < end ? left : end;
  if (eligibleFrom > until) {
    return {
      share: 0,
      eligible_from: eligibleFrom,
      why: left && left < end && eligibleFrom <= end ? `left on ${left}, before completing a year` : `completes a year on ${eligibleFrom} — first-year leave earns no bonus`,
    };
  }
  const from = eligibleFrom > start ? eligibleFrom : start;
  const days = daysBetween(from, until);
  const share = r.pro_rata ? Math.min(1, days / daysBetween(start, end)) : 1;
  return { share, eligible_from: eligibleFrom, from, until, why: '' };
}

/**
 * One person's year.
 *
 * @param counts      marks across the year, as countMarks gives them
 * @param marked_days how many days carry any mark at all
 */
export function yearBonusFor(employee = {}, counts = {}, rule, { year, marked_days = 0 } = {}) {
  const r = normaliseYearRule(rule);
  const salary = n(employee.monthly_salary);
  const leaves = daysOff(counts, r);
  const { pct, band } = slabFor(leaves, r);
  const base = {
    employee_id: employee.id,
    name: employee.name || '',
    code: employee.code || '',
    company_name: employee.company_name || '',
    department: employee.department || '',
    salary,
    leaves,
    band,
    pct,
    full_bonus: Math.round((r.base_days * salary) / r.divisor),
    share: null,
    amount: 0,
    eligible: false,
    held: false,
  };
  if (!marked_days) return { ...base, held: true, why: 'nothing is marked for them this year' };
  if (!salary) return { ...base, held: true, why: 'no monthly salary on the record' };
  const service = serviceShare(employee, year, r);
  if (service.share === null) return { ...base, held: true, why: service.why };
  const amount = Math.round(base.full_bonus * (pct / 100) * service.share);
  const shareWords = service.share < 1 ? ` × ${Math.round(service.share * 100)}% of the year (from ${service.from})` : '';
  return {
    ...base,
    share: Math.round(service.share * 1000) / 1000,
    amount,
    eligible: amount > 0,
    why: service.share === 0
      ? service.why
      : pct === 0
        ? `${leaves} leaves — ${band}, no bonus`
        : `${leaves} leaves — ${band}: ${pct}% of ${r.base_days} days${shareWords}`,
  };
}

/** The whole year, plus who has been paid already. */
export function yearBonusRun(employees = [], marksById = new Map(), rule, { year, paid = new Set(), months_on_record = [] } = {}) {
  const r = normaliseYearRule(rule);
  const lines = employees
    .map((e) => {
      const m = marksById.get(Number(e.id)) || { counts: {}, marked_days: 0 };
      return { ...yearBonusFor(e, m.counts, r, { year, marked_days: m.marked_days }), already_paid: paid.has(Number(e.id)) };
    })
    .sort((a, b) => b.amount - a.amount || Number(a.held) - Number(b.held) || a.name.localeCompare(b.name));
  const toPay = lines.filter((l) => l.eligible && !l.already_paid);
  return {
    rule: r,
    year,
    months_on_record,
    lines,
    totals: {
      people: lines.length,
      eligible: lines.filter((l) => l.eligible).length,
      held: lines.filter((l) => l.held).length,
      already_paid: lines.filter((l) => l.already_paid).length,
      to_pay: toPay.length,
      amount: toPay.reduce((t, l) => t + l.amount, 0),
    },
  };
}

export const yearBonusKind = (year) => `leave_year_${year}`;
