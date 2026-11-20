/**
 * WHAT TO CHECK BEFORE A MONTH IS PAID.
 *
 * Dinesh's brief: *"Create an exception detection system using existing
 * payroll data"* — and, twice over, *"Do not automatically correct or change
 * any salary amount."*
 *
 * SO THIS FILE CHANGES NOTHING. It reads the month as it has already been
 * calculated and says what looks wrong. Every line names the person, the
 * figure, and what somebody should go and look at. Not one of them edits a
 * row, and none of them can: there is no write in this file at all.
 *
 * THE SECOND RULE: A FLAG IS NOT A FAULT. A net of nought is right for
 * somebody who joined on the 30th; a zero salary is right for a director who
 * takes none. That is why each one is a question with a suggested check
 * rather than an error, and why a flag can be marked **Ignored** with a
 * reason instead of having to be made to go away.
 *
 * Dependency-free, like the rest of shared/.
 */

const n = (v) => Number(v) || 0;
const money = (v) => `₹${Math.round(n(v)).toLocaleString('en-IN')}`;

/**
 * The checks, in the order they matter.
 *
 * `severity` is only how loud the line is: 'bad' is money that is wrong or
 * missing, 'warn' is something to look at before paying, 'note' is tidiness.
 * Nothing here is ever fatal - a month can always be paid over a flag,
 * because the office knows things this file does not.
 */
export const EXCEPTION_KINDS = [
  ['no_salary', 'No salary set', 'bad'],
  ['zero_per_day', 'Day rate is nought', 'bad'],
  ['negative_net', 'Net payable is below nought', 'bad'],
  ['zero_net', 'Net payable is nought', 'warn'],
  ['absent_over_days', 'Absent more days than the month has', 'bad'],
  ['no_attendance', 'Nothing marked all month', 'warn'],
  ['part_attendance', 'Attendance looks unfinished', 'note'],
  ['paid_without_details', 'Marked paid with no payment details', 'warn'],
  ['duplicate_person', 'The same name twice on one company', 'warn'],
  ['pf_no_uan', 'PF deducted with no UAN', 'warn'],
  ['esi_over_limit', 'ESI deducted above the wage limit', 'warn'],
  ['big_deduction', 'Deductions are more than half the gross', 'warn'],
];

export const exceptionLabel = (code) => EXCEPTION_KINDS.find(([k]) => k === code)?.[1] || code;
export const exceptionSeverity = (code) => EXCEPTION_KINDS.find(([k]) => k === code)?.[2] || 'note';

/** How many of the month's days have a mark against them. */
const markedDays = (attendance = {}) =>
  Object.values(attendance).filter((e) => String((typeof e === 'object' ? e?.code : e) || '').trim()).length;

/**
 * Every flag on one month.
 *
 * @param rows   [{ row, calc, employee }] - the row as stored, what
 *               `calculateRow` returned for it, and the master
 * @param period the month
 * @param today  for "is this month still running", so a half-marked month in
 *               progress is not called unfinished
 */
export function payrollExceptions(rows = [], { period = {}, today = '' } = {}) {
  const out = [];
  const say = (entry, code, detail, amount) =>
    out.push({
      code,
      label: exceptionLabel(code),
      severity: exceptionSeverity(code),
      employee_id: entry.row?.employee_id ?? entry.employee?.id ?? null,
      row_id: entry.row?.id ?? null,
      name: entry.row?.employee_name || entry.employee?.name || '',
      company: entry.row?.company_name || entry.employee?.company_name || '',
      detail,
      amount: amount === undefined ? null : n(amount),
    });

  /*
   * The same person entered twice is counted here rather than per row,
   * because it is a fact about the pair. The database cannot stop it: the
   * unique key is on employee + month, so two employee records with one
   * name are two perfectly legal rows - and two salaries.
   */
  const byName = new Map();
  for (const entry of rows) {
    const key = `${entry.row?.company_name || ''}::${String(entry.row?.employee_name || '').trim().toLowerCase()}`;
    if (!key.trim()) continue;
    byName.set(key, (byName.get(key) || 0) + 1);
  }

  const seenDuplicate = new Set();
  const monthRunning = !!today && String(today).slice(0, 7) === `${period.year}-${String(period.month).padStart(2, '0')}`;
  const dayOfMonth = monthRunning ? Number(String(today).slice(8, 10)) : 0;

  for (const entry of rows) {
    const { row = {}, calc = {}, employee = {} } = entry;

    if (!n(row.salary)) {
      say(entry, 'no_salary', 'No monthly salary on this row — check the employee master.', 0);
    } else if (!n(calc.per_day)) {
      say(entry, 'zero_per_day', 'The day rate works out at nought. Check the salary and the month’s working days.', 0);
    }

    const net = n(calc.net_salary);
    if (net < 0) {
      say(entry, 'negative_net', `Deductions come to more than the earnings. Verify the loan, penalty and deduction figures.`, net);
    } else if (!net && n(row.salary)) {
      say(entry, 'zero_net', 'Nothing is payable this month. Verify the salary setup and the attendance.', 0);
    }

    const absent = n(calc.absent_days);
    if (absent > n(calc.working_days)) {
      say(entry, 'absent_over_days', `${absent} absent against ${calc.working_days} working days.`, absent);
    }

    const marked = markedDays(row.attendance);
    if (!marked) {
      say(entry, 'no_attendance', 'No day is marked, so the month pays in full. Import the machine’s file or mark the grid.', null);
    } else if (dayOfMonth > 1 && marked < dayOfMonth - 1) {
      say(entry, 'part_attendance', `${marked} day(s) marked out of ${dayOfMonth - 1} so far this month.`, null);
    }

    /*
     * PAID IS A CLAIM THAT MONEY LEFT THE BANK. Without a mode, a date or a
     * reference there is nothing to check it against - which is exactly the
     * row somebody queries three months later.
     */
    if (String(row.status || '').toLowerCase() === 'paid' && !(row.payment_mode && (row.payment_date || row.payment_ref))) {
      say(entry, 'paid_without_details', 'Marked paid with no payment date or reference against it.', net);
    }

    const key = `${row.company_name || ''}::${String(row.employee_name || '').trim().toLowerCase()}`;
    if ((byName.get(key) || 0) > 1 && !seenDuplicate.has(key)) {
      seenDuplicate.add(key);
      say(entry, 'duplicate_person', `${byName.get(key)} people on this company share this name — check they are not the same person twice.`, net);
    }

    if (n(calc.pf) > 0 && !String(employee.uan || '').trim()) {
      say(entry, 'pf_no_uan', 'PF is being deducted but there is no UAN on the record — the return cannot be filed.', calc.pf);
    }

    /*
     * ESI stops above the wage limit. The engine already handles that; a
     * deduction above it means a figure typed by hand, which is worth a look
     * rather than a correction nobody asked for.
     */
    if (n(calc.esi) > 0 && n(calc.gross_salary) > 21000) {
      say(entry, 'esi_over_limit', `ESI is being deducted on a gross of ${money(calc.gross_salary)}.`, calc.esi);
    }

    const deductions = n(calc.pt) + n(calc.esi) + n(calc.pf) + n(calc.loan_deduction) +
      n(calc.penalty_deduction) + n(calc.deduction);
    if (n(calc.gross_salary) > 0 && deductions > n(calc.gross_salary) / 2) {
      say(entry, 'big_deduction', `${money(deductions)} is coming off a gross of ${money(calc.gross_salary)}.`, deductions);
    }
  }

  return out;
}

/** The flags grouped for the headline: how many, and how many are loud. */
export function exceptionSummary(list = []) {
  const open = list.filter((e) => (e.state || 'open') === 'open');
  return {
    total: list.length,
    open: open.length,
    bad: open.filter((e) => e.severity === 'bad').length,
    warn: open.filter((e) => e.severity === 'warn').length,
    people: new Set(open.map((e) => e.employee_id)).size,
  };
}
