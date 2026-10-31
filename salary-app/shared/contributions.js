/**
 * What PF, ESI and professional tax actually come to.
 *
 * Until now PF and ESI were numbers somebody typed onto each employee and the
 * app simply deducted them. That was honest while a salary was a single figure
 * - there was nothing to work PF out *of*. Now that a salary has a Basic, it
 * can be: PF is 12% of Basic, ESI is 0.75% of gross under the wage limit, and
 * PT is the slab the month's gross falls in.
 *
 * ---------------------------------------------------------------------------
 * The rule carried over from the salary structure:
 *
 *   NOTHING SWITCHES ITSELF ON.
 *
 * Every employee starts on `fixed`, which deducts exactly the number already
 * typed against them, exactly as before. Working a figure out is one thing;
 * changing what lands in somebody's bank account is another, and that is a
 * decision rather than a calculation. `auto` has to be chosen, per person or
 * in bulk, and the app shows what it would change before it changes it.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, so the server and the standalone file agree.
 */

import { ESI_DEFAULTS, PF_DEFAULTS } from './statutory.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round0 = (n) => Math.round(num(n));

/** How a deduction is arrived at. Everybody starts on `fixed`. */
export const MODES = [
  { key: 'fixed', label: 'Fixed amount', hint: 'deduct exactly what is typed, as before' },
  { key: 'auto', label: 'Work it out', hint: 'calculate it from the rules each month' },
];

export const isAuto = (mode) => String(mode || 'fixed') === 'auto';

/* ---------------- provident fund ---------------- */

export const PF_EXTRA = {
  // What the employer pays on top of its 12%: EDLI insurance and the EPFO's
  // administration charge. Small, and the only reason a CTC ever adds up.
  edliRate: 0.5,
  adminRate: 0.5,
};

/**
 * PF for one month.
 *
 * Charged on Basic where a salary has been broken up, because that is what the
 * law charges it on. Without a breakup there is no Basic to charge, so it
 * falls back to the month's gross after absence - higher, and the same figure
 * the PF register has always reported.
 *
 * @param wages_basic  the month's earned Basic, or null when none is set
 * @param fallback     the month's gross after absence
 */
export function pfFor({ wages_basic, fallback } = {}, settings = {}) {
  const { wageCeiling, employeeRate, employerRate, pensionRate } = { ...PF_DEFAULTS, ...settings };
  const { edliRate, adminRate } = { ...PF_EXTRA, ...settings };

  const onBasic = wages_basic !== null && wages_basic !== undefined;
  const full = round0(onBasic ? wages_basic : fallback);
  const wages = Math.min(full, wageCeiling);

  const employee = round0((wages * employeeRate) / 100);
  const employerTotal = round0((wages * employerRate) / 100);
  // The pension share is capped at the ceiling too; the rest stays in the PF.
  const pension = round0((wages * pensionRate) / 100);

  return {
    wages,
    on: onBasic ? 'basic' : 'gross',
    capped: full > wageCeiling,
    employee,
    employer: employerTotal,
    pension,
    provident: Math.max(0, employerTotal - pension),
    edli: round0((wages * edliRate) / 100),
    admin: round0((wages * adminRate) / 100),
    // What the employer parts with in total, which is what a CTC needs.
    employer_cost: employerTotal + round0((wages * edliRate) / 100) + round0((wages * adminRate) / 100),
  };
}

/* ---------------- employees' state insurance ---------------- */

/**
 * ESI for one month, on the month's gross.
 *
 * The shares are rounded UP to the next rupee, which is the ESIC's own rule
 * and not a detail worth getting wrong on a return.
 *
 * Note the app deliberately does NOT carry somebody who crosses the wage limit
 * mid-period: under ESIC rules contributions continue to the end of the
 * contribution period (April-September or October-March) even once they are
 * over the limit. That needs a view across months, which this does not have,
 * so `over_limit` is reported and the person can be put on a fixed amount.
 */
export function esiFor({ gross } = {}, settings = {}) {
  const { wageLimit, employeeRate, employerRate } = { ...ESI_DEFAULTS, ...settings };
  const wages = round0(gross);
  const eligible = wages > 0 && wages <= wageLimit;

  return {
    wages,
    eligible,
    over_limit: wages > wageLimit,
    employee: eligible ? Math.ceil((wages * employeeRate) / 100) : 0,
    employer: eligible ? Math.ceil((wages * employerRate) / 100) : 0,
    contribution_period: null,
  };
}

/** April-September and October-March, which is how ESI is reckoned. */
export const esiContributionPeriod = (month) =>
  month >= 4 && month <= 9 ? 'Apr-Sep' : 'Oct-Mar';

/* ---------------- professional tax ---------------- */

/**
 * Gujarat, from 1 April 2022: nothing up to ₹12,000 a month, ₹200 above it.
 *
 * Kept as a slab list rather than a threshold and an amount so another state,
 * or a future change, is a line of data instead of a change of shape. A period
 * still carries its own threshold and amount, and those win when they are set,
 * so no month already paid moves.
 */
export const PT_SLABS_GUJARAT = [
  { upto: 12000, amount: 0 },
  { upto: null, amount: 200 },
];

export function ptFor(gross, { slabs = PT_SLABS_GUJARAT, threshold, amount } = {}) {
  const value = round0(gross);
  // A period's own threshold/amount is the sheet's original rule and wins.
  if (threshold !== undefined && threshold !== null && amount !== undefined && amount !== null) {
    return value > num(threshold) ? round0(amount) : 0;
  }
  for (const slab of slabs) {
    if (slab.upto === null || slab.upto === undefined) return round0(slab.amount);
    if (value <= num(slab.upto)) return round0(slab.amount);
  }
  return 0;
}

/* ---------------- what a month would deduct ---------------- */

/**
 * The deductions for one row, honouring each employee's chosen mode.
 *
 * Returns what is deducted AND what it would be if worked out, so the dashboard
 * can show the difference without anything having to change first.
 */
export function contributionsFor(employee, month = {}, settings = {}) {
  const pf = pfFor(
    { wages_basic: month.earned_basic ?? null, fallback: month.gross_after_absent },
    settings.pf
  );
  const esi = esiFor({ gross: month.gross_salary }, settings.esi);

  const pfAuto = isAuto(employee?.pf_mode);
  const esiAuto = isAuto(employee?.esi_mode);

  return {
    pf: {
      ...pf,
      mode: pfAuto ? 'auto' : 'fixed',
      typed: round0(employee?.pf),
      deducted: pfAuto ? pf.employee : round0(employee?.pf),
      // Worth naming rather than silently differing.
      differs: pfAuto ? false : round0(employee?.pf) !== pf.employee,
    },
    esi: {
      ...esi,
      mode: esiAuto ? 'auto' : 'fixed',
      typed: round0(employee?.esi),
      deducted: esiAuto ? esi.employee : round0(employee?.esi),
      differs: esiAuto ? false : round0(employee?.esi) !== esi.employee,
    },
  };
}

/**
 * What switching somebody to `auto` would do to their take-home, before it is
 * done. The honest version of a settings toggle.
 */
export function wouldChange(employee, month = {}, settings = {}) {
  const c = contributionsFor({ ...employee, pf_mode: 'fixed', esi_mode: 'fixed' }, month, settings);
  const pfNow = c.pf.typed;
  const esiNow = c.esi.typed;
  const pfThen = c.pf.employee;
  const esiThen = c.esi.employee;

  return {
    pf: { now: pfNow, then: pfThen, change: pfThen - pfNow },
    esi: { now: esiNow, then: esiThen, change: esiThen - esiNow },
    // A positive take-home change means they get more; negative, less.
    take_home: -(pfThen - pfNow) - (esiThen - esiNow),
  };
}
