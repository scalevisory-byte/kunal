import ExcelJS from 'exceljs';
import { ATTENDANCE_CODES } from '../../shared/calc.js';
import { MONTH_NAMES } from './db.js';

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const MONEY = '#,##0.00';
const MONEY0 = '#,##0';
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/** Sun/Mon/... header over each day column, like row 2 of the sheet. */
const weekdayLabel = (year, month, day) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month - 1, day).getDay()];

/**
 * Writes the month back out in the same shape as the April tab: attendance
 * grid on the left, the AH..BE calculation columns on the right, a totals row
 * per company, and the code legend on its own sheet.
 */
export async function buildWorkbook(payroll) {
  const { period, rows, totals } = payroll;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Salary App';
  wb.created = new Date();

  const days = daysInMonth(period.year, period.month);
  const ws = wb.addWorksheet(period.label, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }],
  });

  const calcHeaders = [
    'Working Days', 'Sunday', 'Absent Days', 'Present Days', 'Salary', 'Sunday Salary',
    'Absent Salary', 'Gross Salary', 'Salary / Day', 'Salary / Hour', 'Salary / Minutes',
    'OT/LT In Minutes', 'OT/LT Salary', 'Deduction / Additions', 'Gross Salary', 'PT', 'ESI',
    'PF', 'Net Salary', 'Sunday Salary', 'Final Payable', 'Mode', 'Status', 'Remark',
  ];

  ws.getCell(1, 4).value = `Month of ${MONTH_NAMES[period.month - 1]} - ${period.year}`;
  ws.getCell(1, 4).font = { bold: true, size: 13 };

  const header = ['Company', 'Sr. No.', 'Name'];
  for (let d = 1; d <= days; d++) header.push(weekdayLabel(period.year, period.month, d));
  header.push(...calcHeaders);
  const headerRow = ws.addRow([]); // row 2
  header.forEach((text, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = text;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = HEAD_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER;
  });
  headerRow.height = 34;

  const dayRow = ws.addRow([]); // row 3: the 1..31 strip
  for (let d = 1; d <= days; d++) {
    const cell = dayRow.getCell(3 + d);
    cell.value = d;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: 'center' };
    cell.border = BORDER;
  }

  let serial = 0;
  let currentCompany = null;
  const companyStart = { row: 0, name: null };

  const writeCompanyTotal = (endRow) => {
    if (!companyStart.row || endRow < companyStart.row) return;
    const row = ws.addRow([]);
    row.getCell(3).value = `${companyStart.name} - Total`;
    row.getCell(3).font = { bold: true };
    // Sum the block above so the file stays live if a number is edited in Excel.
    const sumCols = [3 + days + 5, 3 + days + 15, 3 + days + 16, 3 + days + 17, 3 + days + 18,
      3 + days + 19, 3 + days + 20, 3 + days + 21];
    for (const col of sumCols) {
      const letter = ws.getColumn(col).letter;
      const cell = row.getCell(col);
      cell.value = { formula: `SUM(${letter}${companyStart.row}:${letter}${endRow})` };
      cell.numFmt = MONEY0;
      cell.font = { bold: true };
    }
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.fill = TOTAL_FILL;
      cell.border = BORDER;
    });
    ws.addRow([]);
  };

  for (const row of rows) {
    if (row.company_name !== currentCompany) {
      writeCompanyTotal(ws.rowCount);
      currentCompany = row.company_name;
      serial = 0;
      companyStart.row = ws.rowCount + 1;
      companyStart.name = currentCompany;
    }
    serial++;

    const values = [row.company_name, serial, row.employee_name];
    for (let d = 1; d <= days; d++) values.push(row.attendance?.[d] || '');
    values.push(
      row.working_days, row.sundays_worked, row.absent_days, row.present_days, row.salary,
      row.sunday_salary, row.absent_salary, row.gross_after_absent, row.per_day, row.per_hour,
      row.per_minute, row.ot_minutes, row.ot_salary, row.adjustment, row.gross_salary, row.pt,
      row.esi, row.pf, row.net_salary, row.sunday_salary, row.final_payable,
      row.payment_mode || '', row.status || '', row.remark || ''
    );

    const excelRow = ws.addRow(values);
    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.font = { size: 9 };
      if (col > 3 && col <= 3 + days) cell.alignment = { horizontal: 'center' };
    });
    const base = 3 + days;
    for (const col of [base + 5, base + 6, base + 7, base + 8, base + 13, base + 14,
      base + 15, base + 16, base + 17, base + 18, base + 19, base + 20, base + 21]) {
      excelRow.getCell(col).numFmt = MONEY0;
    }
    for (const col of [base + 9, base + 10, base + 11]) excelRow.getCell(col).numFmt = MONEY;
  }
  writeCompanyTotal(ws.rowCount);

  const grand = ws.addRow([]);
  grand.getCell(3).value = 'GRAND TOTAL';
  const base = 3 + days;
  const grandCols = {
    [base + 5]: totals.salary,
    [base + 15]: totals.gross_salary,
    [base + 16]: totals.pt,
    [base + 17]: totals.esi,
    [base + 18]: totals.pf,
    [base + 19]: totals.net_salary,
    [base + 20]: totals.sunday_salary,
    [base + 21]: totals.final_payable,
  };
  for (const [col, value] of Object.entries(grandCols)) {
    const cell = grand.getCell(Number(col));
    cell.value = value;
    cell.numFmt = MONEY0;
  }
  grand.eachCell({ includeEmpty: false }, (cell) => {
    cell.font = { bold: true };
    cell.fill = TOTAL_FILL;
    cell.border = BORDER;
  });

  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 7;
  ws.getColumn(3).width = 26;
  for (let d = 1; d <= days; d++) ws.getColumn(3 + d).width = 4.5;
  for (let i = 0; i < calcHeaders.length; i++) ws.getColumn(base + 1 + i).width = 12;
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: base + calcHeaders.length } };

  /* Legend, so whoever opens the file knows what the marks mean. */
  const legend = wb.addWorksheet('Codes');
  legend.addRow(['Code', 'Meaning', 'Counts as absent (days)', 'Counts as Sunday worked']);
  legend.getRow(1).font = { bold: true };
  for (const [code, meta] of Object.entries(ATTENDANCE_CODES)) {
    legend.addRow([code, meta.label, meta.absent, meta.sunday]);
  }
  legend.addRow([]);
  legend.addRow(['Working days', period.working_days]);
  legend.addRow(['Hours per day', period.hours_per_day]);
  legend.addRow(['PT above', period.pt_threshold, 'PT amount', period.pt_amount]);
  legend.getColumn(1).width = 10;
  legend.getColumn(2).width = 26;
  legend.getColumn(3).width = 22;
  legend.getColumn(4).width = 22;

  return wb;
}
