import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseSheet } from '../../shared/sheet.js';

/**
 * Bakes an employee master into the standalone HTML, so the file opens with
 * everybody already listed instead of empty.
 *
 *   node scripts/make-seed.mjs <sheet.xlsx> [tab name]
 *
 * Writes seed.json, which vite.config.js inlines into the standalone build.
 * Only the master is seeded - companies, names, salaries, PF/ESI, pay mode -
 * never a month's attendance, so every month still starts blank.
 *
 * seed.json is git-ignored: it carries real salaries and does not belong in
 * the repository. Re-run this whenever the master changes.
 */

const [, , file, tab] = process.argv;
if (!file) {
  console.error('Usage: node scripts/make-seed.mjs <sheet.xlsx> [tab name]');
  process.exit(1);
}

const read = await parseSheet(ExcelJS, fs.readFileSync(file), { sheetName: tab });
if (read.error) {
  console.error(read.error, read.sheets ? `\nTabs: ${read.sheets.join(', ')}` : '');
  process.exit(1);
}

const companies = [];
const employees = [];
let id = 1;

for (const item of read.parsed) {
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

const seed = { companies, employees, next_id: id };
fs.writeFileSync(path.resolve('seed.json'), `${JSON.stringify(seed, null, 2)}\n`);

console.log(`Seeded from "${read.sheet}": ${employees.length} employees in ${companies.length} companies`);
for (const c of companies) {
  console.log(`  ${c.name.padEnd(24)} ${employees.filter((e) => e.company_id === c.id).length}`);
}
if (read.skipped.length) {
  console.log(`  skipped ${read.skipped.length}: ${read.skipped.map((s) => s.name).join(', ')}`);
}
