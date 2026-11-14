import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MARK_MAP,
  daysWithoutData,
  monthlyStatusToMarks,
  isLegacyXls,
  readMonthlyStatus,
  readSheet,
  thinDays,
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

/* ------------------------------------------------------------------ *
 * The Basic Work Duration export: the same machine, printed the other *
 * way round - one BLOCK of four rows per person, with the clock times *
 * the grid report does not carry.                                     *
 * ------------------------------------------------------------------ */

/**
 * The day columns in the real export are NOT contiguous - some days are
 * merged across two columns and the reader leaves the second blank. The gaps
 * here are deliberate, because reading the days row by position instead of by
 * its own headers is exactly the bug this shape invites.
 */
function blockSheet({ company = 'BNF', month = 'Nov', year = 2026, lastDay = 14, people }) {
  const days = Array.from({ length: lastDay }, (_, i) => i + 1);
  const columns = {};
  let c = 2;
  for (const d of days) {
    columns[d] = c;
    c += d % 5 === 2 ? 2 : 1; // a blank column after every few days
  }
  const width = c;
  const line = (label, pick) => {
    const row = new Array(width).fill('');
    row[0] = label;
    for (const d of days) row[columns[d]] = pick(d) ?? '';
    return row;
  };
  const header = new Array(width).fill('');
  header[0] = 'Days';
  for (const d of days) header[columns[d]] = `${d} ${'SMTWThFSt'.slice(0, 1)}`;

  const rows = [
    ['', 'Monthly Status Report'],
    [''],
    ['', `${month} 01 ${year}  To  ${month} ${lastDay} ${year}`],
    ['Company:', '', '', '', company, '', 'Printed On : Nov 14 2026 12:03'],
    [''],
    [''],
    header,
    [''],
    ['Department:', '', '', 'Default'],
  ];
  for (const p of people) {
    const head = new Array(width).fill('');
    head[0] = 'Emp. Code:';
    head[3] = p.code;
    head[8] = 'Emp. Name:';
    head[13] = p.name;
    rows.push([''], head);
    rows.push(line('Status', (d) => p.marks[d]));
    rows.push(line('InTime', (d) => p.times?.[d]?.[0]));
    rows.push(line('OutTime', (d) => p.times?.[d]?.[1]));
    rows.push(line('Total', (d) => p.total?.[d] ?? '00:00'));
  }
  return { name: 'Sheet1', rows };
}

const novPeriod = { year: 2026, month: 11 };

test('the four-row-per-person export is read as the same report', () => {
  const read = readSheet(
    'Sheet1',
    blockSheet({
      people: [
        {
          code: '3',
          name: 'AJEET UPADHYAY',
          marks: { 1: 'WO', 2: 'P', 3: 'P', 8: 'WOP', 9: 'A' },
          times: { 2: ['13:21', '16:19'], 3: ['15:33', '19:39'], 8: ['13:12', ''] },
        },
      ],
    }).rows,
  );

  assert.equal(read.error, undefined);
  assert.equal(read.company, 'BNF');
  assert.equal(read.month, 11);
  assert.equal(read.year, 2026);
  assert.equal(read.days.length, 14);
  assert.equal(read.people.length, 1);

  const p = read.people[0];
  assert.equal(p.code, '3');
  assert.equal(p.name, 'AJEET UPADHYAY');
  assert.equal(p.marks[1], 'WO');
  assert.equal(p.marks[8], 'WOP');
  assert.deepEqual(p.times[2], { in: '13:21', out: '16:19' });
  assert.deepEqual(p.times[3], { in: '15:33', out: '19:39' });
});

test('a blank out time is never filled in from the machine total', () => {
  /*
   * 105 days in Dinesh's real November file have an in time, no out time, and
   * a Total the machine worked out to some cut-off of its own: 13:12 in with
   * a total of 9:48 implies 23:00, which nobody punched. Taking that would
   * put a leaving time on the record that never happened and pay the hours.
   */
  const read = readSheet(
    'Sheet1',
    blockSheet({
      people: [{
        code: '3', name: 'AJEET UPADHYAY',
        marks: { 8: 'WOP' },
        times: { 8: ['13:12', ''] },
        total: { 8: '9:48' },
      }],
    }).rows,
  );
  assert.deepEqual(read.people[0].times[8], { in: '13:12', out: '' });
});

test('the clock times ride onto the attendance entries', () => {
  const sheets = [
    readSheet('Sheet1', blockSheet({
      people: [{
        code: '3', name: 'AJEET UPADHYAY',
        marks: { 2: 'P', 3: 'P', 8: 'WOP' },
        times: { 2: ['09:07', '18:35'], 8: ['11:20', ''] },
      }],
    }).rows),
  ];
  const out = monthlyStatusToMarks({ sheets, employees, period: novPeriod });

  const day2 = out.entries.find((e) => e.day === 2);
  assert.equal(day2.code, 'P');
  assert.equal(day2.in_time, '09:07');
  assert.equal(day2.out_time, '18:35');

  // Worked the weekly off, so SP - which is what the Sunday register pays
  // from. Reading WOP as plain presence would stop that person being paid.
  const day8 = out.entries.find((e) => e.day === 8);
  assert.equal(day8.code, 'SP');
  assert.equal(day8.in_time, '11:20');
  /*
   * Sent as '' rather than left out. setAttendance only touches a column the
   * entry NAMES, so omitting it would leave an out time from an earlier
   * import sitting there and pay hours nobody worked. '' says "the machine
   * saw no punch out", which is the truth.
   */
  assert.equal(day8.out_time, '');

  // A day with no times at all names neither column.
  const day3 = out.entries.find((e) => e.day === 3);
  assert.equal('in_time' in day3, false);
  assert.equal('out_time' in day3, false);

  assert.equal(out.withTimes, 2);
});

test('a day where attendance collapses is named, and a Sunday off is not', () => {
  /*
   * The partial version of the no-data trap. In the real November file the
   * 10th and 11th read 22 and 23 present against about 75 on every other day
   * - a festival, or a reader that did not sync. Writing it through books 183
   * absences nobody earned.
   *
   * Day 1 here is the weekly off: 9 of 10 people have WO and the tenth worked
   * it. That is a fully known day off and must NOT be flagged.
   */
  const people = Array.from({ length: 10 }, (_, i) => {
    const marks = {};
    for (let d = 1; d <= 14; d += 1) {
      if (d === 1) marks[d] = i === 0 ? 'WOP' : 'WO';
      else if (d === 10) marks[d] = i === 0 ? 'P' : 'A';   // one person in
      else marks[d] = i < 7 ? 'P' : 'A';                    // seven of ten, usually
    }
    return { code: String(i + 1), name: `PERSON ${i + 1}`, marks };
  });
  const sheets = [readSheet('Sheet1', blockSheet({ people }).rows)];

  // Nothing is MISSING - somebody is present on every day, the 10th included.
  assert.deepEqual(daysWithoutData(sheets), []);

  const thin = thinDays(sheets);
  assert.deepEqual(thin.map((t) => t.day), [10]);
  assert.equal(thin[0].present, 1);
  assert.equal(thin[0].absent, 9);

  // And it is NAMED, not skipped: the marks for the 10th are still written,
  // because treating a quiet day as missing would be its own guess.
  const out = monthlyStatusToMarks({ sheets, employees: people.map((p, i) => ({
    id: i + 1, name: p.name, code: p.code, active: 1,
  })), period: novPeriod });
  assert.deepEqual(out.skippedDays, []);
  assert.equal(out.thinDays.length, 1);
  assert.equal(out.entries.filter((e) => e.day === 10).length, 10);
});

test('an ordinary month flags no thin days at all', () => {
  const people = Array.from({ length: 10 }, (_, i) => {
    const marks = {};
    for (let d = 1; d <= 14; d += 1) marks[d] = d === 1 ? 'WO' : i < 8 ? 'P' : 'A';
    return { code: String(i + 1), name: `PERSON ${i + 1}`, marks };
  });
  assert.deepEqual(thinDays([readSheet('Sheet1', blockSheet({ people }).rows)]), []);
});

test('the one-row-per-person export is still read as a grid', () => {
  // The dispatch must not drag the old shape down the new path.
  const read = readSheet('Sheet1', sheet({
    people: [{ code: '3', name: 'AJEET UPADHYAY', marks: normalMonth() }],
  }).rows);
  assert.equal(read.days.length, 31);
  assert.equal(read.people[0].marks[4], 'WO');
  assert.equal(read.people[0].times, undefined);
});
