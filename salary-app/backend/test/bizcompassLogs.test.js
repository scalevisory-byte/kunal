/**
 * Reading the Bizcompass Sync Tool's punch spool.
 *
 * The format is fixed by another company's product, so these pin what was
 * actually observed in Dinesh's own folder rather than what the format ought
 * to be: five tab-separated fields, a dd-mm-yyyy timestamp, the direction
 * field always 0, and no name anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUNCH_MAPPING,
  coverage,
  normalId,
  parseLogText,
  punchDate,
  punchRows,
  readLogFiles,
  logFileDate,
  fileCouldMatter,
  protectDecided,
} from '../../shared/bizcompassLogs.js';
import { punchesToMarks } from '../../shared/punches.js';

const G1 = '17c5b74f-8de9-4840-b565-9fcc32280df3';
const G2 = '87b302c5-0293-49d0-9b0e-44dd67401b57';
const line = (user, when, device = G1) => `${user}\t${when}\t255\t${device}\t0`;

const staff = [
  { id: 1, name: 'AMIT SHAH', code: 'E101', device_code: '37', active: 1 },
  { id: 2, name: 'RIYA PAL', code: 'E102', device_code: '114', active: 1 },
  { id: 3, name: 'KIRAN DESAI', code: '126', active: 1 },
];

/* ---------------- the format ---------------- */

test('a line is read exactly as the tool writes it', () => {
  const { punches, skipped } = parseLogText(line('37', '22-11-2026 15:24:39'));
  assert.equal(skipped, 0);
  assert.deepEqual(punches[0].user, '37');
  assert.equal(punches[0].when, '22-11-2026 15:24:39');
  assert.equal(punches[0].device, G1);
});

test('a torn or short line is counted and dropped, never half-read', () => {
  // These files are written by another program while we read them, so the
  // last line of one can be incomplete. That must not take an import down.
  const raw = [line('37', '22-11-2026 15:24:39'), '114\t22-11-20', 'rubbish', '', '46'].join('\n');
  const { punches, skipped } = parseLogText(raw);
  assert.equal(punches.length, 1);
  assert.equal(skipped, 3);
});

test('a blank line is not a skipped line', () => {
  const { punches, skipped } = parseLogText(`\n\n${line('37', '01-11-2026 09:30:00')}\n\n`);
  assert.equal(punches.length, 1);
  assert.equal(skipped, 0);
});

test('the date is read the way the tool writes it, day first', () => {
  assert.deepEqual(punchDate('03-11-2026 09:28:00'), { day: 3, month: 11, year: 2026 });
  assert.equal(punchDate('nonsense'), null);
});

test('a user number is compared without its leading zeros', () => {
  assert.equal(normalId('037'), '37');
  assert.equal(normalId(37), '37');
  assert.equal(normalId(' 37 '), '37');
});

test('several files read as one stream, and the readers are named', () => {
  const got = readLogFiles([
    { name: 'a.dat', text: line('37', '20-11-2026 09:14:00', G1) },
    { name: 'b.dat', text: [line('114', '20-11-2026 09:20:00', G2), line('37', '20-11-2026 18:12:00', G1)].join('\n') },
  ]);
  assert.equal(got.punches.length, 3);
  assert.equal(got.files, 2);
  assert.deepEqual(got.devices.sort(), [G1, G2].sort());
});

/* ---------------- what is in the spool ---------------- */

test('coverage says which days are there and how many people each carries', () => {
  const { punches } = parseLogText(
    [
      line('37', '20-11-2026 09:14:00'),
      line('37', '20-11-2026 18:12:00'),
      line('114', '20-11-2026 09:20:00'),
      line('37', '21-11-2026 09:02:00'),
    ].join('\n')
  );
  const cov = coverage(punches, { month: 11, year: 2026 });
  assert.equal(cov.days.length, 2);
  assert.deepEqual(
    cov.days.map((d) => [d.day, d.punches, d.people]),
    [
      [20, 3, 2],
      [21, 1, 1],
    ]
  );
  assert.equal(cov.first.day, 20);
  assert.equal(cov.last.day, 21);
});

test('punches from another month are counted apart, not silently dropped', () => {
  const { punches } = parseLogText(
    [line('37', '31-10-2026 09:14:00'), line('37', '01-11-2026 09:14:00')].join('\n')
  );
  const cov = coverage(punches, { month: 11, year: 2026 });
  assert.equal(cov.days.length, 1);
  assert.equal(cov.outside, 1);
});

/* ---------------- who the numbers are ---------------- */

test('the reader number matches device_code, and the office code is the fallback', () => {
  const { punches } = parseLogText(
    [
      line('37', '20-11-2026 09:14:00'),
      line('126', '20-11-2026 09:20:00'),
    ].join('\n')
  );
  const got = punchRows(punches, staff);
  assert.equal(got.rows.length, 2);
  assert.deepEqual(got.matched.map((m) => m.name).sort(), ['AMIT SHAH', 'KIRAN DESAI']);
  assert.deepEqual(got.unknown, []);
});

test('a number nobody carries is NAMED, with how many punches it has', () => {
  // There are no names in the file, so an unmatched number cannot be guessed
  // at - somebody has to put it on a record.
  const { punches } = parseLogText(
    [line('999', '20-11-2026 09:14:00'), line('999', '20-11-2026 18:14:00')].join('\n')
  );
  const got = punchRows(punches, staff);
  assert.equal(got.rows.length, 0);
  assert.deepEqual(got.unknown, [{ id: '999', punches: 2 }]);
});

test('somebody who has left takes their punches with them', () => {
  const { punches } = parseLogText(line('37', '20-11-2026 09:14:00'));
  const gone = staff.map((e) => (e.id === 1 ? { ...e, active: 0 } : e));
  const got = punchRows(punches, gone);
  assert.equal(got.rows.length, 0);
  assert.deepEqual(got.unknown, [{ id: '37', punches: 1 }]);
});

/* ---------------- and through the importer that already exists ---------------- */

const marksFor = (raw, employees = staff, period = { month: 11, year: 2026, hours_per_day: 9 }) => {
  const { punches } = parseLogText(raw);
  const { rows } = punchRows(punches, employees);
  return punchesToMarks({ rows, mapping: PUNCH_MAPPING, employees, period });
};

test('the earliest punch is the arrival and the latest is the departure', () => {
  // The direction field is 0 on every line in the whole spool, so there is
  // nothing to read; this is the rule every other import already uses.
  const result = marksFor(
    [
      line('37', '20-11-2026 13:40:00'),
      line('37', '20-11-2026 09:14:00'),
      line('37', '20-11-2026 18:12:00'),
      line('37', '20-11-2026 11:02:00'),
    ].join('\n')
  );
  const day = result.entries.find((e) => e.day === 20 && e.employee_id === 1);
  assert.equal(day.in_time, '09:14');
  assert.equal(day.out_time, '18:12');
  assert.equal(day.code, 'P');
});

test('a day nobody punched gets NO entry - it is not an absence', () => {
  // The spool simply has nothing for a day the tool was stopped on, and a day
  // with no entry leaves the grid as it was. This is the whole reason this
  // source is safer than a report that prints A for both.
  const result = marksFor(line('37', '20-11-2026 09:14:00'));
  assert.deepEqual(result.days, [20]);
  assert.equal(result.entries.length, 1);
  assert.ok(!result.entries.some((e) => e.code === 'A'));
});

test('one punch in the whole day is Present with no hours claimed', () => {
  const result = marksFor(line('37', '20-11-2026 09:14:00'));
  const day = result.entries[0];
  assert.equal(day.code, 'P');
  assert.equal(day.minutes, 0);
  assert.equal(day.in_time, '09:14');
});

test('a short day is a half day, judged against the month, not a fixed figure', () => {
  const result = marksFor(
    [line('37', '20-11-2026 09:00:00'), line('37', '20-11-2026 12:00:00')].join('\n')
  );
  assert.equal(result.entries[0].code, 'HF');
});

test('two readers on one day are one day, not two', () => {
  // In and Out are separate machines in his office.
  const result = marksFor(
    [
      line('37', '20-11-2026 09:14:00', G2),
      line('37', '20-11-2026 18:12:00', G1),
    ].join('\n')
  );
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].in_time, '09:14');
  assert.equal(result.entries[0].out_time, '18:12');
});

test('punches outside the open month never reach it', () => {
  const result = marksFor(
    [line('37', '31-10-2026 09:14:00'), line('37', '20-11-2026 09:14:00')].join('\n')
  );
  assert.deepEqual(result.days, [20]);
});

/* ---------------- narrowing sixteen thousand files ---------------- */

test("the file's own name says which day it synced", () => {
  assert.deepEqual(logFileDate('LogFile_11_22_10_25_51_808.dat'), { month: 11, day: 22 });
  assert.equal(logFileDate('config.xml'), null);
  assert.equal(logFileDate('LogFile_13_40_10_25_51_808.dat'), null);
});

test('a month takes its own files plus the edges of the months beside it', () => {
  // The name is the time the batch was SYNCED, and a punch at 23:58 can sync
  // after midnight - so the real date is still read from every line.
  assert.equal(fileCouldMatter('LogFile_11_22_10_25_51_808.dat', { month: 11 }), true);
  assert.equal(fileCouldMatter('LogFile_10_31_23_59_00_000.dat', { month: 11 }), true);
  assert.equal(fileCouldMatter('LogFile_12_01_00_05_00_000.dat', { month: 11 }), true);
  assert.equal(fileCouldMatter('LogFile_08_14_10_00_00_000.dat', { month: 11 }), false);
  assert.equal(fileCouldMatter('notes.txt', { month: 11 }), false);
  assert.equal(fileCouldMatter('anything', {}), true);
});

test('December and January wrap round rather than falling off the end', () => {
  assert.equal(fileCouldMatter('LogFile_12_31_23_50_00_000.dat', { month: 1 }), true);
  assert.equal(fileCouldMatter('LogFile_01_01_00_01_00_000.dat', { month: 12 }), true);
});

/* ---------------- what a punch may and may not overrule ---------------- */

const entry = (over = {}) => ({
  employee_id: 1, day: 20, code: 'P', minutes: -30, in_time: '09:14', out_time: '18:12', ...over,
});

test('a punch may set a day that is blank or plainly P, A or HF', () => {
  for (const was of ['', 'P', 'A', 'HF']) {
    const got = protectDecided([entry()], () => was);
    assert.equal(got.entries[0].code, 'P', `${was || 'blank'} should be settable`);
    assert.deepEqual(got.protected, []);
  }
});

test('a punch NEVER overrules a decision somebody made', () => {
  // Somebody on casual leave who comes in for ten minutes must not have their
  // CL turned into a present day and taken off the leave register with it.
  for (const was of ['CL', 'SL', 'PL', 'UL', 'H', 'PH', 'HP', 'S', 'SP', 'WH', 'AD']) {
    const got = protectDecided([entry()], () => was);
    assert.ok(!('code' in got.entries[0]), `${was} was overwritten`);
    assert.ok(!('minutes' in got.entries[0]), `${was} kept minutes worked out as if Present`);
    assert.equal(got.protected[0].code, was);
  }
});

test('the clock times still land on a protected day', () => {
  // The hours are a fact whatever the mark; it is the MARK that is a decision.
  const got = protectDecided([entry()], () => 'CL');
  assert.equal(got.entries[0].in_time, '09:14');
  assert.equal(got.entries[0].out_time, '18:12');
  assert.equal(got.entries[0].employee_id, 1);
  assert.equal(got.entries[0].day, 20);
});

test('it looks the day up per person, not once for the lot', () => {
  const stored = (id, day) => (id === 2 && day === 20 ? 'CL' : '');
  const got = protectDecided([entry(), entry({ employee_id: 2 })], stored);
  assert.equal(got.entries[0].code, 'P');
  assert.ok(!('code' in got.entries[1]));
  assert.equal(got.protected.length, 1);
});
