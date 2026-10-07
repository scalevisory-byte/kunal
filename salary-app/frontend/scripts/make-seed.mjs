import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseSheet } from '../../shared/sheet.js';

/**
 * Bakes an employee master into the standalone HTML, so the file opens with
 * everybody already listed instead of empty.
 *
 *   node scripts/make-seed.mjs <sheet.xlsx>[:tab] [more.xlsx[:tab] ...]
 *
 * Several are merged, because the master is spread across more than one tab -
 * the bank sheet and the cash sheet are each half of it. Somebody appearing
 * twice is taken from the first sheet that has them.
 *
 * Writes seed.json, which vite.config.js inlines into the standalone build.
 * Only the master is seeded - companies, names, salaries, PF/ESI, pay mode -
 * never a month's attendance, so every month still starts blank.
 *
 * seed.json is git-ignored: it carries real salaries and does not belong in
 * the repository. Re-run this whenever the master changes.
 */

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/make-seed.mjs <sheet.xlsx>[:tab] [more.xlsx[:tab] ...]');
  process.exit(1);
}

const companies = [];
const employees = [];
const seen = new Set();
let id = 1;
const sources = [];

for (const arg of args) {
  // A Windows path has a colon in it, so only a colon past the drive letter
  // separates the tab name from the file.
  const cut = arg.lastIndexOf(':');
  const [file, tab] = cut > 1 ? [arg.slice(0, cut), arg.slice(cut + 1)] : [arg, undefined];

  const read = await parseSheet(ExcelJS, fs.readFileSync(file), { sheetName: tab });
  if (read.error) {
    console.error(read.error, read.sheets ? `\nTabs: ${read.sheets.join(', ')}` : '');
    process.exit(1);
  }
  sources.push({ sheet: read.sheet, parsed: read.parsed.length, skipped: read.skipped });

  for (const item of read.parsed) {
    const key = `${item.company.trim().toLowerCase()}|${item.name.trim().toLowerCase()}`;
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

const seed = { companies, employees, next_id: id };
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
