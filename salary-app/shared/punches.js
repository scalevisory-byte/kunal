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
import { findLunchGap } from './lunchGap.js';
import { hoursForEmployee } from './lateEarly.js';
import { dayNotFinished, departureTime, formatTime, TIME_RULES } from './timesheet.js';

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
export function punchesToMarks({
  rows, mapping, rules, employees, period, deductLunch = true,
  findLunch = true, lunchRules, now = new Date(),
}) {
  const hoursPerDay = Number(period.hours_per_day) || 9;
  // The half-day line follows the configured day - half of the month's hours -
  // unless the import names one, exactly as the Time tab does it. The two must
  // agree: a day read off the machine and a day typed by hand are the same day.
  const settings = { ...DEFAULT_RULES, halfDayHours: hoursPerDay / 2, ...(rules || {}) };
  /* The half-day line and the full day are now worked out PER PERSON inside
     the loop, against their own shift - see the note there. Nothing may read
     a month-wide figure here, or the two would disagree. */

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
    /*
     * LUNCH, where the sheet has it.
     *
     * A punch machine's export rarely carries lunch, and this importer
     * deliberately never wrote it: naming a column it does not have would
     * wipe a lunch somebody had typed. A timesheet the office keeps in Excel
     * usually DOES have it - Dinesh asked to import exactly that - so it is
     * read only when the mapping names those columns, and written only then.
     * With no lunch column the behaviour is byte for byte what it was.
     */
    const lunchOutAt = mapping.lunchOut ? minutesOfDay(values[mapping.lunchOut]) : null;
    const lunchInAt = mapping.lunchIn ? minutesOfDay(values[mapping.lunchIn]) : null;

    const id = `${employee.id}:${day}`;
    const seen = perPersonDay.get(id) || {
      employee, day, in: null, out: null, lunchOut: null, lunchIn: null, punches: 0, times: [],
    };
    for (const t of [inAt, outAt]) {
      if (t === null) continue;
      seen.punches++;
      // Every stamp, not just the two ends: the lunch break is a GAP, and a
      // gap cannot be seen in the first and the last alone.
      seen.times.push(t);
      if (seen.in === null || t < seen.in) seen.in = t;
      if (seen.out === null || t > seen.out) seen.out = t;
    }
    // Lunch is a pair, not a punch: the first row that gives it wins, and it
    // never moves the arrival or the departure.
    if (lunchOutAt !== null && seen.lunchOut === null) seen.lunchOut = lunchOutAt;
    if (lunchInAt !== null && seen.lunchIn === null) seen.lunchIn = lunchInAt;
    perPersonDay.set(id, seen);
  }

  const entries = [];
  const summary = { present: 0, halfDay: 0, absent: 0, shortHours: 0, overtime: 0 };
  const days = new Set();

  for (const seen of perPersonDay.values()) {
    days.add(seen.day);

    /*
     * LUNCH, FOUND IN THE DAY'S OWN PUNCHES.
     *
     * Dinesh: *"JO 30 MINUTES GAP HO O LUNCH ME COUNT HO ESA HO SAKTA HE?"*.
     * The readers are door locks, so stepping out to eat is two punches like
     * any other; what marks it out is how long the gap is.
     *
     * A lunch the SHEET named always wins - `seen.lunchOut` is only set when
     * the mapping carried those columns, and this fills nothing then. Whether
     * the break comes off the paid day is the month's `lunch_paid` setting
     * and is not decided here.
     */
    if (findLunch && seen.lunchOut === null && seen.lunchIn === null) {
      const gap = findLunchGap(seen.times, lunchRules);
      if (gap) {
        seen.lunchOut = gap.out;
        seen.lunchIn = gap.in;
        seen.lunchFound = true;
        summary.lunchFound = (summary.lunchFound || 0) + 1;
        summary.lunchMinutes = (summary.lunchMinutes || 0) + gap.minutes;
      }
    }
    /*
     * JUDGED AGAINST THEIR OWN DAY, not the office's.
     *
     * v1.82 made the shift length personal and `hoursForEmployee` the one
     * answer to it - called by the salary engine, the server, the offline
     * file, the Time tab and the eSSL reader. THIS FILE WAS MISSED, so a day
     * read off the punch machine was still measured against the month's nine
     * hours: a six-hour part-timer finishing exactly on time was docked three
     * hours, every day.
     *
     * `hasOwnShift` compares against the office day rather than asking
     * whether the column is filled in, so for everybody on the usual shift
     * this comes out byte for byte as before.
     */
    const personHours = hoursForEmployee(seen.employee, { period });
    const fullDay = Math.round(personHours * 60);
    const halfLine =
      (rules && rules.halfDayHours != null ? Number(rules.halfDayHours) : personHours / 2) * 60;

    let code;
    let minutes = 0;

    /*
     * THE DEPARTURE IS DECIDED FIRST, AND THE MARK FOLLOWS IT.
     *
     * It used to be the other way round: the mark was worked out from
     * `seen.out`, and only afterwards did `departureTime` decide whether that
     * last punch was a departure at all. So a day still running - 09:35,
     * 13:37, 14:16 at twenty past two, where the last punch is the person
     * coming BACK from lunch - was marked HF off four and a half hours the
     * code then refused to write as an out time. Half a day's pay, decided at
     * lunchtime, on somebody sitting at their desk.
     *
     * The mark may not rest on a departure this module does not believe in,
     * so both now come from the SAME call.
     */
    const inText = seen.in === null ? '' : formatTime(seen.in);
    /*
     * AND A DAY THAT CANNOT HAVE FINISHED YET HAS NO DEPARTURE.
     *
     * Dinesh on the Time tab at 16:14: *"out time abhi bhi aa raha he"*. The
     * lunch-return case was caught in v2.0.0, but somebody with only two
     * punches was still handed a departure and CHARGED a shortfall while they
     * were at their desk - ANURAG VERMA read 10:49 to 15:37 and −252 minutes
     * on a day with two hours left to run.
     *
     * Only ever today, and only until their own day's length has gone by, so
     * no day in the past can move. The evening's pull writes the real one.
     */
    const unfinished = dayNotFinished({
      year: period.year,
      month: period.month,
      day: seen.day,
      arrival: seen.in,
      hoursPerDay: personHours,
      lunchMinutes:
        seen.lunchOut !== null && seen.lunchIn !== null && seen.lunchIn > seen.lunchOut
          ? seen.lunchIn - seen.lunchOut
          : 0,
      deductLunch,
      now,
    });
    const outText = unfinished
      ? ''
      : departureTime(
          inText,
          seen.out === null ? '' : formatTime(seen.out),
          seen.lunchIn === null ? '' : formatTime(seen.lunchIn)
        );

    if (seen.in === null) {
      code = settings.absentCode;
      summary.absent++;
    } else if (!outText) {
      /*
       * Nothing to measure: one punch only, or the last punch was the return
       * from lunch. They were here; when they left is not known, and NOT
       * KNOWN IS NOT HALF A DAY. The day goes through as present with no
       * minutes either way, and lands on Reports -> Missing punch for the
       * real departure to be typed in.
       */
      code = settings.presentCode;
      summary.present++;
      summary.noDeparture = (summary.noDeparture || 0) + 1;
      if (unfinished) summary.stillIn = (summary.stillIn || 0) + 1;
    } else {
      /*
       * Lunch comes off the hours, exactly as it does for a day typed on the
       * Time tab - `readTimes` there subtracts it unless the month pays for
       * it. Counting an hour at lunch as an hour worked would hand back pay
       * the sheet does not owe, and the two screens would disagree about the
       * same day.
       */
      const lunch =
        deductLunch && seen.lunchOut !== null && seen.lunchIn !== null && seen.lunchIn > seen.lunchOut
          ? seen.lunchIn - seen.lunchOut
          : 0;
      const worked = seen.out - seen.in - lunch;
      if (worked < halfLine) {
        code = settings.halfDayCode;
        summary.halfDay++;
      } else {
        code = settings.presentCode;
        summary.present++;
        if (settings.countShortHours) {
          const diff = Math.round(worked - fullDay);
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
      in_time: inText,
      /*
       * One punch leaves `out` equal to `in`, and writing that is a claim
       * they left the moment they arrived; a last punch that is the return
       * from lunch is not a departure either. Blank is the honest record:
       * they were here, nobody knows when they went. Sent as `''` rather
       * than omitted, because `setAttendance` merges per field and leaving
       * it out would keep a stale out time from some earlier day's import.
       *
       * This is the very figure the mark above was decided from, so the two
       * cannot contradict each other.
       */
      out_time: outText,
      // Only when the sheet named those columns. `setAttendance` merges per
      // field, so leaving them out keeps whatever is already on the day.
      ...(seen.lunchOut === null ? {} : { lunch_out: formatTime(seen.lunchOut) }),
      ...(seen.lunchIn === null ? {} : { lunch_in: formatTime(seen.lunchIn) }),
      /* Marks a lunch this module WORKED OUT from the gaps rather than read
         off a column. The caller drops it before writing; what it is for is
         deciding whether a lunch already on the day may be replaced. A person
         who was there knows better than a rule about gap lengths. */
      ...(seen.lunchFound ? { lunch_found: true } : {}),
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
