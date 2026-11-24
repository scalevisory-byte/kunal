/*
 * "SHIFT TIME ADD KIYA, PHIR BHI JO LATE KA HAI WO TIME PROPER SHOW NHI KR
 * RHA HAI" — HR, on the live dashboard, with the shift column filled in.
 *
 * It was true. `shiftFor` has always existed and the PAYROLL has always used
 * it, so a shift typed on somebody's record really did change what they were
 * charged. The SCREENS did not: the roll call, the month's late count and the
 * daily WhatsApp message each judged everybody against the office day.
 *
 * So a shift could be set, move the payslip, and change nothing anybody could
 * see — and on an evening shift it was worse than nothing: they read as hours
 * late every single day, which is how a late list stops being read at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { shiftTimesFor } from '../../shared/lateEarly.js';
import { isLateIn, isEarlyOut, lateByMinutes } from '../../shared/timesheet.js';
import { dailyReport } from '../../shared/dailyReport.js';

const OFFICE = { in_time: '09:30', out_time: '18:30' };

test('somebody with no shift of their own is judged on the office day', () => {
  const shift = shiftTimesFor({}, OFFICE);
  assert.equal(shift.in, '09:30');
  assert.equal(shift.out, '18:30');
});

test('THEIR OWN SHIFT WINS, and an evening shift is not five hours late', () => {
  const evening = { name: 'Night desk', shift_in: '14:00', shift_out: '23:00' };
  const shift = shiftTimesFor(evening, OFFICE);
  assert.equal(shift.in, '14:00');
  assert.equal(shift.out, '23:00');

  const day = { code: 'P', in_time: '14:05', out_time: '23:05' };
  /* Against the office day this is four and a half hours late, every day. */
  assert.equal(isLateIn(day, { start: OFFICE.in_time, grace: 15 }), true);
  assert.equal(lateByMinutes(day, { start: OFFICE.in_time }), 275);
  /* Against their own, they are five minutes in and inside the grace. */
  assert.equal(isLateIn(day, { start: shift.in, grace: 15 }), false);
  assert.equal(isEarlyOut(day, { end: shift.out, grace: 15 }), false);
});

test('a shift of their own does not excuse being late for it', () => {
  const theirs = { shift_in: '11:00', shift_out: '20:00' };
  const shift = shiftTimesFor(theirs, OFFICE);
  const day = { code: 'P', in_time: '11:40', out_time: '20:00' };
  assert.equal(isLateIn(day, { start: shift.in, grace: 15 }), true);
  assert.equal(lateByMinutes(day, { start: shift.in }), 40);
});

test('the office day is taken in either spelling', () => {
  /* The screens hold it as {in_time,out_time}; the rules hold it as
     {shift_in,shift_out}. One helper, so neither caller has to convert. */
  assert.equal(shiftTimesFor({}, { shift_in: '10:00', shift_out: '19:00' }).in, '10:00');
  assert.equal(shiftTimesFor({}, { in: '10:00', out: '19:00' }).out, '19:00');
  /* Nothing at all still gives a sane day rather than undefined. */
  assert.equal(shiftTimesFor({}, {}).in, '09:30');
});

/* ================================================================= *
 * the daily WhatsApp message
 * ================================================================= */

const rowsFor = (people) =>
  people.map((p, i) => ({
    employee_id: i + 1,
    employee_name: p.name,
    company_name: 'BOOKNFLY',
    shift_in: p.shift_in,
    shift_out: p.shift_out,
    attendance: { 5: { code: 'P', in_time: p.in_time, out_time: p.out_time, minutes: 0 } },
  }));

const message = (people) =>
  dailyReport({
    period: { id: 1, year: 2026, month: 11, label: 'November 2026', lunch_paid: 1 },
    rows: rowsFor(people),
    day: 5,
    standard: { in: '09:30', out: '18:30', grace: 15 },
  }).text;

test('THE GROUP MESSAGE NAMES THE RIGHT PEOPLE', () => {
  const text = message([
    // On the office day and genuinely late.
    { name: 'Amit Shah', in_time: '10:20', out_time: '18:35' },
    // On an evening shift, and exactly on time for it.
    { name: 'Night Desk', shift_in: '14:00', shift_out: '23:00', in_time: '14:02', out_time: '23:05' },
  ]);
  assert.match(text, /Amit Shah/, 'the person who really was late is missing');
  assert.ok(
    !/Night Desk/.test(text),
    'somebody on time for their own shift went out to the group as late'
  );
});

test('and still names somebody late for a shift of their own', () => {
  const text = message([
    { name: 'Night Desk', shift_in: '14:00', shift_out: '23:00', in_time: '15:10', out_time: '23:05' },
  ]);
  assert.match(text, /Night Desk/);
  /* How late is measured against THEIR start, not the office's. */
  assert.match(text, /1h 10m/, `the lateness was measured against the wrong start:\n${text}`);
});

test('an early finish is judged against their own end too', () => {
  const text = message([
    { name: 'Night Desk', shift_in: '14:00', shift_out: '23:00', in_time: '14:00', out_time: '21:00' },
  ]);
  assert.match(text, /Night Desk/, 'two hours early on their own shift was not noticed');
});

test('nothing here moves a figure', () => {
  /*
   * Late and early on these screens are a LIST, never a deduction. What is
   * charged is `late_policy` on the month, computed in `calculateRow` from
   * the same `shiftFor` this now uses - so correcting the screens brings them
   * into line with the payslip rather than changing either.
   */
  const report = dailyReport({
    period: { id: 1, year: 2026, month: 11, label: 'November 2026', lunch_paid: 1 },
    rows: rowsFor([{ name: 'Night Desk', shift_in: '14:00', shift_out: '23:00', in_time: '14:02', out_time: '23:05' }]),
    day: 5,
    standard: { in: '09:30', out: '18:30', grace: 15 },
  });
  assert.ok(!/₹/.test(report.text), 'the daily message is not about money');
});

test('A SHIFT EQUAL TO THE COLUMN DEFAULT IS "NOT SET", so the office day still wins', () => {
  /*
   * `employees.shift_in` carries a DEFAULT of 09:30 for everybody, so
   * "nobody set one" and "somebody set 09:30" are the same bytes. Reading a
   * default as a personal shift would make the office's own start do nothing
   * for all eighty-six people still carrying it - the office setting would
   * quietly be ignored, which is the same complaint one level up.
   */
  const everybody = { shift_in: '09:30', shift_out: '18:30' };
  const office = shiftTimesFor(everybody, { in_time: '10:00', out_time: '19:00' });
  assert.equal(office.in, '10:00', 'the office start was ignored for somebody on the default');
  assert.equal(office.out, '19:00');

  /* And a real shift still wins over the office day. */
  const theirs = shiftTimesFor({ shift_in: '14:00', shift_out: '23:00' }, { in_time: '10:00', out_time: '19:00' });
  assert.equal(theirs.in, '14:00');
  assert.equal(theirs.out, '23:00');
});

test('the two halves are judged apart', () => {
  /* Somebody who starts with everybody and finishes late keeps the office
     start and their own finish. */
  const mixed = shiftTimesFor({ shift_in: '09:30', shift_out: '22:00' }, { in_time: '09:30', out_time: '18:30' });
  assert.equal(mixed.in, '09:30');
  assert.equal(mixed.out, '22:00');
});
