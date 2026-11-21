/**
 * EVERY DEDUCTION IN ONE PLACE, for one month.
 *
 * Each of these was already calculated and already on the payslip - PF, ESI,
 * Professional Tax, a loan instalment, a penalty, the Deduct box, and the
 * late/early charge where that rule is on. What there was no way to see is
 * all of them at once, down the staff: "what came out of people's pay last
 * month, and under what heads" was a question nobody could answer without
 * opening eighty-five payslips.
 *
 * ---------------------------------------------------------------------------
 * IT ASSEMBLES; IT NEVER RECALCULATES.
 *
 * Every figure here came out of `calculateRow`, which is what the payslip was
 * built from and what the bank file was paid from. A statement that worked
 * the deductions out for itself would, the first time somebody typed a net
 * salary over the formula, disagree with the payslip - and then nobody could
 * say which was right.
 *
 * Two things stated rather than assumed:
 *
 *   ABSENCE IS NOT A DEDUCTION. A day not worked was never earned, so it is
 *   shown apart, under what the month earned, and NOT added into the
 *   deductions total. Counting it would double it: the gross is already
 *   after it.
 *
 *   AND TWO OF THESE HEADS ARE ALREADY INSIDE `gross_salary`. The one-off
 *   Deduct box and the late/early charge are taken off BEFORE the gross is
 *   struck (`gross = earned + overtime + additions - deduction - late`),
 *   while PF, ESI, PT, the loan and a penalty come off AFTER it to reach the
 *   net. So listing all seven against `gross_salary` takes those two twice.
 *   `earned` adds them back, exactly as the statutory wage register already
 *   does, and then `earned - every deduction` IS the net, to the rupee. The
 *   report's own balance check is what found this.
 *
 *   THE EMPLOYER'S SHARE IS NOT A DEDUCTION EITHER. It is what the company
 *   pays on top, so it has its own column and its own total, and it never
 *   touches what anybody takes home.
 * ---------------------------------------------------------------------------
 */

/** The heads, in the order a payslip reads them. */
export const DEDUCTION_HEADS = [
  ['pf', 'PF', 'the employee’s 12% share'],
  ['esi', 'ESI', '0.75% while the gross is within the limit'],
  ['pt', 'Professional Tax', 'the state slab, charged on the month’s gross'],
  ['loan_deduction', 'Loan / advance', 'this month’s instalment'],
  ['penalty_deduction', 'Penalty', 'recovered against a recorded penalty'],
  ['deduction', 'Other deduction', 'the Deduct box — a fine, breakage, a recovery'],
  ['late_salary', 'Late / early', 'only where the month runs on the concession rule'],
];

const n = (v) => Math.round(Number(v) || 0);

/** The heads that are taken off BEFORE `gross_salary` is struck. */
export const INSIDE_GROSS = ['deduction', 'late_salary'];

/**
 * What the month earned before anything came out of it.
 *
 * `gross_salary` is already after the Deduct box and the late/early charge,
 * so those are added back - otherwise they are counted twice and the
 * statement does not balance.
 */
export const earnedOf = (row = {}) =>
  n(row.gross_salary) + INSIDE_GROSS.reduce((t, key) => t + n(row[key]), 0);

/** One person's line. */
export function deductionLine(row = {}) {
  const heads = {};
  for (const [key] of DEDUCTION_HEADS) heads[key] = n(row[key]);
  const total = DEDUCTION_HEADS.reduce((t, [key]) => t + heads[key], 0);
  return {
    employee_id: row.employee_id,
    name: row.employee_name || '',
    code: row.employee_code || '',
    company_name: row.company_name || '',
    department: row.department || '',
    ...heads,
    /* Shown, never added in: the gross is already after it. */
    absent_salary: n(row.absent_salary),
    absent_days: Number(row.absent_days) || 0,
    earned: earnedOf(row),
    gross_salary: n(row.gross_salary),
    total,
    net_salary: n(row.net_salary),
    /* What the company pays on top. Not a deduction; its own total. */
    pf_employer: n(row.pf_employer_cost ?? row.pf_employer),
    esi_employer: n(row.esi_employer),
    note: row.adjustment_note || '',
  };
}

export function deductionStatement(rows = []) {
  const lines = rows.map(deductionLine).sort(
    (a, b) =>
      b.total - a.total ||
      String(a.company_name).localeCompare(String(b.company_name)) ||
      String(a.name).localeCompare(String(b.name))
  );

  const sum = (f) => lines.reduce((t, l) => t + f(l), 0);
  const totals = { people: lines.length };
  for (const [key] of DEDUCTION_HEADS) totals[key] = sum((l) => l[key]);
  totals.total = sum((l) => l.total);
  totals.earned = sum((l) => l.earned);
  totals.gross_salary = sum((l) => l.gross_salary);
  totals.net_salary = sum((l) => l.net_salary);
  totals.absent_salary = sum((l) => l.absent_salary);
  totals.pf_employer = sum((l) => l.pf_employer);
  totals.esi_employer = sum((l) => l.esi_employer);
  /* How many people each head actually touched - "PT 14,400" and "PT, 72
     people" are different facts, and the second is the one that finds a
     slab applied to somebody it should not have been. */
  totals.counts = Object.fromEntries(
    DEDUCTION_HEADS.map(([key]) => [key, lines.filter((l) => l[key]).length])
  );
  /* The arithmetic the statement is only worth anything if it holds: what
     the month earned, less every deduction, IS the net. Against
     `gross_salary` it would not - two of the heads are already inside it. */
  totals.balances = totals.earned - totals.total === totals.net_salary;
  return { lines, totals };
}

export const DEDUCTION_COLUMNS = [
  ['Name', 'name'],
  ['Code', 'code'],
  ['Company', 'company_name'],
  ['Department', 'department'],
  ['Earned', 'earned'],
  ...DEDUCTION_HEADS.map(([key, label]) => [label, key]),
  ['Total deducted', 'total'],
  ['Net paid', 'net_salary'],
  ['Employer PF', 'pf_employer'],
  ['Employer ESI', 'esi_employer'],
  ['Note', 'note'],
];
