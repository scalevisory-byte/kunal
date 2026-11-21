/**
 * EVERY PERSON CAN WORK THEIR OWN HOURS.
 *
 * Dinesh, looking at the live Time tab: *"timing shift har staff ki alag
 * alag ho sakti he"*.
 *
 * Shifts were ALREADY held per person (`employees.shift_in` / `shift_out`,
 * editable on the record) and ALREADY used to judge late and early - a
 * night-shift worker measured against 09:30 would read as five hours late
 * every day, and that had been dealt with.
 *
 * What had not: **Fill the usual timings wrote the OFFICE'S one day onto
 * everybody.** One click put 09:00-18:00 onto somebody who works nights.
 * Their hours came out wrong, and because the fill looks like it worked,
 * nothing on the screen said so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillTimesFor, hasOwnShift, shiftFor } from '../../shared/lateEarly.js';
import { timesToDay } from '../../shared/timesheet.js';

const OFFICE = { in_time: '09:00', lunch_out: '13:00', lunch_in: '13:30', out_time: '18:00' };

test('somebody with no shift of their own gets the office day, exactly as before', () => {
  assert.equal(hasOwnShift({}, OFFICE), false);
  assert.deepEqual(fillTimesFor({}, OFFICE), OFFICE);
  assert.deepEqual(fillTimesFor({ shift_in: '', shift_out: '' }, OFFICE), OFFICE);
  /* Nothing already set up can move - that is the whole of why this is safe
     to turn on across eighty-six people at once. */
  assert.deepEqual(fillTimesFor({ shift_in: null }, OFFICE), OFFICE);
});

test('A NIGHT SHIFT IS FILLED WITH ITS OWN HOURS, not the office’s', () => {
  const night = fillTimesFor({ shift_in: '22:00', shift_out: '06:00' }, OFFICE);
  assert.equal(night.in_time, '22:00');
  assert.equal(night.out_time, '06:00');
});

test('...and a shift crossing midnight is filled with NO lunch', () => {
  /* The office's 13:00-13:30 is in the middle of their night off. Writing it
     onto the day would take half an hour off hours they worked in full. */
  const night = fillTimesFor({ shift_in: '22:00', shift_out: '06:00' }, OFFICE);
  assert.equal(night.lunch_out, '');
  assert.equal(night.lunch_in, '');
});

test('an afternoon shift drops the lunch too, because the office’s is before they start', () => {
  const late = fillTimesFor({ shift_in: '14:00', shift_out: '23:00' }, OFFICE);
  assert.equal(late.in_time, '14:00');
  assert.equal(late.out_time, '23:00');
  assert.equal(late.lunch_out, '', 'a 13:00 break on a shift that starts at 14:00 is nonsense');
});

test('...but a shift that merely starts earlier KEEPS the office break', () => {
  const early = fillTimesFor({ shift_in: '08:00', shift_out: '17:00' }, OFFICE);
  assert.equal(early.in_time, '08:00');
  assert.equal(early.out_time, '17:00');
  assert.equal(early.lunch_out, '13:00', 'one o’clock is inside eight to five');
  assert.equal(early.lunch_in, '13:30');
});

test('half a shift is still their own shift', () => {
  /* Only one of the two typed: the one that is set is theirs and the other
     falls back to the office, rather than the whole thing being ignored. */
  assert.equal(hasOwnShift({ shift_in: '07:00' }, OFFICE), true);
  const half = fillTimesFor({ shift_in: '07:00' }, OFFICE);
  assert.equal(half.in_time, '07:00');
  assert.equal(half.out_time, '18:00');
});

test('THE HOURS THAT COME OUT ARE RIGHT, which is the point of all of it', () => {
  const night = fillTimesFor({ shift_in: '22:00', shift_out: '06:00' }, OFFICE);
  const day = timesToDay(night, { hoursPerDay: 8, deductLunch: true });
  assert.equal(day.worked, 480, 'ten at night to six is eight hours');
  assert.equal(day.overnight, true);

  /* And what the office USED to write on that person: nine in the morning to
     six at night, less a lunch - a day they did not work at all. */
  const wrong = timesToDay(OFFICE, { hoursPerDay: 8, deductLunch: true });
  assert.equal(wrong.worked, 510);
  assert.notEqual(wrong.worked, day.worked);
});

test('the shift used for judging late is the SAME one that gets filled', () => {
  /* Two answers to "what hours does this person work" is how a day gets
     filled 09:00 and then called four hours late against 14:00. */
  const person = { shift_in: '14:00', shift_out: '23:00' };
  const judged = shiftFor(person, { shift_in: OFFICE.in_time, shift_out: OFFICE.out_time });
  const filled = fillTimesFor(person, OFFICE);
  assert.equal(judged.in, filled.in_time);
  assert.equal(judged.out, filled.out_time);
});

test('A SHIFT EQUAL TO THE OFFICE DAY IS NOT "THEIR OWN"', () => {
  /*
   * `employees.shift_in` carries a DEFAULT of 09:30 for every single person,
   * so "the column is filled in" proves nothing. Asked that way, all
   * eighty-six of his staff reported as working their own shift - wrong on
   * screen, and the wrong branch to take when filling a day.
   */
  const office = { in_time: '09:30', lunch_out: '13:00', lunch_in: '13:30', out_time: '18:30' };
  assert.equal(hasOwnShift({ shift_in: '09:30', shift_out: '18:30' }, office), false);
  assert.deepEqual(fillTimesFor({ shift_in: '09:30', shift_out: '18:30' }, office), office,
    'and they get the office day WITH its lunch, not a stripped-down copy');

  assert.equal(hasOwnShift({ shift_in: '09:30', shift_out: '22:00' }, office), true, 'a different finish is their own');
  assert.equal(hasOwnShift({ shift_in: '06:00', shift_out: '18:30' }, office), true, 'so is a different start');
});
