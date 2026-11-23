import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SHAPE,
  REPORT_SHAPES,
  SHAPE_KEYS,
  dailyReport,
  normaliseShape,
  suggestShape,
} from '../../shared/dailyReport.js';
import { minutesForMark } from '../../shared/timesheet.js';

/*
 * THE DAILY REPORT'S THREE SHAPES.
 *
 * Dinesh: *"short hours & ot ka report aaj ki date ka dusre din jayega / same
 * day kaise jayega / uske liye kya solution he"*.
 *
 * The hours are `out - in - lunch`, so they cannot exist before the person has
 * gone home. The one thing these tests are really about is that the MORNING
 * shape does not print a clean bill of health at ten o'clock: at that hour
 * every day is inside its grace, so the sum really does come to nothing.
 */

const period = {
  id: 1,
  year: 2026,
  month: 11,
  hours_per_day: 9,
  lunch_paid: 1,
  shift_in: '09:30',
  shift_out: '18:30',
  late_policy: 'none',
  day_grace_minutes: 0,
};

/*
 * Days are built the way `setAttendance` builds them - the mark, the times AND
 * the minutes those times come to. A fixture carrying times and no `minutes`
 * proves nothing, because the report reads the stored column and not the clock.
 */
const dayOf = (code, in_time, out_time) => ({
  code,
  in_time,
  out_time,
  minutes: minutesForMark(
    { in_time, out_time },
    { hoursPerDay: 9, code, deductLunch: false, graceMinutes: 0 }
  ),
});

const rows = [
  {
    employee_id: 1,
    employee_name: 'Amit Shah',
    attendance: {
      /* yesterday: finished, 50 minutes short */
      21: dayOf('P', '09:30', '17:40'),
      /* today: in, not out yet */
      22: { code: 'P', in_time: '09:30', out_time: '', minutes: 0 },
    },
  },
  {
    employee_id: 2,
    employee_name: 'Priya Nair',
    attendance: {
      21: dayOf('P', '09:30', '19:30'), // an hour of overtime yesterday
      22: { code: 'P', in_time: '09:35', out_time: '', minutes: 0 },
    },
  },
];

const build = (over = {}) =>
  dailyReport({
    period,
    rows,
    day: 22,
    date: '2026-11-22',
    standard: { in: '09:30', out: '18:30', grace: 15 },
    ...over,
  });

test('the morning shape prints no hours headings at all', () => {
  const built = build({ shape: 'morning' });
  assert.equal(built.counts.hours_in_message, false);
  assert.equal(built.hours_day, null);
  assert.ok(!/Short hours$/m.test(built.text), 'no Short hours heading');
  assert.ok(!/^Overtime/m.test(built.text), 'no Overtime heading');
});

test('AND IT NEVER SAYS NOBODY WAS SHORT - the whole reason the shape exists', () => {
  const built = build({ shape: 'morning' });
  assert.ok(
    !/Nobody was short/.test(built.text),
    'at ten in the morning that reads as a clean day nobody has worked'
  );
  assert.ok(
    !/No overtime logged/.test(built.text),
    'nor as a day in which nobody stayed late'
  );
  assert.match(built.text, /not in this message: the day is not finished/);
});

test('the morning shape still carries attendance, late coming and uniform', () => {
  const built = build({ shape: 'morning' });
  assert.match(built.text, /^Attendance$/m);
  assert.match(built.text, /^Late Coming \/ Early Going$/m);
  assert.match(built.text, /^Uniform$/m);
  /* Priya came in at 09:35 - inside a 15-minute grace, so not late. */
  assert.equal(built.counts.late, 0);
});

test("with_yesterday reports the day before, under the day before's date", () => {
  const built = build({ shape: 'with_yesterday', hoursDay: 21, hoursDate: '2026-11-21' });
  assert.equal(built.hours_day, 21);
  assert.equal(built.hours_date, '2026-11-21');
  assert.match(built.text, /Short hours — 21 November 2026/);
  assert.match(built.text, /Amit Shah — 50m short/);
  assert.match(built.text, /Overtime — 21 November 2026/);
  assert.match(built.text, /Priya Nair — 1h 00m/);
  /* Today's heading is still today's, so the two cannot be confused. */
  assert.match(built.text, /Date: 22 November 2026/);
});

test('yesterday in the previous month is named, never read as day 0', () => {
  const built = dailyReport({
    period,
    rows,
    day: 1,
    date: '2026-11-01',
    shape: 'with_yesterday',
    hoursDay: null,
    hoursDate: '2026-10-31',
  });
  assert.equal(built.counts.hours_in_another_month, true);
  assert.equal(built.counts.hours_in_message, false);
  assert.match(built.text, /previous month, which is a separate sheet/);
  assert.ok(!/Nobody was short/.test(built.text));
});

test('end_of_day reports today, and names anybody still not clocked out', () => {
  const built = build({ shape: 'end_of_day' });
  assert.equal(built.hours_day, 22);
  assert.equal(built.counts.no_clock_out, 2);
  assert.match(built.text, /2 people clocked in and not out/);
  assert.match(built.text, /Amit Shah, Priya Nair/);
  /* Nobody is short, and that is said - at the end of the day it is true. */
  assert.match(built.text, /Nobody was short of hours today/);
});

test('end_of_day is the default, so a saved link gets what it always got', () => {
  assert.equal(DEFAULT_SHAPE, 'end_of_day');
  const asked = build({ shape: 'end_of_day' });
  const silent = build();
  assert.equal(silent.text, asked.text);
});

test('an unknown shape falls back to the long-standing one', () => {
  assert.equal(normaliseShape('nonsense'), 'end_of_day');
  assert.equal(normaliseShape(''), 'end_of_day');
  assert.equal(normaliseShape('MORNING'), 'morning');
  for (const key of SHAPE_KEYS) assert.equal(normaliseShape(key), key);
});

test('the stamp is printed only when the caller says what time it is', () => {
  assert.ok(!/As at/.test(build().text), 'no stamp leaves the old text alone');
  assert.match(build({ asOf: '19:10' }).text, /^As at: 19:10$/m);
});

test('the clock suggests the shape: morning before the day ends, end after', () => {
  const at = (h, m) => new Date(2026, 10, 22, h, m);
  assert.equal(suggestShape({ date: '2026-11-22', shiftOut: '18:30', now: at(10, 0) }), 'morning');
  assert.equal(suggestShape({ date: '2026-11-22', shiftOut: '18:30', now: at(19, 10) }), 'end_of_day');
  /* A day already gone is finished whatever the hour. */
  assert.equal(suggestShape({ date: '2026-11-05', shiftOut: '18:30', now: at(10, 0) }), 'end_of_day');
  /* A day still to come can only be the morning one. */
  assert.equal(suggestShape({ date: '2026-11-30', shiftOut: '18:30', now: at(19, 10) }), 'morning');
});

test('every shape has a label and a reason, and the screens map over the list', () => {
  assert.equal(REPORT_SHAPES.length, 3);
  for (const shape of REPORT_SHAPES) {
    assert.ok(shape.key && shape.label && shape.why, `${shape.key} is described`);
    assert.ok(shape.why.length > 40, `${shape.key} says WHEN it is true`);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const panel = fs.readFileSync(
    path.join(here, '../../frontend/src/components/DailyReport.jsx'),
    'utf8'
  );
  assert.match(panel, /REPORT_SHAPES\.map/, 'the picker reads the list');
  /* Comments stripped, so an explanation cannot pass for the thing it warns about. */
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(
    !/>\s*Morning — before/.test(code),
    'the panel must not hand-write a shape label - that is how the select went stale in v1.85'
  );
  assert.match(code, /suggestShape\(/, 'the panel takes the clock suggestion from the module');
});
