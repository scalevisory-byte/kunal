/**
 * Reading eTimeTrackLite's own database, instead of exporting a file by hand.
 *
 * The devices have "Auto Clear After Download" ticked, so they are wiped after
 * every pull and eTimeTrackLite's database is the only durable copy of a
 * punch. That database is MS Access, and the table that matters is
 * AttendanceLogs - one row per person per day, carrying the machine's own
 * verdict plus the in and out times. It is the same material the Basic Work
 * Duration report prints, which is why nothing here re-decides anything.
 *
 * THIS MODULE DOES NOT READ ACCESS. Jet's provider is 32-bit, Windows-only and
 * has no business being a dependency of a payroll app. ESSL-PULL.ps1 runs on
 * the machine that holds the database, opens it READ-ONLY (eTimeTrackLite is
 * live on the same file and locking it would stop punches being collected at
 * all), and writes a small JSON file. This module turns that file into the
 * shape monthlyStatus.js already produces, so thinDays, daysWithoutData and
 * monthlyStatusToMarks run over it unchanged.
 *
 * That reuse is the point. A day the machine has no record of looks exactly
 * like a day everybody was absent, and the rules that tell those apart cost
 * real bugs to learn - 912 absences nobody earned in one October file. Coming
 * in through the same door means they cannot be learnt twice and forgotten
 * once.
 */

import { parseTime, formatTime } from './timesheet.js';

/** What ESSL-PULL.ps1 writes at the top of the file, so a stray JSON cannot
 *  be mistaken for a pull. */
export const ESSL_FILE_KIND = 'essl-attendance-logs';
export const ESSL_PULL_VERSION = 1;

export const isEsslPull = (value) =>
  !!value && typeof value === 'object' && value.kind === ESSL_FILE_KIND && Array.isArray(value.rows);

/**
 * Access's "no value" for a date is not null - it is a date in 1899 or 1900.
 * The live file showed `1900-01-01 00:00:00` in InTime and OutTime for every
 * absent day. Anything before this year is the machine saying nothing, not a
 * punch from before living memory.
 */
export const SENTINEL_BEFORE_YEAR = 1950;

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 19).replace('T', ' ');
  }
  return String(value).trim();
};

/**
 * The date part of a value, as {year, month, day}, or null.
 *
 * Two spellings are accepted and no others: `yyyy-MM-dd`, which is what
 * ESSL-PULL.ps1 writes, and `dd/MM/yyyy`, which is how the machine prints
 * dates in India and how its own reports read. A bare `03/11/2026` is read
 * the Indian way deliberately - this is the only reading that matches the
 * device's own output, and guessing the American one would move a punch by
 * eight months without a word.
 */
export function esslDate(value) {
  const raw = text(value);
  if (!raw) return null;
  let m = raw.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  m = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) };
  return null;
}

/**
 * The clock time in a value, as 'HH:MM', or '' for "nothing was recorded".
 *
 * '' is returned, never omitted and never 0. setAttendance merges per field,
 * so an out time left out would leave a stale one standing and pay hours
 * nobody worked; an out time of '' clears it.
 *
 * A time of exactly midnight is read as nothing. eTimeTrackLite writes
 * `1900-01-01 00:00:00` where there is no punch, and the sentinel date catches
 * most of those, but a row carrying the real date with a midnight time means
 * the same thing. A genuine punch at 00:00 is vanishingly rare against the
 * cost of inventing a day that began or ended at midnight.
 */
export function esslTime(value) {
  const raw = text(value);
  if (!raw) return '';
  const date = esslDate(raw);
  if (date && date.year < SENTINEL_BEFORE_YEAR) return '';
  const m = raw.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?/);
  if (!m) return '';
  const minutes = parseTime(`${m[1]}:${m[2]}${m[3] ? ` ${m[3]}` : ''}`);
  if (minutes === null || minutes === 0) return '';
  return formatTime(minutes);
}

const keyOf = (row) => text(row.code) || `name:${text(row.name).toUpperCase()}`;

/**
 * The pull, as sheets.
 *
 * One sheet per company PER MONTH, because a sheet that spanned two months
 * would be dropped whole: monthlyStatusToMarks skips any sheet whose month is
 * not the period's. A pull that crosses the 1st is ordinary - somebody runs it
 * on the 2nd - so it has to come out as two sheets, not one that is thrown
 * away.
 */
export function esslSheets(file) {
  if (!isEsslPull(file)) return [];
  const sheets = new Map();

  for (const row of file.rows) {
    const date = esslDate(row.date);
    if (!date) continue;
    const status = text(row.status).toUpperCase();
    if (!status) continue;

    const company = text(row.company);
    const key = `${company}\u0000${date.year}-${date.month}`;
    let sheet = sheets.get(key);
    if (!sheet) {
      sheet = {
        name: company || 'eTimeTrackLite',
        company,
        month: date.month,
        year: date.year,
        days: new Set(),
        people: new Map(),
      };
      sheets.set(key, sheet);
    }
    sheet.days.add(date.day);

    const id = keyOf(row);
    let person = sheet.people.get(id);
    if (!person) {
      person = { name: text(row.name), code: text(row.code), marks: {}, times: {} };
      sheet.people.set(id, person);
    }
    person.marks[date.day] = status;

    const inAt = esslTime(row.in);
    const outAt = esslTime(row.out);
    if (inAt || outAt) person.times[date.day] = { in: inAt, out: outAt };
  }

  return [...sheets.values()].map((sheet) => ({
    name: sheet.name,
    company: sheet.company,
    month: sheet.month,
    year: sheet.year,
    days: [...sheet.days].sort((a, b) => a - b),
    people: [...sheet.people.values()].filter((p) => Object.keys(p.marks).length),
  }));
}

/** What the pull says about itself, for the screen that is about to write it. */
export function esslSummary(file) {
  if (!isEsslPull(file)) return null;
  const sheets = esslSheets(file);
  return {
    source: text(file.source),
    machine: text(file.machine),
    pulled_at: text(file.pulled_at),
    rows: file.rows.length,
    people: new Set(sheets.flatMap((s) => s.people.map((p) => p.code || p.name))).size,
    companies: [...new Set(sheets.map((s) => s.company).filter(Boolean))],
    months: sheets.map((s) => ({ month: s.month, year: s.year, days: s.days.length })),
  };
}

/**
 * An uploaded file, as a pull - or null, which means "not one of these".
 *
 * The first non-blank byte has to be `{` before anything is decoded. The other
 * file arriving at this route is a legacy .xls of a megabyte or two, and
 * decoding that as text to find out it is not JSON is work done for nothing
 * on every single import.
 */
export function asEsslPull(input) {
  if (!input) return null;
  if (typeof input === 'object' && !isBytes(input) && isEsslPull(input)) return input;

  if (isBytes(input)) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    let i = 0;
    // A UTF-8 BOM, then whitespace.
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
    while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i += 1;
    if (bytes[i] !== 0x7b) return null;
  }

  let raw;
  try {
    raw = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
  } catch {
    return null;
  }
  if (!raw.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return isEsslPull(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const isBytes = (v) =>
  v instanceof ArrayBuffer || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(v));
