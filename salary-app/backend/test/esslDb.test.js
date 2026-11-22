import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ESSL_FILE_KIND,
  asEsslPull,
  esslDate,
  esslTime,
  esslSheets,
  esslSummary,
  isEsslPull,
} from '../../shared/esslDb.js';
import { daysWithoutData, thinDays, monthlyStatusToMarks } from '../../shared/monthlyStatus.js';

const pull = (rows) => ({ kind: ESSL_FILE_KIND, version: 1, source: 'E:\\Essl\\x.mdb', rows });
const row = (over = {}) => ({
  company: 'BNF',
  code: '101',
  name: 'AMIT SHAH',
  date: '2026-11-03',
  status: 'P',
  in: '2026-11-03 09:28:00',
  out: '2026-11-03 18:40:00',
  ...over,
});

/* ---------------- the sentinel ---------------- */

test("Access's 1900 date is nothing recorded, not a punch", () => {
  assert.equal(esslTime('1900-01-01 00:00:00'), '');
  assert.equal(esslTime('1899-12-30 00:00:00'), '');
  assert.equal(esslTime(''), '');
  assert.equal(esslTime(null), '');
});

test('a real time comes back as HH:MM', () => {
  assert.equal(esslTime('2026-11-03 09:28:00'), '09:28');
  assert.equal(esslTime('2026-11-03 18:40:00'), '18:40');
  assert.equal(esslTime('09:28'), '09:28');
});

test('midnight is read as nothing recorded', () => {
  // The sentinel catches most of these, but a row carrying the real date with
  // a midnight time means the same thing, and inventing a day that ended at
  // 00:00 is worse than saying it is not known.
  assert.equal(esslTime('2026-11-03 00:00:00'), '');
});

test('a dd/MM/yyyy date is read the way the machine prints it', () => {
  assert.deepEqual(esslDate('03/11/2026'), { year: 2026, month: 11, day: 3 });
  assert.deepEqual(esslDate('2026-11-03'), { year: 2026, month: 11, day: 3 });
  assert.equal(esslDate('rubbish'), null);
});

/* ---------------- the shape ---------------- */

test('a stray JSON file is not a pull', () => {
  assert.equal(isEsslPull({ rows: [] }), false);
  assert.equal(isEsslPull({ kind: ESSL_FILE_KIND }), false);
  assert.equal(isEsslPull(pull([])), true);
  assert.deepEqual(esslSheets({ anything: true }), []);
});

test('one sheet per company', () => {
  const sheets = esslSheets(pull([row(), row({ company: 'SCALE', code: '202', name: 'RIYA' })]));
  assert.deepEqual(
    sheets.map((s) => s.company).sort(),
    ['BNF', 'SCALE']
  );
});

test('a pull crossing the 1st comes out as two sheets, not one thrown away', () => {
  // monthlyStatusToMarks drops a sheet whose month is not the period's, so a
  // single sheet spanning two months would lose the lot.
  const sheets = esslSheets(
    pull([row({ date: '2026-10-31' }), row({ date: '2026-11-01' })])
  );
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets.map((s) => s.month).sort(), [10, 11]);
});

test("the machine's own codes are carried through, not translated here", () => {
  // WOP must survive as WOP so DEFAULT_MARK_MAP can turn it into SP, which is
  // what the Sunday register pays from. Translating twice is how it stops.
  const [sheet] = esslSheets(pull([row({ status: 'wop' })]));
  assert.equal(sheet.people[0].marks[3], 'WOP');
});

test('an in time with no out time leaves the out blank, never guessed', () => {
  const [sheet] = esslSheets(pull([row({ out: '1900-01-01 00:00:00' })]));
  assert.deepEqual(sheet.people[0].times[3], { in: '09:28', out: '' });
});

test('a day with no times at all carries no times entry', () => {
  const [sheet] = esslSheets(
    pull([row({ status: 'A', in: '1900-01-01 00:00:00', out: '1900-01-01 00:00:00' })])
  );
  assert.equal(sheet.people[0].times[3], undefined);
  assert.equal(sheet.people[0].marks[3], 'A');
});

test('a row with no date or no status is skipped, not half-read', () => {
  const sheets = esslSheets(pull([row({ date: '' }), row({ status: '' })]));
  assert.deepEqual(sheets, []);
});

/* ---------------- the rules it exists to reuse ---------------- */

test('a day the machine has nothing for is not a day everybody was absent', () => {
  // The October file read A for all 114 people from the 23rd because the
  // device stopped syncing on the 22nd. 912 absences nobody earned.
  const rows = [];
  for (const day of [3, 4]) {
    for (const code of ['101', '102', '103']) {
      rows.push(row({ code, name: `P${code}`, date: `2026-11-0${day}` }));
    }
  }
  for (const code of ['101', '102', '103']) {
    rows.push(
      row({
        code,
        name: `P${code}`,
        date: '2026-11-05',
        status: 'A',
        in: '1900-01-01 00:00:00',
        out: '1900-01-01 00:00:00',
      })
    );
  }
  const sheets = esslSheets(pull(rows));
  assert.deepEqual(daysWithoutData(sheets), [5]);
});

test('a day where attendance collapses without disappearing is named', () => {
  // thinDays needs a few days carrying an absence before it can say what the
  // month's usual share is - one odd day on its own is not a pattern.
  const people = Array.from({ length: 20 }, (_, i) => String(100 + i));
  const rows = [];
  const mark = (code, day, present) =>
    row({
      code,
      name: `P${code}`,
      date: `2026-11-0${day}`,
      status: present ? 'P' : 'A',
      in: present ? `2026-11-0${day} 09:28:00` : '1900-01-01 00:00:00',
      out: present ? `2026-11-0${day} 18:40:00` : '1900-01-01 00:00:00',
    });

  // Ordinary days: one person off, the rest in.
  for (const day of [3, 4, 6, 7]) {
    people.forEach((code, i) => rows.push(mark(code, day, i > 0)));
  }
  // The 5th: two people read, the other eighteen read as absent - a device
  // that synced one reader. Writing it through books 18 absences nobody
  // earned.
  people.forEach((code, i) => rows.push(mark(code, 5, i < 2)));

  const thin = thinDays(esslSheets(pull(rows)));
  const named = thin.map((d) => (typeof d === 'number' ? d : d.day));
  assert.deepEqual(named, [5], `only the 5th should be named: ${JSON.stringify(thin)}`);
});

test('it reaches attendance entries through the same door as the file import', () => {
  const sheets = esslSheets(
    pull([
      row({ date: '2026-11-03' }),
      row({ date: '2026-11-04', status: 'WOP' }),
      row({ date: '2026-11-05' }),
    ])
  );
  const result = monthlyStatusToMarks({
    sheets,
    employees: [{ id: 7, name: 'AMIT SHAH', code: '101', active: 1 }],
    period: { month: 11, year: 2026, hours_per_day: 9 },
  });
  const byDay = Object.fromEntries(result.entries.map((e) => [e.day, e]));
  assert.equal(byDay[3].code, 'P');
  assert.equal(byDay[4].code, 'SP', 'WOP must reach the Sunday register as SP');
  assert.equal(byDay[3].employee_id, 7);
  assert.equal(byDay[3].in_time, '09:28');
  assert.equal(byDay[3].out_time, '18:40');
});

test('somebody the machine knows and the staff list does not is named, not invented', () => {
  const result = monthlyStatusToMarks({
    sheets: esslSheets(pull([row({ code: '999', name: 'NOBODY HERE' })])),
    employees: [{ id: 7, name: 'AMIT SHAH', code: '101', active: 1 }],
    period: { month: 11, year: 2026, hours_per_day: 9 },
  });
  assert.equal(result.entries.length, 0);
  assert.ok(result.unmatched.length >= 1);
});

test('the summary says where it came from and what is in it', () => {
  const summary = esslSummary(pull([row(), row({ code: '202', name: 'RIYA', company: 'SCALE' })]));
  assert.equal(summary.rows, 2);
  assert.equal(summary.people, 2);
  assert.deepEqual(summary.companies.sort(), ['BNF', 'SCALE']);
  assert.equal(summary.source, 'E:\\Essl\\x.mdb');
  assert.equal(esslSummary({}), null);
});

/* ---------------- telling the two files apart ---------------- */

test('a legacy .xls is not decoded looking for JSON', () => {
  // The other file arriving at this route is a megabyte or two of binary. The
  // first non-blank byte decides, before anything is decoded.
  const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(asEsslPull(xls), null);
});

test('a pull is recognised as bytes, as a string and as an object', () => {
  const file = pull([row()]);
  const json = JSON.stringify(file);
  assert.ok(asEsslPull(json));
  assert.ok(asEsslPull(new TextEncoder().encode(json)));
  assert.ok(asEsslPull(file));
  // A BOM in front of it, which is what Set-Content -Encoding UTF8 writes.
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(json)]);
  assert.ok(asEsslPull(bom), 'a BOM must not hide the pull');
});

test('other JSON is not a pull', () => {
  assert.equal(asEsslPull('{"kind":"something-else","rows":[]}'), null);
  assert.equal(asEsslPull('not json at all'), null);
  assert.equal(asEsslPull('{'), null);
  assert.equal(asEsslPull(''), null);
  assert.equal(asEsslPull(null), null);
});
