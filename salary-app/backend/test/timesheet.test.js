import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  formatTime,
  hasTimes,
  monthTotals,
  parseTime,
  readTimes,
  timesToDay,
} from '../../shared/timesheet.js';

test('a time is read however it was typed', () => {
  assert.equal(parseTime('9:30'), 570);
  assert.equal(parseTime('09:30'), 570);
  assert.equal(parseTime('9.30'), 570);
  assert.equal(parseTime('930'), 570);
  assert.equal(parseTime('0930'), 570);
  assert.equal(parseTime('9'), 540, 'a bare number is an hour');
  assert.equal(parseTime('18:30'), 1110);
  assert.equal(parseTime('6:30 pm'), 1110);
  assert.equal(parseTime('6pm'), 1080);
  assert.equal(parseTime('12am'), 0, 'midnight, not noon');
  assert.equal(parseTime('12pm'), 720, 'noon stays noon');
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('-'), null);
  assert.equal(parseTime('lunch'), null);
  assert.equal(parseTime('25:00'), null, 'there is no 25th hour');
  assert.equal(parseTime('9:75'), null);
});

test('times print back tidy', () => {
  assert.equal(formatTime(570), '09:30');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(null), '');
  assert.equal(formatDuration(495), '8h 15m');
  assert.equal(formatDuration(-45), '-45m', 'under an hour reads as minutes');
  assert.equal(formatDuration(60), '1h 00m');
});

test('a normal day: out minus in, less the lunch break', () => {
  const read = readTimes({ in_time: '09:30', lunch_out: '13:00', lunch_in: '13:45', out_time: '18:30' });
  assert.equal(read.gross, 540, 'nine hours between in and out');
  assert.equal(read.lunch, 45);
  assert.equal(read.worked, 495);
  assert.equal(read.overnight, false);
  assert.equal(read.warning, '');
});

test('a shift that ends after midnight counts as one day, not minus one', () => {
  const read = readTimes({ in_time: '21:00', out_time: '05:00' });
  assert.equal(read.worked, 480, 'eight hours across midnight');
  assert.equal(read.overnight, true);
});

test('half a lunch, a lunch longer than the day, and a missing punch are all called out', () => {
  assert.match(readTimes({ in_time: '09:00', lunch_out: '13:00', out_time: '18:00' }).warning, /only one lunch/);
  const silly = readTimes({ in_time: '09:00', lunch_out: '09:30', lunch_in: '20:00', out_time: '18:00' });
  assert.match(silly.warning, /longer than the day/);
  assert.equal(silly.lunch, 0, 'and the break is not taken off');
  assert.match(readTimes({ out_time: '18:00' }).warning, /no in time/);
  assert.match(readTimes({ in_time: '09:00' }).warning, /no out time/);
  assert.equal(readTimes({ in_time: '09:00' }).worked, null, 'one punch measures nothing');
});

test('short hours past the grace become the day minutes, and a few minutes do not', () => {
  const short = timesToDay({ in_time: '09:30', lunch_out: '13:00', lunch_in: '13:45', out_time: '18:30' }, { hoursPerDay: 9 });
  assert.equal(short.diff, -45);
  assert.equal(short.minutes, -45, 'past the 15 minute grace, so it is deducted');
  assert.equal(short.code, 'P');

  const nearly = timesToDay({ in_time: '09:30', out_time: '18:20' }, { hoursPerDay: 9 });
  assert.equal(nearly.diff, -10);
  assert.equal(nearly.minutes, 0, 'ten minutes late is not money');

  const late = timesToDay({ in_time: '09:00', out_time: '20:00' }, { hoursPerDay: 9 });
  assert.equal(late.minutes, 120, 'two hours of overtime');
});

test('under four and a half hours is a half day, and is not charged twice', () => {
  const day = timesToDay({ in_time: '09:00', out_time: '12:00' }, { hoursPerDay: 9 });
  assert.equal(day.worked, 180);
  assert.equal(day.code, 'HF');
  assert.equal(day.minutes, 0, 'half a day is already paid at half - the missing hours are not deducted again');
});

test('a day with no times has nothing to say about the mark', () => {
  const day = timesToDay({}, { hoursPerDay: 9 });
  assert.equal(day.worked, null);
  assert.equal(day.code, '');
  assert.equal(day.minutes, 0);
  assert.equal(hasTimes({}), false);
  assert.equal(hasTimes({ in_time: '09:00' }), true);
  assert.equal(hasTimes({ code: 'P', minutes: -30 }), false, 'a mark is not a time');
});

test('the month adds up only the days that were clocked', () => {
  const totals = monthTotals(
    [
      { in_time: '09:30', out_time: '18:30' }, // 9h, bang on
      { in_time: '09:30', out_time: '17:30' }, // an hour short
      { in_time: '09:30', out_time: '20:30' }, // two hours over
      { code: 'A' }, // absent, nothing clocked
      {}, // nothing at all
    ],
    { hoursPerDay: 9 }
  );
  assert.equal(totals.days, 3);
  assert.equal(totals.worked, 540 + 480 + 660);
  assert.equal(totals.expected, 3 * 540);
  assert.equal(totals.short, 60);
  assert.equal(totals.overtime, 120);
});

test('the month\'s clock hours ride along on the calculated row', async () => {
  const { calculateRow } = await import('../../shared/calc.js');
  const row = calculateRow({ salary: 26000 }, { hours_per_day: 9 }, {
    1: { code: 'P', in_time: '09:30', lunch_out: '13:00', lunch_in: '13:45', out_time: '18:30' },
    2: { code: 'P', in_time: '09:00', out_time: '18:00' },
    3: { code: 'A' },
  });
  assert.equal(row.worked_minutes, 495 + 540, 'only the days that were clocked');
});
