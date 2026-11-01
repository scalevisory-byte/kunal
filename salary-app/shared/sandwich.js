/**
 * Sandwich leave: the day off caught between two days of absence.
 *
 * Somebody absent on Saturday and again on Monday was away for three days, and
 * many Indian employers deduct the Sunday in the middle too. Dinesh asked for
 * the rule by name ("sandwich leave rules").
 *
 * ---------------------------------------------------------------------------
 * Two things this module will not do.
 *
 * **It never applies itself.** It FINDS the sandwiched days and says what each
 * one would cost. Writing the mark is a separate click, because this is the
 * harshest rule in the app - it takes money for a day nobody was ever due to
 * work - and whether to apply it is a decision, not a calculation. Nothing
 * reads the output of this module except the panel that shows it.
 *
 * **It only sandwiches between genuine absence by default.** The trigger marks
 * are A and UL - days with no pay behind them. Including CL/SL/PL is the harsher
 * reading some companies take, and it is available, but it is not the default:
 * docking a Sunday between two days of leave somebody had earned is a different
 * decision from docking one between two days of unexplained absence.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, like the rest of shared/.
 */

import { ATTENDANCE_CODES } from './calc.js';
import { isWeeklyOff, policyFor } from './weeklyOff.js';

/** Marks that count as the bread of the sandwich. */
export const DEFAULT_TRIGGERS = ['A', 'UL'];

/** The harsher reading: paid leave either side also closes the sandwich. */
export const LEAVE_TRIGGERS = ['A', 'UL', 'CL', 'SL', 'PL'];

/** Marks that mean the day was already off - the filling. */
const OFF_MARKS = new Set(['S', 'PH']);

const codeOf = (entry) =>
  String((entry && typeof entry === 'object' ? entry.code : entry) || '').trim().toUpperCase();

/**
 * Was this day off? Either it carries an off mark, or it carries nothing at all
 * and the weekly-off policy says it was never a working day.
 *
 * A day carrying SP or HP is NOT off - it was worked, and is paid extra for it.
 */
function offDay(attendance, year, month, day, policy) {
  const code = codeOf(attendance[day]);
  if (code) return OFF_MARKS.has(code);
  return isWeeklyOff(year, month, day, policy);
}

/**
 * The sandwiched days in one person's month.
 *
 * @param attendance day -> mark
 * @param opts {
 *   year, month, employee, company, policy, triggers, per_day, days_in_month
 * }
 * @returns {{
 *   days: [{ day, mark, before, after, cost }],
 *   days_lost: number,
 *   amount: number,
 *   edges: number[]      days at the very start or end of the month that could
 *                        not be judged, because the day on the other side is in
 *                        another month
 * }}
 */
export function sandwichedDays(attendance = {}, opts = {}) {
  const {
    year,
    month,
    employee,
    company,
    triggers = DEFAULT_TRIGGERS,
    per_day: perDay = 0,
    days_in_month: total = new Date(Number(year), Number(month), 0).getDate(),
  } = opts;

  const policy = opts.policy ? opts.policy : policyFor(employee, company);
  const trigger = new Set(triggers.map((t) => String(t).toUpperCase()));

  const isTrigger = (day) => trigger.has(codeOf(attendance[day]));
  const isOff = (day) => offDay(attendance, year, month, day, policy);

  const days = [];
  const edges = [];

  for (let day = 1; day <= total; day++) {
    if (!isOff(day)) continue;

    /*
     * A run of off days is one piece of filling: Saturday and Sunday together,
     * or a Sunday against a festival holiday. The sandwich closes on the first
     * working day either side, so the whole run goes or none of it does.
     */
    let start = day;
    let end = day;
    while (end + 1 <= total && isOff(end + 1)) end++;

    const before = start - 1;
    const after = end + 1;

    // At the edge of the month the day on the other side is in another month,
    // which this function cannot see. Named, never guessed at.
    if (before < 1 || after > total) {
      for (let d = start; d <= end; d++) edges.push(d);
      day = end;
      continue;
    }

    if (isTrigger(before) && isTrigger(after)) {
      for (let d = start; d <= end; d++) {
        const mark = codeOf(attendance[d]);
        days.push({
          day: d,
          mark: mark || '',
          label: mark ? ATTENDANCE_CODES[mark]?.label || mark : 'weekly off',
          before,
          after,
          before_mark: codeOf(attendance[before]),
          after_mark: codeOf(attendance[after]),
          cost: 1,
        });
      }
    }
    day = end;
  }

  const daysLost = days.reduce((sum, d) => sum + d.cost, 0);
  return {
    days,
    days_lost: daysLost,
    amount: Math.round(daysLost * (Number(perDay) || 0)),
    edges,
    triggers: [...trigger],
  };
}

/**
 * Everybody's, for the panel. One row per person who has any, plus the month's
 * total, so the cost of applying the rule is one figure before it is applied.
 */
export function sandwichReport(rows = [], opts = {}) {
  const people = [];
  let daysLost = 0;
  let amount = 0;
  let edges = 0;

  for (const row of rows) {
    const found = sandwichedDays(row.attendance || {}, {
      ...opts,
      employee: row,
      per_day: row.per_day,
    });
    edges += found.edges.length;
    if (!found.days.length) continue;
    people.push({
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      company_name: row.company_name,
      ...found,
    });
    daysLost += found.days_lost;
    amount += found.amount;
  }

  people.sort((a, b) => b.days_lost - a.days_lost || String(a.employee_name).localeCompare(b.employee_name));
  return { people, days_lost: daysLost, amount, edges };
}

/**
 * What applying it would write: the trigger mark on each sandwiched day.
 *
 * Deliberately `UL` rather than `A` - unpaid leave. It costs the same day's pay
 * but it is counted separately on the payslip and the reports, so a month's
 * absences are not inflated by days the rule docked rather than days somebody
 * failed to turn up.
 */
export function entriesToApply(report, { code = 'UL' } = {}) {
  const entries = [];
  for (const person of report?.people || []) {
    for (const day of person.days) {
      entries.push({ employee_id: person.employee_id, day: day.day, code });
    }
  }
  return entries;
}
