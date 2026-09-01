/**
 * Turning a biometric machine's export into attendance marks.
 *
 * eSSL, ZKTeco, Matrix and the rest all export something like "who, which day,
 * in at, out at", but no two reports put those in the same columns, and some
 * give one row per punch rather than one per day. So nothing here assumes a
 * layout: the caller says which column is which, and this works out the rest.
 *
 * Dependency-free - ExcelJS is passed in - so the server and the standalone
 * browser build read a file exactly the same way.
 */

import { ATTENDANCE_CODES } from './calc.js';
import { TIME_RULES, formatTime } from './timesheet.js';

/* ---------------- reading whatever was uploaded ---------------- */

const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    return String(value.result ?? value.text ?? value.richText?.map((t) => t.text).join('') ?? '');
  }
  return String(value).trim();
};

/**
 * Reads a sheet into headers plus plain rows. The header row is whichever of
 * the first fifteen has the most non-empty cells - these exports usually carry
 * a title and a date range above the real header.
 */
export async function readPunchFile(ExcelJS, buffer, { sheetName, headerRow } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets = wb.worksheets.map((s) => ({ name: s.name, rows: s.rowCount, columns: s.columnCount }));
  const wanted = String(sheetName || '').trim().toLowerCase();
  const ws =
    (wanted && wb.worksheets.find((s) => s.name.trim().toLowerCase() === wanted)) || wb.worksheets[0];
  if (!ws) return { error: 'that file has no sheets', sheets };

  let headerAt = Number(headerRow) || 0;
  if (!headerAt) {
    let best = 0;
    for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
      const filled = ws.getRow(r).values.filter((v) => cellText(v) !== '').length;
      if (filled > best) {
        best = filled;
        headerAt = r;
      }
    }
  }
  if (!headerAt) return { error: 'that sheet looks empty', sheets };

  const headerCells = ws.getRow(headerAt);
  const headers = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    headers.push({ index: c, label: cellText(headerCells.getCell(c).value) || `Column ${c}` });
  }

  const rows = [];
  for (let r = headerAt + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values = {};
    let any = false;
    for (let c = 1; c <= ws.columnCount; c++) {
      const raw = row.getCell(c).value;
      values[c] = raw instanceof Date ? raw : cellText(raw);
      if (values[c] !== '') any = true;
    }
    if (any) rows.push({ row: r, values });
  }

  return { sheet: ws.name, sheets, headerRow: headerAt, headers, rows };
}

/* ---------------- making sense of dates and times ---------------- */

/** Day of the month from a date cell, or null. Excel serials included. */
export function dayOfMonth(value, { year, month }) {
  if (value instanceof Date) {
    return value.getUTCFullYear() === year && value.getUTCMonth() + 1 === month
      ? value.getUTCDate()
      : null;
  }
  const text = String(value || '').trim();
  if (!text) return null;

  // A bare number is either an Excel serial or a plain day number.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (n >= 1 && n <= 31) return Math.floor(n);
    if (n > 59) {
      // Excel's day 1 is 1900-01-01, and it wrongly counts 1900 as a leap year.
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month
        ? date.getUTCDate()
        : null;
    }
    return null;
  }

  // dd/mm/yyyy and dd-mm-yyyy, the way Indian reports write it.
  let m = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m.map(Number);
    const full = y < 100 ? 2000 + y : y;
    return full === year && mo === month ? d : null;
  }

  // yyyy-mm-dd, and anything with a time after it.
  m = text.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m.map(Number);
    return y === year && mo === month ? d : null;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getFullYear() === year && parsed.getMonth() + 1 === month ? parsed.getDate() : null;
  }
  return null;
}

/** Minutes since midnight from a time cell, or null. */
export function minutesOfDay(value) {
  if (value instanceof Date) return value.getUTCHours() * 60 + value.getUTCMinutes();

  const text = String(value || '').trim();
  if (!text || text === '-' || /^(absent|a|--)$/i.test(text)) return null;

  // Excel keeps a time as a fraction of a day.
  if (/^0?\.\d+$/.test(text)) return Math.round(Number(text) * 24 * 60);

  const m = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return null;
  let hours = Number(m[1]);
  const mins = Number(m[2]);
  const suffix = (m[3] || '').toLowerCase();
  if (suffix === 'pm' && hours < 12) hours += 12;
  if (suffix === 'am' && hours === 12) hours = 0;
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/* ---------------- the rules ---------------- */

export const DEFAULT_RULES = {
  // halfDayHours and graceMinutes come from timesheet.js, so a day read off
  // the machine and a day typed on the Time tab are judged the same way.
  ...TIME_RULES,
  // Whether to write the shortfall into the day's minutes at all.
  countShortHours: true,
  // What to write when somebody has no punch on a working day.
  absentCode: 'A',
  presentCode: 'P',
  halfDayCode: 'HF',
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Groups the rows by person and day, then decides each day's mark.
 *
 * One row per punch and one row per day both work: the earliest time of a day
 * is taken as the arrival and the latest as the departure.
 *
 * @returns { entries, matched, unmatched, days, summary }
 *   entries feed straight into setAttendance.
 */
export function punchesToMarks({ rows, mapping, rules, employees, period }) {
  const settings = { ...DEFAULT_RULES, ...(rules || {}) };
  const fullDayMinutes = (Number(period.hours_per_day) || 9) * 60;
  const halfDayMinutes = Number(settings.halfDayHours) * 60;

  // Employees can be matched on the name or on the code they carry in the
  // machine, whichever the report gives.
  const byName = new Map();
  const byCode = new Map();
  for (const emp of employees) {
    if (!emp.active) continue;
    byName.set(norm(emp.name), emp);
    if (emp.code) byCode.set(norm(emp.code), emp);
  }

  const perPersonDay = new Map(); // "empId:day" -> { in, out, punches }
  const unmatched = new Map(); // what the report called them -> how many rows
  let unreadableDates = 0;

  for (const { values } of rows) {
    const who = values[mapping.employee];
    const key = norm(who);
    if (!key) continue;

    const employee = (mapping.matchBy === 'code' ? byCode : byName).get(key) ||
      byName.get(key) ||
      byCode.get(key);
    if (!employee) {
      unmatched.set(String(who).trim(), (unmatched.get(String(who).trim()) || 0) + 1);
      continue;
    }

    const day = dayOfMonth(values[mapping.date], period);
    if (!day) {
      unreadableDates++;
      continue;
    }

    const inAt = mapping.inTime ? minutesOfDay(values[mapping.inTime]) : null;
    const outAt = mapping.outTime ? minutesOfDay(values[mapping.outTime]) : null;

    const id = `${employee.id}:${day}`;
    const seen = perPersonDay.get(id) || { employee, day, in: null, out: null, punches: 0 };
    for (const t of [inAt, outAt]) {
      if (t === null) continue;
      seen.punches++;
      if (seen.in === null || t < seen.in) seen.in = t;
      if (seen.out === null || t > seen.out) seen.out = t;
    }
    perPersonDay.set(id, seen);
  }

  const entries = [];
  const summary = { present: 0, halfDay: 0, absent: 0, shortHours: 0, overtime: 0 };
  const days = new Set();

  for (const seen of perPersonDay.values()) {
    days.add(seen.day);
    let code;
    let minutes = 0;

    if (seen.in === null) {
      code = settings.absentCode;
      summary.absent++;
    } else if (seen.out === null || seen.out === seen.in) {
      // One punch only - they were here, but there is nothing to measure.
      code = settings.presentCode;
      summary.present++;
    } else {
      const worked = seen.out - seen.in;
      if (worked < halfDayMinutes) {
        code = settings.halfDayCode;
        summary.halfDay++;
      } else {
        code = settings.presentCode;
        summary.present++;
        if (settings.countShortHours) {
          const diff = Math.round(worked - fullDayMinutes);
          if (Math.abs(diff) > Number(settings.graceMinutes)) {
            minutes = diff;
            if (diff < 0) summary.shortHours++;
            else summary.overtime++;
          }
        }
      }
    }

    if (!ATTENDANCE_CODES[code]) continue;
    // The arrival and departure go through as clock times too, so an imported
    // day shows on the Time tab exactly like one typed by hand. Lunch is left
    // out: these reports rarely carry it, and naming it here would wipe a
    // lunch somebody had already typed.
    entries.push({
      employee_id: seen.employee.id,
      day: seen.day,
      code,
      minutes,
      in_time: seen.in === null ? '' : formatTime(seen.in),
      out_time: seen.out === null ? '' : formatTime(seen.out),
    });
  }

  return {
    entries,
    matched: perPersonDay.size,
    unmatched: [...unmatched.entries()].map(([name, count]) => ({ name, count })),
    unreadableDates,
    days: [...days].sort((a, b) => a - b),
    summary,
  };
}
