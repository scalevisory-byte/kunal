import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MARK_MAP,
  daysWithoutData,
  monthlyStatusToMarks,
  isLegacyXls,
  readMonthlyStatus,
  readSheet,
} from '../../shared/monthlyStatus.js';

/* A sheet shaped exactly like the machine's Monthly Status (Basic) export. */
const dayHeaders = (days) => days.map((d) => `${d} ${'ThFStSMTW'.slice(d % 7, (d % 7) + 2)}`);

function sheet({ company = 'BNF', month = 'Oct', year = 2026, people }) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return {
    name: 'Sheet1',
    rows: [
      ['', 'Monthly Status'],
      ['', `${month} 01 ${year}  To  ${month} 31 ${year}`],
      ['Company:', '', '', company, '', '', 'Printed On : Oct 31 2026 16:14'],
      ['Department', '', '', '', '', 'Default'],
      ['Sl', '', 'Emp. Code', '', 'Name', '', ...dayHeaders(days)],
      ...people.map((p, i) => [
        String(i + 1), '', p.code, '', p.name, '',
        ...days.map((d) => p.marks[d] ?? ''),
      ]),
    ],
  };
}

const everyDay = (mark) => Object.fromEntries(Array.from({ length: 31 }, (_, i) => [i + 1, mark]));

/** Present all month, except the Sundays, which are the weekly off. */
const normalMonth = (overrides = {}) => {
  const marks = {};
  for (let d = 1; d <= 31; d += 1) marks[d] = [4, 11, 18, 25].includes(d) ? 'WO' : 'P';
  return { ...marks, ...overrides };
};

const period = { year: 2026, month: 10 };
const employees = [
  { id: 1, name: 'AJEET UPADHYAY', code: '3', active: 1 },
  { id: 2, name: 'ROHIT TAYADE', code: '12', active: 1 },
  { id: 3, name: 'NEHA YADAV', code: '24', active: 1 },
];

test('the sheet is read off its own header, not an assumed layout', () => {
  const read = readSheet('Sheet1', sheet({
    people: [{ code: '3', name: 'AJEET UPADHYAY', marks: normalMonth() }],
  }).rows);
  assert.equal(read.company, 'BNF');
  assert.equal(read.month, 10);
  assert.equal(read.year, 2026);
  assert.equal(read.days.length, 31);
  assert.equal(read.people.length, 1);
  assert.equal(read.people[0].code, '3');
  assert.equal(read.people[0].marks[4], 'WO');
});

test('WO is the weekly off and WOP is somebody who worked it', () => {
  // Getting this pair wrong is what stops a Sunday being paid: WOP has to
  // become SP, which is what the Sunday register pays from.
  assert.equal(DEFAULT_MARK_MAP.WO, 'S');
  assert.equal(DEFAULT_MARK_MAP.WOP, 'SP');
  assert.equal(DEFAULT_MARK_MAP.HP, 'HP');

  const sheets = readMonthlyStatus([
    sheet({ people: [{ code: '3', name: 'AJEET UPADHYAY', marks: normalMonth({ 11: 'WOP' }) }] }),
  ]);
  const { entries } = monthlyStatusToMarks({ sheets, employees, period });
  assert.equal(entries.find((e) => e.day === 11).code, 'SP');
  assert.equal(entries.find((e) => e.day === 4).code, 'S');
});

test('a day the machine has no record of is not everybody being absent', () => {
  // Dinesh's real October export: the device stopped on the 22nd and every
  // one of 114 people reads A from the 23rd on.
  const stopped = (marks) => {
    const out = { ...marks };
    for (let d = 23; d <= 31; d += 1) out[d] = d === 25 ? 'WO' : 'A';
    return out;
  };
  const sheets = readMonthlyStatus([
    sheet({
      people: [
        { code: '3', name: 'AJEET UPADHYAY', marks: stopped(normalMonth()) },
        { code: '12', name: 'ROHIT TAYADE', marks: stopped(normalMonth()) },
      ],
    }),
  ]);

  // The 25th is a Sunday carrying WO and no absence at all, so it is a known
  // day off rather than a gap, and it still gets marked.
  assert.deepEqual(daysWithoutData(sheets), [23, 24, 26, 27, 28, 29, 30, 31]);

  const safe = monthlyStatusToMarks({ sheets, employees, period });
  assert.deepEqual(safe.skippedDays, [23, 24, 26, 27, 28, 29, 30, 31]);
  assert.ok(!safe.entries.some((e) => e.day >= 23 && e.day !== 25), 'a no-data day was written through');
  assert.equal(safe.entries.find((e) => e.day === 25).code, 'S');
  // Not one absence survives, because not one of them was real.
  assert.equal(safe.tally.A ?? 0, 0);

  // It can still be forced, but it has to be asked for - and then it is 16
  // absences across two people where there were none.
  const forced = monthlyStatusToMarks({ sheets, employees, period, includeEmptyDays: true });
  assert.deepEqual(forced.skippedDays, []);
  assert.equal(forced.tally.A, 16);
});

test('a real absence on a day the machine was working is still an absence', () => {
  const sheets = readMonthlyStatus([
    sheet({
      people: [
        { code: '3', name: 'AJEET UPADHYAY', marks: normalMonth({ 7: 'A', 8: 'A' }) },
        { code: '12', name: 'ROHIT TAYADE', marks: normalMonth() },
      ],
    }),
  ]);
  assert.deepEqual(daysWithoutData(sheets), []);
  const { tally, entries } = monthlyStatusToMarks({ sheets, employees, period });
  assert.equal(tally.A, 2);
  assert.ok(entries.some((e) => e.employee_id === 1 && e.day === 7 && e.code === 'A'));
});

test('somebody absent every single day is named, not silently docked', () => {
  const sheets = readMonthlyStatus([
    sheet({
      people: [
        { code: '3', name: 'AJEET UPADHYAY', marks: normalMonth() },
        { code: '24', name: 'NEHA YADAV', marks: everyDay('A') },
      ],
    }),
  ]);
  const { neverPresent } = monthlyStatusToMarks({ sheets, employees, period });
  assert.equal(neverPresent.length, 1);
  assert.equal(neverPresent[0].name, 'NEHA YADAV');
  assert.ok(neverPresent[0].days > 25, 'should count the whole month');
});

test('people are matched on the machine code first, then the name', () => {
  const sheets = readMonthlyStatus([
    sheet({
      people: [
        { code: '12', name: 'R. TAYADE', marks: normalMonth() },   // code matches, name does not
        { code: '', name: 'AJEET UPADHYAY', marks: normalMonth() }, // no code, name matches
        { code: '999', name: 'SOMEBODY ELSE', marks: normalMonth() },
      ],
    }),
  ]);
  const { matched, unmatched } = monthlyStatusToMarks({ sheets, employees, period });
  assert.deepEqual(matched.map((m) => m.id).sort(), [1, 2]);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].name, 'SOMEBODY ELSE');
  assert.equal(unmatched[0].company, 'BNF');
});

test('a sheet for another month is not this month attendance', () => {
  const sheets = readMonthlyStatus([
    sheet({ month: 'Sep', people: [{ code: '3', name: 'AJEET UPADHYAY', marks: normalMonth() }] }),
  ]);
  const { entries, matched } = monthlyStatusToMarks({ sheets, employees, period });
  assert.equal(entries.length, 0);
  assert.equal(matched.length, 0);
});

test('only filling the blanks leaves a mark somebody typed alone', () => {
  const sheets = readMonthlyStatus([
    sheet({
      people: [
        { code: '3', name: 'AJEET UPADHYAY', marks: normalMonth({ 7: 'A' }) },
        // Somebody turned up on the 7th, so it is a day with data on it.
        { code: '12', name: 'ROHIT TAYADE', marks: normalMonth() },
      ],
    }),
  ]);
  const existing = { '1:7': 'CL' };   // somebody already recorded casual leave
  const careful = monthlyStatusToMarks({ sheets, employees, period, onlyBlank: true, existing });
  assert.ok(!careful.entries.some((e) => e.employee_id === 1 && e.day === 7));
  assert.equal(careful.skippedExisting, 1);
  // The colleague's blank 7th is still filled in - only the typed mark is left.
  assert.ok(careful.entries.some((e) => e.employee_id === 2 && e.day === 7));

  const overwrite = monthlyStatusToMarks({ sheets, employees, period, existing });
  assert.equal(overwrite.entries.find((e) => e.employee_id === 1 && e.day === 7).code, 'A');
});

test('a mark the machine uses and we do not is counted, never guessed', () => {
  const sheets = readMonthlyStatus([
    sheet({ people: [{ code: '3', name: 'AJEET UPADHYAY', marks: normalMonth({ 7: 'XX', 8: 'XX' }) }] }),
  ]);
  const { unknownMarks, entries } = monthlyStatusToMarks({ sheets, employees, period });
  assert.deepEqual(unknownMarks, [{ mark: 'XX', rows: 2 }]);
  assert.ok(!entries.some((e) => e.day === 7));
});

test('each company sheet is read on its own', () => {
  const two = readMonthlyStatus([
    sheet({ company: 'BNF', people: [{ code: '3', name: 'AJEET UPADHYAY', marks: normalMonth() }] }),
    { ...sheet({ company: 'SCALE', people: [{ code: '12', name: 'ROHIT TAYADE', marks: normalMonth() }] }), name: 'Sheet2' },
  ]);
  const { companies, matched } = monthlyStatusToMarks({ sheets: two, employees, period });
  assert.deepEqual(companies.map((c) => c.company), ['BNF', 'SCALE']);
  assert.equal(matched.length, 2);
});

test('a sheet with no grid in it says so instead of throwing', () => {
  const [bad] = readMonthlyStatus([{ name: 'Notes', rows: [['just some text'], ['and more']] }]);
  assert.match(bad.error, /no day-by-day grid/);
  const out = monthlyStatusToMarks({ sheets: [bad], employees, period });
  assert.equal(out.entries.length, 0);
  assert.equal(out.sheetErrors.length, 1);
});

test('a legacy .xls is recognised, because ExcelJS cannot open one', () => {
  assert.ok(isLegacyXls(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])));
  assert.ok(!isLegacyXls(Buffer.from('PK\u0003\u0004and then a zip')));
  assert.ok(!isLegacyXls(Buffer.from([1, 2])));
});

test('a merged "Company:" label does not get read as the company name', () => {
  // ExcelJS repeats a merged cell's value across every cell it covers, so the
  // first non-empty cell after the label is the label again. SheetJS leaves
  // the repeats blank. The same code has to cope with both.
  const merged = {
    name: 'Sheet1',
    rows: [
      ['', 'Monthly Status Report (Basic Report)', 'Monthly Status Report (Basic Report)'],
      ['', 'Oct 01 2026  To  Oct 31 2026', 'Oct 01 2026  To  Oct 31 2026'],
      ['Company:', 'Company:', 'Company:', 'BNF', 'BNF', 'BNF'],
      ['Sl', '', 'Emp. Code', '', 'Name', '', ...Array.from({ length: 31 }, (_, i) => `${i + 1} Th`)],
      ['1', '', '3', '', 'AJEET UPADHYAY', '', ...Array.from({ length: 31 }, () => 'P')],
    ],
  };
  const read = readSheet(merged.name, merged.rows);
  assert.equal(read.company, 'BNF');
  assert.equal(read.month, 10);
  assert.equal(read.people.length, 1);
});
