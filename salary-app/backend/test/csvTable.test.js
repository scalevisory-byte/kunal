import test from 'node:test';
import assert from 'node:assert/strict';
import { looksNumeric, numericColumns, parseCsv } from '../../shared/csvTable.js';

/**
 * READING A REPORT FILE BACK, so it can be printed.
 *
 * Dinesh: *"sare reports me proper printing reports dalo"*. Half the reports
 * were a download and nothing else.
 */

test('a CSV is split properly, not on every comma', () => {
  /*
   * These files carry names like "O'Brien, Sons" and remarks with commas in
   * them, correctly quoted by the server. A naive split shifts every column
   * after one of those by a place, silently.
   */
  const rows = parseCsv('Name,Note,Amount\r\n"Shah, Amit","said ""yes"" on Monday",1200\r\nRiya,,800\r\n');
  assert.deepEqual(rows[0], ['Name', 'Note', 'Amount']);
  assert.deepEqual(rows[1], ['Shah, Amit', 'said "yes" on Monday', '1200']);
  assert.deepEqual(rows[2], ['Riya', '', '800']);
  assert.equal(rows.length, 3, 'the trailing newline made a fourth row');
});

test('the BOM is not part of the first heading', () => {
  /* It is written on purpose so Excel opens the rupee signs; printed, it is
     an invisible character at the front of the first column name. */
  const rows = parseCsv('﻿Company,Amount\nBOOKNFLY,100\n');
  assert.equal(rows[0][0], 'Company');
});

test('a column of codes is never added up', () => {
  const head = ['Employee code', 'UAN', 'Name', 'PIN code', 'Amount', 'Days'];
  const rows = [
    ['BOO-001', '100200300400', 'Amit Shah', '390007', '22,489', '20'],
    ['BOO-002', '100200300401', 'Riya Pal', '390011', '45,872', '18'],
  ];
  assert.deepEqual(numericColumns(head, rows), [false, false, false, false, true, true]);

  /*
   * A heading that names an identifier is left alone WHATEVER its values
   * look like: a UAN column summing to 200,400,600,801 is worse than no
   * total at all.
   */
  assert.equal(numericColumns(['UAN'], [['123456789012']])[0], false);
  /* And a column with one word in it is not a figure column either. */
  assert.equal(numericColumns(['Amount'], [['100'], ['n/a']])[0], false);
  /* A blank cell says nothing either way - a column of amounts with one gap
     is still a column of amounts. */
  assert.equal(numericColumns(['Amount'], [['100'], ['']])[0], true);
  /* A column of nothing but blanks has nothing to add. */
  assert.equal(numericColumns(['Amount'], [[''], ['']])[0], false);
});

test('a figure is read through its rupee sign, its commas and its minus', () => {
  assert.equal(looksNumeric('1,200'), 1200);
  assert.equal(looksNumeric('₹ 22,489'), 22489);
  assert.equal(looksNumeric('-450.50'), -450.5);
  assert.equal(looksNumeric('20'), 20);
  /* Not a figure. */
  assert.equal(looksNumeric('BOO-001'), null);
  assert.equal(looksNumeric('09:30'), null);
  assert.equal(looksNumeric('2026-10-01'), null);
  /* Blank is "says nothing", which is not the same as nought. */
  assert.equal(looksNumeric(''), null);
  assert.equal(looksNumeric(null), null);
});

test('a file with only headings is still a report', () => {
  const rows = parseCsv('Company,Amount\n');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ['Company', 'Amount']);
});
