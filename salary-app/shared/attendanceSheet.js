/**
 * The month's attendance as a spreadsheet: out, filled in, and back.
 *
 * Dinesh asked for "attendance ka simple excel" after the staff master got
 * one. Same shape of answer and the same rules, because learning two is one
 * too many: ONE FILE BOTH WAYS. Download the month - everybody down the
 * page, the days across the top, whatever is already marked in place - fill
 * in the blanks in Excel, send it back.
 *
 * The two importers beside it read what a biometric machine produces, in the
 * machine's own shape. This one is for an office that keeps the register on
 * paper, or in somebody's own sheet, and types it up once a month.
 *
 * Dependency-free: the caller passes ExcelJS in.
 */

import { ATTENDANCE_CODES } from './calc.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return String(value.result ?? value.text ?? value.richText?.map((t) => t.text).join('') ?? '').trim();
  }
  return String(value).trim();
};

const KEY = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The three columns before the days start. */
const WHO = [
  { field: 'code', header: 'Employee Code', also: ['emp code', 'empcode', 'code', 'emp id'], width: 14 },
  { field: 'name', header: 'Name', also: ['employee name'], width: 26 },
  { field: 'company', header: 'Company', also: ['firm', 'unit'], width: 22 },
];

const WHO_BY_HEADER = new Map();
for (const c of WHO) {
  WHO_BY_HEADER.set(KEY(c.header), c.field);
  WHO_BY_HEADER.set(KEY(c.field), c.field);
  for (const a of c.also) WHO_BY_HEADER.set(KEY(a), c.field);
}

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/* ---------------- writing it out ---------------- */

export async function writeAttendanceSheet(ExcelJS, { period, people = [] } = {}) {
  const total = daysInMonth(period.year, period.month);
  const label =
    period.label ||
    `${new Date(Date.UTC(period.year, period.month - 1, 1)).toLocaleString('en-GB', { month: 'long' })} ${period.year}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'BOOKNFLY HRMS';
  wb.created = new Date();

  const ws = wb.addWorksheet(label.slice(0, 28));
  ws.columns = [
    ...WHO.map((c) => ({ header: c.header, key: c.field, width: c.width })),
    ...Array.from({ length: total }, (_, i) => ({ header: String(i + 1), key: `d${i + 1}`, width: 5 })),
  ];

  /*
   * Two header rows: the day number, and the weekday under it. Typing a
   * month without knowing which column is Sunday is how a whole row ends up
   * one day out.
   */
  const dayRow = ws.getRow(1);
  const dowRow = ws.insertRow(2, []);
  for (let d = 1; d <= total; d += 1) {
    const at = WHO.length + d;
    const dow = WEEKDAYS[new Date(Date.UTC(period.year, period.month - 1, d)).getUTCDay()];
    const cell = dowRow.getCell(at);
    cell.value = dow;
    cell.alignment = { horizontal: 'center' };
    cell.font = { size: 8, color: { argb: dow === 'Sun' ? 'FFB8402E' : 'FF888888' } };
    dayRow.getCell(at).alignment = { horizontal: 'center' };
    if (dow === 'Sun') {
      dayRow.getCell(at).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
    }
  }
  dayRow.font = { bold: true };
  ws.views = [{ state: 'frozen', xSplit: WHO.length, ySplit: 2 }];

  for (const person of people) {
    const row = { code: person.code || '', name: person.name, company: person.company || '' };
    for (let d = 1; d <= total; d += 1) row[`d${d}`] = person.marks?.[d] || '';
    const added = ws.addRow(row);
    for (let d = 1; d <= total; d += 1) {
      added.getCell(WHO.length + d).alignment = { horizontal: 'center' };
    }
  }

  /* ---- what every mark means ---- */
  const legend = wb.addWorksheet('Marks');
  legend.columns = [
    { header: 'Type this', key: 'c', width: 12 },
    { header: 'Means', key: 'l', width: 22 },
    { header: 'What it does to the pay', key: 'e', width: 52 },
  ];
  legend.getRow(1).font = { bold: true };
  for (const [code, meta] of Object.entries(ATTENDANCE_CODES)) {
    const effect = meta.absent
      ? `Costs ${meta.absent} day${meta.absent === 1 ? '' : 's'} of pay`
      : meta.sunday
        ? 'Adds a day, paid on the Sunday register and not in the salary'
        : 'Costs nothing';
    legend.addRow({ c: code, l: meta.label, e: effect });
  }
  legend.addRow({});
  for (const line of [
    'Fill in the grid and upload it back on the Attendance tab.',
    'A BLANK CELL LEAVES THAT DAY ALONE. It does not clear a mark that is already there.',
    'To clear a day, do it on the attendance grid in the app - a blank here means "nothing to say".',
    'A mark this list does not have is named in the summary and skipped, never guessed at.',
    'Rows are matched on Employee Code first, then on Company and Name together.',
    'Nothing is written until you have read the summary and pressed the button.',
  ]) {
    legend.addRow({ c: '', l: '', e: line });
  }

  return wb;
}

/* ---------------- reading it back ---------------- */

/**
 * Rows -> people and their marks.
 *
 * The header row is found, not assumed, and the day columns come off that
 * row's own numbers - so a sheet with an extra column in front, or the days
 * starting somewhere else, still reads.
 */
export function readAttendanceSheet(rows = []) {
  let headerRow = -1;
  let who = {};
  let days = [];
  let best = 0;

  for (let r = 0; r < Math.min(rows.length, 20); r += 1) {
    const found = {};
    const seen = [];
    (rows[r] || []).forEach((cell, c) => {
      const label = text(cell);
      const field = WHO_BY_HEADER.get(KEY(label));
      if (field && !(field in found)) found[field] = c;
      const n = /^(\d{1,2})$/.exec(label);
      if (n) {
        const day = Number(n[1]);
        if (day >= 1 && day <= 31 && !seen.some((d) => d.day === day)) seen.push({ day, column: c });
      }
    });
    const score = Object.keys(found).length * 2 + seen.length;
    if (score > best && 'name' in found && seen.length >= 20) {
      best = score;
      headerRow = r;
      who = found;
      days = seen;
    }
  }

  if (headerRow < 0) {
    return { error: 'no grid was found - this sheet needs a Name column and the days numbered across the top', people: [] };
  }

  const people = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const name = text(row[who.name]);
    // The weekday row sits under the numbers and has no name in it, and a
    // TOTAL line at the bottom is not a person.
    if (!name || /^(total|grand total)\b/i.test(name)) continue;

    const marks = {};
    for (const { day, column } of days) {
      const mark = text(row[column]).toUpperCase();
      if (mark) marks[day] = mark;
    }
    people.push({
      row: r + 1,
      name,
      code: who.code === undefined ? '' : text(row[who.code]),
      company: who.company === undefined ? '' : text(row[who.company]),
      marks,
    });
  }

  return { headerRow, days: days.map((d) => d.day).sort((a, b) => a - b), people };
}

/* ---------------- what it would do ---------------- */

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The plan, before a day is written.
 *
 * Two rules, the same two the staff sheet has:
 *
 * A BLANK CELL LEAVES THE DAY ALONE. Somebody fills in the exceptions and
 * leaves the rest; those blanks must not clear a month somebody has already
 * marked. Clearing a day is done on the grid, where it is one day at a time
 * and visible.
 *
 * A MARK THAT REPLACES A DIFFERENT MARK IS COUNTED SEPARATELY from one that
 * fills a blank. Filling blanks is typing up the register; changing P to A
 * is taking a day's pay off somebody, and it should not arrive as one row
 * among two thousand.
 */
export function planAttendanceImport({
  people = [],
  employees = [],
  period,
  existing = {},
  markMap = {},
} = {}) {
  const total = daysInMonth(period.year, period.month);
  const byCode = new Map();
  const byName = new Map();
  for (const e of employees) {
    if (e.active === 0) continue;
    if (e.code) byCode.set(norm(e.code), e);
    byName.set(`${norm(e.company_name)}::${norm(e.name)}`, e);
    // A name on its own, when it is not shared by two people - a sheet kept
    // by hand often has no company column at all.
    const key = norm(e.name);
    byName.set(key, byName.has(key) ? null : e);
  }

  const entries = [];
  const unmatched = [];
  const unknownMarks = new Map();
  const changes = [];
  const matched = [];
  let fills = 0;

  for (const person of people) {
    const employee =
      (person.code && byCode.get(norm(person.code))) ||
      (person.company && byName.get(`${norm(person.company)}::${norm(person.name)}`)) ||
      byName.get(norm(person.name)) ||
      null;

    if (!employee) {
      unmatched.push({ row: person.row, name: person.name, code: person.code, company: person.company });
      continue;
    }
    matched.push({ id: employee.id, name: employee.name });

    for (const [rawDay, raw] of Object.entries(person.marks)) {
      const day = Number(rawDay);
      if (day < 1 || day > total) continue;
      /*
       * A blank is not an unknown mark, it is nothing to say. The reader
       * already drops empty cells; this guards a caller that does not, so
       * the "blank leaves the day alone" rule cannot be contradicted by the
       * summary reporting blanks as marks it did not recognise.
       */
      if (!String(raw).trim()) continue;
      const code = (markMap[raw] || raw).toUpperCase();
      if (!ATTENDANCE_CODES[code]) {
        unknownMarks.set(raw, (unknownMarks.get(raw) || 0) + 1);
        continue;
      }
      const was = existing[`${employee.id}:${day}`] || '';
      if (was === code) continue;
      if (was) changes.push({ id: employee.id, name: employee.name, day, from: was, to: code });
      else fills += 1;
      entries.push({ employee_id: employee.id, day, code });
    }
  }

  const tally = {};
  for (const e of entries) tally[e.code] = (tally[e.code] || 0) + 1;

  return {
    entries,
    tally,
    matched,
    unmatched,
    changes,
    fills,
    unknownMarks: [...unknownMarks].map(([mark, n]) => ({ mark, rows: n })),
    counts: {
      people: people.length,
      matched: matched.length,
      unmatched: unmatched.length,
      marks: entries.length,
      fills,
      changes: changes.length,
    },
  };
}
