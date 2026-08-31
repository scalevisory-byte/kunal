import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-import-'));
process.env.APP_PASSWORD = '';

const { importSheet, listSheetNames } = await import('../src/importer.js');
const { buildWorkbook } = await import('../../shared/workbook.js');
const { buildPayroll } = await import('../src/payroll.js');
const { createPeriod } = await import('../src/db.js');

/**
 * A miniature version of the April tab: the same columns in the same places,
 * including the trailing space in the tab name and a company left blank so it
 * carries down from the row above.
 */
async function sampleSheet() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('April ');
  ws.getCell('D1').value = 'Month of April - 2026';
  ws.getCell('B2').value = 'Sr. No.';
  ws.getCell('C2').value = 'Name';
  ws.getCell('AL2').value = 'Salary';

  const write = (row, values) => {
    for (const [ref, value] of Object.entries(values)) ws.getCell(`${ref}${row}`).value = value;
  };
  // Absent days typed over the formula, OT amount typed over the formula.
  write(4, { A: 'BNF PVT LTD', B: 1, C: 'Ashutosh Jha', AH: 26, AI: 1, AJ: 7.5, AL: 60000, AS: 0, AT: -90, AY: 0 });
  // Company blank - carries down. PF entered, marks in the day grid.
  write(5, { B: 2, C: 'Rohit Tayade', AH: 26, AL: 22000, AY: 1800, BC: 'Cash', D: 'A', E: 'HF', F: 'SP' });
  write(6, { A: 'SCALE', B: 1, C: 'Nilesh Chitte', AH: 26, AJ: 4.5, AL: 14500 });
  write(7, { A: 'SCALE', B: 2, C: 'No Salary Person' }); // nothing in AL
  return wb.xlsx.writeBuffer();
}

test('the tab is found despite the trailing space in its name', async () => {
  const buffer = await sampleSheet();
  assert.deepEqual((await listSheetNames(buffer)).map((s) => s.name), ['April ']);
  const dry = await importSheet(buffer, { sheetName: 'April', dryRun: true });
  assert.equal(dry.sheet, 'April ');
});

test('a dry run reports what it found and writes nothing', async () => {
  const buffer = await sampleSheet();
  const dry = await importSheet(buffer, { sheetName: 'April', dryRun: true });
  assert.equal(dry.parsed, 3);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.preview[1].company, 'BNF PVT LTD', 'a blank company carries down from the row above');
  assert.deepEqual(dry.preview[1].attendance, { 1: 'A', 2: 'HF', 3: 'SP' });
  assert.equal(dry.skipped.length, 1);
  assert.match(dry.skipped[0].reason, /salary/);
});

test('importing builds the master and the month, matching the sheet', async () => {
  const buffer = await sampleSheet();
  const period = createPeriod({ year: 2026, month: 4 });

  const result = await importSheet(buffer, { sheetName: 'April', periodId: period.id });
  assert.equal(result.created, 3);
  assert.equal(result.attendanceMarks, 3);

  const payroll = buildPayroll(period.id);
  const byName = Object.fromEntries(payroll.rows.map((r) => [r.employee_name, r]));

  // The typed absent count and the typed OT amount both survive the round trip.
  const ashutosh = byName['Ashutosh Jha'];
  assert.equal(ashutosh.absent_days, 7.5);
  assert.equal(ashutosh.ot_salary, -90);
  assert.equal(ashutosh.gross_salary, 42602, 'matches the April sheet');
  assert.equal(ashutosh.net_salary, 42402);
  assert.equal(ashutosh.sunday_salary, 2308);

  // Marks in the grid drive the counts instead of an override.
  const rohit = byName['Rohit Tayade'];
  assert.equal(rohit.company_name, 'BNF PVT LTD');
  assert.equal(rohit.absent_days, 1.5, 'A + HF');
  assert.equal(rohit.sundays_worked, 1, 'SP');
  assert.equal(rohit.overrides.absent_days, false);
  assert.equal(rohit.pf, 1800);
  assert.equal(rohit.payment_mode, 'Cash');

  assert.equal(byName['Nilesh Chitte'].absent_days, 4.5);
  assert.equal(payroll.companies.length, 2);
});

test('importing the same sheet again updates rather than duplicating', async () => {
  const buffer = await sampleSheet();
  const period = createPeriod({ year: 2026, month: 5 });
  const again = await importSheet(buffer, { sheetName: 'April', periodId: period.id });
  assert.equal(again.created, 0);
  assert.equal(again.updated, 3);
  assert.equal(buildPayroll(period.id).rows.length, 3);
});

test('the exported workbook has the grid, the calculation columns and a legend', async () => {
  const period = createPeriod({ year: 2026, month: 6 });
  const buffer = await sampleSheet();
  await importSheet(buffer, { sheetName: 'April', periodId: period.id });

  const wb = await buildWorkbook(ExcelJS, buildPayroll(period.id));
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['June 2026', 'Sunday Register', 'Codes']);

  const ws = wb.getWorksheet('June 2026');
  const header = ws.getRow(2).values.filter(Boolean);
  assert.ok(header.includes('Working Days') && header.includes('Net Salary') && header.includes('Final Payable'));
  assert.equal(ws.getRow(3).getCell(4).value, 1, 'the day strip starts at 1');
  assert.equal(ws.getRow(3).getCell(33).value, 30, 'June has 30 days');

  // Company subtotals stay live formulas so the file can be edited in Excel.
  const labels = [];
  ws.eachRow((row) => {
    const value = row.getCell(3).value;
    if (typeof value === 'string' && /total/i.test(value)) labels.push(value);
  });
  assert.ok(labels.some((l) => l.startsWith('BNF PVT LTD')));
  assert.ok(labels.includes('GRAND TOTAL'));

  // In the sample sheet Rohit Tayade carries an SP mark on day 3, and Ashutosh
  // Jha a typed Sunday count with no marks - both are owed Sunday pay, so both
  // belong on the register. Nilesh Chitte worked none and does not.
  const register = wb.getWorksheet('Sunday Register');
  const names = [];
  register.eachRow((row) => {
    const value = row.getCell(3).value;
    if (typeof value === 'string') names.push(value);
  });
  assert.ok(names.includes('Employee'), 'it has a header');
  assert.ok(names.includes('Rohit Tayade'), 'the one with a marked Sunday');
  assert.ok(names.includes('Ashutosh Jha'), 'and the one with a typed count');
  assert.ok(names.includes('TOTAL'));
  assert.ok(!names.includes('Nilesh Chitte'), 'people who worked no Sunday are left out');

  const legend = wb.getWorksheet('Codes');
  assert.equal(legend.getRow(1).getCell(1).value, 'Code');
  assert.ok(legend.rowCount > 8);
});
