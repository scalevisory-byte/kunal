import ExcelJS from 'exceljs';
import { ATTENDANCE_CODES } from '../../shared/calc.js';
import { db, createEmployee, listEmployees, setAttendance, syncPayrollRows, updateEmployee, upsertCompany } from './db.js';
import { log } from './logger.js';

const text = (cell) => {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return String(v.result ?? v.text ?? v.richText?.map((t) => t.text).join('') ?? '');
  return String(v).trim();
};

const number = (cell) => {
  const v = cell?.value;
  // Number(null) is 0, so an empty cell has to be ruled out before converting -
  // otherwise a row with no salary imports as an employee earning nothing.
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'object' ? Number(v.result) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Tab names in these sheets carry stray spaces and mixed case ("April " with a
 * trailing space), so match on an exact name first and forgivingly after that.
 */
function findSheet(wb, name) {
  const wanted = String(name).trim().toLowerCase();
  return (
    wb.getWorksheet(name) ||
    wb.worksheets.find((s) => s.name.trim().toLowerCase() === wanted) ||
    wb.worksheets.find((s) => s.name.trim().toLowerCase().startsWith(wanted)) ||
    null
  );
}

/**
 * Reads a sheet laid out like the April tab and pulls out the employee master
 * plus that month's attendance:
 *
 *   A company | B sr no | C name | D..AG day marks | AL monthly salary
 *   AI sundays worked | AJ absent days | AS OT minutes | AU adjustment
 *   AX ESI | AY PF | BC payment mode
 *
 * Anything it cannot make sense of is reported back rather than guessed at.
 */
export async function importSheet(buffer, { sheetName, periodId, headerRow = 2, dryRun = false } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = sheetName ? findSheet(wb, sheetName) : wb.worksheets[0];
  if (!ws) {
    return { error: `sheet ${sheetName || '#1'} not found`, sheets: wb.worksheets.map((s) => s.name) };
  }

  const parsed = [];
  const skipped = [];
  let lastCompany = null;

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = text(row.getCell(3));
    if (!name) continue;

    const company = text(row.getCell(1)) || lastCompany;
    const salary = number(row.getCell(38)); // AL

    // Merged header cells repeat their text down the rows they span, so a row
    // with neither a company nor a salary is sheet furniture, not an employee.
    if (!company && salary === null) continue;

    if (!company) {
      skipped.push({ row: r, name, reason: 'no company in column A and none above it' });
      continue;
    }
    lastCompany = company;

    if (salary === null) {
      skipped.push({ row: r, name, reason: 'no salary in column AL' });
      continue;
    }

    const attendance = {};
    for (let day = 1; day <= 31; day++) {
      const code = text(row.getCell(3 + day)).toUpperCase();
      if (code && ATTENDANCE_CODES[code]) attendance[day] = code;
    }

    parsed.push({
      row: r,
      company,
      name,
      salary,
      // The sheet holds a typed number in these when the formula was overridden.
      sundays: number(row.getCell(35)), // AI
      absent: number(row.getCell(36)), // AJ
      ot_minutes: number(row.getCell(45)) ?? 0, // AS
      ot_amount: number(row.getCell(46)), // AT
      adjustment: number(row.getCell(47)) ?? 0, // AU
      esi: number(row.getCell(50)) ?? 0, // AX
      pf: number(row.getCell(51)) ?? 0, // AY
      payment_mode: text(row.getCell(55)) || null, // BC
      attendance,
    });
  }

  if (dryRun) {
    return { sheet: ws.name, dryRun: true, parsed: parsed.length, skipped, preview: parsed.slice(0, 15) };
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
    `Imported ${ws.name}: ${result.created} new employees, ${result.updated} updated, ` +
      `${result.rowsWritten} payroll rows, ${skipped.length} skipped.`
  );

  return { sheet: ws.name, parsed: parsed.length, skipped, ...result };
}

export async function listSheetNames(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.map((s) => ({ name: s.name, rows: s.rowCount, columns: s.columnCount }));
}
