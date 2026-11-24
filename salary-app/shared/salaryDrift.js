/**
 * WHEN THE MONTH'S SALARY AND THE RECORD'S SALARY DISAGREE.
 *
 * Dinesh, off his live sheet: *"5 lac salary showing / 50 dala he"* — the
 * employee record said 50,000 and the salary sheet was paying **5,00,000**.
 *
 * ---------------------------------------------------------------------------
 * WHY THAT HAPPENS, AND WHY IT IS NOT SIMPLY A BUG TO DELETE.
 *
 * `payroll_rows.salary` is the month's own figure, taken from the record when
 * the row was first created. After that `syncPayrollRows` only fills it in
 * where it is still 0 — it deliberately does NOT follow the record, because a
 * month that has been run must not quietly move when somebody edits a master
 * later, and because the office really does sometimes type a different figure
 * for one month on purpose.
 *
 * So a difference has two completely different meanings and the app cannot
 * tell them apart:
 *
 *   - somebody typed the salary wrong, fixed it on the record, and the open
 *     month is still paying the old one — which is what happened here, by a
 *     factor of ten; or
 *   - somebody meant this month to pay something else.
 *
 * ---------------------------------------------------------------------------
 * SO THIS NAMES IT AND CHANGES NOTHING.
 *
 * It is the same answer as every other place two figures can disagree in this
 * app: the typed-over cell marked with a ✎, the asset that is "not checked"
 * rather than missing, the punch day that is "not known" rather than absent.
 * The office is shown the difference with both figures and decides. There is
 * no rule here that could be right, so there is no rule.
 *
 * It computes nothing: both figures are already on the row.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Is this row's salary different from the salary on the person's record? */
export function driftOf(row = {}) {
  /*
   * `monthly_salary` is the record's figure, carried on every payroll row by
   * `listPayrollRows`. Where it is missing the question cannot be asked at
   * all — and "not known" is never "they disagree".
   */
  if (row.monthly_salary === null || row.monthly_salary === undefined || row.monthly_salary === '') {
    return null;
  }
  const sheet = num(row.salary);
  const master = num(row.monthly_salary);
  if (sheet === master) return null;
  /*
   * A row still sitting at 0 is not a disagreement — it is a row nobody has
   * filled in, which `syncPayrollRows` fills from the record by itself on the
   * next read. Reporting it would put a line on the screen that disappears
   * when somebody looks.
   */
  if (sheet === 0) return null;
  return { sheet, master, diff: master - sheet };
}

/**
 * Every row whose month disagrees with its record, biggest gap first.
 *
 * @param rows payroll rows as `listPayrollRows` returns them
 */
export function salaryDrift(rows = []) {
  const lines = [];
  for (const row of rows) {
    const d = driftOf(row);
    if (!d) continue;
    lines.push({
      id: row.id,
      employee_id: row.employee_id,
      name: row.employee_name || '',
      ...d,
    });
  }
  lines.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return {
    lines,
    /*
     * What the month is paying ABOVE the records, and below them, counted
     * apart. One figure netted off would read as nothing wrong on a month
     * where one person is ten times over and another is under.
     */
    over: lines.filter((l) => l.sheet > l.master).length,
    under: lines.filter((l) => l.sheet < l.master).length,
    worst: lines[0] || null,
    any: lines.length > 0,
  };
}

/** The patch that brings one record's salary onto the month. */
export const takeMasterPatch = (line) => ({ salary: line.master });
