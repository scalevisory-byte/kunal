/**
 * The employee master as a spreadsheet: out, edited, and back in.
 *
 * Dinesh: "bulk me employee update karne k liye?" then "sari chizo me xls ka
 * default format do jisse bulk import ho sake".
 *
 * The existing salary-sheet importer brings in a company, a name, a salary
 * and the PF/ESI figures, in the April sheet's fixed column positions, and
 * needs an open month because it also carries attendance. It cannot touch a
 * bank account, a PAN, a UAN, a joining date or a designation - which is most
 * of what an office actually needs to fill in for eighty-five people.
 *
 * The shape here is deliberately the SAME FILE both ways. Download the staff
 * list, edit it in Excel, upload it back: the rows that changed are updates,
 * the rows typed underneath are new people. A blank template is that file
 * with no rows in it, so there is only one format to learn and only one that
 * can drift.
 *
 * Dependency-free: the caller passes ExcelJS in, so the server and the
 * browser produce an identical file.
 */

/* ---------------- what a column is ---------------- */

/**
 * Every column, in the order it appears.
 *
 * `also` lists what somebody else's spreadsheet is likely to call it, so a
 * file that was not produced here still reads. Matching is on letters and
 * digits only, so "Emp. Code", "emp code" and "EMPCODE" are one thing.
 */
export const EMPLOYEE_COLUMNS = [
  { field: 'code', header: 'Employee Code', also: ['emp code', 'empcode', 'code', 'employee id', 'emp id'], width: 14,
    note: 'Your own code, or the attendance machine’s. Matched on first, so keep it steady.' },
  { field: 'name', header: 'Name', also: ['employee name', 'full name'], width: 26, required: true,
    note: 'Required. With the company, this is how a row finds its person when there is no code.' },
  { field: 'company', header: 'Company', also: ['company name', 'firm', 'unit'], width: 24, required: true,
    note: 'Required. A company that does not exist yet is created, and the dry run names it first.' },
  { field: 'designation', header: 'Designation', also: ['title', 'post', 'role'], width: 20 },
  { field: 'department', header: 'Department', also: ['dept'], width: 16 },
  { field: 'monthly_salary', header: 'Monthly Salary', also: ['salary', 'gross', 'gross salary', 'ctc'], width: 14, kind: 'money',
    note: 'What the month is paid on. A change here changes a payslip, so the dry run lists these on their own.' },
  { field: 'pf', header: 'PF', also: ['pf amount', 'provident fund'], width: 10, kind: 'money' },
  { field: 'esi', header: 'ESI', also: ['esi amount'], width: 10, kind: 'money' },
  { field: 'payment_mode', header: 'Pay By', also: ['payment mode', 'mode', 'paid by'], width: 10,
    note: 'Bank, Cash, Gpay, Cheque — whatever you use. Cash means the bank columns can stay empty.' },
  { field: 'bank_name', header: 'Bank', also: ['bank name'], width: 18 },
  { field: 'bank_account', header: 'Account Number', also: ['account', 'a/c', 'ac no', 'account no', 'bank account'], width: 20, kind: 'text' },
  { field: 'ifsc', header: 'IFSC', also: ['ifsc code'], width: 14 },
  { field: 'pan', header: 'PAN', also: ['pan no', 'pan number'], width: 12 },
  { field: 'aadhaar', header: 'Aadhaar', also: ['aadhar', 'aadhaar no', 'uid'], width: 16, kind: 'text' },
  { field: 'uan', header: 'UAN', also: ['uan no', 'uan number'], width: 14, kind: 'text',
    note: 'Without this the PF return will not file.' },
  { field: 'esic_no', header: 'ESIC Number', also: ['esic', 'esic no', 'ip number'], width: 16, kind: 'text' },
  { field: 'phone', header: 'Phone', also: ['mobile', 'contact', 'phone no'], width: 14, kind: 'text' },
  { field: 'email', header: 'Email', also: ['email id', 'e-mail'], width: 24 },
  { field: 'dob', header: 'Date of Birth', also: ['dob', 'birth date', 'birthday'], width: 14, kind: 'date' },
  { field: 'joined_on', header: 'Joining Date', also: ['doj', 'date of joining', 'joined'], width: 14, kind: 'date',
    note: 'Drives the work anniversary, the probation reminder and the gratuity sum.' },
  { field: 'religion', header: 'Religion', also: [], width: 14,
    note: 'Only used to decide whose festival is a paid holiday. Leave it blank and they work that day.' },
  { field: 'gender', header: 'Gender', also: ['sex'], width: 10 },
  { field: 'blood_group', header: 'Blood Group', also: ['blood'], width: 12 },
];

const KEY = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const BY_HEADER = new Map();
for (const column of EMPLOYEE_COLUMNS) {
  BY_HEADER.set(KEY(column.header), column.field);
  BY_HEADER.set(KEY(column.field), column.field);
  for (const alias of column.also || []) BY_HEADER.set(KEY(alias), column.field);
}

export const REQUIRED = EMPLOYEE_COLUMNS.filter((c) => c.required).map((c) => c.field);

/* ---------------- reading what came back ---------------- */

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const z = (n) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${z(value.getUTCMonth() + 1)}-${z(value.getUTCDate())}`;
  }
  if (typeof value === 'object') {
    return String(value.result ?? value.text ?? value.richText?.map((t) => t.text).join('') ?? '').trim();
  }
  return String(value).trim();
};

/** 45678 (Excel's own day count) or "12/03/1994" or "1994-03-12" -> ISO. */
export function readDate(value) {
  const raw = text(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Excel keeps a date as days since 1899-12-30. Anything in that range that
  // is a bare number is a date, not a year.
  if (/^\d{4,5}(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 60000) {
      const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  const m = raw.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    let day = Number(a);
    let month = Number(b);
    /*
     * Day first, which is how everybody here writes it - and the only safe
     * reading of 12/03. The one case it can be told apart is a first number
     * over twelve, which can only be a day, so 03/12 stays 3 December. A
     * month over twelve means the two are the other way round.
     */
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month > 12 || day > 31) return '';
    /*
     * A two-digit year pivots at 50: "94" is a birth year, "26" is a joining
     * date. Adding 2000 to everything put a man born in 1994 in 2094, which
     * reads as a typo nobody would question until the gratuity sum.
     */
    const short = Number(y);
    const year = short >= 100 ? short : short >= 50 ? 1900 + short : 2000 + short;
    const z = (n) => String(n).padStart(2, '0');
    return `${year}-${z(month)}-${z(day)}`;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

const money = (value) => {
  const raw = text(value).replace(/[₹,\s]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * One sheet of rows -> the people in it.
 *
 * The header row is FOUND, not assumed: the row that matches the most known
 * column names wins. Anybody's own export has its columns in its own order
 * and usually a title line or two above them.
 */
export function readEmployeeSheet(rows = []) {
  let headerRow = -1;
  let columns = {};
  let best = 0;

  for (let r = 0; r < Math.min(rows.length, 25); r += 1) {
    const found = {};
    let hits = 0;
    (rows[r] || []).forEach((cell, c) => {
      const field = BY_HEADER.get(KEY(text(cell)));
      // The FIRST column with a given name wins, so a sheet that repeats one
      // does not quietly read the right-hand copy.
      if (field && !(field in found)) {
        found[field] = c;
        hits += 1;
      }
    });
    if (hits > best) {
      best = hits;
      headerRow = r;
      columns = found;
    }
  }

  if (headerRow < 0 || !('name' in columns)) {
    return { error: 'no Name column was found in this sheet', people: [], columns: {} };
  }

  const unknown = [];
  (rows[headerRow] || []).forEach((cell, c) => {
    const label = text(cell);
    if (label && !BY_HEADER.has(KEY(label))) unknown.push({ column: c, label });
  });

  const people = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const name = text(row[columns.name]);
    if (!name || /^(total|grand total)\b/i.test(name)) continue;

    const person = { row: r + 1, name };
    for (const column of EMPLOYEE_COLUMNS) {
      if (column.field === 'name') continue;
      const at = columns[column.field];
      if (at === undefined) continue;
      const cell = row[at];
      if (column.kind === 'date') {
        const d = readDate(cell);
        if (d) person[column.field] = d;
      } else if (column.kind === 'money') {
        const n = money(cell);
        if (n !== null) person[column.field] = n;
      } else {
        const v = text(cell);
        if (v) person[column.field] = v;
      }
    }
    people.push(person);
  }

  return { headerRow, columns, unknown, people };
}

/* ---------------- what the file would do ---------------- */

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The plan, before a single row is written.
 *
 * Three rules this hangs on:
 *
 * A BLANK CELL IS NOT AN INSTRUCTION. Somebody sends a file with four
 * columns filled in; the twenty they left alone must not wipe twenty fields
 * that are already right. Only a cell with something in it is a change.
 *
 * A row finds its person BY CODE FIRST, then by company and name - the same
 * order the attendance importer uses, so one person cannot be two different
 * people depending on which file came in.
 *
 * A SALARY CHANGE IS COUNTED SEPARATELY. Everything else on this sheet is a
 * detail; that one is a payslip.
 */
export function planEmployeeImport({ people = [], employees = [], companies = [] } = {}) {
  const byCode = new Map();
  const byName = new Map();
  for (const e of employees) {
    if (e.code) byCode.set(norm(e.code), e);
    byName.set(`${norm(e.company_name)}::${norm(e.name)}`, e);
  }
  const knownCompanies = new Set(companies.map((c) => norm(c.name)));

  const create = [];
  const update = [];
  const unchanged = [];
  const problems = [];
  const newCompanies = new Set();
  const seen = new Map();
  let salaryMoves = 0;

  for (const person of people) {
    const where = `row ${person.row}`;
    if (!person.company) {
      problems.push({ row: person.row, name: person.name, why: 'no company on this row' });
      continue;
    }

    /*
     * The same person twice in one file is a mistake worth naming, not a
     * silent second write where the lower row quietly wins.
     *
     * BOTH ways of identifying them are tracked, not just the one this row
     * happens to use: a row carrying the code and a row carrying only the
     * name are the same person, and checking one key missed exactly that.
     */
    const key = `${norm(person.company)}::${norm(person.name)}`;
    const keys = person.code ? [`code:${norm(person.code)}`, key] : [key];
    const clash = keys.find((k) => seen.has(k));
    if (clash) {
      problems.push({
        row: person.row,
        name: person.name,
        why: `the same person is on ${seen.get(clash)} as well`,
      });
      continue;
    }
    for (const k of keys) seen.set(k, where);

    if (!knownCompanies.has(norm(person.company))) newCompanies.add(person.company);

    const match =
      (person.code && byCode.get(norm(person.code))) || byName.get(key) || null;

    if (!match) {
      create.push(person);
      continue;
    }

    const changes = [];
    for (const column of EMPLOYEE_COLUMNS) {
      const field = column.field;
      if (field === 'company' || field === 'name') continue;
      if (!(field in person)) continue; // blank cell: not an instruction
      const was = match[field];
      const to = person[field];
      const same =
        column.kind === 'money'
          ? Number(was || 0) === Number(to || 0)
          : norm(was) === norm(to);
      if (same) continue;
      changes.push({ field, label: column.header, from: was ?? '', to });
      if (field === 'monthly_salary') salaryMoves += 1;
    }

    if (changes.length) update.push({ id: match.id, name: match.name, row: person.row, changes });
    else unchanged.push({ id: match.id, name: match.name });
  }

  return {
    create,
    update,
    unchanged,
    problems,
    newCompanies: [...newCompanies],
    salaryMoves,
    counts: {
      rows: people.length,
      create: create.length,
      update: update.length,
      unchanged: unchanged.length,
      problems: problems.length,
    },
  };
}

/* ---------------- the file itself ---------------- */

/**
 * The workbook: one sheet of people, one sheet explaining the columns.
 *
 * The SAME file is the template and the export. Asked for with no employees
 * it is a blank form; asked for with the staff on it, it is the thing to
 * edit and send back. Two formats would be two formats to keep in step.
 *
 * ExcelJS is passed in rather than imported, so this file stays
 * dependency-free and the browser can build the identical workbook.
 */
export async function writeEmployeeSheet(ExcelJS, { employees = [], companies = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BOOKNFLY HRMS';
  wb.created = new Date();

  const ws = wb.addWorksheet('Employees');
  ws.columns = EMPLOYEE_COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width || 16 }));

  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle' };
  head.height = 20;
  EMPLOYEE_COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FFFFF3CD' : 'FFF1F1EF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } };
    if (c.note || c.required) cell.note = `${c.required ? 'Required. ' : ''}${c.note || ''}`.trim();
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const e of employees) {
    const row = {};
    for (const c of EMPLOYEE_COLUMNS) {
      row[c.field] = c.field === 'company' ? e.company_name || '' : e[c.field] ?? '';
    }
    const added = ws.addRow(row);
    /*
     * Account numbers, Aadhaar, UAN and phone numbers are TEXT. Left as
     * numbers Excel drops the leading zero off an account and renders a
     * twelve-digit Aadhaar as 1.23457E+11, and what comes back is not the
     * number that went out.
     */
    EMPLOYEE_COLUMNS.forEach((c, i) => {
      if (c.kind === 'text') added.getCell(i + 1).numFmt = '@';
      if (c.kind === 'money') added.getCell(i + 1).numFmt = '#,##0';
    });
  }

  /* ---- how to fill it in ---- */
  const notes = wb.addWorksheet('How to fill this in');
  notes.columns = [
    { header: 'Column', key: 'c', width: 20 },
    { header: 'Needed?', key: 'r', width: 11 },
    { header: 'What it is', key: 'n', width: 92 },
  ];
  notes.getRow(1).font = { bold: true };
  for (const c of EMPLOYEE_COLUMNS) {
    notes.addRow({
      c: c.header,
      r: c.required ? 'Required' : '',
      n: c.note || (c.kind === 'date' ? 'A date. 12/03/1994 or 1994-03-12 both read.' : ''),
    });
  }
  notes.addRow({});
  for (const line of [
    'Edit this file and upload it back on the Employees tab.',
    'A row that matches somebody already on the list UPDATES them. A row that matches nobody ADDS them.',
    'Matching is on Employee Code first, then on Company and Name together.',
    'A BLANK CELL CHANGES NOTHING. Only what you actually type is written, so a file with four columns filled in cannot wipe the other twenty.',
    'To clear something, do it on the person’s own record rather than here - a blank here means "not stated".',
    'Nothing is written until you have read the summary and pressed the button.',
    companies.length ? `Companies already set up: ${companies.map((c) => c.name).join(', ')}` : '',
  ]) {
    if (line) notes.addRow({ c: '', r: '', n: line });
  }

  return wb;
}
