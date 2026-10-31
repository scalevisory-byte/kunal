/**
 * One person's own report: every month they were paid, side by side.
 *
 * The salary sheet reads a month across all the staff. This reads one person
 * down the months — their attendance, their leave, their pay — which is what
 * gets printed for a loan application, an appraisal, a resignation, or when
 * somebody asks why last month was short.
 *
 * It assembles only. Every figure already came out of `calculateRow`, so a
 * month here and the same month's payslip cannot disagree.
 *
 * Dependency-free, so the server and the standalone file build it identically.
 */

import { attendanceSummary } from './attendanceReport.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => Math.round(Number(n) || 0);

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * @param months  [{ period, row }] — one entry per month the person has a
 *                payroll row in, oldest first. `row` is a calculated row.
 * @param employee the master record, for the header and the leave quotas.
 */
export function employeeReport({ employee, months = [] } = {}) {
  const rows = months
    .filter((m) => m && m.period && m.row)
    .map(({ period, row }) => {
      // Re-use the attendance report so the per-month counts here and the
      // month-wide report are literally the same code.
      const [counts] = attendanceSummary({ period, rows: [row] }).rows;

      return {
        period_id: period.id,
        year: period.year,
        month: period.month,
        label: period.label || `${MONTHS[period.month - 1]} ${period.year}`,
        short: `${MONTHS[period.month - 1].slice(0, 3)} ${String(period.year).slice(2)}`,

        present: counts.present,
        half_day: counts.half_day,
        absent: counts.absent,
        casual_leave: counts.casual_leave,
        sick_leave: counts.sick_leave,
        paid_leave: counts.paid_leave,
        unpaid_leave: counts.unpaid_leave,
        holiday: counts.holiday,
        sunday_worked: counts.sunday_worked,
        // Carried through so the totals can work the percentage out the same
        // way a single month does - two definitions on one page is worse than
        // either of them.
        worked_days: counts.worked_days,
        paid_off_days: counts.paid_off_days,
        days_lost: counts.days_lost,
        payable_days: counts.payable_days,
        unmarked_days: counts.unmarked_days,
        attendance_percent: counts.attendance_percent,

        salary: money(row.salary),
        gross_salary: money(row.gross_salary),
        ot_amount: money(row.ot_amount),
        addition: money(row.addition),
        deduction: money(row.deduction),
        pf: money(row.pf),
        esi: money(row.esi),
        pt: money(row.pt),
        loan_deduction: money(row.loan_deduction),
        net_salary: money(row.net_salary),
        // Settled on its own register, so it is shown beside the salary and
        // never added into it.
        sunday_salary: money(row.sunday_salary),
        worked_minutes: Math.round(Number(row.worked_minutes) || 0),

        status: row.status || '',
        payment_mode: row.payment_mode || '',
        remark: row.remark || '',
      };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);

  return {
    employee: employee
      ? {
          id: employee.id,
          code: employee.code || '',
          name: employee.name,
          company_name: employee.company_name,
          designation: employee.designation || '',
          department: employee.department || '',
          joined_on: employee.joined_on || '',
          left_on: employee.left_on || '',
          monthly_salary: money(employee.monthly_salary),
          payment_mode: employee.payment_mode || '',
          phone: employee.phone || '',
          quotas: {
            CL: Number(employee.cl_quota) || 0,
            SL: Number(employee.sl_quota) || 0,
            PL: Number(employee.pl_quota) || 0,
          },
        }
      : null,
    months: rows,
    totals: totalsOf(rows),
    leave: leaveOf(rows, employee),
  };
}

const SUMMED = [
  'present', 'half_day', 'absent', 'worked_days', 'paid_off_days',
  'casual_leave', 'sick_leave', 'paid_leave', 'unpaid_leave',
  'holiday', 'sunday_worked', 'days_lost', 'payable_days', 'unmarked_days',
  'gross_salary', 'ot_amount', 'addition', 'deduction',
  'pf', 'esi', 'pt', 'loan_deduction', 'net_salary', 'sunday_salary',
  'worked_minutes',
];

export function totalsOf(rows) {
  const totals = { months: rows.length };
  for (const key of SUMMED) totals[key] = round2(rows.reduce((n, r) => n + (r[key] || 0), 0));
  // An average over the months actually paid, not over twelve.
  totals.average_net = rows.length ? Math.round(totals.net_salary / rows.length) : 0;
  // The same sum a single month does: days attended out of days expected. It
  // used to be worked out off payable_days, which counts unmarked days as
  // worked, so the footer read 80.8% under a month reading 73.7%.
  const attended = totals.worked_days + totals.paid_off_days;
  const expected = attended + totals.days_lost;
  totals.attendance_percent = expected > 0 ? Math.round((attended / expected) * 1000) / 10 : null;
  return totals;
}

/**
 * Leave taken against the quota. Counted from the marks rather than kept as a
 * running balance, so it cannot drift away from the grid.
 *
 * The quota is a year's worth; this counts whatever months are in the report,
 * which is the year when the report is for a year. A partial report says so.
 */
export function leaveOf(rows, employee) {
  const taken = {
    CL: rows.reduce((n, r) => n + (r.casual_leave || 0), 0),
    SL: rows.reduce((n, r) => n + (r.sick_leave || 0), 0),
    PL: rows.reduce((n, r) => n + (r.paid_leave || 0), 0),
    UL: rows.reduce((n, r) => n + (r.unpaid_leave || 0), 0),
  };
  const quotas = {
    CL: Number(employee?.cl_quota) || 0,
    SL: Number(employee?.sl_quota) || 0,
    PL: Number(employee?.pl_quota) || 0,
  };
  return {
    taken,
    quotas,
    balance: {
      CL: round2(quotas.CL - taken.CL),
      SL: round2(quotas.SL - taken.SL),
      PL: round2(quotas.PL - taken.PL),
    },
    // Unpaid leave has no quota: it is leave that was taken anyway and docked.
    unpaid: taken.UL,
    over: ['CL', 'SL', 'PL'].filter((kind) => taken[kind] > quotas[kind]),
    months_counted: rows.length,
  };
}

export const MONTH_COLUMNS = [
  ['Month', 'label'],
  ['Present', 'present'], ['Half day', 'half_day'], ['Absent', 'absent'],
  ['CL', 'casual_leave'], ['SL', 'sick_leave'], ['PL', 'paid_leave'], ['Unpaid', 'unpaid_leave'],
  ['Holiday', 'holiday'], ['Sunday worked', 'sunday_worked'],
  ['Days lost', 'days_lost'], ['Payable days', 'payable_days'], ['Attendance %', 'attendance_percent'],
  ['Salary', 'salary'], ['Gross', 'gross_salary'],
  ['OT / LT', 'ot_amount'], ['Addition', 'addition'], ['Deduction', 'deduction'],
  ['PF', 'pf'], ['ESI', 'esi'], ['PT', 'pt'], ['Loan', 'loan_deduction'],
  ['Net', 'net_salary'], ['Sunday pay', 'sunday_salary'],
  ['Status', 'status'], ['Paid by', 'payment_mode'],
];
