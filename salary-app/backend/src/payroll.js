import { calculateRow, countMarks, sundayDaysFromAttendance, totalRows } from '../../shared/calc.js';
import {
  attendanceByEmployee,
  getPeriod,
  listPayrollRows,
  loanDeductions,
  penaltyDeductions,
  postPenaltyRecoveries,
  postRepayments,
  syncPayrollRows,
} from './db.js';

/**
 * The whole month, calculated: every payroll row joined to its attendance and
 * run through the sheet's formulas, plus per-company and grand totals.
 */
export function buildPayroll(periodId, { company_id, sync = true } = {}) {
  const period = getPeriod(periodId);
  if (!period) return null;

  if (sync && !period.locked) {
    syncPayrollRows(periodId);
    // Loans take their instalment the first time the month is looked at.
    postRepayments(periodId);
    // And so does a penalty, which is the whole of what "like a loan" means:
    // recording one is no longer a note somebody has to act on every month.
    postPenaltyRecoveries(periodId);
  }

  const attendance = attendanceByEmployee(periodId);
  const loans = loanDeductions(periodId);
  const penalties = penaltyDeductions(periodId);
  const rows = listPayrollRows(periodId, { company_id }).map((row) => {
    const marks = attendance.get(row.employee_id) || {};
    return {
      ...row,
      attendance: marks,
      // Day count per mark, so leave can be reported without re-reading the grid.
      mark_counts: countMarks(marks),
      // The dates behind the Sunday count, for the register.
      sunday_days: sundayDaysFromAttendance(marks),
      loan_deduction: loans.get(row.employee_id) || 0,
      penalty_deduction: penalties.get(row.employee_id)?.amount || 0,
      // What it was for, so the payslip can say it without the free-text
      // remark having to carry a sentence appended to it every month.
      penalty_notes: penalties.get(row.employee_id)?.notes || [],
      // Which columns are hand-typed over the formula, so the UI can flag them.
      overrides: {
        absent_days: row.absent_days_override !== null,
        sundays: row.sundays_override !== null,
        ot_minutes: row.ot_minutes_override !== null,
        ot_amount: row.ot_amount_override !== null,
        sunday_salary: row.sunday_salary_override !== null,
      },
      /*
       * The ledger figures are handed in EXPLICITLY, because this is called
       * with the stored row rather than with the object being built above -
       * so anything set up there and not repeated here never reaches the
       * sum. The penalty was added above and silently did nothing until a
       * test went looking for the money rather than for the ledger row.
       */
      ...calculateRow(
        {
          ...row,
          loan_deduction: loans.get(row.employee_id) || 0,
          penalty_deduction: penalties.get(row.employee_id)?.amount || 0,
        },
        period,
        marks
      ),
      // calculateRow hands these back, and the spread above would otherwise
      // drop the notes, which it knows nothing about.
      penalty_notes: penalties.get(row.employee_id)?.notes || [],
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
