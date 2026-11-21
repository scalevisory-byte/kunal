/**
 * WHAT HAPPENS TO UNUSED LEAVE AT THE END OF A YEAR.
 *
 * Dinesh's brief asks for carry-forward with a cap and an expiry, and for
 * encashment. Both move a balance, and one of them moves money, so both are
 * built the same way as the sandwich tool and the penalty recovery before
 * them:
 *
 *   NOTHING HAPPENS BY ITSELF. There is no year-end job. Somebody opens the
 *       panel, sees what it would do to every person by name, and presses a
 *       button. A balance that moved overnight because the calendar turned
 *       is a balance nobody can explain to the person it belongs to.
 *
 *   IT IS A PREVIEW BEFORE IT IS AN ACTION. The same function produces the
 *       list that is shown and the entries that are posted, so what was
 *       approved is exactly what happens.
 *
 * Dependency-free, like the rest of shared/.
 */

import { entitlementOf } from './leaveLedger.js';

const n = (v) => Number(v) || 0;
const round = (v) => Math.round(v * 100) / 100;

/**
 * The default rule, and it is only a default.
 *
 * `max` null means "carry everything" - a cap of nought would be a policy
 * nobody chose. `encashable` says whether this type can be paid out instead,
 * which in most offices is privilege leave and nothing else.
 */
export const DEFAULT_RULES = {
  CL: { carry: false, max: 0, why: 'casual leave is usually use-it-or-lose-it' },
  SL: { carry: false, max: 0, why: 'sick leave is usually not carried' },
  PL: { carry: true, max: 30, encashable: true, why: 'privilege leave is normally carried, up to a cap' },
  /*
   * UNPAID LEAVE IS NOT A BALANCE, and `balance: false` says so.
   *
   * There is no entitlement to it, so its ledger closes negative by however
   * many unpaid days somebody took - and the year end has nothing to carry,
   * nothing to lapse and nothing to flag. Without this it reported every
   * person who ever took an unpaid day as "taken beyond the entitlement",
   * which is a debt list nobody should be on. Found by running it.
   */
  UL: { carry: false, max: 0, balance: false, why: 'unpaid leave is not a balance' },
};

/**
 * WHAT WOULD HAPPEN TO ONE PERSON, FOR ONE TYPE.
 *
 * Takes the closing balance the ledger worked out - never a figure of its
 * own - and splits it into what carries and what lapses.
 *
 * A NEGATIVE CLOSING BALANCE CARRIES NOTHING AND LAPSES NOTHING. Leave taken
 * beyond the entitlement is a debt somebody has to decide about; quietly
 * carrying it into next year as a negative opening would hide that decision,
 * and quietly zeroing it would forgive it. It is named and left alone.
 */
export function yearEndFor({ code, closing, rule = {} } = {}) {
  const balance = round(n(closing));
  const settings = { ...(DEFAULT_RULES[code] || { carry: false, max: 0 }), ...rule };

  /* A type that is not a balance has nothing to carry, nothing to lapse and
     nothing to flag - it was taken and it was docked. */
  if (settings.balance === false) {
    return { code, closing: balance, carried: 0, lapsed: 0, skipped: true, why: settings.why, ignore: true };
  }

  if (balance < 0) {
    return {
      code,
      closing: balance,
      carried: 0,
      lapsed: 0,
      skipped: true,
      why: 'taken beyond the entitlement — somebody has to decide about this one',
    };
  }
  if (!balance) return { code, closing: 0, carried: 0, lapsed: 0, skipped: true, why: 'nothing left' };
  if (!settings.carry) {
    return { code, closing: balance, carried: 0, lapsed: balance, why: settings.why || 'not carried' };
  }
  const cap = settings.max === null || settings.max === undefined ? balance : n(settings.max);
  const carried = Math.min(balance, cap);
  return {
    code,
    closing: balance,
    carried: round(carried),
    lapsed: round(balance - carried),
    why: carried < balance ? `capped at ${cap}` : 'carried in full',
  };
}

/**
 * The whole staff, for one leave year.
 *
 * @param people  [{ employee, ledgers }] - ledgers as `ledgerFor` produced them
 * @param rules   per code, overriding DEFAULT_RULES
 */
export function yearEndPlan(people = [], { year, rules = {} } = {}) {
  const rows = [];
  for (const { employee, ledgers } of people) {
    for (const ledger of ledgers) {
      const outcome = yearEndFor({
        code: ledger.code,
        closing: ledger.summary.closing,
        rule: rules[ledger.code],
      });
      if (outcome.ignore) continue;
      if (!outcome.carried && !outcome.lapsed && !outcome.skipped) continue;
      if (outcome.skipped && !outcome.closing) continue;
      rows.push({
        employee_id: employee.id ?? employee.employee_id,
        name: employee.name || employee.employee_name,
        code: employee.code || '',
        company_name: employee.company_name || '',
        /* Whether this ledger has ever been posted to, and the entitlement
           it is standing in for while it has not. `entriesFor` writes that
           figure down before it takes anything away - see below. */
        posted: ledger.summary.posted,
        entitlement: entitlementOf(ledger),
        ...outcome,
      });
    }
  }
  const sum = (f) => round(rows.reduce((t, r) => t + f(r), 0));
  return {
    year,
    rows,
    totals: {
      people: new Set(rows.map((r) => r.employee_id)).size,
      carried: sum((r) => r.carried),
      lapsed: sum((r) => r.lapsed),
      /* Named apart, because these are the ones a person has to look at
         rather than something the button can deal with. */
      owing: rows.filter((r) => r.closing < 0).length,
    },
  };
}

/**
 * The entries a plan posts.
 *
 * TWO ENTRIES PER LINE, NOT ONE. The closing balance is taken out of the old
 * year (as a lapse and a carry-out) and the carried days are put into the
 * new one - so each year's ledger stands on its own and adds up. Writing
 * only the new year's credit would leave last year showing days still in
 * hand that are not there any more.
 */
export function entriesFor(plan = {}, { on, into } = {}) {
  const entries = [];
  const endOfYear = on || `${plan.year}-12-31`;
  const startOfNext = into || `${Number(plan.year) + 1}-01-01`;

  for (const row of plan.rows) {
    if (row.skipped) continue;

    /*
     * WRITE THE ENTITLEMENT DOWN FIRST, on a ledger nobody has posted to.
     *
     * Until something is posted, the balance shown is an ASSUMPTION - the
     * yearly entitlement on their record, less what the grid shows as taken.
     * Posting anything ends that assumption. So lapsing 7 days off an
     * untouched ledger would leave the year reading MINUS 7 instead of nil,
     * and the person would appear to owe the company a week. Closing the
     * year means writing down what was in hand, and then taking it out.
     */
    if (!row.posted && row.entitlement > 0) {
      entries.push({
        employee_id: row.employee_id,
        code: row.code,
        kind: 'annual',
        days: row.entitlement,
        on_date: `${plan.year}-01-01`,
        note: 'yearly entitlement, written onto the ledger when the year was closed',
        reference: `year end ${plan.year}`,
      });
    }

    if (row.lapsed) {
      entries.push({
        employee_id: row.employee_id,
        code: row.code,
        kind: 'expiry',
        days: row.lapsed,
        on_date: endOfYear,
        note: row.why,
        reference: `year end ${plan.year}`,
      });
    }
    if (row.carried) {
      entries.push({
        employee_id: row.employee_id,
        code: row.code,
        kind: 'expiry',
        days: row.carried,
        on_date: endOfYear,
        note: `carried into ${Number(plan.year) + 1}`,
        reference: `year end ${plan.year}`,
      });
      entries.push({
        employee_id: row.employee_id,
        code: row.code,
        kind: 'carry_forward',
        days: row.carried,
        on_date: startOfNext,
        note: `brought in from ${plan.year}`,
        reference: `year end ${plan.year}`,
      });
    }
  }
  return entries;
}
