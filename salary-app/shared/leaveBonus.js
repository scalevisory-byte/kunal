/**
 * THE LEAVE BONUS — paid for a month nobody took time off in.
 *
 * Dinesh: *"Leave bonus add karo"*, and then *"Leave me ek alag tab rakho"*.
 *
 * Two shapes, because an office runs one or the other and they are not the
 * same promise:
 *
 *   **all or nothing** — a flat amount, and one qualifying day loses the lot.
 *   **graded**        — the same amount, less a fixed cut for each day off,
 *                       never below zero. Somebody with one absence still
 *                       gets something, which is what most offices actually
 *                       mean by an attendance incentive.
 *
 * ---------------------------------------------------------------------------
 * IT COUNTS NOTHING OF ITS OWN, AND IT PAYS NOBODY BY ITSELF.
 *
 * The days come off `countMarks` — the same marks the salary sheet is paid
 * from and the muster roll prints — so this and the payslip cannot disagree
 * about who was in. And working the bonus out does not pay it: the money
 * reaches a payslip only through one call that names the month it goes onto,
 * exactly as an expense claim and a penalty recovery do.
 *
 * THE TRAP THIS MODULE EXISTS TO AVOID: **a month nobody has marked would
 * make the whole staff eligible.** Every person would read as having taken
 * no leave, because nothing says they took any — and the office would pay
 * eighty-five bonuses for a grid that was simply never filled in. So
 * somebody with NO marks at all in the month is never eligible; they are
 * named, with the reason, and the run says how many. This is the same rule
 * the biometric import follows for a day the machine has no record of, and
 * the same one the roll call follows for an empty month.
 * ---------------------------------------------------------------------------
 */

import { ATTENDANCE_CODES, countMarks } from './calc.js';

/** The two shapes a bonus can take. */
export const BONUS_KINDS = [
  ['all_or_nothing', 'All or nothing', 'one qualifying day and the bonus is lost'],
  ['graded', 'Less a cut per day', 'the amount, reduced for each day off'],
];

export const kindLabel = (key) => BONUS_KINDS.find(([k]) => k === key)?.[1] || key;

/**
 * The marks that cost somebody the bonus, by default.
 *
 * Absence and unpaid leave, plus the three paid leaves and a half day: the
 * whole point is a reward for a month nobody was away, and paid leave is
 * still away. Every one of them is a tick on the panel, because an office
 * that pays the bonus through sick leave is a real office.
 */
export const DEFAULT_BREAKS = ['A', 'UL', 'HF', 'AD', 'CL', 'SL', 'PL'];

/** Marks that can sensibly be chosen as disqualifying. */
export const BREAKABLE = ['A', 'UL', 'HF', 'AD', 'CL', 'SL', 'PL', 'WH'];

export const DEFAULT_RULE = {
  kind: 'all_or_nothing',
  /** Flat rupees for a clean month. */
  amount: 500,
  /** `graded` only: rupees off for each qualifying day. */
  cut_per_day: 200,
  /** Which marks cost it. */
  breaks: [...DEFAULT_BREAKS],
  /** Half a day counts as half a day off under `graded`, not a whole one. */
  half_counts_half: true,
};

const n = (v) => Number(v) || 0;
const round0 = (v) => Math.round(n(v));

/** A rule with every field filled in, whatever was stored. */
export function normaliseRule(rule = {}) {
  const kind = BONUS_KINDS.some(([k]) => k === rule.kind) ? rule.kind : DEFAULT_RULE.kind;
  /*
   * AN EMPTY LIST IS NOT A LEAVE BONUS.
   *
   * With nothing disqualifying, every single person qualifies every month -
   * that is a flat allowance, not a bonus for taking no leave, and nobody
   * would have decided it by unticking boxes one at a time. So it falls
   * back to the default list rather than quietly paying the whole staff.
   * (The panel also refuses to untick the last one, so this is the second
   * line of defence, not the first.) Caught by a test.
   */
  const asked = Array.isArray(rule.breaks)
    ? rule.breaks.filter((c) => BREAKABLE.includes(c))
    : [];
  const breaks = asked.length ? asked : [...DEFAULT_BREAKS];
  return {
    kind,
    amount: Math.max(0, round0(rule.amount ?? DEFAULT_RULE.amount)),
    cut_per_day: Math.max(0, round0(rule.cut_per_day ?? DEFAULT_RULE.cut_per_day)),
    breaks,
    half_counts_half: rule.half_counts_half !== false,
  };
}

/** How many days off this person had, by the rule's own list. */
export function daysOff(counts = {}, rule) {
  let days = 0;
  for (const code of rule.breaks) {
    const marked = n(counts[code]);
    if (!marked) continue;
    if (code === 'HF') days += rule.half_counts_half ? marked * 0.5 : marked;
    else if (code === 'AD') days += marked * 2; // the sheet docks two for an AD
    else days += marked;
  }
  return Math.round(days * 100) / 100;
}

/**
 * One person's line.
 *
 * `row` is a calculated row with its `attendance`, as every other report
 * here takes them.
 */
export function bonusFor(row = {}, rule = DEFAULT_RULE) {
  const r = normaliseRule(rule);
  const counts = countMarks(row.attendance || {});
  /* Every mark on the grid, so "nothing marked" can be told from "marked,
     and they were here". Sundays and holidays are marks too - a month where
     only the Sundays are filled in is still a month nobody marked. */
  const marked = Object.values(row.attendance || {}).filter((entry) => {
    const code = (typeof entry === 'object' ? entry?.code : entry) || '';
    return code !== '';
  }).length;

  const off = daysOff(counts, r);
  const which = r.breaks
    .filter((code) => n(counts[code]))
    .map((code) => `${n(counts[code])} ${ATTENDANCE_CODES[code]?.label || code}`);

  /*
   * NOTHING MARKED IS NOT A CLEAN MONTH.
   *
   * Without this the whole staff reads as eligible the moment somebody
   * forgets to fill the grid in, and the office pays a bonus to everybody
   * for a month nobody recorded.
   */
  if (!marked) {
    return {
      employee_id: row.employee_id,
      name: row.employee_name || '',
      code: row.employee_code || '',
      company_name: row.company_name || '',
      department: row.department || '',
      days_off: 0,
      which: [],
      marked_days: 0,
      eligible: false,
      unknown: true,
      amount: 0,
      why: 'nothing is marked for them this month',
    };
  }

  const amount =
    r.kind === 'all_or_nothing'
      ? off > 0
        ? 0
        : r.amount
      : Math.max(0, round0(r.amount - off * r.cut_per_day));

  return {
    employee_id: row.employee_id,
    name: row.employee_name || '',
    code: row.employee_code || '',
    company_name: row.company_name || '',
    department: row.department || '',
    days_off: off,
    which,
    marked_days: marked,
    eligible: amount > 0,
    unknown: false,
    amount,
    why:
      amount > 0
        ? off > 0
          ? `${off} day(s) off — ${which.join(', ')}`
          : 'no day off this month'
        : off > 0
          ? `${off} day(s) off — ${which.join(', ')}`
          : 'the rule pays nothing',
  };
}

/** The whole month. */
export function bonusRun(rows = [], rule = DEFAULT_RULE, { paid = new Set() } = {}) {
  const r = normaliseRule(rule);
  const lines = rows
    .map((row) => ({ ...bonusFor(row, r), already_paid: paid.has(Number(row.employee_id)) }))
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        Number(a.unknown) - Number(b.unknown) ||
        String(a.name).localeCompare(String(b.name))
    );

  const toPay = lines.filter((l) => l.eligible && !l.already_paid);
  return {
    rule: r,
    lines,
    totals: {
      people: lines.length,
      eligible: lines.filter((l) => l.eligible).length,
      /* Named apart, every time: these are the ones a person has to look at
         rather than something the button can deal with. */
      unknown: lines.filter((l) => l.unknown).length,
      already_paid: lines.filter((l) => l.already_paid).length,
      to_pay: toPay.length,
      amount: toPay.reduce((t, l) => t + l.amount, 0),
      paid_amount: lines.filter((l) => l.already_paid).reduce((t, l) => t + l.amount, 0),
    },
  };
}

export const BONUS_COLUMNS = [
  ['Name', 'name'],
  ['Code', 'code'],
  ['Company', 'company_name'],
  ['Department', 'department'],
  ['Days off', 'days_off'],
  ['What', 'why'],
  ['Bonus', 'amount'],
];
