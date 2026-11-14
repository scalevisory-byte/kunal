/**
 * The staff master as a spreadsheet.
 *
 * Dinesh: "bulk me employee update karne k liye?" then "sari chizo me xls ka
 * default format do jisse bulk import ho sake".
 *
 * The salary-sheet importer that already existed brings in a company, a
 * name, a salary and the PF/ESI figures, in the April sheet's fixed column
 * positions, and needs an open month because it also carries attendance. It
 * cannot touch a bank account, a PAN, a UAN, a joining date or a designation
 * - which is most of what an office has to fill in for eighty-five people.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  EMPLOYEE_COLUMNS,
  planEmployeeImport,
  readDate,
  readEmployeeSheet,
  writeEmployeeSheet,
} from '../../shared/employeeSheet.js';

const sheetRows = async (wb, name) => {
  const rows = [];
  wb.getWorksheet(name).eachRow({ includeEmpty: true }, (row, index) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      values[column - 1] = cell.value;
    });
    rows[index - 1] = values;
  });
  return rows;
};

const staff = [
  {
    id: 1, code: 'E101', name: 'Nidhi Shah', company_name: 'BOOK N FLY',
    monthly_salary: 32000, bank_account: '0012345678901', aadhaar: '123456789012',
    dob: '1994-03-12', pan: 'ABCDE1234F',
  },
  { id: 2, code: 'E102', name: 'Rahul Patel', company_name: 'BOOK N FLY', monthly_salary: 28000 },
];

test('the file written is the file read back, down to the leading zero', async () => {
  /*
   * Account numbers, Aadhaar, UAN and phone numbers are written as TEXT. Left
   * as numbers Excel drops the leading zero off an account and renders a
   * twelve-digit Aadhaar as 1.23457E+11, and what comes back is not what went
   * out - which is a failed bank transfer, not a cosmetic problem.
   */
  const wb = await writeEmployeeSheet(ExcelJS, { employees: staff, companies: [{ name: 'BOOK N FLY' }] });
  const buffer = await wb.xlsx.writeBuffer();

  const again = new ExcelJS.Workbook();
  await again.xlsx.load(buffer);
  const read = readEmployeeSheet(await sheetRows(again, 'Employees'));

  assert.equal(read.error, undefined);
  assert.equal(read.people.length, 2);
  assert.equal(read.people[0].bank_account, '0012345678901', 'the leading zero survived');
  assert.equal(read.people[0].aadhaar, '123456789012', 'not turned into 1.23457E+11');
  assert.equal(read.people[0].dob, '1994-03-12');
  assert.equal(read.people[0].monthly_salary, 32000);

  // And the notes sheet travels with it, so the format explains itself.
  assert.ok(again.getWorksheet('How to fill this in'), 'the notes sheet is missing');
});

test('the template and the export are one file', async () => {
  // Two formats would be two things to keep in step, and the first mismatch
  // would be somebody's salary.
  const blank = await writeEmployeeSheet(ExcelJS, { employees: [] });
  const filled = await writeEmployeeSheet(ExcelJS, { employees: staff });
  const headersOf = (wb) => wb.getWorksheet('Employees').getRow(1).values.slice(1).map(String);
  assert.deepEqual(headersOf(blank), headersOf(filled));
  assert.deepEqual(headersOf(blank), EMPLOYEE_COLUMNS.map((c) => c.header));
});

test('the header row is found, not assumed, and strange columns are named', () => {
  // Somebody else's export has its own order, its own names and a title line
  // or two above the headers.
  const rows = [
    ['Staff list as at 14 Nov'],
    [],
    ['Sr', 'Emp Code', 'Employee Name', 'Firm', 'Gross', 'Mobile', 'Remarks'],
    ['1', 'E101', 'Nidhi Shah', 'BOOK N FLY', '32,000', '9876500000', 'senior'],
  ];
  const read = readEmployeeSheet(rows);
  assert.equal(read.headerRow, 2);
  assert.equal(read.people.length, 1);
  assert.equal(read.people[0].code, 'E101');
  assert.equal(read.people[0].company, 'BOOK N FLY');
  assert.equal(read.people[0].monthly_salary, 32000, 'the comma and the rupee sign come off');
  assert.equal(read.people[0].phone, '9876500000');
  assert.deepEqual(read.unknown.map((u) => u.label), ['Sr', 'Remarks']);
});

test('a blank cell is not an instruction', () => {
  /*
   * The rule the whole thing rests on. Somebody sends a file with four
   * columns filled in; the twenty they left alone must not wipe twenty
   * fields that are already right.
   */
  const plan = planEmployeeImport({
    people: [{ row: 2, code: 'E101', name: 'Nidhi Shah', company: 'BOOK N FLY', uan: '100200300400' }],
    employees: staff,
    companies: [{ name: 'BOOK N FLY' }],
  });
  assert.equal(plan.update.length, 1);
  assert.deepEqual(plan.update[0].changes.map((c) => c.field), ['uan']);
  assert.equal(plan.salaryMoves, 0, 'the salary was not on the sheet, so it does not move');
});

test('a row finds its person by code first, then by company and name', () => {
  const plan = planEmployeeImport({
    // Different case, different spacing, and the company written another way.
    people: [{ row: 2, code: 'E101', name: 'NIDHI  SHAH', company: 'Book N Fly', monthly_salary: 35000 }],
    employees: staff,
    companies: [{ name: 'BOOK N FLY' }],
  });
  assert.equal(plan.counts.create, 0, 'matched, not duplicated');
  assert.equal(plan.update[0].id, 1);
  assert.equal(plan.salaryMoves, 1, 'and a salary change is counted on its own');
});

test('the same person twice in one file is named, whichever way they are written', () => {
  /*
   * Tracked on BOTH keys, not the one that row happens to use: a row with
   * the code and a row with only the name are the same person, and checking
   * one key let the second row through to silently overwrite the first.
   */
  const plan = planEmployeeImport({
    people: [
      { row: 2, code: 'E101', name: 'Nidhi Shah', company: 'BOOK N FLY', monthly_salary: 35000 },
      { row: 9, name: 'Nidhi Shah', company: 'BOOK N FLY', monthly_salary: 99999 },
    ],
    employees: staff,
    companies: [{ name: 'BOOK N FLY' }],
  });
  assert.equal(plan.update.length, 1);
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0].why, /row 2/);
  assert.equal(plan.update[0].changes[0].to, 35000, 'the first row stands, not the last');
});

test('a new company is named before it is created, and a row without one is refused', () => {
  const plan = planEmployeeImport({
    people: [
      { row: 2, name: 'New Person', company: 'NEW VENTURE LLP', monthly_salary: 21000 },
      { row: 3, name: 'No Firm' },
    ],
    employees: staff,
    companies: [{ name: 'BOOK N FLY' }],
  });
  assert.deepEqual(plan.newCompanies, ['NEW VENTURE LLP']);
  assert.equal(plan.counts.create, 1);
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0].why, /no company/);
});

test('dates read the way people here write them', () => {
  assert.equal(readDate('12/03/1994'), '1994-03-12', 'day first');
  assert.equal(readDate('25/12/1990'), '1990-12-25');
  assert.equal(readDate('1994-03-12'), '1994-03-12');
  // Excel's own day count, not a year.
  assert.equal(readDate(34700), '1995-01-01');
  /*
   * A two-digit year pivots at 50: "94" is a birth year, "26" is a joining
   * date. Adding 2000 to everything put a man born in 1994 into 2094, which
   * reads as a typo nobody questions until the gratuity sum.
   */
  assert.equal(readDate('3-12-94'), '1994-12-03');
  assert.equal(readDate('1-4-26'), '2026-04-01');
  assert.equal(readDate(''), '');
  assert.equal(readDate('not a date'), '');
});
