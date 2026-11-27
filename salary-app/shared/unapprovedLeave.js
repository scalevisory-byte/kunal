/**
 * Time off nobody approved, and what the rule says it costs.
 *
 * Dinesh: "leave approved nahi ki aur leave li hai to sandwich leave katni
 * chahiye - 1 leave to 2 leave deduct, 2 to 4 leave", and "sudden leave with
 * proper proof only allowed; if proof not submitted, sandwich leave". So an
 * absence that was not approved costs DOUBLE: the day itself and one more.
 *
 * A TOOL, NOT A SETTING, for the reason the sandwich finder next to it is one.
 * This is the harshest rule in the app after that one, and it turns on a fact
 * - "was it approved" - that somebody has to have recorded. So it finds the
 * days, prices them, and marks them on a press. Nothing doubles by itself, and
 * a day nobody has looked at is not a day somebody refused.
 *
 * THREE PILES, AND THEY ARE THREE DIFFERENT STATEMENTS.
 *   refused   - an absence somebody marked "not approved". The rule applies.
 *   undecided - an absence nobody has decided. NAMED, and left alone unless the
 *               office says to count them: null is "nobody has decided", which
 *               is not "no". The roll call is where they are decided.
 *   approved  - an absence with the proof accepted. Stays one day. Counted so
 *               the office can see the rule did look at them.
 *
 * WHAT IT WRITES. The existing mark AD - "Absent (2 days)" - and only the
 * mark, so the per-field merge keeps the reason and the decision on the day.
 * No new arithmetic: `calculateRow` has always docked two days for AD, and the
 * price shown before the press comes out of that same function, so the
 * figure on the button and the figure on the payslip cannot differ.
 *
 * ONLY A PLAIN ABSENCE (A) AND UNPAID LEAVE (UL). Casual, sick and privilege
 * leave are written by an approval or by the office and are paid; a half day
 * is not a day of leave; a day already AD is already doubled.
 */
import { calculateRow } from './calc.js';
import { onStaffThatDay } from './onStaff.js';

export const DOUBLE_MARK = 'AD';
export const SINGLE_ABSENCE = new Set(['A', 'UL']);

const isYes = (v) => v === true || v === 1 || v === '1';
const isNo = (v) => v === false || v === 0 || v === '0';

/** 'approved' | 'refused' | 'undecided' for one day's entry. */
export function standingOf(entry = {}) {
  if (isYes(entry.approved)) return 'approved';
  if (isNo(entry.approved)) return 'refused';
  return 'undecided';
}

const nameOf = (row) => row.employee_name || row.name || '';

/**
 * Every unapproved absence in the month, person by person, priced.
 *
 * `countUndecided` is the office saying "nobody decided means not approved".
 * `upTo` is today's day number in the current month (0 or absent = the whole
 * month): a day that has not happened cannot have been taken without leave.
 */
export function unapprovedLeave(rows = [], period = {}, { countUndecided = false, upTo = 0 } = {}) {
  const out = {
    people: [],
    refused: 0,
    undecided: 0,
    approved: 0,
    already: 0,
    days: 0,
    extra_days: 0,
    amount: 0,
    waiting: [],
  };

  for (const row of rows) {
    const attendance = row.attendance || {};
    const refused = [];
    const undecided = [];
    for (const [key, entry] of Object.entries(attendance)) {
      const day = Number(key);
      const code = String(entry?.code || '').toUpperCase();
      if (code === DOUBLE_MARK) {
        out.already += 1;
        continue;
      }
      if (!SINGLE_ABSENCE.has(code)) continue;
      if (upTo && day > upTo) continue;
      // Somebody who had left by then was not absent without leave - they
      // were gone. Those marks price their last month and are not this rule's.
      if (!onStaffThatDay(row, { year: period.year, month: period.month, day, attendance })) continue;
      const standing = standingOf(entry);
      const line = { day, code, reason: entry.reason || '', standing };
      if (standing === 'approved') out.approved += 1;
      else if (standing === 'refused') refused.push(line);
      else undecided.push(line);
    }
    out.refused += refused.length;
    out.undecided += undecided.length;

    const days = [...refused, ...(countUndecided ? undecided : [])].sort((a, b) => a.day - b.day);
    if (!countUndecided && undecided.length) {
      out.waiting.push({
        employee_id: row.employee_id,
        employee_name: nameOf(row),
        days: undecided.map((d) => d.day).sort((a, b) => a - b),
      });
    }
    if (!days.length) continue;

    /*
     * Priced by the function that pays. Each day goes from costing one day to
     * costing two, so on a plain month this is days x the day rate - but the
     * month's hours rule, a typed override or a part month can all make it
     * something else, and the payslip's own answer is the only one that counts.
     */
    const now = calculateRow(row, period, attendance);
    const after = { ...attendance };
    for (const d of days) after[d.day] = { ...attendance[d.day], code: DOUBLE_MARK };
    const then = calculateRow(row, period, after);
    const amount = Math.round((Number(now.net_salary) || 0) - (Number(then.net_salary) || 0));

    out.people.push({
      employee_id: row.employee_id,
      employee_name: nameOf(row),
      department: row.department || '',
      days,
      extra_days: days.length,
      amount,
    });
    out.days += days.length;
    out.extra_days += days.length;
    out.amount += amount;
  }

  out.people.sort((a, b) => b.days.length - a.days.length || a.employee_name.localeCompare(b.employee_name));
  out.waiting.sort((a, b) => b.days.length - a.days.length || a.employee_name.localeCompare(b.employee_name));
  return out;
}

/**
 * The attendance entries that apply it: the mark and nothing else.
 *
 * Naming only `code` is deliberate. `setAttendance` merges per field, so the
 * reason somebody typed and the "not approved" on the day both stay - which
 * is the record of WHY this day cost two.
 */
export function entriesToDouble(report) {
  const entries = [];
  for (const person of report?.people || []) {
    for (const d of person.days) entries.push({ employee_id: person.employee_id, day: d.day, code: DOUBLE_MARK });
  }
  return entries;
}
