/**
 * The monthly report pack, in the shape Dinesh already circulates.
 *
 * He sends three sheets out every month, and they are not the app's own export:
 *
 *   "Sep-26"                   the salary sheet for everyone paid by bank
 *   "Sep-26 CASH"              the same sheet for everyone paid in cash
 *   "Sep-26 Sunday + Festival" Sunday duty and festival days, paid on their own
 *
 * The layout here is a copy of his: his marks (P / A / HF / W/O / H/O), his
 * columns, his formulas, so a file out of this app drops straight into the
 * place the old one came from. The figures are live formulas rather than typed
 * numbers, because he edits these in Excel after they leave.
 *
 * WHERE HIS VOCABULARY IS SMALLER THAN THE APP'S. His grid knows five marks;
 * the app knows thirteen. Everything maps onto his without changing a number:
 * leave keeps its own code and counts as present because his absent formula
 * only looks for A and HF; AD keeps its code and the formula is widened to
 * weigh it as two days; a Sunday or festival that was worked is W/O or H/O on
 * the main grid exactly as in his file, with the pay for it on the third sheet.
 * Nothing is ever counted in two places.
 *
 * Dependency-free - ExcelJS is passed in - so the server and the standalone
 * browser build produce the same file.
 */

import { MONTH_NAMES, STANDARD_WORKING_DAYS, round2 } from './calc.js';

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const MONEY0 = '#,##0';
const MONEY = '#,##0.00';
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const weekdayOf = (year, month, day) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month - 1, day).getDay()];
const isSunday = (year, month, day) => new Date(year, month - 1, day).getDay() === 0;

/** "Sep-26", the way he names the tab. */
export const packLabel = (period) =>
  `${MONTH_NAMES[period.month - 1].slice(0, 3)}-${String(period.year).slice(2)}`;

const codeOf = (entry) =>
  String((typeof entry === 'object' && entry ? entry.code : entry) || '').toUpperCase();

/**
 * One of the app's marks, in his vocabulary, for the main grid.
 *
 * SP and HP - a Sunday or a festival day that was worked - deliberately come
 * out as W/O and H/O here, which is what his own file carries. The work itself
 * is paid on the Sunday + Festival sheet, so writing P would have his Net Days
 * formula pay for it a second time.
 */
export function gridMark(entry, { sunday } = {}) {
  const code = codeOf(entry);
  if (!code) return '';
  if (code === 'P' || code === 'WH') return 'P';
  if (code === 'A' || code === 'UL') return 'A';
  if (code === 'HF') return 'HF';
  if (code === 'AD') return 'AD';
  if (code === 'S') return 'W/O';
  if (code === 'PH') return 'H/O';
  if (code === 'SP') return sunday ? 'W/O' : 'H/O';
  if (code === 'HP') return 'H/O';
  return code; // CL, SL, PL keep their own code and count as present
}

/** The festival days of the month, from the holidays the Festivals panel keeps. */
export function festivalDays(holidays = []) {
  return [...new Set(holidays.map((h) => Number(h.day)).filter(Boolean))].sort((a, b) => a - b);
}

/** Dates in the month that fall on a Sunday. */
export function sundayDays(period) {
  const out = [];
  for (let d = 1; d <= daysInMonth(period.year, period.month); d++) {
    if (isSunday(period.year, period.month, d)) out.push(d);
  }
  return out;
}

const header = (ws, row, labels, { from = 1 } = {}) => {
  labels.forEach((text, i) => {
    const cell = row.getCell(from + i);
    cell.value = text;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = HEAD_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER;
  });
  row.height = 32;
};

/* ---------------- the salary sheet, his layout ---------------- */

function writeSalarySheet(wb, title, period, rows) {
  const days = daysInMonth(period.year, period.month);
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });

  const labels = ['Company', 'Name'];
  for (let d = 1; d <= days; d++) labels.push(String(d));
  labels.push(
    'Working Days', 'Present Days', 'Absent Days', 'Paid Holiday', 'Net Days', 'Salary',
    'Salary / Day', 'Gross Salary', 'OT / LT', 'Addition', 'Deduction', 'PT', 'ESI', 'PF',
    'Net Salary', 'Payment Mode', 'Status'
  );
  header(ws, ws.addRow([]), labels);

  // Row 2: the weekday over each date, as his sheet has it.
  const dayRow = ws.addRow([]);
  for (let d = 1; d <= days; d++) {
    const cell = dayRow.getCell(2 + d);
    cell.value = weekdayOf(period.year, period.month, d);
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: 'center' };
    cell.border = BORDER;
  }

  const letter = (col) => ws.getColumn(col).letter;
  const base = 2 + days; // last day column
  const C = {
    firstDay: 3,
    lastDay: base,
    workingDays: base + 1,
    presentDays: base + 2,
    absentDays: base + 3,
    paidHoliday: base + 4,
    netDays: base + 5,
    salary: base + 6,
    perDay: base + 7,
    gross: base + 8,
    ot: base + 9,
    addition: base + 10,
    deduction: base + 11,
    pt: base + 12,
    esi: base + 13,
    pf: base + 14,
    net: base + 15,
    mode: base + 16,
    status: base + 17,
  };

  /* His Gross is the salary for the days worked and nothing else - the
     deduction comes off further along, in the Net. Two columns are added to
     his block, OT/LT and Addition, because the app has them and a month
     carrying either would otherwise lose the money silently. With both at
     zero, which is the usual case, every formula below is his exactly. */
  const earned = (r) =>
    `${letter(C.gross)}${r}+${letter(C.ot)}${r}+${letter(C.addition)}${r}-${letter(C.deduction)}${r}`;

  const sundayCols = sundayDays(period).map((d) => `${letter(2 + d)}`);
  const firstRow = ws.rowCount + 1;

  for (const row of rows) {
    const excelRow = ws.addRow([]);
    const r = excelRow.number;
    const span = `${letter(C.firstDay)}${r}:${letter(C.lastDay)}${r}`;

    excelRow.getCell(1).value = row.company_name;
    excelRow.getCell(2).value = row.employee_name;
    for (let d = 1; d <= days; d++) {
      excelRow.getCell(2 + d).value = gridMark(row.attendance?.[d], {
        sunday: isSunday(period.year, period.month, d),
      });
    }

    const set = (col, value, numFmt) => {
      const cell = excelRow.getCell(col);
      cell.value = value;
      if (numFmt) cell.numFmt = numFmt;
      return cell;
    };

    set(C.workingDays, STANDARD_WORKING_DAYS);
    set(C.presentDays, { formula: `${letter(C.workingDays)}${r}-${letter(C.absentDays)}${r}` });
    // AD is two days' absence; his sheet has no such mark, so the formula is
    // widened rather than the mark being flattened into something it is not.
    set(C.absentDays, {
      formula: `COUNTIF(${span},"A")+COUNTIF(${span},"HF")*0.5+COUNTIF(${span},"AD")*2`,
    });
    set(C.paidHoliday, { formula: `COUNTIF(${span},"H/O")` });
    // Sundays worked are paid on the third sheet, so they are W/O here and this
    // term is zero - it is kept because his sheet has it and he reads it.
    const sundayTerm = sundayCols.map((c) => `COUNTIF(${c}${r},"P")`).join('+');
    set(C.netDays, {
      formula: sundayTerm
        ? `${letter(C.presentDays)}${r}+(${sundayTerm})`
        : `${letter(C.presentDays)}${r}`,
    });
    set(C.salary, round2(row.salary), MONEY0);
    set(C.perDay, { formula: `${letter(C.salary)}${r}/${letter(C.workingDays)}${r}` }, MONEY);
    set(C.gross, {
      formula: `ROUND(${letter(C.netDays)}${r}*${letter(C.perDay)}${r},0)`,
    }, MONEY0);
    set(C.ot, round2(row.ot_salary || 0), MONEY0);
    set(C.addition, round2(row.addition || 0), MONEY0);
    set(C.deduction, round2(row.deduction || 0), MONEY0);
    set(C.pt, {
      formula: `IF(${earned(r)}>${period.pt_threshold || 12000},${period.pt_amount || 200},0)`,
    }, MONEY0);
    set(C.esi, round2(row.esi || 0), MONEY0);
    set(C.pf, round2(row.pf || 0), MONEY0);
    set(C.net, {
      formula: `${earned(r)}-${letter(C.pt)}${r}-${letter(C.esi)}${r}-${letter(C.pf)}${r}`,
    }, MONEY0);
    set(C.mode, row.payment_mode || '');
    set(C.status, row.status || '');

    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.font = { size: 9 };
      if (col >= C.firstDay && col <= C.lastDay) cell.alignment = { horizontal: 'center' };
    });
  }

  const lastRow = ws.rowCount;
  const total = ws.addRow([]);
  total.getCell(2).value = 'TOTAL';
  if (lastRow >= firstRow) {
    for (const col of [C.salary, C.gross, C.ot, C.addition, C.deduction, C.pt, C.esi, C.pf, C.net]) {
      const cell = total.getCell(col);
      cell.value = { formula: `SUM(${letter(col)}${firstRow}:${letter(col)}${lastRow})` };
      cell.numFmt = MONEY0;
    }
  }
  total.eachCell({ includeEmpty: false }, (cell) => {
    cell.font = { bold: true };
    cell.fill = TOTAL_FILL;
    cell.border = BORDER;
  });

  ws.addRow([]);
  const legend = ws.addRow([]);
  legend.getCell(2).value =
    'Marks: P Present | A Absent | HF Half day (0.5) | AD Absent 2 days | W/O Weekly off | ' +
    'H/O Paid holiday | CL SL PL leave (paid, counts as present). ' +
    'A Sunday or festival that was worked shows as W/O or H/O here - it is paid on the ' +
    'Sunday + Festival sheet, so it is never counted twice. ' +
    'Gross Salary is the pay for the days worked; OT/LT, Addition and Deduction come off ' +
    'it in the Net, and PT is charged on what is left.';
  legend.getCell(2).font = { size: 9, italic: true };

  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 26;
  for (let d = 1; d <= days; d++) ws.getColumn(2 + d).width = 4.5;
  for (let col = C.workingDays; col <= C.status; col++) ws.getColumn(col).width = 12;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: C.status } };
  return ws;
}

/* ---------------- Sunday + Festival, his third sheet ---------------- */

function writeSundayFestival(wb, title, period, rows, holidays) {
  const sundays = sundayDays(period);
  const festivals = festivalDays(holidays);
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });

  const labels = ['Company Name', 'Employee Name'];
  for (const d of sundays) labels.push(String(d));
  for (const d of festivals) labels.push(String(d));
  labels.push(
    'Total Sunday', 'Festival Paid Leave', 'Salary', 'Salary / Day',
    'Sunday Salary', 'Festival Salary', 'Net Amount', 'Remark'
  );
  header(ws, ws.addRow([]), labels);

  const dayRow = ws.addRow([]);
  [...sundays, ...festivals].forEach((d, i) => {
    const cell = dayRow.getCell(3 + i);
    cell.value = weekdayOf(period.year, period.month, d);
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: 'center' };
    cell.border = BORDER;
  });

  const letter = (col) => ws.getColumn(col).letter;
  const firstSunCol = 3;
  const lastSunCol = 2 + sundays.length;
  const firstFestCol = lastSunCol + 1;
  const lastFestCol = lastSunCol + festivals.length;
  const C = {
    totalSunday: lastFestCol + 1,
    festivalLeave: lastFestCol + 2,
    salary: lastFestCol + 3,
    perDay: lastFestCol + 4,
    sundaySalary: lastFestCol + 5,
    festivalSalary: lastFestCol + 6,
    netAmount: lastFestCol + 7,
    remark: lastFestCol + 8,
  };

  /** Only people with something to be paid for belong on this register. */
  const owed = rows.filter((row) => {
    const worked = sundays.some((d) => codeOf(row.attendance?.[d]) === 'SP');
    const festival = festivals.some((d) => ['HP', 'HF'].includes(codeOf(row.attendance?.[d])));
    return worked || festival || row.sunday_salary > 0;
  });

  const firstRow = ws.rowCount + 1;
  for (const row of owed) {
    const excelRow = ws.addRow([]);
    const r = excelRow.number;
    excelRow.getCell(1).value = row.company_name;
    excelRow.getCell(2).value = row.employee_name;

    sundays.forEach((d, i) => {
      excelRow.getCell(firstSunCol + i).value = codeOf(row.attendance?.[d]) === 'SP' ? 'P' : 'W/O';
    });
    festivals.forEach((d, i) => {
      const code = codeOf(row.attendance?.[d]);
      // H/O here means the festival day was WORKED and is owed an extra day -
      // the main grid is where a festival simply taken off is recorded.
      excelRow.getCell(firstFestCol + i).value = code === 'HP' ? 'H/O' : code === 'HF' ? 'HF' : '';
    });

    const sunSpan = sundays.length
      ? `${letter(firstSunCol)}${r}:${letter(lastSunCol)}${r}`
      : null;
    const festSpan = festivals.length
      ? `${letter(firstFestCol)}${r}:${letter(lastFestCol)}${r}`
      : null;

    const set = (col, value, numFmt) => {
      const cell = excelRow.getCell(col);
      cell.value = value;
      if (numFmt) cell.numFmt = numFmt;
    };

    set(C.totalSunday, sunSpan ? { formula: `COUNTIF(${sunSpan},"P")` } : 0);
    set(
      C.festivalLeave,
      festSpan ? { formula: `COUNTIF(${festSpan},"H/O")+COUNTIF(${festSpan},"HF")*0.5` } : 0
    );
    set(C.salary, round2(row.salary), MONEY0);
    set(C.perDay, { formula: `${letter(C.salary)}${r}/${STANDARD_WORKING_DAYS}` }, MONEY);
    // A typed amount on the Sunday register beats the day-rate sum - that is
    // what the override is for, and it is also how an arrear from a month
    // already closed gets onto this sheet, with the reason in the Remark.
    const typed = row.sunday_salary_override;
    set(
      C.sundaySalary,
      typed === null || typed === undefined || typed === ''
        ? { formula: `${letter(C.totalSunday)}${r}*${letter(C.perDay)}${r}` }
        : round2(typed),
      MONEY
    );
    set(
      C.festivalSalary,
      { formula: `${letter(C.festivalLeave)}${r}*${letter(C.perDay)}${r}` },
      MONEY
    );
    set(
      C.netAmount,
      { formula: `ROUND(${letter(C.sundaySalary)}${r}+${letter(C.festivalSalary)}${r},0)` },
      MONEY0
    );
    set(C.remark, row.remark || '');

    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.font = { size: 9 };
      if (col >= firstSunCol && col <= lastFestCol) cell.alignment = { horizontal: 'center' };
    });
  }

  const lastRow = ws.rowCount;
  const total = ws.addRow([]);
  total.getCell(2).value = 'TOTAL';
  if (lastRow >= firstRow) {
    for (const col of [C.sundaySalary, C.festivalSalary, C.netAmount]) {
      const cell = total.getCell(col);
      cell.value = { formula: `SUM(${letter(col)}${firstRow}:${letter(col)}${lastRow})` };
      cell.numFmt = MONEY0;
    }
  }
  total.eachCell({ includeEmpty: false }, (cell) => {
    cell.font = { bold: true };
    cell.fill = TOTAL_FILL;
    cell.border = BORDER;
  });

  ws.addRow([]);
  const legend = ws.addRow([]);
  legend.getCell(2).value =
    'Sunday: P = worked it, W/O = off. ' +
    (festivals.length
      ? `Festival (${holidays.map((h) => `${h.day} ${h.name}`).join(', ')}): ` +
        'H/O = worked the festival day and is owed an extra day, HF = half of one. ' +
        'A festival simply taken as a paid holiday is on the main sheet and costs nothing, ' +
        'so it is not here. '
      : 'No festival was set for this month. ') +
    'Only people owed something appear at all.';
  legend.getCell(2).font = { size: 9, italic: true };

  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 26;
  for (let col = firstSunCol; col <= lastFestCol; col++) ws.getColumn(col).width = 6;
  for (let col = C.totalSunday; col <= C.netAmount; col++) ws.getColumn(col).width = 13;
  ws.getColumn(C.remark).width = 28;
  return ws;
}

/* ---------------- the pack ---------------- */

/**
 * The three sheets, in one workbook.
 *
 * @param ExcelJS  passed in, so shared/ carries no dependency
 * @param payroll  { period, rows } as buildPayroll returns it
 * @param holidays the month's festivals, for the third sheet's columns
 */
export async function buildMonthlyPack(ExcelJS, payroll, { holidays = [] } = {}) {
  const { period, rows } = payroll;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Salary App';
  wb.created = new Date();

  const label = packLabel(period);
  const isCash = (row) => String(row.payment_mode || '').trim().toLowerCase() === 'cash';

  writeSalarySheet(wb, label, period, rows.filter((r) => !isCash(r)));
  writeSalarySheet(wb, `${label} CASH`, period, rows.filter(isCash));
  writeSundayFestival(wb, `${label} Sunday + Festival`, period, rows, holidays);

  return wb;
}
