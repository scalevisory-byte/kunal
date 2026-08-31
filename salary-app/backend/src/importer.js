import ExcelJS from 'exceljs';
import { db, createEmployee, listEmployees, setAttendance, syncPayrollRows, updateEmployee, upsertCompany } from './db.js';
import { listSheetNames as readSheetNames, parseSheet } from '../../shared/sheet.js';
import { log } from './logger.js';

export const listSheetNames = (buffer) => readSheetNames(ExcelJS, buffer);

/**
 * Reads an April-shaped sheet (shared/sheet.js does the reading) and writes it
 * into the employee master and, when a month is given, that month's payroll.
 * Anything it cannot make sense of is reported back rather than guessed at.
 */
export async function importSheet(buffer, { sheetName, periodId, headerRow = 2, dryRun = false } = {}) {
  const read = await parseSheet(ExcelJS, buffer, { sheetName, headerRow });
  if (read.error) return read;

  const { sheet, parsed, skipped } = read;

  if (dryRun) {
    return { sheet, dryRun: true, parsed: parsed.length, skipped, preview: parsed.slice(0, 15) };
  }

  const result = db.transaction(() => {
    const existing = new Map(listEmployees().map((e) => [`${e.company_name}::${e.name}`.toLowerCase(), e]));
    let created = 0;
    let updated = 0;
    const attendanceEntries = [];
    const rowPatches = [];

    parsed.forEach((item, index) => {
      const company = upsertCompany(item.company, index);
      const key = `${company.name}::${item.name}`.toLowerCase();
      let employee = existing.get(key);
      if (employee) {
        employee = updateEmployee(employee.id, { monthly_salary: item.salary, esi: item.esi, pf: item.pf });
        updated++;
      } else {
        employee = createEmployee({
          company_id: company.id,
          name: item.name,
          monthly_salary: item.salary,
          esi: item.esi,
          pf: item.pf,
          payment_mode: item.payment_mode || 'Bank',
          sort_order: index,
        });
        existing.set(key, employee);
        created++;
      }

      for (const [day, code] of Object.entries(item.attendance)) {
        attendanceEntries.push({ employee_id: employee.id, day: Number(day), code });
      }
      rowPatches.push({ employee, item });
    });

    let rowsWritten = 0;
    if (periodId) {
      syncPayrollRows(periodId);
      if (attendanceEntries.length) setAttendance(periodId, attendanceEntries);

      const update = db.prepare(
        `UPDATE payroll_rows
         SET salary = ?, absent_days_override = ?, sundays_override = ?, ot_minutes_override = ?,
             ot_amount_override = ?, adjustment = ?, esi = ?, pf = ?,
             payment_mode = COALESCE(?, payment_mode), updated_at = datetime('now')
         WHERE period_id = ? AND employee_id = ?`
      );
      for (const { employee, item } of rowPatches) {
        // Only carry a typed absent/sunday count across as an override; when the
        // sheet had a COUNTIF there, the imported marks reproduce it.
        const hasMarks = Object.keys(item.attendance).length > 0;
        // Likewise for OT: with minutes in AS the formula reproduces AT, but the
        // sheet often has a rupee amount typed into AT over it, and that wins.
        const typedOt = !item.ot_minutes && item.ot_amount ? item.ot_amount : null;
        rowsWritten += update.run(
          item.salary,
          hasMarks ? null : item.absent,
          hasMarks ? null : item.sundays,
          // Null hands the month over to whatever minutes get marked on the days.
          item.ot_minutes || null,
          typedOt,
          item.adjustment,
          item.esi,
          item.pf,
          item.payment_mode,
          periodId,
          employee.id
        ).changes;
      }
    }

    return { created, updated, rowsWritten, attendanceMarks: attendanceEntries.length };
  })();

  log.info(
    `Imported ${sheet}: ${result.created} new employees, ${result.updated} updated, ` +
      `${result.rowsWritten} payroll rows, ${skipped.length} skipped.`
  );

  return { sheet, parsed: parsed.length, skipped, ...result };
}
