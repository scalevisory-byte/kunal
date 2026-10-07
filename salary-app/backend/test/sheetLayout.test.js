import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { detectLayout, parseSheet } from '../../shared/sheet.js';

/**
 * A sheet in the shape of the monthly pack: name in B, dates from C, and -
 * on the cash tab - the Sunday register pasted alongside on the same rows,
 * which is where the second "Salary" header comes from.
 */
async function packShaped({ withRegister = false } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sep-26');
  const head = ['Company', 'Name'];
  for (let d = 1; d <= 30; d++) head.push(String(d));
  head.push(
    'Working Days', 'Present Days', 'Absent Days', 'Paid Holiday', 'Net Days', 'Salary',
    'Salary / Day', 'Gross Salary', 'Deduction', 'PT', 'ESI', 'PF', 'Net Salary', 'Payment Mode'
  );
  head.forEach((text, i) => { ws.getRow(1).getCell(i + 1).value = text; });
  if (withRegister) {
    // The register's own block, far to the right, with its own Salary column.
    ['Company Name', 'Employee Name', 'Total Sunday', 'Salary', 'Salary / Day']
      .forEach((text, i) => { ws.getRow(1).getCell(55 + i).value = text; });
  }
  ws.getRow(2).getCell(3).value = 'Tue'; // the weekday strip

  const write = (row, values) => {
    for (const [ref, value] of Object.entries(values)) ws.getCell(`${ref}${row}`).value = value;
  };
  // Salary is AL (38), ESI AQ (43), PF AR (44), mode AT (46) in this layout.
  write(3, { A: 'SCALE', B: 'Alifaya Chikhaliwala', AL: 16600, AQ: 0, AR: 0, AT: 'Cash',
    C: 'P', D: 'A', E: 'HF', H: 'W/O', G: 'H/O' });
  write(4, { B: 'Avesh Quazi', AL: 15000, AT: 'Cash' });
  if (withRegister) {
    // Another person's Sunday pay on the same rows - a different table.
    write(3, { BC: 'SCALE', BD: 'Someone Else', BF: 24150 });
    write(4, { BC: 'SCALE', BD: 'Another', BF: 33000 });
  }
  write(5, { B: 'TOTAL', AL: { formula: 'SUM(AL3:AL4)', result: 31600 } });
  return wb.xlsx.writeBuffer();
}

test('the layout is read off the header, not assumed from positions', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await packShaped());
  const at = detectLayout(wb.getWorksheet('Sep-26'));
  assert.equal(at.headerRow, 1);
  assert.equal(at.name, 2, 'the pack puts the name in B, April puts it in C');
  assert.equal(at.day1, 3, 'and the dates start one column earlier');
  assert.equal(at.salary, 38);
  assert.equal(at.mode, 46);
});

test('a sheet with no header it recognises keeps the April positions', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Nothing');
  ws.getCell('A1').value = 'no header here';
  const at = detectLayout(ws);
  assert.equal(at.name, 3);
  assert.equal(at.day1, 4);
  assert.equal(at.salary, 38);
  assert.equal(at.headerRow, 2);
});

test("the pack's own marks come back in as the app's", async () => {
  const { parsed } = await parseSheet(ExcelJS, await packShaped(), { sheetName: 'Sep-26' });
  const row = parsed.find((p) => p.name === 'Alifaya Chikhaliwala');
  assert.equal(row.salary, 16600);
  assert.equal(row.payment_mode, 'Cash');
  assert.deepEqual(row.attendance, { 1: 'P', 2: 'A', 3: 'HF', 5: 'PH', 6: 'S' });
});

test('a totals row is not imported as somebody earning the whole payroll', async () => {
  // Its Salary cell is a SUM with a cached result, so it reads as a number.
  const { parsed, skipped } = await parseSheet(ExcelJS, await packShaped(), { sheetName: 'Sep-26' });
  assert.deepEqual(parsed.map((p) => p.name), ['Alifaya Chikhaliwala', 'Avesh Quazi']);
  assert.ok(!skipped.some((s) => /total/i.test(s.name)), 'not even reported - it is furniture');
});

test('a second Salary column further right does not hijack the first', async () => {
  // His cash tab has the Sunday register alongside it, with its own Salary
  // column; reading the rightmost one gave every employee somebody else's pay.
  const { parsed } = await parseSheet(ExcelJS, await packShaped({ withRegister: true }), {
    sheetName: 'Sep-26',
  });
  assert.equal(parsed.find((p) => p.name === 'Alifaya Chikhaliwala').salary, 16600);
  assert.equal(parsed.find((p) => p.name === 'Avesh Quazi').salary, 15000);
});
