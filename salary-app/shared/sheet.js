import { ATTENDANCE_CODES } from './calc.js';

/** A totals row is not an employee, however much salary its formula holds. */
const TOTAL_ROW = /^(grand\s+)?total\b/i;

/** The monthly pack's marks, in the app's vocabulary. */
const PACK_MARKS = { 'W/O': 'S', 'H/O': 'PH' };

/**
 * Reading an April-shaped salary sheet. Nothing here touches a database or
 * pulls in a dependency of its own - the caller passes ExcelJS in - so the
 * server and the standalone browser build parse a file the same way.
 */

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

/** The April tab's column positions, which everything falls back to. */
const APRIL = {
  name: 3,
  day1: 4,
  addition: null,
  salary: 38, // AL
  sundays: 35, // AI
  absent: 36, // AJ
  otMinutes: 45, // AS
  otAmount: 46, // AT
  adjustment: 47, // AU
  deduction: null, // the pack has its own column; April folds it into AU
  esi: 50, // AX
  pf: 51, // AY
  mode: 55, // BC
  headerRow: 2,
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Works out where the columns are by reading the header, because these sheets
 * are not all laid out alike: the April tab has the name in C and the dates
 * from D, the monthly pack has the name in B and the dates from C. Guessing
 * from positions alone read every name one column off.
 *
 * Only a header that is actually recognised moves anything; anything it cannot
 * find keeps its April position, so a sheet with no header row at all still
 * parses exactly as it always did.
 */
export function detectLayout(ws, { headerRow } = {}) {
  const found = { ...APRIL };
  const rows = headerRow ? [headerRow] : [1, 2, 3];

  for (const r of rows) {
    const row = ws.getRow(r);
    // First match wins, left to right. The monthly pack's cash tab carries the
    // Sunday register alongside it on the same row, so "Salary" appears twice
    // and the later one belongs to a different table entirely.
    const at = {};
    for (let c = 1; c <= Math.min(ws.columnCount, 80); c++) {
      const label = norm(text(row.getCell(c)));
      if (label && !(label in at)) at[label] = c;
    }

    const name = at['name'] ?? at['employee name'] ?? at['employee'];
    if (name === undefined) continue; // not the header row

    found.headerRow = r;
    found.name = name;
    if (at['1'] !== undefined) found.day1 = at['1'];
    const pick = (key, ...labels) => {
      for (const label of labels) {
        if (at[label] !== undefined) {
          found[key] = at[label];
          return;
        }
      }
    };
    pick('salary', 'salary');
    pick('esi', 'esi');
    pick('pf', 'pf');
    pick('mode', 'payment mode', 'mode');
    pick('sundays', 'sunday');
    pick('absent', 'absent days');
    pick('adjustment', 'deduction additions');
    pick('deduction', 'deduction');
    pick('addition', 'addition');
    pick('otMinutes', 'ot lt in minutes');
    pick('otAmount', 'ot lt salary');
    break;
  }
  return found;
}

/**
 * Reads a salary sheet and pulls out the employee master plus that month's
 * attendance. The April tab and the monthly pack are both understood - the
 * column positions come from the header, falling back to April's:
 *
 *   A company | C name | D..AG day marks | AL monthly salary
 *   AI sundays worked | AJ absent days | AS OT minutes | AU adjustment
 *   AX ESI | AY PF | BC payment mode
 *
 * Anything it cannot make sense of is reported back rather than guessed at.
 */
export async function parseSheet(ExcelJS, buffer, { sheetName, headerRow } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = sheetName ? findSheet(wb, sheetName) : wb.worksheets[0];
  if (!ws) {
    return { error: `sheet ${sheetName || '#1'} not found`, sheets: wb.worksheets.map((s) => s.name) };
  }

  const at = detectLayout(ws, { headerRow });
  const parsed = [];
  const skipped = [];
  let lastCompany = null;

  for (let r = at.headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = text(row.getCell(at.name));
    if (!name) continue;
    // A totals row carries a cached formula result in the salary column, so it
    // reads as somebody earning the whole payroll unless it is ruled out here.
    if (TOTAL_ROW.test(name)) continue;

    const company = text(row.getCell(1)) || lastCompany;
    const salary = number(row.getCell(at.salary));

    // Merged header cells repeat their text down the rows they span, so a row
    // with neither a company nor a salary is sheet furniture, not an employee.
    if (!company && salary === null) continue;

    if (!company) {
      skipped.push({ row: r, name, reason: 'no company in column A and none above it' });
      continue;
    }
    lastCompany = company;

    if (salary === null) {
      skipped.push({ row: r, name, reason: 'no salary in the Salary column' });
      continue;
    }

    const attendance = {};
    for (let day = 1; day <= 31; day++) {
      const code = text(row.getCell(at.day1 + day - 1)).toUpperCase();
      // The pack writes his own marks; they mean the same days as the app's.
      const mapped = PACK_MARKS[code] || code;
      if (mapped && ATTENDANCE_CODES[mapped]) attendance[day] = mapped;
    }

    // The pack's one column holds a pay mode on the cash sheet and a status
    // on the others, so each is only taken when it looks like itself.
    const typed = text(row.getCell(at.mode));
    const mode = /^(bank|cash|gpay|cheque)$/i.test(typed) ? typed : null;
    const status = /^(paid|hold|pending)$/i.test(typed) ? typed.toLowerCase() : null;

    parsed.push({
      row: r,
      company,
      name,
      salary,
      // The sheet holds a typed number in these when the formula was overridden.
      sundays: number(row.getCell(at.sundays)),
      absent: number(row.getCell(at.absent)),
      ot_minutes: number(row.getCell(at.otMinutes)) ?? 0,
      ot_amount: number(row.getCell(at.otAmount)),
      adjustment: number(row.getCell(at.adjustment)) ?? 0,
      // The pack keeps the one-off deduction in a column of its own; April
      // folded it into the signed AU, so only one of the two is ever present.
      deduction: at.deduction ? number(row.getCell(at.deduction)) ?? 0 : 0,
      addition: at.addition ? number(row.getCell(at.addition)) ?? 0 : 0,
      esi: number(row.getCell(at.esi)) ?? 0,
      pf: number(row.getCell(at.pf)) ?? 0,
      payment_mode: mode,
      status,
      attendance,
    });
  }

  return { sheet: ws.name, parsed, skipped };
}

export async function listSheetNames(ExcelJS, buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.map((s) => ({ name: s.name, rows: s.rowCount, columns: s.columnCount }));
}
