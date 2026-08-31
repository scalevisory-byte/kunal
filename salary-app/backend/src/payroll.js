import { calculateRow, countMarks, sundayDaysFromAttendance, totalRows } from '../../shared/calc.js';
import { attendanceByEmployee, getPeriod, listPayrollRows, syncPayrollRows } from './db.js';

/**
 * The whole month, calculated: every payroll row joined to its attendance and
 * run through the sheet's formulas, plus per-company and grand totals.
 */
export function buildPayroll(periodId, { company_id, sync = true } = {}) {
  const period = getPeriod(periodId);
  if (!period) return null;

  if (sync && !period.locked) syncPayrollRows(periodId);

  const attendance = attendanceByEmployee(periodId);
  const rows = listPayrollRows(periodId, { company_id }).map((row) => {
    const marks = attendance.get(row.employee_id) || {};
    return {
      ...row,
      attendance: marks,
      // Day count per mark, so leave can be reported without re-reading the grid.
      mark_counts: countMarks(marks),
      // The dates behind the Sunday count, for the register.
      sunday_days: sundayDaysFromAttendance(marks),
      // Which columns are hand-typed over the formula, so the UI can flag them.
      overrides: {
        absent_days: row.absent_days_override !== null,
        sundays: row.sundays_override !== null,
        ot_minutes: row.ot_minutes_override !== null,
        ot_amount: row.ot_amount_override !== null,
        sunday_salary: row.sunday_salary_override !== null,
      },
      ...calculateRow(row, period, marks),
    };
  });

  const byCompany = new Map();
  for (const row of rows) {
    if (!byCompany.has(row.company_id)) {
      byCompany.set(row.company_id, { company_id: row.company_id, company_name: row.company_name, rows: [] });
    }
    byCompany.get(row.company_id).rows.push(row);
  }

  return {
    period,
    rows,
    companies: [...byCompany.values()].map((group) => ({
      company_id: group.company_id,
      company_name: group.company_name,
      totals: totalRows(group.rows),
    })),
    totals: totalRows(rows),
  };
}

/** One employee's month, in the shape a payslip needs. */
export function buildPayslip(periodId, employeeId) {
  const payroll = buildPayroll(periodId, { sync: false });
  if (!payroll) return null;
  const row = payroll.rows.find((r) => r.employee_id === Number(employeeId));
  if (!row) return null;
  return { period: payroll.period, row };
}
