import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseSheet } from '../../shared/sheet.js';

/**
 * Bakes an employee master into the standalone HTML, so the file opens with
 * everybody already listed instead of empty.
 *
 *   node scripts/make-seed.mjs <sheet.xlsx>[:tab] [more.xlsx[:tab] ...]
 *                                 [--month YYYY-MM]
 *                                 [--register <file>[:tab]]
 *                                 [--festival <day>:<name>]
 *
 * Several sheets are merged, because the master is spread across more than one
 * tab - the bank sheet and the cash sheet are each half of it. Somebody
 * appearing twice is taken from the first sheet that has them.
 *
 * With --month, the month itself is seeded too: the period, a payroll row per
 * person, and every attendance mark off the day grids, so the file opens with
 * that month already done. --register layers the Sunday + Festival sheet on
 * top, which is the only place a worked Sunday (SP) or a worked festival day
 * (HP) is recorded. --festival names the holidays, since a sheet only carries
 * their dates.
 *
 * Writes seed.json, which vite.config.js inlines into the standalone build.
 * The seed reaches **only a browser that has stored nothing**, so it can never
 * overwrite real work.
 *
 * seed.json is git-ignored: it carries real salaries and does not belong in
 * the repository. Re-run this whenever the master changes.
 */

const argv = process.argv.slice(2);
const args = [];
const opts = { festivals: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--month') opts.month = argv[++i];
  else if (a === '--register') opts.register = argv[++i];
  else if (a === '--festival') opts.festivals.push(argv[++i]);
  else args.push(a);
}
if (!args.length) {
  console.error(
    'Usage: node scripts/make-seed.mjs <sheet.xlsx>[:tab] [more…] ' +
      '[--month YYYY-MM] [--register <file>[:tab]] [--festival <day>:<name>]'
  );
  process.exit(1);
}

/** "file.xlsx:Tab Name" - a Windows drive letter's colon is not a separator. */
const splitSource = (arg) => {
  const cut = arg.lastIndexOf(':');
  return cut > 1 ? [arg.slice(0, cut), arg.slice(cut + 1)] : [arg, undefined];
};

const companies = [];
const employees = [];
const seen = new Set();
let id = 1;
const sources = [];

const months = [];
const payrollRows = [];
const attendance = [];
const holidays = [];
const marksOf = new Map(); // "company|name" -> that month's marks

for (const arg of args) {
  const [file, tab] = splitSource(arg);

  const read = await parseSheet(ExcelJS, fs.readFileSync(file), { sheetName: tab });
  if (read.error) {
    console.error(read.error, read.sheets ? `\nTabs: ${read.sheets.join(', ')}` : '');
    process.exit(1);
  }
  sources.push({ sheet: read.sheet, parsed: read.parsed.length, skipped: read.skipped });

  for (const item of read.parsed) {
    const key = `${item.company.trim().toLowerCase()}|${item.name.trim().toLowerCase()}`;
    if (!marksOf.has(key)) marksOf.set(key, { item, company: item.company.trim() });
    if (seen.has(key)) continue;
    seen.add(key);

    const name = item.company.trim();
    let company = companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!company) {
      company = { id: id++, name, sort_order: companies.length };
      companies.push(company);
    }
    employees.push({
      id: id++,
      company_id: company.id,
      code: null,
      name: item.name.trim(),
      designation: null,
      monthly_salary: item.salary,
      pf: item.pf,
      esi: item.esi,
      payment_mode: item.payment_mode || 'Bank',
      joined_on: null,
      left_on: null,
      active: 1,
      sort_order: employees.length,
    });
  }
}

/* ---------------- the month, when one was asked for ---------------- */

if (opts.month) {
  const [year, month] = opts.month.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) {
    console.error(`--month wants YYYY-MM, got "${opts.month}"`);
    process.exit(1);
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const periodId = id++;
  months.push({
    id: periodId,
    year,
    month,
    label: `${MONTHS[month - 1]} ${year}`,
    working_days: 26,
    hours_per_day: 9,
    pt_threshold: 12000,
    pt_amount: 200,
    locked: 0,
  });

  for (const festival of opts.festivals) {
    const [day, ...rest] = festival.split(':');
    holidays.push({
      id: id++,
      period_id: periodId,
      day: Number(day),
      name: rest.join(':') || `Festival ${day}`,
      code: 'PH',
      religions: [],
      applied_at: null,
    });
  }

  // The Sunday + Festival sheet is the only record of a Sunday or a festival
  // day that was WORKED, so its marks are layered over the day grids.
  const worked = new Map();
  if (opts.register) {
    const [file, tab] = splitSource(opts.register);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync(file));
    const ws = tab ? wb.getWorksheet(tab) || wb.worksheets.find((x) => x.name.trim() === tab.trim()) : wb.worksheets[0];
    if (!ws) {
      console.error(`--register: no sheet "${tab}" in ${file}`);
      process.exit(1);
    }
    const text = (c) => {
      const v = ws.getRow(c.r).getCell(c.c).value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return String(v.result ?? v.text ?? '');
      return String(v).trim();
    };
    // Header row 1: Company Name | Employee Name | <dates…> | Total Sunday | …
    const head = [];
    for (let c = 1; c <= ws.columnCount; c++) head.push(text({ r: 1, c }));
    const nameCol = head.findIndex((h) => /employee name/i.test(h)) + 1;
    const stop = head.findIndex((h) => /total sunday/i.test(h)) + 1;
    if (!nameCol || !stop) {
      console.error('--register: could not find "Employee Name" and "Total Sunday" in row 1');
      process.exit(1);
    }
    const dateCols = [];
    for (let c = nameCol + 1; c < stop; c++) {
      const day = Number(head[c - 1]);
      if (day >= 1 && day <= 31) dateCols.push({ c, day });
    }
    const amountCol = head.findIndex((h) => /net amount/i.test(h)) + 1;
    const salaryCol = head.findIndex((h) => /^salary$/i.test(h)) + 1;
    const remarkCol = head.findIndex((h) => /remark/i.test(h)) + 1;

    for (let r = 3; r <= ws.rowCount; r++) {
      const name = text({ r, c: nameCol });
      if (!name || /^total$/i.test(name)) continue;
      const marks = {};
      let days = 0;
      for (const { c, day } of dateCols) {
        const v = text({ r, c }).toUpperCase();
        const sunday = new Date(year, month - 1, day).getDay() === 0;
        // SP and HP both carry a day's extra pay. A register HF means half of
        // the festival day was worked, which the app has no single mark for -
        // and writing HF onto the grid would turn a paid holiday into half a
        // day's ABSENCE and dock the pay instead of adding to it. So the grid
        // is left alone and the half is settled by the amount below.
        if (v === 'P' && sunday) { marks[day] = 'SP'; days += 1; }
        else if (v === 'H/O' && !sunday) { marks[day] = 'HP'; days += 1; }
        else if (v === 'HF') days += 0.5;
      }
      const amount = amountCol ? Number(text({ r, c: amountCol })) : NaN;
      const salary = salaryCol ? Number(text({ r, c: salaryCol })) : NaN;
      const remark = remarkCol ? text({ r, c: remarkCol }) : '';
      // The app works the amount out as days x day rate. Where the sheet says
      // something else - a half day, an arrear carried in from last month - the
      // typed figure wins and is kept as an override, with its reason.
      const expected = Number.isFinite(salary) ? Math.round(days * (salary / 26)) : null;
      const override =
        Number.isFinite(amount) && (expected === null || Math.abs(amount - expected) > 1)
          ? amount
          : null;
      if (Object.keys(marks).length || override !== null || remark) {
        worked.set(name.trim().toLowerCase(), { marks, override, remark });
      }
    }
  }

  const owedOf = (employee) => worked.get(employee.name.toLowerCase());

  for (const employee of employees) {
    const company = companies.find((c) => c.id === employee.company_id);
    const key = `${company.name.toLowerCase()}|${employee.name.toLowerCase()}`;
    const found = marksOf.get(key);
    const item = found?.item;

    payrollRows.push({
      id: id++,
      period_id: periodId,
      employee_id: employee.id,
      salary: employee.monthly_salary,
      absent_days_override: null,
      sundays_override: null,
      ot_minutes_override: null,
      ot_amount_override: null,
      addition: item?.addition || 0,
      deduction: item?.deduction || 0,
      adjustment_note: null,
      adjustment: 0,
      esi: employee.esi || 0,
      pf: employee.pf || 0,
      sunday_salary_override: owedOf(employee)?.override ?? null,
      payment_mode: employee.payment_mode,
      status: item?.status || 'pending',
      sunday_status: null,
      sunday_mode: null,
      remark: owedOf(employee)?.remark || null,
    });

    const owed = worked.get(employee.name.toLowerCase());
    const marks = { ...(item?.attendance || {}), ...(owed?.marks || {}) };
    for (const [day, code] of Object.entries(marks)) {
      attendance.push({
        period_id: periodId,
        employee_id: employee.id,
        day: Number(day),
        code,
        minutes: 0,
        in_time: '',
        lunch_out: '',
        lunch_in: '',
        out_time: '',
      });
    }
  }
}

const seed = {
  companies,
  employees,
  periods: months,
  payroll_rows: payrollRows,
  attendance,
  holidays,
  next_id: id,
};
fs.writeFileSync(path.resolve('seed.json'), `${JSON.stringify(seed, null, 2)}\n`);

console.log(
  `Seeded from ${sources.map((s) => `"${s.sheet}" (${s.parsed})`).join(' + ')}: ` +
    `${employees.length} employees in ${companies.length} companies`
);
for (const c of companies) {
  console.log(`  ${c.name.padEnd(28)} ${employees.filter((e) => e.company_id === c.id).length}`);
}
for (const s of sources) {
  if (s.skipped.length) {
    console.log(`  "${s.sheet}" skipped ${s.skipped.length}: ${s.skipped.map((x) => x.name.slice(0, 40)).join(' | ')}`);
  }
}
if (months.length) {
  const counts = attendance.reduce((acc, a) => ({ ...acc, [a.code]: (acc[a.code] || 0) + 1 }), {});
  console.log(
    `\n${months[0].label} seeded: ${payrollRows.length} payroll rows, ` +
      `${attendance.length} marks, ${holidays.length} festivals`
  );
  console.log('  ' + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join('  '));
}
