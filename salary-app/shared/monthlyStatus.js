/**
 * The biometric machine's **Monthly Status (Basic) report**.
 *
 * Different from punches.js, which reads one row per punch or per day and has
 * to work out whether somebody turned up. This report has already decided: it
 * is a month-wide grid, one sheet per company, one row per person, one column
 * per day, holding the machine's own verdict.
 *
 *     Company:            BNF
 *     Sl   Emp. Code  Name              1 Th  2 F  3 St  4 S  5 M  ...
 *     1    3          AJEET UPADHYAY    P     P    P     WO   P    ...
 *
 * Dependency-free: the caller hands over a workbook already read into plain
 * rows, so the server and the browser read a file exactly the same way.
 *
 * ---------------------------------------------------------------------------
 * The thing this module exists to get right
 *
 * A day the machine has no record of looks exactly like a day everybody was
 * absent: the report writes "A" either way. Dinesh's October export has every
 * one of 114 people marked A from the 23rd to the 31st, because the device
 * stopped syncing on the 22nd - not because the whole company stopped coming
 * in. Writing that through costs each of them eight days' pay.
 *
 * So a day on which NOBODY was present is treated as "no data" and is left
 * alone by default. It can be forced in, but it has to be asked for.
 * ---------------------------------------------------------------------------
 */

import { ATTENDANCE_CODES } from './calc.js';

/* ---------------- what the machine's codes mean here ---------------- */

/**
 * The machine's vocabulary against this app's. Only the left-hand side is the
 * machine's; everything on the right is a code in ATTENDANCE_CODES.
 *
 * WO/WOP are the pair worth understanding: WO is the weekly off, which the app
 * calls S, and WOP is somebody who worked it - the app's SP, which is what the
 * Sunday register pays from. Reading WOP as plain presence would quietly stop
 * those people being paid for the Sunday.
 */
export const DEFAULT_MARK_MAP = {
  P: 'P',
  A: 'A',
  WO: 'S',
  WOP: 'SP',
  H: 'PH',
  HP: 'HP',
  HF: 'HF',
  L: 'PL',
  CL: 'CL',
  SL: 'SL',
  PL: 'PL',
  UL: 'UL',
  AD: 'AD',
  WH: 'WH',
};

/** Marks that prove the machine had data that day. WO is printed by the
 *  software from the calendar, not read off the device, so it proves nothing. */
const EVIDENCE = new Set(['P', 'WOP', 'HP', 'HF', 'H', 'L', 'CL', 'SL', 'PL', 'WH']);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    return String(value.result ?? value.text ?? value.richText?.map((t) => t.text).join('') ?? '').trim();
  }
  return String(value).trim();
};

const norm = (s) => text(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------------- reading one sheet ---------------- */

/** "1 Th", "23 F", "31 St" - the day-of-month headers this report uses. */
const dayHeader = (cell) => {
  const m = text(cell).match(/^(\d{1,2})\s*[A-Za-z]{0,3}$/);
  if (!m) return null;
  const day = Number(m[1]);
  return day >= 1 && day <= 31 ? day : null;
};

/**
 * One sheet, as far as its shape goes: which row is the header, which columns
 * hold the code, the name and each day, and which month it is for.
 */
export function readSheet(name, rows) {
  let headerRow = -1;
  let dayColumns = [];

  // The header is the row with the most day-of-month cells in it. Looking for
  // the word "Sl" is not enough - these reports get re-labelled.
  for (let r = 0; r < Math.min(rows.length, 20); r += 1) {
    const found = [];
    (rows[r] || []).forEach((cell, c) => {
      const day = dayHeader(cell);
      if (day !== null) found.push({ day, column: c });
    });
    if (found.length > dayColumns.length) {
      dayColumns = found;
      headerRow = r;
    }
  }
  if (headerRow < 0 || dayColumns.length < 20) {
    return { name, error: 'this sheet has no day-by-day grid in it' };
  }

  // A day appearing twice (some exports repeat the header) keeps the first.
  const seen = new Set();
  dayColumns = dayColumns.filter((d) => (seen.has(d.day) ? false : seen.add(d.day)));
  const lastDayColumn = Math.max(...dayColumns.map((d) => d.column));

  const header = rows[headerRow] || [];
  const findColumn = (...labels) => {
    for (let c = 0; c < header.length; c += 1) {
      const h = norm(header[c]);
      if (h && labels.some((l) => h === l || h.startsWith(l))) return c;
    }
    return -1;
  };
  const codeColumn = findColumn('emp code', 'employee code', 'emp id', 'code');
  const nameColumn = findColumn('name', 'employee name');
  if (nameColumn < 0) return { name, error: 'this sheet has no Name column' };

  // The company sits above the grid, as "Company:" and then its name a few
  // cells along.
  //
  // The label and the name are each in a MERGED range, and ExcelJS repeats a
  // merged value into every cell it covers - so the first non-empty cell after
  // "Company:" is another "Company:". SheetJS does the opposite and leaves the
  // repeats blank. Skipping anything that still reads as the label works for
  // both, which is the point of reading the file this way.
  let company = '';
  for (let r = 0; r < headerRow; r += 1) {
    const row = rows[r] || [];
    const at = row.findIndex((cell) => /^company\b/i.test(text(cell)));
    if (at >= 0) {
      company = text(
        row.slice(at + 1).find((cell) => {
          const value = text(cell);
          return value && !/^company\b/i.test(value);
        })
      );
      break;
    }
  }

  // ... and so does the date range: "Oct 01 2026  To  Oct 31 2026".
  let month = null;
  let year = null;
  for (let r = 0; r < headerRow; r += 1) {
    const line = (rows[r] || []).map(text).join(' ');
    const m = line.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})/);
    if (m) {
      const index = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (index >= 0) {
        month = index + 1;
        year = Number(m[3]);
        break;
      }
    }
  }

  const people = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const who = text(row[nameColumn]);
    if (!who || /^(total|grand total)\b/i.test(who)) continue;
    const marks = {};
    for (const { day, column } of dayColumns) {
      const raw = text(row[column]).toUpperCase();
      if (raw) marks[day] = raw;
    }
    if (!Object.keys(marks).length) continue;
    people.push({ name: who, code: codeColumn >= 0 ? text(row[codeColumn]) : '', marks });
  }

  return {
    name,
    company,
    month,
    year,
    headerRow,
    days: dayColumns.map((d) => d.day).sort((a, b) => a - b),
    lastDayColumn,
    people,
  };
}

/** Every sheet in the workbook, each read on its own. */
export const readMonthlyStatus = (sheets) =>
  sheets.map(({ name, rows }) => readSheet(name, rows));

/* ---------------- turning it into marks ---------------- */

/**
 * Days the machine plainly has nothing for.
 *
 * Two things have to be true at once: nobody on any sheet is marked present,
 * on leave or on a holiday, AND somebody is marked absent. Everybody absent on
 * the same day happens; everybody absent on the same NINE days does not.
 *
 * The second half matters. A Sunday nobody worked carries WO and nothing else,
 * which is not missing data - it is a fully known day off, and skipping it
 * would leave the Sundays blank on the grid.
 */
export function daysWithoutData(sheets) {
  const evidence = new Set();
  const absences = new Set();
  const seen = new Set();
  for (const sheet of sheets) {
    if (sheet.error) continue;
    for (const day of sheet.days || []) seen.add(day);
    for (const person of sheet.people || []) {
      for (const [rawDay, raw] of Object.entries(person.marks)) {
        const day = Number(rawDay);
        if (EVIDENCE.has(raw)) evidence.add(day);
        else if (raw === 'A' || raw === 'AD') absences.add(day);
      }
    }
  }
  return [...seen].filter((day) => !evidence.has(day) && absences.has(day)).sort((a, b) => a - b);
}

/**
 * The marks to write, as setAttendance wants them.
 *
 * @param sheets       what readMonthlyStatus returned
 * @param employees    the master, for matching
 * @param period       the open month, so days outside it are dropped
 * @param markMap      the machine's codes against this app's
 * @param includeEmptyDays  write the no-data days anyway. Off by default, and
 *                          it should stay off unless somebody has looked.
 * @param onlyBlank    never overwrite a mark somebody typed by hand
 * @param existing     what the grid already holds: { "employeeId:day": code }
 */
export function monthlyStatusToMarks({
  sheets,
  employees,
  period,
  markMap = DEFAULT_MARK_MAP,
  includeEmptyDays = false,
  onlyBlank = false,
  existing = {},
} = {}) {
  const map = { ...DEFAULT_MARK_MAP, ...(markMap || {}) };
  const skipDays = new Set(includeEmptyDays ? [] : daysWithoutData(sheets));

  const byName = new Map();
  const byCode = new Map();
  for (const employee of employees) {
    if (employee.active === 0) continue;
    byName.set(norm(employee.name), employee);
    if (employee.code) byCode.set(norm(employee.code), employee);
  }

  const daysInMonth = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const entries = [];
  const unmatched = [];
  const unknownMarks = new Map();
  const matched = [];
  let kept = 0;
  let skippedExisting = 0;

  for (const sheet of sheets) {
    if (sheet.error) continue;
    // A sheet for another month is not this month's attendance.
    if (sheet.month && sheet.year && (sheet.month !== period.month || sheet.year !== period.year)) {
      continue;
    }

    for (const person of sheet.people) {
      const employee =
        (person.code && byCode.get(norm(person.code))) || byName.get(norm(person.name)) || null;
      if (!employee) {
        unmatched.push({ name: person.name, code: person.code, sheet: sheet.name, company: sheet.company });
        continue;
      }
      matched.push({ id: employee.id, name: employee.name, as: person.name });

      for (const [rawDay, rawMark] of Object.entries(person.marks)) {
        const day = Number(rawDay);
        if (day < 1 || day > daysInMonth) continue;
        if (skipDays.has(day)) continue;

        const code = map[rawMark];
        if (!code) {
          unknownMarks.set(rawMark, (unknownMarks.get(rawMark) || 0) + 1);
          continue;
        }
        if (!ATTENDANCE_CODES[code]) {
          unknownMarks.set(rawMark, (unknownMarks.get(rawMark) || 0) + 1);
          continue;
        }
        if (onlyBlank && existing[`${employee.id}:${day}`]) {
          skippedExisting += 1;
          continue;
        }
        entries.push({ employee_id: employee.id, day, code });
        kept += 1;
      }
    }
  }

  // What the month will look like, so a dry run can be read without doing sums.
  const tally = {};
  for (const entry of entries) tally[entry.code] = (tally[entry.code] || 0) + 1;

  /*
   * Somebody marked absent on every single day the machine DOES have data for
   * has almost certainly never been enrolled on the device - or has left. Four
   * of these in Dinesh's October export have a full month of A against their
   * name. Either way it is not attendance, and importing it would wipe out
   * their pay, so they are named rather than quietly written through.
   */
  const neverPresent = [];
  for (const sheet of sheets) {
    if (sheet.error) continue;
    if (sheet.month && sheet.year && (sheet.month !== period.month || sheet.year !== period.year)) continue;
    for (const person of sheet.people) {
      const days = Object.entries(person.marks).filter(([day]) => !skipDays.has(Number(day)));
      if (!days.length) continue;
      if (days.some(([, raw]) => EVIDENCE.has(raw))) continue;
      const employee =
        (person.code && byCode.get(norm(person.code))) || byName.get(norm(person.name)) || null;
      if (!employee) continue;
      neverPresent.push({
        id: employee.id,
        name: employee.name,
        days: days.filter(([, raw]) => raw === 'A').length,
      });
    }
  }

  return {
    entries,
    tally,
    matched,
    unmatched,
    unknownMarks: [...unknownMarks].map(([mark, n]) => ({ mark, rows: n })),
    skippedDays: [...skipDays].sort((a, b) => a - b),
    neverPresent,
    skippedExisting,
    counted: kept,
    companies: sheets.filter((s) => !s.error).map((s) => ({
      sheet: s.name,
      company: s.company,
      people: s.people.length,
    })),
    sheetErrors: sheets.filter((s) => s.error).map((s) => ({ sheet: s.name, error: s.error })),
  };
}

/* ---------------- getting a workbook into plain rows ---------------- */

/**
 * The library is passed in, never imported, so this file stays dependency-free
 * and the server and the browser can use different readers for the same shape.
 *
 * SheetJS, on the server. It reads the legacy .xls these machines still export
 * as well as .xlsx - ExcelJS reads only the latter, which is why the punch
 * importer could not open Dinesh's October file at all.
 */
export const sheetsFromSheetJS = (XLSX, buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: true, defval: '' }),
  }));
};

/**
 * ExcelJS, in the browser, where it is already bundled. .xlsx only - a .xls
 * has to be re-saved, and the caller is expected to say so rather than
 * failing with something cryptic.
 */
export const sheetsFromExcelJS = (workbook) =>
  workbook.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, index) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        values[column - 1] = cell.value;
      });
      rows[index - 1] = values;
    });
    return { name: ws.name, rows };
  });

/** True for a legacy .xls, which ExcelJS cannot read. */
export const isLegacyXls = (buffer) => {
  const head = buffer?.slice?.(0, 8);
  if (!head || head.length < 8) return false;
  const bytes = [...head];
  // The OLE2 compound-document signature every BIFF .xls starts with.
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b);
};
