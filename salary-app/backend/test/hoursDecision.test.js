/**
 * THE MONTH'S HOURS AS A YES OR A NO.
 *
 * Dinesh: *"Amount to apne aap aayega na minus hours ka / o deduct karna he
 * ya nahi uska decision lena he khali"* - the figure must not be typed, only
 * decided about. `shared/hoursDecision.js` turns the figure `calculateRow`
 * already returns into exactly that choice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLEAR_HOURS_PATCH,
  chargeHoursPatch,
  hasTypedHours,
  hoursDecision,
  hoursMinutesOf,
} from '../../shared/hoursDecision.js';
import { calculateRow } from '../../shared/calc.js';
import { minutesForMark } from '../../shared/timesheet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(path.join(here, '../../frontend/src', p), 'utf8');

const line = (id, name, over, extra = {}) => ({
  row: { id, employee_name: name, ...(over === undefined ? {} : { ot_minutes_override: over }) },
  calc: { monthly_hours_judged: true, ...extra },
});
const short = (m, amt) => ({ monthly_hours_diff: m, monthly_hours_chargeable: m, monthly_hours_amount: amt });
const over = (m, amt) => ({ monthly_hours_diff: m, monthly_hours_chargeable: 0, monthly_hours_amount: amt });

test('short and over are TWO decisions, never one button', () => {
  const d = hoursDecision([
    line(1, 'Short Sharma', undefined, short(-84, -155.56)),
    line(2, 'Over Oza', undefined, over(120, 222.22)),
  ]);
  assert.equal(d.short.length, 1);
  assert.equal(d.over.length, 1);
  assert.equal(d.shortAmount, 156);
  assert.equal(d.overAmount, 222);
  /*
   * Deducting somebody's missing hours and paying somebody else's overtime
   * are different questions. One button for both answers the second without
   * being asked, which is how an overtime bill appears that nobody approved.
   */
  assert.notEqual(d.shortAmount, d.overAmount);
});

test('A ROW WHOSE HOURS ARE NOT KNOWN IS NEVER INCLUDED', () => {
  const d = hoursDecision([
    { row: { id: 1, employee_name: 'Never Clocked' }, calc: { monthly_hours_judged: false } },
    line(2, 'Did Clock', undefined, short(-60, -111)),
  ]);
  assert.equal(d.unknown, 1);
  assert.equal(d.short.length, 1);
  assert.equal(d.short[0].name, 'Did Clock');
  /* 0 would read as a decision somebody took. Not known is not nought. */
  assert.ok(!d.short.some((l) => l.name === 'Never Clocked'));
  assert.ok(!d.over.some((l) => l.name === 'Never Clocked'));
});

test('a figure somebody already typed is left alone, and counted', () => {
  const d = hoursDecision([
    line(1, 'Typed Tarun', -300, short(-10, -18)),
    line(2, 'Blank Bhavna', undefined, short(-60, -111)),
    line(3, 'Zero Zubin', 0, short(-90, -166)),
  ]);
  assert.deepEqual(d.short.map((l) => l.name), ['Blank Bhavna']);
  assert.equal(d.decided.length, 2, 'a typed 0 is a decision too, not an empty box');
  assert.ok(d.decided.some((l) => l.minutes === -300));
  assert.ok(d.decided.some((l) => l.minutes === 0));
  /* The office's own figure outranks ours - the same rule as "Mark everyone
     Present", which fills blank days and never overwrites a mark. */
  assert.equal(hasTypedHours({ ot_minutes_override: 0 }), true);
  assert.equal(hasTypedHours({ ot_minutes_override: '' }), false);
  assert.equal(hasTypedHours({ ot_minutes_override: null }), false);
  assert.equal(hasTypedHours({}), false);
});

test('the minutes written are the ones the rule would really have charged', () => {
  /* Short takes the GRACE off - `chargeable`, not `diff` - so saying yes
     writes what the rule would have taken, never more. */
  assert.equal(hoursMinutesOf({ monthly_hours_diff: -100, monthly_hours_chargeable: -40 }), -40);
  /* Grace forgives a shortfall; it is not a floor under overtime. */
  assert.equal(hoursMinutesOf({ monthly_hours_diff: 120, monthly_hours_chargeable: 0 }), 120);
  assert.equal(hoursMinutesOf({ monthly_hours_diff: 0, monthly_hours_chargeable: 0 }), 0);
});

test('somebody exactly on their hours is not a decision at all', () => {
  const d = hoursDecision([line(1, 'Bang On', undefined, short(0, 0))]);
  assert.equal(d.short.length, 0);
  assert.equal(d.over.length, 0);
  assert.equal(d.anything, false, 'the bar does not appear with nothing to decide');
});

test('the worst are listed first, because they are what the decision is about', () => {
  const d = hoursDecision([
    line(1, 'A', undefined, short(-30, -55)),
    line(2, 'B', undefined, short(-300, -555)),
    line(3, 'C', undefined, short(-90, -166)),
  ]);
  assert.deepEqual(d.short.map((l) => l.name), ['B', 'C', 'A']);
});

test('the patches are the OT min box and nothing else', () => {
  /*
   * Saying yes must not switch the month's RULE. A rule applies to everybody
   * from then on; this is a judgement taken person by person with the figure
   * in front of you. One is a policy, the other is a decision, and they must
   * not be the same button.
   */
  assert.deepEqual(chargeHoursPatch(-84), { ot_minutes_override: -84 });
  assert.deepEqual(CLEAR_HOURS_PATCH, { ot_minutes_override: '' });
  for (const patch of [chargeHoursPatch(-84), CLEAR_HOURS_PATCH]) {
    assert.deepEqual(Object.keys(patch), ['ot_minutes_override']);
    assert.ok(!('late_policy' in patch));
  }
});

test('END TO END off a real calculated month: the figure is never typed', () => {
  const period = {
    year: 2026, month: 11, working_days: 26, hours_per_day: 9,
    late_policy: 'none', lunch_paid: 0, pt_threshold: 12000, pt_amount: 200,
  };
  const days = (inAt, outAt) =>
    Array.from({ length: 12 }, (_, i) => ({
      day: i + 2, code: 'P', in_time: inAt, out_time: outAt,
      minutes: minutesForMark({ in_time: inAt, out_time: outAt, code: 'P' },
        { hoursPerDay: 9, code: 'P', deductLunch: true }),
    }));
  const row = { id: 7, employee_name: 'Harish Gupta', salary: 26000, pf: 0, esi: 0 };
  const calc = calculateRow({ ...row }, period, days('09:30', '17:30'));

  /* On this rule the month pays in full... */
  assert.equal(calc.net_salary, 25800);
  /* ...and the decision carries the figure, already worked out. */
  const d = hoursDecision([{ row, calc }]);
  assert.equal(d.short.length, 1);
  assert.equal(d.short[0].minutes, -720, 'twelve hours short, read off the clock');
  assert.equal(d.shortAmount, 1333);

  /* Saying yes = writing exactly that into the row, and nothing else. */
  const after = calculateRow({ ...row, ...chargeHoursPatch(d.short[0].minutes) }, period, days('09:30', '17:30'));
  assert.equal(after.ot_minutes, -720);
  assert.equal(after.net_salary, 25800 - 1333);
  /* And clearing it hands the row back to the rule. */
  const back = calculateRow({ ...row, ot_minutes_override: '' }, period, days('09:30', '17:30'));
  assert.equal(back.net_salary, 25800);
});

/* ---------------- the screen is wired to it ---------------- */

test('the salary sheet decides from this module and does not count again', () => {
  const sheet = src('components/SalarySheet.jsx');
  assert.match(sheet, /hoursDecision\(/, 'the bar reads the shared module');
  assert.match(sheet, /chargeHoursPatch\(/);
  assert.match(sheet, /CLEAR_HOURS_PATCH/);
  /* The figure on the row and the figure in the bar must come from one
     place, or the confirm and the sheet will disagree about the month. */
  assert.match(sheet, /hoursMinutesOf\(calc\)/, 'the row writes the module’s own figure');
});

test('the bar is its own class, not a reuse of the toolbar', () => {
  /*
   * `.toolbar` is on a dozen screens and restyling it here would quietly
   * redraw all of them - the `.alerts` / `.login` / `.sticky-name` trap, and
   * the invented-class trap the other way round: the class also has to EXIST.
   */
  const sheet = src('components/SalarySheet.jsx');
  const css = src('styles.css');
  assert.match(sheet, /className="row gap wrap hours-decide"/);
  assert.match(css, /\.hours-decide \{/, '.hours-decide needs a rule of its own');
});

test('a locked month offers no decision to take', () => {
  const sheet = src('components/SalarySheet.jsx');
  const bar = sheet.slice(sheet.indexOf('hours-decide'), sheet.indexOf('<ScrollFrame'));
  /*
   * Every button that DECIDES something. "Show them" - bringing the hidden
   * Hours columns back - is not a decision about the month: it changes what
   * this screen shows and nothing that is stored, so a locked month must still
   * be able to press it. Locking a month must never lock somebody out of
   * LOOKING at it.
   */
  // Read to the closing tag's first line: an arrow function's `=>` ends a
  // naive `<button ...>` match before the handler it is looking for.
  const all = [...bar.matchAll(/<button/g)].map((m) => bar.slice(m.index, bar.indexOf('\n', bar.indexOf('>', m.index))));
  const view = all.filter((b) => /chooseHours\(/.test(b));
  assert.equal(view.length, 1, 'exactly one view-only button, and it is named here');
  const buttons = all.filter((b) => !/chooseHours\(/.test(b));
  assert.ok(buttons.length >= 2, 'the bar has buttons to check');
  for (const b of buttons) assert.match(b, /disabled=\{locked\}/, `not disabled when locked: ${b}`);
});

test('the footer and the rows come from ONE calculation', () => {
  /*
   * The footer used to sum the fields STORED on each row while every row on
   * screen recalculated itself, so between a change and the server's reply
   * the two disagreed. One typed cell made that a blink; pressing "Deduct
   * the short hours" changes eighty-six rows at once, which turned it into a
   * visibly wrong total on a payroll screen - measured at 2,07,000 against
   * rows adding to 2,05,557.
   */
  const sheet = src('components/SalarySheet.jsx');
  assert.match(sheet, /const calcs = useMemo\(/, 'one calculation for the whole sheet');
  assert.match(sheet, /totalRows\(calcs\.map\(\(c\) => c\.calc\)\)/, 'the footer reads it');
  /*
   * The bar reads that same memo and now also the PERIOD, because what it may
   * offer depends on whether the month charges the hours at all. This used to
   * pin `hoursDecision(calcs)` exactly and was rewritten rather than loosened
   * when the second argument arrived.
   */
  assert.match(sheet, /hoursDecision\(calcs, \{ period \}\)/, 'and so does the decision bar');
  /* And nothing rebuilds its own copy - that is how two answers appear. */
  const rebuilds = sheet.match(/filtered\.map\(\(row\) => \(\{ row, calc:/g) || [];
  assert.equal(rebuilds.length, 1, 'the rows are calculated in exactly one place');
});
