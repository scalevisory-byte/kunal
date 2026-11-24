/**
 * DECIDING WHETHER THE MONTH'S HOURS SHOULD COUNT.
 *
 * Dinesh, having asked for the pay to come from the day count alone:
 * *"Amount to apne aap aayega na minus hours ka / o deduct karna he ya nahi
 * uska decision lena he khali"*.
 *
 * So the figure must NOT be typed. It is already worked out - `calculateRow`
 * returns the month's hours on every policy - and this module turns it into
 * the one thing left to do: a yes or a no.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WRITES, AND WHY THAT AND NOTHING ELSE.
 *
 * Saying yes writes `ot_minutes_override` on the row - the box the salary
 * sheet has always had, which beats every policy and which the office can
 * see, change and clear. It does NOT switch the month's rule: a rule applies
 * to everybody from then on, and this is a decision taken person by person
 * with the figure in front of you. One is a policy, the other is a judgement,
 * and they must not be the same button.
 * ---------------------------------------------------------------------------
 *
 * Three rules this module exists to hold:
 *
 *   A ROW WHOSE HOURS ARE NOT KNOWN IS NEVER INCLUDED. `monthly_hours_judged`
 *   false means nobody clocked anything, which is not "they did no hours".
 *   Writing 0 there would read as a decision somebody took.
 *
 *   A FIGURE SOMEBODY ALREADY TYPED IS LEFT ALONE, and counted so the screen
 *   can say so - the same rule as "Mark everyone Present", which fills blank
 *   days and never overwrites a mark.
 *
 *   SHORT AND OVER ARE TWO DECISIONS, NOT ONE. Deducting somebody's missing
 *   hours and paying somebody else's overtime are different questions, and
 *   bundling them into one button answers the second without being asked.
 */

import { onDaysOnly } from './lateEarly.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Does this row already carry a figure somebody typed into OT min? */
export const hasTypedHours = (row = {}) => {
  const v = row.ot_minutes_override;
  return v !== null && v !== undefined && v !== '';
};

/**
 * The minutes that saying "yes" would write for one calculated row.
 *
 * Short uses `chargeable`, which has the month's grace already taken off, so
 * the figure written is the one the rule would really have charged. Over uses
 * `diff`, because grace forgives a shortfall and is not a floor under
 * overtime.
 */
export const hoursMinutesOf = (calc = {}) =>
  num(calc.monthly_hours_diff) < 0 ? num(calc.monthly_hours_chargeable) : num(calc.monthly_hours_diff);

/**
 * @param {Array<{row: object, calc: object}>} calcs rows already calculated -
 *   this module never calculates, so it cannot become a second opinion.
 * @returns {{
 *   short: Array, over: Array, decided: Array, unknown: number,
 *   shortAmount: number, overAmount: number, anything: boolean,
 *   charging: boolean, chargedDeducted: number, chargedPaid: number,
 * }}
 */
export function hoursDecision(calcs = [], { period = null } = {}) {
  /*
   * IS THE MONTH ALREADY CHARGING THESE HOURS?
   *
   * Dinesh, off his live sheet: *"ot plus mins net me count ho raha he / o
   * sirf dikhna chahiye / katna he to o manually add hoga"*. His November was
   * opened before the days-only rule existed and still runs on the monthly
   * one, so every OT figure on it is in the net — and this bar was offering
   * to *"deduct the short hours"* that were already deducted, which reads as
   * though they were not.
   *
   * A month keeps the rule it was opened on, deliberately, so nothing here
   * switches it — but the bar has to say which world it is in, and offer the
   * switch rather than a button that means nothing.
   */
  const charging = period ? !onDaysOnly(period) : false;
  const out = {
    short: [], over: [], decided: [], unknown: 0,
    shortAmount: 0, overAmount: 0, anything: false,
    charging,
    /*
     * WHAT THE HOURS ARE DOING TO THE MONTH AS IT STANDS - DEDUCTED AND PAID
     * REPORTED APART, NEVER NETTED.
     *
     * This was one figure, the sum of `ot_salary` across everybody, and on
     * Dinesh's live November that printed as *"\u20b91,251 across 60 people"* -
     * which reads as a trivial amount and was why he reported the deduction
     * twice. It was the NET: ASHOK MISHRA was +13,237 of overtime paid and
     * AJEETKUMAR -3,192 of hours charged, and they cancelled.
     *
     * The module already holds that short and over are two decisions and not
     * one, for the buttons. The same is true of the figure describing them:
     * somebody deciding whether to stop charging the hours needs to know what
     * stops being deducted AND what stops being paid, because the second is
     * money people lose by pressing it.
     *
     * All three are read off `ot_salary`, the figure the payslip prints, and
     * never recomputed from a rule. `chargedAmount` stays as the net, which is
     * what the month's own OT total column adds up to.
     */
    chargedAmount: 0,
    chargedPeople: 0,
    chargedDeducted: 0,
    chargedDeductedPeople: 0,
    chargedPaid: 0,
    chargedPaidPeople: 0,
  };
  for (const entry of calcs) {
    const row = entry?.row || {};
    const calc = entry?.calc || {};
    if (charging && num(calc.ot_salary) !== 0) {
      const paid = num(calc.ot_salary);
      out.chargedAmount += paid;
      out.chargedPeople += 1;
      if (paid < 0) {
        out.chargedDeducted += -paid;
        out.chargedDeductedPeople += 1;
      } else {
        out.chargedPaid += paid;
        out.chargedPaidPeople += 1;
      }
    }
    /* Already answered, by hand or by a previous press. Counted, never
       overwritten - the office's own figure outranks ours. */
    if (hasTypedHours(row)) {
      out.decided.push({ id: row.id, name: row.employee_name, minutes: num(row.ot_minutes_override) });
      continue;
    }
    if (!calc.monthly_hours_judged) {
      out.unknown += 1;
      continue;
    }
    const minutes = hoursMinutesOf(calc);
    if (minutes === 0) continue;
    const amount = Math.abs(num(calc.monthly_hours_amount));
    const line = { id: row.id, name: row.employee_name, minutes, amount };
    if (minutes < 0) {
      out.short.push(line);
      out.shortAmount += amount;
    } else {
      out.over.push(line);
      out.overAmount += amount;
    }
  }
  /* Worst first - the people the decision is really about. */
  out.short.sort((a, b) => a.minutes - b.minutes);
  out.over.sort((a, b) => b.minutes - a.minutes);
  out.shortAmount = Math.round(out.shortAmount);
  out.overAmount = Math.round(out.overAmount);
  out.chargedAmount = Math.round(out.chargedAmount);
  out.chargedDeducted = Math.round(out.chargedDeducted);
  out.chargedPaid = Math.round(out.chargedPaid);
  out.anything =
    out.short.length > 0 || out.over.length > 0 || out.decided.length > 0 || charging;
  return out;
}

/** The patch that records a yes. Clearing hands the row back to the rule. */
export const chargeHoursPatch = (minutes) => ({ ot_minutes_override: minutes });
export const CLEAR_HOURS_PATCH = { ot_minutes_override: '' };

/**
 * WHAT THE HOURS ARE DOING TO THIS MONTH, IN ONE PHRASE.
 *
 * Read by the bar on the salary sheet AND by the confirmation that stops the
 * rule. Written out in both places they would drift, and the one that drifted
 * would be the one somebody presses.
 *
 * It names the two sides apart rather than netting them: the net is what made
 * a month deducting thousands from one person print as *"₹1,251"*.
 *
 * @param {object} decision what `hoursDecision` returned
 * @param {(n: number) => string} money how to write an amount - the caller
 *   passes its own formatter, so this module stays free of a currency
 * @returns {string} e.g. "13,237 deducted from 24 people and 14,488 paid to 36 people"
 */
export function chargedPhrase(decision = {}, money = (n) => String(n)) {
  const parts = [];
  const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
  if (decision.chargedDeductedPeople) {
    parts.push(`${money(decision.chargedDeducted)} deducted from ${people(decision.chargedDeductedPeople)}`);
  }
  if (decision.chargedPaidPeople) {
    parts.push(`${money(decision.chargedPaid)} paid to ${people(decision.chargedPaidPeople)}`);
  }
  return parts.join(' and ');
}
