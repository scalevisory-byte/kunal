import { ATTENDANCE_CODES, MONTH_NAMES, round2 } from './calc.js';

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const MONEY = '#,##0.00';
const MONEY0 = '#,##0';
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/**
 * The AH..BE calculation block, in sheet order. Everything that needs a column
 * position - the header, the value, the number format, the SUM row - is read
 * off this one list, so a column added or removed can no longer leave an
 * offset somewhere else pointing at the wrong cell.
 *
 *   money - the number format for the cell, if it holds one
 *   total - the key on the totals object to sum in the footer rows
 *
 * There is no Sunday Salary or Final Payable column here on purpose: Sunday
 * duty is settled on its own register, so its amount is only on that sheet.
 */
const CALC_COLUMNS = [
  { head: 'Working Days', get: (r) => r.working_days },
  { head: 'Sunday', get: (r) => r.sundays_worked },
  { head: 'Absent Days', get: (r) => r.absent_days },
  { head: 'Present Days', get: (r) => r.present_days },
  { head: 'Salary', get: (r) => r.salary, money: MONEY0, total: 'salary' },
  { head: 'Absent Salary', get: (r) => r.absent_salary, money: MONEY0 },
  { head: 'Gross Salary', get: (r) => r.gross_after_absent, money: MONEY0 },
  { head: 'Salary / Day', get: (r) => r.per_day, money: MONEY },
  { head: 'Salary / Hour', get: (r) => r.per_hour, money: MONEY },
  { head: 'Salary / Minutes', get: (r) => r.per_minute, money: MONEY },
  { head: 'OT/LT In Minutes', get: (r) => r.ot_minutes },
  { head: 'OT/LT Salary', get: (r) => r.ot_salary, money: MONEY0 },
  { head: 'Addition', get: (r) => r.addition, money: MONEY0 },
  { head: 'Deduction', get: (r) => r.deduction, money: MONEY0 },
  { head: 'Gross Salary', get: (r) => r.gross_salary, money: MONEY0, total: 'gross_salary' },
  { head: 'PT', get: (r) => r.pt, money: MONEY0, total: 'pt' },
  { head: 'ESI', get: (r) => r.esi, money: MONEY0, total: 'esi' },
  { head: 'PF', get: (r) => r.pf, money: MONEY0, total: 'pf' },
  { head: 'Loan', get: (r) => r.loan_deduction || 0, money: MONEY0, total: 'loan_deduction' },
  { head: 'Net Payable', get: (r) => r.net_salary, money: MONEY0, total: 'net_salary' },
  { head: 'Paid Leave', get: (r) => r.mark_counts?.PL || 0 },
  { head: 'Unpaid Leave', get: (r) => r.mark_counts?.UL || 0 },
  { head: 'Mode', get: (r) => r.payment_mode || '' },
  { head: 'Status', get: (r) => r.status || '' },
  { head: 'Remark', get: (r) => r.remark || '' },
];

/** Sheet column numbers for the calc columns matching a test. */
const calcColumn = (base, match) =>
  CALC_COLUMNS.flatMap((col, i) => (match(col) ? [base + 1 + i] : []));

/** Sun/Mon/... header over each day column, like row 2 of the sheet. */
const weekdayLabel = (year, month, day) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month - 1, day).getDay()];

/**
 * Writes the month back out in the same shape as the April tab: attendance
 * grid on the left, the AH..BE calculation columns on the right, a totals row
 * per company, and the code legend on its own sheet.
 *
 * ExcelJS is passed in rather than imported so shared/ carries no dependencies.
 */
export async function buildWorkbook(ExcelJS, payroll) {
  const { period, rows, totals } = payroll;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Salary App';
  wb.created = new Date();

  const days = daysInMonth(period.year, period.month);
  const ws = wb.addWorksheet(period.label, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }],
  });

  const calcHeaders = CALC_COLUMNS.map((c) => c.head);

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
    const sumCols = calcColumn(3 + days, (c) => c.total);
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
    for (const col of CALC_COLUMNS) values.push(col.get(row));

    const excelRow = ws.addRow(values);
    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.font = { size: 9 };
      if (col > 3 && col <= 3 + days) cell.alignment = { horizontal: 'center' };
    });
    const base = 3 + days;
    CALC_COLUMNS.forEach((col, i) => {
      if (col.money) excelRow.getCell(base + 1 + i).numFmt = col.money;
    });
  }
  writeCompanyTotal(ws.rowCount);

  const grand = ws.addRow([]);
  grand.getCell(3).value = 'GRAND TOTAL';
  const base = 3 + days;
  CALC_COLUMNS.forEach((col, i) => {
    if (!col.total) return;
    const cell = grand.getCell(base + 1 + i);
    cell.value = totals[col.total];
    cell.numFmt = MONEY0;
  });
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

  /* The Sunday register on its own sheet, the way the workbook keeps it. */
  const worked = rows.filter((row) => row.sundays_worked > 0);
  const sunday = wb.addWorksheet('Sunday Register');

  sunday.getCell('A1').value = `Sunday & holiday pay - ${period.label}`;
  sunday.getCell('A1').font = { bold: true, size: 13 };

  const sundayDates = [
    ...new Set([
      ...Array.from({ length: days }, (_, i) => i + 1).filter(
        (d) => new Date(period.year, period.month - 1, d).getDay() === 0
      ),
      ...worked.flatMap((row) => row.sunday_days || []),
    ]),
  ].sort((a, b) => a - b);

  const sundayHeader = ['Sr. No.', 'Company', 'Employee'];
  for (const date of sundayDates) sundayHeader.push(`${weekdayLabel(period.year, period.month, date)} ${date}`);
  sundayHeader.push('Days', 'Day Rate', 'Amount', 'Paid By', 'Status');

  const sundayHeaderRow = sunday.addRow([]);
  sundayHeader.forEach((text, i) => {
    const cell = sundayHeaderRow.getCell(i + 1);
    cell.value = text;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = HEAD_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER;
  });
  sundayHeaderRow.height = 28;

  const firstSundayRow = sunday.rowCount + 1;
  worked.forEach((row, index) => {
    const values = [index + 1, row.company_name, row.employee_name];
    for (const date of sundayDates) values.push((row.sunday_days || []).includes(date) ? 'P' : '');
    values.push(
      row.sundays_worked,
      round2(row.per_day),
      row.sunday_salary,
      row.sunday_mode || '',
      row.sunday_status || 'pending'
    );
    const excelRow = sunday.addRow(values);
    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.font = { size: 9 };
      if (col > 3 && col <= 3 + sundayDates.length) cell.alignment = { horizontal: 'center' };
    });
    excelRow.getCell(4 + sundayDates.length + 1).numFmt = MONEY;
    excelRow.getCell(4 + sundayDates.length + 2).numFmt = MONEY0;
  });

  if (worked.length) {
    const totalRow = sunday.addRow([]);
    totalRow.getCell(3).value = 'TOTAL';
    const daysCol = 4 + sundayDates.length;
    const amountCol = daysCol + 2;
    for (const col of [daysCol, amountCol]) {
      const letter = sunday.getColumn(col).letter;
      const cell = totalRow.getCell(col);
      cell.value = { formula: `SUM(${letter}${firstSundayRow}:${letter}${sunday.rowCount - 1})` };
      cell.numFmt = MONEY0;
    }
    totalRow.eachCell({ includeEmpty: false }, (cell) => {
      cell.font = { bold: true };
      cell.fill = TOTAL_FILL;
      cell.border = BORDER;
    });
  } else {
    sunday.addRow(['', '', 'Nobody worked a Sunday this month.']);
  }

  sunday.getColumn(1).width = 7;
  sunday.getColumn(2).width = 18;
  sunday.getColumn(3).width = 26;
  for (let i = 0; i < sundayDates.length; i++) sunday.getColumn(4 + i).width = 6;
  for (let i = 0; i < 5; i++) sunday.getColumn(4 + sundayDates.length + i).width = 12;
  sunday.views = [{ state: 'frozen', xSplit: 3, ySplit: 2 }];

  /* Legend, so whoever opens the file knows what the marks mean. */
  const legend = wb.addWorksheet('Codes');
  legend.addRow(['Code', 'Meaning', 'Salary days deducted', 'Paid extra at day rate']);
  legend.getRow(1).font = { bold: true };
  for (const [code, meta] of Object.entries(ATTENDANCE_CODES)) {
    legend.addRow([code, meta.label, meta.absent || '-', meta.sunday || '-']);
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
