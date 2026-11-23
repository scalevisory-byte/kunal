import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, dayOfMonth, minutesOfDay, punchesToMarks } from '../../shared/punches.js';

const PERIOD = { year: 2026, month: 9, hours_per_day: 9 };
const STAFF = [
  { id: 1, name: 'Ashutosh Jha', code: 'BNF001', active: 1 },
  { id: 2, name: 'Rohit Tayade', code: 'BNF002', active: 1 },
  { id: 3, name: 'Gone Already', code: 'BNF003', active: 0 },
];
const MAP = { employee: 1, date: 2, inTime: 3, outTime: 4, matchBy: 'name' };
const rows = (list) => list.map((values, i) => ({ row: i + 1, values }));

test('dates are read in every shape these reports use', () => {
  assert.equal(dayOfMonth('07/09/2026', PERIOD), 7, 'dd/mm/yyyy');
  assert.equal(dayOfMonth('7-9-26', PERIOD), 7, 'short year');
  assert.equal(dayOfMonth('2026-09-07', PERIOD), 7, 'yyyy-mm-dd');
  assert.equal(dayOfMonth('07/09/2026 09:00', PERIOD), 7, 'with a time after it');
  assert.equal(dayOfMonth(new Date(Date.UTC(2026, 8, 7)), PERIOD), 7, 'a real date');
  assert.equal(dayOfMonth('7', PERIOD), 7, 'a bare day number');

  // Another month must not leak into this one.
  assert.equal(dayOfMonth('07/08/2026', PERIOD), null);
  assert.equal(dayOfMonth('07/09/2025', PERIOD), null);
  assert.equal(dayOfMonth('rubbish', PERIOD), null);
  assert.equal(dayOfMonth('', PERIOD), null);
});

test('times are read in every shape too', () => {
  assert.equal(minutesOfDay('09:30'), 570);
  assert.equal(minutesOfDay('9:30 AM'), 570);
  assert.equal(minutesOfDay('01:00 PM'), 780);
  assert.equal(minutesOfDay('12:30 AM'), 30, 'midnight is hour zero');
  assert.equal(minutesOfDay('12:30 PM'), 750, 'noon stays twelve');
  assert.equal(minutesOfDay('17:15:44'), 1035, 'seconds are ignored');
  assert.equal(minutesOfDay(new Date(Date.UTC(2026, 8, 7, 9, 30))), 570);
  assert.equal(minutesOfDay(''), null);
  assert.equal(minutesOfDay('-'), null);
  assert.equal(minutesOfDay('Absent'), null);
});

test('a full day is present, a short day is half, no punch is absent', () => {
  const result = punchesToMarks({
    rows: rows([
      { 1: 'Ashutosh Jha', 2: '01/09/2026', 3: '09:00', 4: '18:00' }, // 9h
      { 1: 'Ashutosh Jha', 2: '02/09/2026', 3: '', 4: '' }, // no punch
      { 1: 'Rohit Tayade', 2: '01/09/2026', 3: '09:30', 4: '13:00' }, // 3.5h
    ]),
    mapping: MAP,
    rules: DEFAULT_RULES,
    employees: STAFF,
    period: PERIOD,
  });

  const find = (id, day) => result.entries.find((e) => e.employee_id === id && e.day === day);
  assert.equal(find(1, 1).code, 'P');
  assert.equal(find(1, 1).minutes, 0, 'a full day costs nothing');
  assert.equal(find(1, 2).code, 'A');
  assert.equal(find(2, 1).code, 'HF');
  assert.deepEqual(result.summary, { present: 1, halfDay: 1, absent: 1, shortHours: 0, overtime: 0 });
  assert.deepEqual(result.days, [1, 2]);
});

test('time worked under the day becomes short-hour minutes, past the grace', () => {
  const run = (inAt, outAt, rules) =>
    punchesToMarks({
      rows: rows([{ 1: 'Ashutosh Jha', 2: '01/09/2026', 3: inAt, 4: outAt }]),
      mapping: MAP,
      rules: { ...DEFAULT_RULES, ...rules },
      employees: STAFF,
      period: PERIOD,
    }).entries[0];

  assert.equal(run('09:45', '17:15').minutes, -90, '7.5 hours against 9 is 90 short');
  assert.equal(run('09:00', '19:00').minutes, 60, 'and an hour over is overtime');
  assert.equal(run('09:00', '17:50').minutes, 0, 'ten minutes inside the 15 minute grace');
  assert.equal(run('09:00', '17:40').minutes, -20, 'twenty is past it');
  assert.equal(run('09:45', '17:15', { countShortHours: false }).minutes, 0, 'switched off entirely');
  assert.equal(run('09:00', '17:40', { graceMinutes: 30 }).minutes, 0, 'a wider grace');
});

test('one row per punch works as well as one row per day', () => {
  const result = punchesToMarks({
    rows: rows([
      { 1: 'Ashutosh Jha', 2: '01/09/2026', 3: '09:00', 4: '' },
      { 1: 'Ashutosh Jha', 2: '01/09/2026', 3: '13:00', 4: '' },
      { 1: 'Ashutosh Jha', 2: '01/09/2026', 3: '17:30', 4: '' },
    ]),
    mapping: MAP,
    rules: DEFAULT_RULES,
    employees: STAFF,
    period: PERIOD,
  });
  assert.equal(result.entries.length, 1, 'three punches, one day');
  // Earliest to latest: 09:00 to 17:30 is 8.5 hours, half an hour short.
  assert.equal(result.entries[0].code, 'P');
  assert.equal(result.entries[0].minutes, -30);
});

test('names that are not on the staff list are reported, not guessed at', () => {
  const result = punchesToMarks({
    rows: rows([
      { 1: '  ashutosh   jha ', 2: '01/09/2026', 3: '09:00', 4: '18:00' },
      { 1: 'Nobody At All', 2: '01/09/2026', 3: '09:00', 4: '18:00' },
      { 1: 'Nobody At All', 2: '02/09/2026', 3: '09:00', 4: '18:00' },
      { 1: 'Gone Already', 2: '01/09/2026', 3: '09:00', 4: '18:00' },
    ]),
    mapping: MAP,
    rules: DEFAULT_RULES,
    employees: STAFF,
    period: PERIOD,
  });
  assert.equal(result.matched, 1, 'spacing and capitals do not stop a match');
  assert.deepEqual(result.unmatched, [
    { name: 'Nobody At All', count: 2 },
    { name: 'Gone Already', count: 1 },
  ], 'an inactive employee counts as unmatched too');
});

test('the employee code can be matched on instead of the name', () => {
  const result = punchesToMarks({
    rows: rows([{ 1: 'BNF002', 2: '01/09/2026', 3: '09:00', 4: '18:00' }]),
    mapping: { ...MAP, matchBy: 'code' },
    rules: DEFAULT_RULES,
    employees: STAFF,
    period: PERIOD,
  });
  assert.equal(result.entries[0].employee_id, 2);
});

test('rows for another month are counted, not silently dropped', () => {
  const result = punchesToMarks({
    rows: rows([
      { 1: 'Ashutosh Jha', 2: '01/08/2026', 3: '09:00', 4: '18:00' },
      { 1: 'Ashutosh Jha', 2: '01/09/2026', 3: '09:00', 4: '18:00' },
    ]),
    mapping: MAP,
    rules: DEFAULT_RULES,
    employees: STAFF,
    period: PERIOD,
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.unreadableDates, 1);
});

test('ONE PUNCH WRITES A BLANK OUT TIME, NOT THE SAME MINUTE TWICE', () => {
  /*
   * The readers are door locks, so most days carry many punches and earliest
   * / latest is the right rule. Somebody who went through once has only an
   * arrival, and writing that minute into BOTH columns claims they left the
   * moment they arrived. Every screen downstream then read it as a 24-hour
   * shift.
   *
   * Blank is the honest record, and it must be sent as '' rather than left
   * out: `setAttendance` merges per field, so omitting it would keep a stale
   * out time from an earlier import.
   */
  const got = punchesToMarks({
    rows: [{ values: ['E1', '20-11-2026 10:50:00'] }],
    mapping: { employee: 0, date: 1, inTime: 1, outTime: 1, matchBy: 'code' },
    rules: DEFAULT_RULES,
    employees: [{ id: 1, code: 'E1', name: 'ABDULHAK BHENSWALA', active: 1 }],
    period: { month: 11, year: 2026, hours_per_day: 9 },
  });
  const day = got.entries.find((e) => e.day === 20);
  assert.equal(day.in_time, '10:50');
  assert.equal(day.out_time, '', 'the departure is not known, and must not be invented');
  assert.ok('out_time' in day, 'it must be named so a stale out time is cleared');
  assert.equal(day.code, 'P', 'they were here');
  assert.equal(day.minutes, 0, 'and nothing is charged or paid for hours nobody can measure');
});

test('many punches in a day still read first in, last out', () => {
  // A door lock: in, out for tea, in, out for lunch, in, home. Everything
  // between the first and the last is simply the door opening.
  const stamps = ['09:14', '11:02', '11:20', '13:30', '14:05', '18:12'];
  const got = punchesToMarks({
    rows: stamps.map((t) => ({ values: ['E1', `20-11-2026 ${t}:00`] })),
    mapping: { employee: 0, date: 1, inTime: 1, outTime: 1, matchBy: 'code' },
    rules: DEFAULT_RULES,
    employees: [{ id: 1, code: 'E1', name: 'SOMEBODY', active: 1 }],
    period: { month: 11, year: 2026, hours_per_day: 9 },
  });
  const day = got.entries.find((e) => e.day === 20);
  assert.equal(day.in_time, '09:14');
  assert.equal(day.out_time, '18:12');
});

test('A DAY STILL RUNNING IS NOT HALF A DAY', () => {
  /*
   * Dinesh saw this on his own portal: HARISH punched 09:35, 13:37, 14:16 and
   * the day came out HF at twenty past two, sitting at his desk.
   *
   * The last punch is him coming BACK from lunch, not leaving. The mark was
   * worked out from it (09:35 to 14:16, less the 39-minute break, is 4h 02m -
   * under the half-day line) and only AFTERWARDS did the same function refuse
   * to write 14:16 as an out time. Half a day's pay off a departure the code
   * itself did not believe in.
   */
  const { entries, summary } = punchesToMarks({
    rows: rows([
      ['', 'Ashutosh Jha', '07/09/2026', '09:35', '13:37'],
      ['', 'Ashutosh Jha', '07/09/2026', '14:16', ''],
    ]),
    mapping: MAP,
    employees: STAFF,
    period: PERIOD,
  });

  const day = entries.find((e) => e.day === 7);
  assert.ok(day, 'the day is still written - the arrival is real');
  assert.equal(day.code, 'P', 'present, not HF: when they left is not known');
  assert.equal(day.in_time, '09:35');
  assert.equal(day.out_time, '', 'the return from lunch is not a departure');
  assert.equal(day.minutes, 0, 'nothing is charged and nothing is paid');
  assert.equal(summary.halfDay, 0);
  assert.equal(summary.noDeparture, 1, 'and the dry run can say so');
});

test('a day that really did finish short is still a half day', () => {
  // The guard must not swallow the honest case: an out time that IS a
  // departure, and a short day, still reads as one.
  const { entries, summary } = punchesToMarks({
    rows: rows([['', 'Ashutosh Jha', '08/09/2026', '09:30', '12:00']]),
    mapping: MAP,
    employees: STAFF,
    period: PERIOD,
  });
  const day = entries.find((e) => e.day === 8);
  assert.equal(day.code, 'HF');
  assert.equal(day.out_time, '12:00');
  assert.equal(summary.halfDay, 1);
  assert.equal(summary.noDeparture, undefined, 'nothing to report here');
});

test('the mark and the out time can never contradict each other', () => {
  /*
   * The rule in one line: a mark derived from the hours may only exist where
   * an out time was actually written. Anything else is a figure the module
   * declined to record being used to decide pay.
   */
  const { entries } = punchesToMarks({
    rows: rows([
      ['', 'Ashutosh Jha', '09/09/2026', '10:50', '10:50'],
      ['', 'Rohit Tayade', '09/09/2026', '09:00', '13:20'],
      ['', 'Rohit Tayade', '09/09/2026', '14:00', ''],
    ]),
    mapping: MAP,
    employees: STAFF,
    period: PERIOD,
  });
  for (const e of entries) {
    if (e.code === 'HF') assert.ok(e.out_time, `HF on ${e.day} with no out time`);
    if (!e.out_time) assert.notEqual(e.code, 'HF', `no departure on ${e.day}, so no half day`);
  }
  assert.equal(entries.length, 2);
});

test('A DAY THAT CANNOT HAVE FINISHED YET IS NOT GIVEN A DEPARTURE', () => {
  /*
   * Dinesh on the Time tab at twenty past four: *"out time abhi bhi aa raha
   * he"*. v2.0.0 caught the lunch-return case, but somebody with only TWO
   * punches was still handed a departure and charged a shortfall while they
   * sat at their desk — ANURAG VERMA read 10:49 to 15:37 and −252 minutes on
   * a day with two hours of it left to run.
   *
   * You cannot have finished your day before your day's length has gone by.
   */
  const at = (h, m) => new Date(2026, 8, 7, h, m);
  const args = (now) => ({
    rows: rows([
      ['', 'Ashutosh Jha', '07/09/2026', '10:49', '15:37'],
    ]),
    mapping: MAP,
    employees: STAFF,
    period: PERIOD,
    now,
  });

  const midday = punchesToMarks(args(at(16, 14)));
  const day = midday.entries.find((e) => e.day === 7);
  assert.equal(day.out_time, '', 'they are still in - the departure is not known');
  assert.equal(day.code, 'P', 'present, and not half a day');
  assert.equal(day.minutes, 0, 'NOTHING IS CHARGED for a day still running');
  assert.equal(midday.summary.stillIn, 1, 'and the dry run can say so');

  // Once the day really is over, the same punches read normally.
  const evening = punchesToMarks(args(at(20, 30)));
  const done = evening.entries.find((e) => e.day === 7);
  assert.equal(done.out_time, '15:37', 'the evening pull writes the real departure');
  // 4h 48m is 288 minutes, which is MORE than half of nine hours, so the day
  // is present and short by 252 — the very figure Dinesh screenshotted.
  assert.equal(done.code, 'P');
  assert.equal(done.minutes, -252, 'and only then is the shortfall charged');
  assert.equal(evening.summary.stillIn, undefined);
});

test('a day in the past is finished whatever the clock says now', () => {
  // The guard looks at TODAY only, so no stored month can move - a month
  // imported at four in the afternoon reads exactly as one imported at
  // midnight.
  const early = punchesToMarks({
    rows: rows([['', 'Ashutosh Jha', '03/09/2026', '10:49', '15:37']]),
    mapping: MAP,
    employees: STAFF,
    period: PERIOD,
    now: new Date(2026, 8, 7, 16, 14),
  });
  const day = early.entries.find((e) => e.day === 3);
  assert.equal(day.out_time, '15:37');
  assert.equal(day.code, 'P');
  assert.equal(day.minutes, -252);
  assert.equal(early.summary.stillIn, undefined);
});

test('somebody who started early enough HAS finished, and is judged', () => {
  // 06:42 plus nine hours is 15:42, which has gone by at 16:14. The guard
  // must not swallow every day on the current date.
  const got = punchesToMarks({
    rows: rows([['', 'Ashutosh Jha', '07/09/2026', '06:42', '11:00']]),
    mapping: MAP,
    employees: STAFF,
    period: PERIOD,
    now: new Date(2026, 8, 7, 16, 14),
  });
  const day = got.entries.find((e) => e.day === 7);
  assert.equal(day.out_time, '11:00');
  assert.equal(day.code, 'HF');
});

test('an imported day is judged against THEIR shift, not the office day', () => {
  /*
   * v1.82 made the shift length personal and `hoursForEmployee` the one
   * answer to it — and this file was missed. A day read off the punch machine
   * was measured against the month's nine hours, so a six-hour part-timer
   * finishing exactly on time was docked three hours, every day.
   */
  const part = [{ id: 7, name: 'Part Timer', code: 'BNF007', active: 1, shift_in: '09:00', shift_out: '15:00' }];
  const got = punchesToMarks({
    rows: rows([['', 'Part Timer', '03/09/2026', '09:00', '15:00']]),
    mapping: MAP,
    employees: part,
    period: PERIOD,
    now: new Date(2026, 8, 7, 20, 0),
  });
  const day = got.entries.find((e) => e.day === 3);
  assert.equal(day.code, 'P', 'six hours IS their full day');
  assert.equal(day.minutes, 0, 'and nothing is docked for the other three');
});

test('somebody on the usual shift comes out exactly as before', () => {
  // hasOwnShift compares against the office day rather than asking whether the
  // column is filled in, so this must be byte for byte unchanged.
  const same = [{ id: 8, name: 'Normal Hours', code: 'BNF008', active: 1, shift_in: '09:30', shift_out: '18:30' }];
  for (const staff of [STAFF.slice(0, 1), same]) {
    const got = punchesToMarks({
      rows: rows([['', staff[0].name, '03/09/2026', '09:30', '17:30']]),
      mapping: MAP,
      employees: staff,
      period: PERIOD,
      now: new Date(2026, 8, 7, 20, 0),
    });
    const day = got.entries.find((e) => e.day === 3);
    assert.equal(day.code, 'P');
    assert.equal(day.minutes, -60, 'eight hours against nine is an hour short');
  }
});
