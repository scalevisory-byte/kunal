/**
 * THE DAILY WHATSAPP REPORT — the message HR already types every morning.
 *
 * What these pin, each of them a rule the roll call learned the hard way:
 *
 *  - **A day nobody has marked is not a day everybody was absent.**
 *  - **A reason is carried, in brackets**, because that is what the group
 *    actually reads.
 *  - **"Not known" is never "on time"** — no clock time means not listed as
 *    late, not counted as punctual.
 *  - **A half day, leave or an absence is never judged late or early.**
 *  - **The uniform is three-state**, and both spellings of "no" count: the
 *    server answers with a boolean and the offline store with 0/1.
 *  - **Nobody is asked about the uniform of somebody working from home.**
 *  - **Office inspection, conduct and incidents are never invented** — they
 *    appear only when the office passes them in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPED_DEFAULTS, dailyReport } from '../../shared/dailyReport.js';

const DAY = 19;
const person = (id, name, entry) => ({
  employee_id: id,
  employee_name: name,
  attendance: entry === null ? {} : { [DAY]: entry },
});

const STANDARD = { in: '09:30', out: '18:30' };
const build = (rows, opts = {}) =>
  dailyReport({ rows, day: DAY, date: '2026-11-19', standard: STANDARD, ...opts });

test('a day nobody has marked says so instead of listing everybody as absent', () => {
  const built = build([person(1, 'Amit Patel', null), person(2, 'Riya Pal', null)]);
  assert.equal(built.counts.nothing_marked, true);
  assert.equal(built.counts.absent, 0);
  assert.ok(built.text.includes('Nothing is marked for this day yet'));
  assert.ok(!built.text.includes('Amit Patel'));
  assert.ok(!built.text.includes('Riya Pal'));
});

test('an absence carries the reason in brackets, the way the group reads it', () => {
  const built = build([
    person(1, 'Disha Sakre', { code: 'A', reason: 'WENT TO VILLAGE' }),
    person(2, 'Amit Patel', { code: 'P', in_time: '09:30', out_time: '18:30' }),
  ]);
  assert.ok(built.text.includes('• Disha Sakre (WENT TO VILLAGE)'));
  assert.equal(built.counts.absent, 1);
  assert.equal(built.counts.present, 1);
});

test('an absence with no reason is named plainly, never guessed at', () => {
  const built = build([person(1, 'Disha Sakre', { code: 'A' })]);
  assert.ok(built.text.includes('• Disha Sakre'));
  assert.ok(!built.text.includes('('));
});

test('somebody with no clock time is not called late, and not called punctual either', () => {
  const built = build([person(1, 'Mahesh Shinde', { code: 'P' })]);
  assert.equal(built.counts.late, 0);
  assert.ok(built.text.includes('None today'));
});

test('late is counted from the office start, with how late', () => {
  const built = build([person(1, 'Amit Patel', { code: 'P', in_time: '10:22', out_time: '18:40' })]);
  assert.equal(built.counts.late, 1);
  assert.ok(built.text.includes('Amit Patel — 10:22'));
  assert.ok(/52m late/.test(built.text));
});

test('the grace is the one it is given, so the message matches what payroll would charge', () => {
  const rows = [person(1, 'Amit Patel', { code: 'P', in_time: '09:40' })];
  assert.equal(build(rows).counts.late, 0); // inside the usual 15 minutes
  assert.equal(build(rows, { standard: { ...STANDARD, grace: 0 } }).counts.late, 1);
});

test('a half day, leave and an absence are never judged late or early', () => {
  const built = build([
    person(1, 'Riya Pal', { code: 'CL', in_time: '11:30', out_time: '14:00' }),
    person(2, 'Mahesh Shinde', { code: 'HF', in_time: '11:30', out_time: '14:00' }),
    person(3, 'Disha Sakre', { code: 'A', in_time: '11:30', out_time: '14:00' }),
  ]);
  assert.equal(built.counts.late, 0);
  assert.equal(built.counts.early, 0);
});

test('a working day cut short is an early finish', () => {
  const built = build([person(1, 'Priya Nair', { code: 'P', in_time: '09:30', out_time: '17:10' })]);
  assert.equal(built.counts.early, 1);
  assert.ok(built.text.includes('Priya Nair — 17:10'));
});

test('out of uniform counts both ways of saying no, and never an absence', () => {
  const fromServer = build([
    person(1, 'Priya Nair', { code: 'P', uniform: false }),
    person(2, 'Amit Patel', { code: 'P', uniform: true }),
    person(3, 'Disha Sakre', { code: 'A', uniform: false }),
  ]);
  assert.equal(fromServer.counts.out_of_uniform, 1);
  assert.ok(fromServer.text.includes('Out of uniform:'));
  assert.ok(!fromServer.text.split('Out of uniform:')[1].includes('Disha Sakre'));

  const fromTheOfflineStore = build([
    person(1, 'Priya Nair', { code: 'P', uniform: 0 }),
    person(2, 'Amit Patel', { code: 'P', uniform: 1 }),
  ]);
  assert.equal(fromTheOfflineStore.counts.out_of_uniform, 1);
});

test('a floor nobody walked reads as not checked, not as everybody in uniform', () => {
  const built = build([
    person(1, 'Priya Nair', { code: 'P' }),
    person(2, 'Amit Patel', { code: 'P' }),
  ]);
  assert.ok(built.text.includes('Not checked today'));
  assert.ok(!built.text.includes('All staff in proper uniform'));
});

test('nobody is asked about the uniform of somebody working from home', () => {
  const built = build([
    person(1, 'Priya Nair', { code: 'P', uniform: true }),
    person(2, 'Amit Patel', { code: 'WH' }),
  ]);
  assert.equal(built.counts.at_work, 1);
  assert.equal(built.counts.uniform_not_checked, 0);
  assert.ok(built.text.includes('All staff in proper uniform'));
  // Still a day present: working from home is a day worked.
  assert.equal(built.counts.present, 2);
});

test('overtime is listed as hours, longest first', () => {
  const built = build([
    person(1, 'Mahesh Shinde', { code: 'P', minutes: 135 }),
    person(2, 'Amit Patel', { code: 'P', minutes: 30 }),
    person(3, 'Priya Nair', { code: 'P', minutes: -80 }),
  ]);
  assert.equal(built.counts.overtime, 2);
  const lines = built.text.split('Overtime')[1];
  assert.ok(lines.indexOf('Mahesh Shinde') < lines.indexOf('Amit Patel'));
  assert.ok(lines.includes('2h 15m'));
  assert.ok(!lines.includes('Priya Nair'));
});

test('inspection, conduct and incidents appear only when the office passes them in', () => {
  const bare = build([person(1, 'Amit Patel', { code: 'P' })]);
  assert.ok(!bare.text.includes('Office Inspection'));
  assert.ok(!bare.text.includes('Conduct'));
  assert.ok(!bare.text.includes('Incidents'));

  const told = build([person(1, 'Amit Patel', { code: 'P' })], { typed: TYPED_DEFAULTS });
  assert.ok(told.text.includes('Office Inspection\nAll checklist items OK'));
  assert.ok(told.text.includes('Conduct\nNo issues today'));
  assert.ok(told.text.includes('Incidents\nLogged today: 0 | Pending overall: 0'));
});

test('a line left blank reads as not recorded, never as an answer', () => {
  const built = build([person(1, 'Amit Patel', { code: 'P' })], { typed: { inspection: '   ' } });
  assert.ok(built.text.includes('Office Inspection\nNot recorded'));
});

test('the heading is whatever the office calls it', () => {
  const built = build([person(1, 'Amit Patel', { code: 'P' })], {
    title: 'BOOKNFLY DAILY OFFICE REPORT',
  });
  assert.equal(built.text.split('\n')[0], 'BOOKNFLY DAILY OFFICE REPORT');
  assert.equal(built.text.split('\n')[1], 'Date: 19 November 2026');
});
