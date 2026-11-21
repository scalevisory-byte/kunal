/**
 * WHAT EACH DEPARTMENT COSTS, for one month.
 *
 * Listed as not built on the note *"Needs the department joined to the
 * payroll row at report time"* - which had stopped being true. The same
 * stale note stood in front of the department-wise LEAVE summary, and the
 * lesson is worth writing down twice: **a note explaining why something
 * cannot be built outlives the thing that made it true.** `listPayrollRows`
 * carries `e.department` on every row; the join is already in the month.
 *
 * ---------------------------------------------------------------------------
 * IT ASSEMBLES; IT NEVER RECALCULATES, and it says what it is adding up.
 *
 * `net_salary` is what people take home. `cost` is what the company actually
 * spends - net, plus every deduction it hands on (PF, ESI, PT are the
 * employee's money passing through), plus the employer's own contributions.
 * The two are different questions and a page carrying only one of them gets
 * read as the other.
 *
 * Sunday pay is NOT in either. It is settled on its own register, which is
 * the whole reason that register exists, and folding it in here would make
 * this disagree with the salary sheet. It is shown in its own column.
 * ---------------------------------------------------------------------------
 */

import { earnedOf } from './deductionStatement.js';

const NO_DEPARTMENT = 'No department set';
const n = (v) => Math.round(Number(v) || 0);

const blank = (department) => ({
  department,
  people: 0,
  /* People actually paid something this month - a department of four with
     one on unpaid leave all month is not four salaries. */
  paid: 0,
  earned: 0,
  gross_salary: 0,
  pf: 0,
  esi: 0,
  pt: 0,
  loan_deduction: 0,
  other_deduction: 0,
  deductions: 0,
  net_salary: 0,
  pf_employer: 0,
  esi_employer: 0,
  employer: 0,
  cost: 0,
  sunday_salary: 0,
  present_days: 0,
  absent_days: 0,
  worked_minutes: 0,
});

export function salaryByDepartment(rows = []) {
  const byName = new Map();
  for (const row of rows) {
    const name = String(row.department || '').trim() || NO_DEPARTMENT;
    if (!byName.has(name)) byName.set(name, blank(name));
    const d = byName.get(name);
    d.people += 1;
    if (n(row.net_salary) > 0) d.paid += 1;
    /* What the month earned BEFORE anything came out: `gross_salary` is
       already after the Deduct box and the late charge, so listing those
       against it would count them twice. Same rule as the wage register. */
    d.earned += earnedOf(row);
    d.gross_salary += n(row.gross_salary);
    d.pf += n(row.pf);
    d.esi += n(row.esi);
    d.pt += n(row.pt);
    d.loan_deduction += n(row.loan_deduction);
    d.other_deduction += n(row.deduction) + n(row.penalty_deduction) + n(row.late_salary);
    d.net_salary += n(row.net_salary);
    d.pf_employer += n(row.pf_employer_cost ?? row.pf_employer);
    d.esi_employer += n(row.esi_employer);
    d.sunday_salary += n(row.sunday_salary);
    d.present_days += Number(row.present_days) || 0;
    d.absent_days += Number(row.absent_days) || 0;
    d.worked_minutes += Number(row.worked_minutes) || 0;
  }

  const lines = [...byName.values()]
    .map((d) => {
      d.deductions = d.pf + d.esi + d.pt + d.loan_deduction + d.other_deduction;
      d.employer = d.pf_employer + d.esi_employer;
      /* What the company spends. The deductions are the employee's money
         passing through, so the gross already holds them - only the
         employer's own share is added on top. */
      d.cost = d.gross_salary + d.employer;
      d.per_head = d.people ? Math.round(d.cost / d.people) : 0;
      /* The figure a department is actually compared on. A big department
         costing more than a small one is not news; a big one costing more
         PER PERSON is. */
      d.share = 0;
      return d;
    })
    .sort((a, b) => b.cost - a.cost || a.department.localeCompare(b.department));

  const totals = blank('All departments');
  for (const d of lines) {
    for (const key of Object.keys(totals)) {
      if (key === 'department') continue;
      totals[key] += d[key] || 0;
    }
  }
  totals.per_head = totals.people ? Math.round(totals.cost / totals.people) : 0;
  for (const d of lines) {
    d.share = totals.cost ? Math.round((d.cost / totals.cost) * 1000) / 10 : 0;
  }
  totals.share = lines.length ? 100 : 0;

  return { lines, totals };
}

export const SALARY_DEPARTMENT_COLUMNS = [
  ['Department', 'department'],
  ['People', 'people'],
  ['Paid', 'paid'],
  ['Days present', 'present_days'],
  ['Days absent', 'absent_days'],
  ['Earned', 'earned'],
  ['Gross', 'gross_salary'],
  ['PF', 'pf'],
  ['ESI', 'esi'],
  ['PT', 'pt'],
  ['Loan', 'loan_deduction'],
  ['Other deductions', 'other_deduction'],
  ['Total deducted', 'deductions'],
  ['Net paid', 'net_salary'],
  ['Employer PF', 'pf_employer'],
  ['Employer ESI', 'esi_employer'],
  ['Cost to company', 'cost'],
  ['Cost per head', 'per_head'],
  ['Share of the month', 'share'],
  ['Sunday pay (settled apart)', 'sunday_salary'],
];
