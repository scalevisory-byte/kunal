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
import { parseTime, formatTime, minutesForMark } from './timesheet.js';

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
 * Is this the block shape?
 *
 * A row whose first cell is literally "Status", with an "Emp. Code:" row
 * above it. The grid shape has neither - its first column is a serial number
 * and its codes sit under day headers.
 */
function looksLikeBlocks(rows) {
  let sawCode = false;
  for (let r = 0; r < rows.length; r += 1) {
    const first = text((rows[r] || [])[0]);
    if (/^emp\.?\s*code/i.test(first)) sawCode = true;
    else if (sawCode && norm(first) === 'status') return true;
  }
  return false;
}

/**
 * The company name, which sits above the grid as "Company:" and then the name
 * a few cells along.
 *
 * The label and the name are each in a MERGED range, and ExcelJS repeats a
 * merged value into every cell it covers - so the first non-empty cell after
 * "Company:" is another "Company:". SheetJS does the opposite and leaves the
 * repeats blank. Skipping anything that still reads as the label works for
 * both, which is the point of reading the file this way.
 */
function companyOf(rows, before) {
  for (let r = 0; r < before; r += 1) {
    const row = rows[r] || [];
    const at = row.findIndex((cell) => /^company\b/i.test(text(cell)));
    if (at >= 0) {
      return text(
        row.slice(at + 1).find((cell) => {
          const value = text(cell);
          return value && !/^company\b/i.test(value);
        })
      );
    }
  }
  return '';
}

/** The date range above the grid: "Oct 01 2026  To  Oct 31 2026". */
function monthOf(rows, before) {
  for (let r = 0; r < before; r += 1) {
    const line = (rows[r] || []).map(text).join(' ');
    const m = line.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})/);
    if (m) {
      const index = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (index >= 0) return { month: index + 1, year: Number(m[3]) };
    }
  }
  return { month: null, year: null };
}

/**
 * One sheet, as far as its shape goes: which row is the header, which columns
 * hold the code, the name and each day, and which month it is for.
 */
export function readSheet(name, rows) {
  /*
   * Two shapes, one machine.
   *
   * The Monthly Status report puts a person on one row; the Basic Work
   * Duration report gives each person a block of four rows and adds the clock
   * times. They share the header, the codes and everything downstream, so
   * which one this is gets decided here and nowhere else.
   *
   * Decided on "Status" sitting in the first column, which only the block
   * shape has - not on the file's name, which is whatever it was saved as.
   */
  if (looksLikeBlocks(rows)) return readBlockSheet(name, rows);

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

  const company = companyOf(rows, headerRow);
  const { month, year } = monthOf(rows, headerRow);

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

/* ---------------- the same report, printed the other way round ---------------- */

/**
 * The **Basic Work Duration** export: one BLOCK per person rather than one row.
 *
 *     Days          1 S    2 M    3 T    4 W   ...
 *     Emp. Code:  3        Emp. Name:   AJEET UPADHYAY
 *     Status        WO     P      P      P
 *     InTime               13:21  15:33  13:23
 *     OutTime              16:19  19:39  19:06
 *     Total         00:00  2:58   4:06   5:43
 *
 * Same machine, same codes, same Company/date-range header - so everything
 * after reading is shared with the grid shape above. Two things are new:
 *
 * It carries the CLOCK TIMES, which the grid report does not. Those go onto
 * in_time/out_time, the same columns the Time tab writes and the sheet already
 * pays short hours from, so a day read off the machine and a day typed by hand
 * are judged by one rule.
 *
 * The machine's own **Total** is deliberately ignored. The app works the day
 * out from in - out - lunch with its own grace and half-day lines; keeping the
 * machine's figure as well would be a second source of truth, and the first
 * time the two disagreed nobody would know which the payslip used.
 */
function readBlockSheet(name, rows) {
  const label = (row) => norm((row || [])[0]);

  // The day columns are on the row literally labelled "Days".
  let dayRow = -1;
  for (let r = 0; r < rows.length; r += 1) {
    if (label(rows[r]) === 'days') { dayRow = r; break; }
  }
  if (dayRow < 0) return { name, error: 'this sheet has no "Days" row' };

  const dayColumns = [];
  (rows[dayRow] || []).forEach((cell, c) => {
    const day = dayHeader(cell);
    if (day !== null) dayColumns.push({ day, column: c });
  });
  const seen = new Set();
  const days = dayColumns.filter((d) => (seen.has(d.day) ? false : seen.add(d.day)));
  if (!days.length) return { name, error: 'the "Days" row has no day numbers in it' };

  /*
   * The value beside a label, skipping the label itself.
   *
   * Both halves of the person's header are MERGED ranges. ExcelJS repeats a
   * merged value into every cell it covers, so the first non-empty cell after
   * "Emp. Code:" is another "Emp. Code:"; SheetJS leaves the repeats blank.
   * Skipping anything that still reads as the label works for both.
   */
  const after = (row, re) => {
    const at = (row || []).findIndex((cell) => re.test(text(cell)));
    if (at < 0) return '';
    const rest = (row || []).slice(at + 1).find((cell) => {
      const value = text(cell);
      return value && !re.test(value);
    });
    return text(rest);
  };

  const people = [];
  for (let r = dayRow + 1; r < rows.length; r += 1) {
    if (!/^emp\.?\s*code/i.test(text((rows[r] || [])[0]))) continue;

    const head = rows[r];
    const code = after(head, /^emp\.?\s*code/i);
    const who = after(head, /^emp\.?\s*name/i);
    if (!who) continue;

    // The four rows of this block, found BY THEIR LABEL rather than by
    // position - an export that drops a row it has nothing for would
    // otherwise shift every reading by one.
    const lines = {};
    for (let k = r + 1; k < rows.length; k += 1) {
      if (/^emp\.?\s*code/i.test(text((rows[k] || [])[0]))) break;
      const key = label(rows[k]);
      if (key && !lines[key]) lines[key] = rows[k];
    }
    const status = lines.status;
    if (!status) continue;

    const marks = {};
    const times = {};
    for (const { day, column } of days) {
      const mark = text(status[column]).toUpperCase();
      if (mark) marks[day] = mark;

      const inAt = parseTime(text((lines.intime || [])[column]));
      const outAt = parseTime(text((lines.outtime || [])[column]));
      /*
       * NOTHING INVENTS A DEPARTURE.
       *
       * A blank OutTime with an InTime beside it is common in this export -
       * somebody did not punch out. The machine still prints a Total for that
       * day, worked out to some cut-off of its own, and taking it would put a
       * leaving time on the record that nobody recorded. The in time is
       * written, the out time is left blank, and the day shows as never
       * punched out - which is what happened.
       */
      if (inAt !== null || outAt !== null) {
        times[day] = {
          in: inAt === null ? '' : formatTime(inAt),
          out: outAt === null ? '' : formatTime(outAt),
        };
      }
    }
    if (!Object.keys(marks).length) continue;
    people.push({ name: who, code, marks, times });
  }

  return {
    name,
    company: companyOf(rows, dayRow),
    ...monthOf(rows, dayRow),
    headerRow: dayRow,
    days: days.map((d) => d.day).sort((a, b) => a - b),
    lastDayColumn: Math.max(...days.map((d) => d.column)),
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
 * Days where attendance COLLAPSES without disappearing.
 *
 * daysWithoutData above catches the clean case: nobody present at all, so the
 * machine plainly has nothing. The nasty case is the partial one. In Dinesh's
 * November file the 10th and the 11th read 22 and 23 people present against
 * about 75 on every other working day - a festival, or a device that synced
 * some readers and not others. Either way, writing it through books 183
 * absences that nobody earned, and that is two days off 90-odd payslips.
 *
 * So the day is NOT skipped - it is named, with its figures, and he decides.
 * Treating a quiet day as missing would be its own kind of guess.
 *
 * Measured as the share of people who were at work out of those who could
 * have been - present against present-plus-absent - so a Sunday that 99
 * people have off does not read as a collapse. A day under half the month's
 * usual share is called out.
 */
export function thinDays(sheets, { ignore = [] } = {}) {
  const skip = new Set(ignore);
  const tally = new Map();
  for (const sheet of sheets) {
    if (sheet.error) continue;
    for (const person of sheet.people || []) {
      for (const [rawDay, raw] of Object.entries(person.marks)) {
        const day = Number(rawDay);
        if (skip.has(day)) continue;
        const row = tally.get(day) || { present: 0, absent: 0 };
        if (EVIDENCE.has(raw)) row.present += 1;
        else if (raw === 'A' || raw === 'AD') row.absent += 1;
        tally.set(day, row);
      }
    }
  }

  // Only days somebody was marked absent on can be thin; a day everybody had
  // off is a known day off.
  const days = [...tally.entries()]
    .filter(([, r]) => r.absent > 0 && r.present + r.absent > 0)
    .map(([day, r]) => ({ day, ...r, share: r.present / (r.present + r.absent) }))
    .sort((a, b) => a.day - b.day);
  if (days.length < 4) return [];

  const shares = days.map((d) => d.share).sort((a, b) => a - b);
  const mid = shares.length / 2;
  const usual =
    shares.length % 2 ? shares[Math.floor(mid)] : (shares[mid - 1] + shares[mid]) / 2;
  if (!usual) return [];

  return days
    .filter((d) => d.share < usual / 2)
    .map((d) => ({
      day: d.day,
      present: d.present,
      absent: d.absent,
      percent: Math.round(d.share * 1000) / 10,
      usualPercent: Math.round(usual * 1000) / 10,
    }));
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
  const hoursPerDay = Number(period.hours_per_day) || 9;
  const entries = [];
  const unmatched = [];
  const unknownMarks = new Map();
  const matched = [];
  let kept = 0;
  let withTimes = 0;
  let shortMinutes = 0;
  let shortDays = 0;
  let overtimeMinutes = 0;
  let overtimeDays = 0;
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
        const entry = { employee_id: employee.id, day, code };
        /*
         * The clock times, where this export carries them.
         *
         * They go onto in_time/out_time - the same columns the Time tab
         * writes and the sheet already pays short hours from - so a day read
         * off the machine and a day typed by hand are judged by one rule.
         *
         * setAttendance merges PER FIELD, so naming these two cannot wipe a
         * lunch somebody typed. A blank out time is sent as '' rather than
         * left out, because that is the difference between "not known" and
         * "do not touch what is there": the machine saw no punch out, and a
         * stale out time from an earlier import would otherwise pay hours
         * nobody worked.
         */
        const t = person.times && person.times[day];
        if (t) {
          if (t.in) entry.in_time = t.in;
          entry.out_time = t.out || '';
        }
        if (entry.in_time) {
          withTimes += 1;
          /*
           * What this will COST, worked out before the button rather than
           * discovered on the payslip.
           *
           * The clock times become short hours and overtime by the same rule
           * the Time tab and the grid use - minutesForMark, so the preview
           * cannot promise one figure and the write produce another. In
           * Dinesh's 14-day November file it comes to 483 hours short and 144
           * over, which is far too much to find out about afterwards.
           */
          const m = minutesForMark(
            { in_time: entry.in_time, out_time: entry.out_time },
            { hoursPerDay, code },
          );
          if (m < 0) { shortMinutes -= m; shortDays += 1; }
          else if (m > 0) { overtimeMinutes += m; overtimeDays += 1; }
        }
        entries.push(entry);
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
    thinDays: thinDays(sheets, { ignore: [...skipDays] }),
    neverPresent,
    skippedExisting,
    counted: kept,
    // Days this file also carries clock times for. Zero on the grid-shaped
    // report, which has none - so the screen can say which kind it just read
    // rather than silently doing more or less than last time.
    withTimes,
    shortMinutes,
    shortDays,
    overtimeMinutes,
    overtimeDays,
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
