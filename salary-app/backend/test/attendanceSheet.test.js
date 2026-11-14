/**
 * The month's register as a spreadsheet.
 *
 * Dinesh asked for "attendance ka simple excel" after the staff master got
 * one. The two importers beside it read what a biometric machine produces,
 * in the machine's own shape; this is for an office that keeps the register
 * on paper or in its own sheet and types it up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  planAttendanceImport,
  readAttendanceSheet,
  writeAttendanceSheet,
} from '../../shared/attendanceSheet.js';

const period = { id: 1, year: 2026, month: 11, label: 'November 2026' };
const employees = [
  { id: 1, code: 'E101', name: 'Nidhi Shah', company_name: 'BOOK N FLY', active: 1 },
  { id: 2, code: 'E102', name: 'Rahul Patel', company_name: 'BOOK N FLY', active: 1 },
];

const rowsOf = (ws) => {
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, index) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      values[column - 1] = cell.value;
    });
    rows[index - 1] = values;
  });
  return rows;
};

test('the grid goes out with the weekday under every day, and reads back', async () => {
  /*
   * Two header rows on purpose: the day number, and the weekday under it.
   * Typing a month without knowing which column is Sunday is how a whole
   * row ends up one day out, and nobody notices until the Sunday register.
   */
  const wb = await writeAttendanceSheet(ExcelJS, {
    period,
    people: [{ code: 'E101', name: 'Nidhi Shah', company: 'BOOK N FLY', marks: { 1: 'S', 2: 'P' } }],
  });
  const ws = wb.worksheets[0];
  assert.equal(ws.getRow(1).getCell(4).value, '1');
  assert.equal(ws.getRow(2).getCell(4).value, 'Sun', '1 November 2026 is a Sunday');
  assert.equal(ws.getRow(1).getCell(33).value, '30', 'November has 30 days');
  assert.ok(wb.getWorksheet('Marks'), 'the legend travels with the file');

  const buffer = await wb.xlsx.writeBuffer();
  const again = new ExcelJS.Workbook();
  await again.xlsx.load(buffer);
  const read = readAttendanceSheet(rowsOf(again.worksheets[0]));
  assert.equal(read.error, undefined);
  assert.equal(read.people.length, 1, 'the weekday row is not read as a person');
  assert.equal(read.people[0].marks[1], 'S');
  assert.equal(read.people[0].marks[2], 'P');
});

test('a blank cell leaves that day alone', () => {
  /*
   * The rule the whole thing rests on. Somebody fills in the exceptions and
   * leaves the rest; those blanks must not clear a month already marked.
   * Clearing a day is done on the grid in the app, one day at a time, where
   * it can be seen.
   */
  const plan = planAttendanceImport({
    people: [{ row: 3, code: 'E101', name: 'Nidhi Shah', marks: { 3: 'CL', 4: '', 5: '   ' } }],
    employees,
    period,
    existing: { '1:4': 'P', '1:5': 'P' },
  });
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].code, 'CL');
  assert.deepEqual(plan.unknownMarks, [], 'a blank is nothing to say, not a mark we failed to recognise');
});

test('filling a blank and changing a mark are counted apart', () => {
  /*
   * Typing up the register is filling blanks. Changing a P to an A is a
   * day's pay off somebody, and it must not arrive as one row among two
   * thousand - so it is counted on its own and named.
   */
  const plan = planAttendanceImport({
    people: [{ row: 3, code: 'E101', name: 'Nidhi Shah', marks: { 2: 'P', 3: 'A', 6: 'CL' } }],
    employees,
    period,
    existing: { '1:2': 'P', '1:3': 'P' },
  });
  assert.equal(plan.counts.fills, 1, 'day 6 was blank');
  assert.equal(plan.counts.changes, 1, 'day 3 was P and becomes A');
  assert.deepEqual(plan.changes, [{ id: 1, name: 'Nidhi Shah', day: 3, from: 'P', to: 'A' }]);
  // Day 2 already says P, so there is nothing to write for it at all.
  assert.equal(plan.entries.length, 2);
});

test('a mark the app does not know is named, never guessed', () => {
  const plan = planAttendanceImport({
    people: [{ row: 3, code: 'E101', name: 'Nidhi Shah', marks: { 2: 'ZZ', 3: 'P' } }],
    employees,
    period,
  });
  assert.deepEqual(plan.unknownMarks, [{ mark: 'ZZ', rows: 1 }]);
  assert.equal(plan.entries.length, 1, 'the rest of the row still goes in');
});

test('a row finds its person by code, then company and name, then the name alone', () => {
  const plan = planAttendanceImport({
    people: [
      { row: 3, code: 'E101', name: 'WRONG NAME', marks: { 2: 'P' } },
      { row: 4, name: 'rahul  patel', company: 'book n fly', marks: { 2: 'P' } },
      { row: 5, name: 'Ghost Person', marks: { 2: 'P' } },
    ],
    employees,
    period,
  });
  assert.equal(plan.matched.length, 2);
  assert.equal(plan.matched[0].id, 1, 'the code wins over the name on the sheet');
  assert.equal(plan.matched[1].id, 2, 'case and spacing do not matter');
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.unmatched[0].name, 'Ghost Person');
});

test('a day outside the month is dropped', () => {
  // A sheet kept from a 31-day month, used for November.
  const plan = planAttendanceImport({
    people: [{ row: 3, code: 'E101', name: 'Nidhi Shah', marks: { 30: 'P', 31: 'P' } }],
    employees,
    period,
  });
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].day, 30);
});
