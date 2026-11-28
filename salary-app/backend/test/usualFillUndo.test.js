/**
 * v2.37.0: undoing "Fill the usual timings", and the hours under each Sunday.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usualFillDays } from '../../shared/usualFill.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OFFICE = { in_time: '09:30', out_time: '18:30', lunch_out: '', lunch_in: '' };
const jaswant = { employee_id: 1, employee_name: 'Jaswant' };
const abdul = { employee_id: 2, employee_name: 'Abdulhak', shift_in: '10:00', shift_out: '19:00' };
const ajay = { employee_id: 3, employee_name: 'Ajay' };
const days = {
  1: { in_time: '09:30', out_time: '18:30' },  // the office day, filled
  2: { in_time: '10:00', out_time: '19:00' },  // his own shift, filled
  3: { in_time: '09:53' },                     // a real arrival
};
const entryOf = (row) => days[row.employee_id];
const targets = [jaswant, abdul, ajay].map((row) => ({ row, day: 28 }));

test('a day carrying exactly the usual times, with no punch behind it, is the fill', () => {
  const got = usualFillDays(targets, { standard: OFFICE, entryOf, punches: {} });
  assert.deepEqual(got.map((d) => d.row.employee_name), ['Jaswant', 'Abdulhak']);
});

test('a punch on record that day means it was not a fill, whatever the times say', () => {
  const got = usualFillDays(targets, { standard: OFFICE, entryOf, punches: { 1: { 28: [{ at: '09:30' }] } } });
  assert.deepEqual(got.map((d) => d.row.employee_name), ['Abdulhak']);
});

test('a time typed differently is not offered', () => {
  const got = usualFillDays([{ row: jaswant, day: 28 }], {
    standard: OFFICE,
    entryOf: () => ({ in_time: '09:30', out_time: '18:45' }),
    punches: {},
  });
  assert.equal(got.length, 0);
});

test('the Sunday tab prints the hours under each tick, and "no times" for an unclocked one', () => {
  const tab = fs.readFileSync(path.join(here, '../../frontend/src/components/SundayRegister.jsx'), 'utf8');
  assert.match(tab, /className=\{`sun-hrs/);
  assert.match(tab, /formatDuration\(seen\.worked\) : 'no times'/);
  const css = fs.readFileSync(path.join(here, '../../frontend/src/styles.css'), 'utf8');
  assert.match(css, /\.sun-hrs \{/);
});
