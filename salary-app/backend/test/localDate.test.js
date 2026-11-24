/*
 * "TODAY" MUST MEAN TODAY HERE.
 *
 * Found while auditing the salary sheet. Marking a row **paid** stamps
 * `payment_date` silently, and the date it stamped came from
 * `new Date().toISOString().slice(0, 10)` - the UTC date. IST is five and a
 * half hours ahead of UTC, so from midnight to half past five in the morning
 * that returns YESTERDAY. At 00:30 on 1 December a November salary was
 * stamped **30 November**: the wrong month, which is the one a reconciliation
 * reads. Seventy-two places did it, on both sides of the app.
 *
 * THIS FILE RUNS IN IST ON PURPOSE. In UTC the two answers are the same
 * string and a test written here would prove nothing - which is also why the
 * whole suite stayed green through the change, and why this file exists.
 * Same trap and same answer as `localStamp` in punchClock.js.
 */
process.env.TZ = 'Asia/Kolkata';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { todayIso, isoOf, isoPlusDays } from '../../shared/today.js';
import { todayLong } from '../../frontend/src/format.js';

/** 02:00 IST on 24 November 2026 - an ordinary late night on his server. */
const TWO_AM = new Date('2026-11-23T20:30:00Z');
/** 00:30 IST on 1 December 2026 - the expensive one. */
const MONTH_TURN = new Date('2026-11-30T19:00:00Z');

test('the runner really is in IST, or nothing below means anything', () => {
  assert.equal(new Date().getTimezoneOffset(), -330, 'TZ=Asia/Kolkata did not take');
  assert.equal(TWO_AM.getDate(), 24, 'that moment is not the 24th here');
});

test('THE BUG: at 2am the UTC date is yesterday, and the local one is not', () => {
  assert.equal(TWO_AM.toISOString().slice(0, 10), '2026-11-23', 'the old way');
  assert.equal(todayIso(TWO_AM), '2026-11-24', 'the new way');
});

test('AT THE TURN OF A MONTH IT WAS THE WRONG MONTH', () => {
  /*
   * This is the one that mattered: a payment marked at half past midnight on
   * 1 December was dated into November.
   */
  assert.equal(MONTH_TURN.toISOString().slice(0, 10), '2026-11-30');
  assert.equal(todayIso(MONTH_TURN), '2026-12-01');
});

test('the date the screen SHOWS and the date it WRITES agree', () => {
  /*
   * `todayLong` was already local, so the header said 24 November while
   * everything the app wrote said the 23rd. One day, two answers.
   */
  for (const at of [TWO_AM, MONTH_TURN, new Date('2026-07-04T12:00:00Z')]) {
    const written = todayIso(at);
    const shown = todayLong(at);
    const day = Number(written.slice(8));
    assert.ok(
      shown.includes(` ${day} `),
      `the header says "${shown}" and the record says ${written}`
    );
  }
});

test('an unreadable date is empty, never the string NaN-aN-aN', () => {
  for (const bad of ['not a date', '', null, undefined, NaN]) {
    assert.equal(isoOf(bad), '', String(bad));
  }
});

test('isoPlusDays counts in local days and crosses a month end', () => {
  assert.equal(isoPlusDays(7, MONTH_TURN), '2026-12-08');
  assert.equal(isoPlusDays(-1, TWO_AM), '2026-11-23');
  assert.equal(isoPlusDays(0, TWO_AM), todayIso(TWO_AM));
  /* 30 days from 2 Feb lands in March, which is the invitation expiry case. */
  assert.equal(isoPlusDays(30, new Date('2027-02-02T06:00:00Z')), '2027-03-04');
});

/* ================================================================= *
 * nowhere writes its own "today" any more
 * ================================================================= */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');

/*
 * Built from parts so this file's own sweep cannot match the pattern it is
 * looking for - the same reason the other sweeps strip comments first.
 */
const UTC_TODAY = new RegExp(['new Date\\(\\)', '\\.toISOString\\(\\)', '\\.slice\\(0,\\s*10\\)'].join(''));

/*
 * A date read out of a SPREADSHEET is left alone, and this names the three
 * files it is left alone in. Those turn an Excel serial into a Date at UTC
 * midnight and then render it, which is self-consistent: reading them as
 * local would move every imported date back a day.
 */
const SPREADSHEET_READERS = ['shared/assetImport.js', 'shared/employeeSheet.js', 'shared/monthlyStatus.js'];

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

test('NOBODY WRITES THEIR OWN TODAY - there is one answer, and it is imported', () => {
  const files = [
    ...walk(path.join(root, 'frontend/src')),
    ...walk(path.join(root, 'backend/src')),
    ...walk(path.join(root, 'shared')),
  ];
  assert.ok(files.length > 100, 'the sweep found almost nothing - check the paths');

  const offenders = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (SPREADSHEET_READERS.includes(rel)) continue;
    const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (UTC_TODAY.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `these still work out today in UTC: ${offenders.join(', ')}`);
});

test('and the three spreadsheet readers are exempt ON PURPOSE, not by accident', () => {
  for (const rel of SPREADSHEET_READERS) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.match(src, /toISOString\(\)\.slice\(0, 10\)/, `${rel} no longer needs its exemption - take it off the list`);
  }
});

/* ================================================================= *
 * the screen the audit started on
 * ================================================================= */

test('marking a salary row paid stamps the LOCAL date', () => {
  const src = fs.readFileSync(path.join(root, 'frontend/src/components/salary/PaymentTracking.jsx'), 'utf8');
  assert.match(src, /payment_date: today\(\)/, 'the payment date is no longer stamped here');
  assert.match(src, /const today = \(\) => todayIso\(\)/, 'it works the date out itself again');
  assert.match(src, /from '.*shared\/today\.js'/);
});
