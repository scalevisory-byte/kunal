/*
 * THE ATTENDANCE GRID'S SUMMARY COLUMNS MUST ACCOUNT FOR EVERY MARK.
 *
 * Found by auditing the attendance tab against an independent count. Two
 * things were wrong, and the second only showed up because of the first:
 *
 *   - The salary sheet's **PL** column renders `PL + CL + SL` and says so in
 *     its tooltip. The grid's column, the same label on the same month,
 *     rendered `counts.PL` alone - so one person with a casual leave day and
 *     a privilege leave day read **2** on one screen and **1** on the other.
 *     The sum was written out twice, which is how it came to differ; it is
 *     written once now, in `paidLeaveDays`.
 *
 *   - The grid has no column of its own for casual or sick leave, and none
 *     for a paid holiday either. So those days were counted in NOTHING: on
 *     real data, fifteen days marked showed as fourteen accounted for, and
 *     nothing on the row said where the fifteenth had gone. His festival
 *     system writes **PH** for the staff a festival covers, so every Diwali
 *     and Eid landed on the grid and appeared in none of its figures.
 *
 * The test that matters is the last one: every code has somewhere to be
 * counted, so adding a fifteenth mark fails here until somebody decides
 * where it belongs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ATTENDANCE_CODES, paidLeaveDays } from '../../shared/calc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const grid = read('frontend/src/components/Attendance.jsx');
const sheet = read('frontend/src/components/SalarySheet.jsx');

test('paid leave is casual, sick and privilege leave together', () => {
  assert.equal(paidLeaveDays({ CL: 1, SL: 2, PL: 3 }), 6);
  assert.equal(paidLeaveDays({ PL: 1 }), 1);
  assert.equal(paidLeaveDays({}), 0);
  assert.equal(paidLeaveDays(), 0, 'nothing marked is nought, not a crash');
});

test('it counts nothing that is not paid leave', () => {
  /* An absence, a half day, a holiday and a weekly off are each somebody
     else's column - counting them here would double them. */
  assert.equal(paidLeaveDays({ A: 4, HF: 2, UL: 3, S: 4, PH: 2, P: 20, SP: 1, AD: 1 }), 0);
});

test('THE TWO SCREENS CALL ONE SUM, and neither writes its own', () => {
  assert.match(grid, /paidLeaveDays\(counts\)/, 'the grid works it out itself again');
  assert.match(sheet, /paidLeaveDays\(row\.mark_counts\)/, 'the sheet works it out itself again');
  for (const [name, src] of [['grid', grid], ['salary sheet', sheet]]) {
    const live = noComments(src);
    assert.doesNotMatch(
      live,
      /counts\?\?\.?CL|\.CL \|\| 0\) \+|mark_counts\?\.CL/,
      `the ${name} adds the leave codes up by hand again`
    );
  }
});

test('the grid says what its PL column counts, as the salary sheet does', () => {
  /* "Paid leave taken" alone is what let the two drift unnoticed: it reads
     as the PL mark, which is exactly what it used to be. */
  const head = grid.match(/<th title="([^"]*)">PL<\/th>/);
  assert.ok(head, 'the PL header is gone');
  for (const code of ['CL', 'SL', 'PL']) {
    assert.ok(head[1].includes(code), `the PL tooltip does not name ${code}`);
  }
});

test('a paid holiday has a column', () => {
  assert.match(grid, /<th title="[^"]*">HOL<\/th>/, 'the HOL header is gone');
  assert.match(grid, /\{counts\.PH \|\| '-'\}/, 'nothing counts a paid holiday');
});

/* ================================================================= *
 * the invariant
 * ================================================================= */

/**
 * Which of the grid's summary columns counts each mark. A code with no
 * column is a day that is marked on the grid, paid from the grid, and
 * invisible in the grid's own month figures.
 */
const COLUMN_FOR = {
  P: 'P', WH: 'P', OD: 'P', DD: 'P',
  A: 'Absent', AD: 'Absent',
  UL: 'LWP',          /* and Absent, since it costs a day */
  HF: 'HD',           /* and Absent, at half a day */
  S: 'WO',
  PH: 'HOL',
  CL: 'PL', SL: 'PL', PL: 'PL',
  SP: 'Sun', HP: 'Sun',
};

test('EVERY MARK IS COUNTED SOMEWHERE - a new one fails here until it has a column', () => {
  const missing = Object.keys(ATTENDANCE_CODES).filter((code) => !COLUMN_FOR[code]);
  assert.deepEqual(
    missing,
    [],
    `these marks are counted in no column on the grid: ${missing.join(', ')}`
  );
  /* And nothing in the map names a code that no longer exists. */
  const stale = Object.keys(COLUMN_FOR).filter((code) => !ATTENDANCE_CODES[code]);
  assert.deepEqual(stale, [], `the map names marks that are gone: ${stale.join(', ')}`);
});

test('and the grid really renders each of those columns', () => {
  const live = noComments(grid);
  for (const column of new Set(Object.values(COLUMN_FOR))) {
    assert.match(
      live,
      new RegExp(`>${column}</th>`),
      `the ${column} column is in the map and not on the grid`
    );
  }
});

test('the month a row shows adds up to the days it has marked', () => {
  /*
   * The whole point, stated as arithmetic. Absent is in DAYS OF SALARY (a
   * half day costs 0.5, a double absence 2), so it cannot be added to a day
   * count - the day columns are counted here instead.
   */
  const counts = { P: 8, A: 1, HF: 1, CL: 1, SL: 1, PL: 1, UL: 1, PH: 2, S: 4, SP: 1, HP: 1, WH: 1, OD: 1, AD: 1 };
  const marked = Object.values(counts).reduce((a, b) => a + b, 0);

  const onTheRow =
    (counts.P + counts.WH + counts.OD) +   // P
    (counts.A + counts.AD) +               // Absent, as days
    counts.S +                             // WO
    counts.PH +                            // HOL
    paidLeaveDays(counts) +                // PL
    counts.UL +                            // LWP
    counts.HF +                            // HD
    (counts.SP + counts.HP);               // Sun

  assert.equal(onTheRow, marked, 'the row does not account for every marked day');
  assert.equal(marked, 25);
});
