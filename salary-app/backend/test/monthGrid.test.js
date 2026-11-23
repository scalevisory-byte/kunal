import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WEEKDAYS, daysInMonth, firstWeekday, monthWeeks } from '../../shared/monthGrid.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '../../', p), 'utf8');

/*
 * THE MONTH'S LAYOUT, SHARED BY BOTH CALENDARS.
 *
 * Dinesh: *"calcndr bana do usme sari date k dikh ajyenge"*. There was
 * already a calendar here - the leave one - working this out inline. Two
 * copies is how two calendars come to disagree about which square the 1st
 * sits in, so it is one module and these tests say what it promises.
 */

test('a month of five weeks: 1 November 2026 is a Sunday', () => {
  const weeks = monthWeeks({ year: 2026, month: 11 });
  assert.equal(firstWeekday(2026, 11), 0, 'Sunday');
  assert.equal(weeks[0][0], 1, 'the 1st is in the first square');
  assert.equal(weeks.flat().filter((d) => d !== null).length, 30);
  for (const week of weeks) assert.equal(week.length, 7, 'every row is a week');
});

test('a month starting midweek gets leading blanks, never the other month', () => {
  /* 1 December 2026 is a Tuesday. */
  const weeks = monthWeeks({ year: 2026, month: 12 });
  assert.equal(weeks[0][0], null);
  assert.equal(weeks[0][1], null);
  assert.equal(weeks[0][2], 1, 'Tuesday');
  /* THE RULE: blanks, not 29/30 November. Those are days from another sheet,
     and on a payroll calendar they would read as days of this month. */
  assert.ok(
    weeks.flat().every((d) => d === null || (d >= 1 && d <= 31)),
    'nothing from a neighbouring month appears'
  );
});

test('the last week is padded, so every row is still seven squares', () => {
  for (const [y, m] of [[2026, 1], [2026, 2], [2026, 11], [2027, 5], [2028, 2]]) {
    const weeks = monthWeeks({ year: y, month: m });
    assert.ok(weeks.every((w) => w.length === 7), `${y}-${m} rows are weeks`);
    assert.equal(
      weeks.flat().filter((d) => d !== null).length,
      daysInMonth(y, m),
      `${y}-${m} has every one of its days`
    );
  }
});

test('February is counted, not guessed', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29, 'a leap year');
});

test('a short list of cells is padded, never silently dropped', () => {
  /* A month whose rows have not all arrived must still draw as that month. */
  const weeks = monthWeeks({ year: 2026, month: 11, cells: [{ day: 1 }, { day: 2 }] });
  assert.equal(weeks.flat().filter(Boolean).length, 2);
  assert.equal(weeks.flat().length % 7, 0);
  assert.equal(weeks.length, 5, 'still a November-shaped month');
});

test('nonsense gives no weeks rather than a wrong month', () => {
  assert.deepEqual(monthWeeks({}), []);
  assert.deepEqual(monthWeeks({ year: 2026, month: 0 }), []);
  assert.deepEqual(monthWeeks({ year: 2026, month: 13 }), []);
});

test('BOTH calendars read this module - there is no second copy of the layout', () => {
  for (const file of [
    'frontend/src/components/LeaveCalendar.jsx',
    'frontend/src/components/TimeCalendar.jsx',
  ]) {
    const src = read(file);
    assert.match(src, /monthWeeks\(/, `${file} uses the shared layout`);
    /* The inline version this replaced - a second one would drift. */
    assert.ok(
      !/for \(let i = 0; i < cells\.length; i \+= 7\)/.test(src),
      `${file} must not slice its own weeks`
    );
  }
  assert.equal(WEEKDAYS.length, 7);
});

test('THE CALENDAR ASSEMBLES: it never reads the clock a second time', () => {
  const src = read('frontend/src/components/TimeCalendar.jsx');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  /* `judge` and `entryOf` are handed in from the Time tab - the same pair the
     table and the save path use. A `timesToDay` or `minutesForMark` of its own
     would make the calendar a second opinion about a day. */
  assert.match(code, /judge\(person, d\)/);
  assert.ok(!/timesToDay\(/.test(code), 'no second reading of the clock');
  assert.ok(!/minutesForMark\(/.test(code), 'no second judgement of the mark');
});

test("the day's detail is ABOVE the grid, which was measured, not guessed", () => {
  const src = read('frontend/src/components/TimeCalendar.jsx');
  /*
   * Below it, clicking the 2nd put the answer at 1,286px in a 1,200px
   * window - the one thing the click was for, under the fold. Same as the
   * attendance day picker's clock block.
   */
  assert.ok(
    src.indexOf('{chosen ? (') < src.indexOf('<div className="lc-grid tc-grid">'),
    'the detail card comes first in the markup'
  );
});

test('every class the calendar invents has a rule behind it', () => {
  const src = read('frontend/src/components/TimeCalendar.jsx');
  const css = read('frontend/src/styles.css');
  const used = new Set();
  for (const m of src.matchAll(/\b(tc-[a-z-]+)\b/g)) used.add(m[1]);
  assert.ok(used.size >= 6, 'found the classes');
  for (const name of used) {
    assert.ok(css.includes(`.${name}`), `.${name} has no CSS - the invented-class trap`);
  }
});
