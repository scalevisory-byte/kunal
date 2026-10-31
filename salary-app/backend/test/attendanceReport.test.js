import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUMMARY_COLUMNS,
  attendanceDaywise,
  attendanceSummary,
  daywiseCsv,
} from '../../shared/attendanceReport.js';

const period = { id: 1, year: 2026, month: 10, label: 'October 2026', working_days: 26, hours_per_day: 9 };

/** A row shaped the way buildPayroll hands it over. */
const row = (name, attendance, extra = {}) => ({
  employee_id: extra.id ?? 1,
  company_id: extra.company_id ?? 1,
  company_name: extra.company_name ?? 'BNF',
  // buildPayroll hands these over under the payroll row's own column names.
  employee_code: extra.code ?? '3',
  employee_name: name,
  attendance,
  mark_counts: Object.values(attendance).reduce((counts, code) => {
    counts[code] = (counts[code] || 0) + 1;
    return counts;
  }, {}),
  present_days: extra.present_days ?? 26,
  absent_days: extra.absent_days ?? 0,
  overrides: extra.overrides ?? {},
});

/**
 * Takes PAIRS, not an object: JS puts integer-like keys first whatever order
 * they were written in, so `{ '1-18': 'P', '4': 'S' }` applies the 4th before
 * the range and the S is overwritten. An array keeps what was meant.
 */
const marks = (pairs) => {
  const out = {};
  for (const [range, code] of pairs) {
    const [from, to] = String(range).split('-').map(Number);
    for (let d = from; d <= (to || from); d += 1) out[d] = code;
  }
  return out;
};

test('the summary counts every mark, and days lost is in days of pay', () => {
  const payroll = {
    period,
    rows: [
      row('AJEET', marks([['1-20', 'P'], ['21', 'A'], ['22', 'HF'], ['23', 'AD'], ['24', 'CL'], ['25', 'S'], ['26', 'SP']]), {
        present_days: 22.5,
        absent_days: 3.5,
      }),
    ],
  };
  const [r] = attendanceSummary(payroll).rows;

  assert.equal(r.present, 20);
  assert.equal(r.absent, 1);
  assert.equal(r.half_day, 1);
  assert.equal(r.absent_two, 1);
  assert.equal(r.casual_leave, 1);
  assert.equal(r.sunday_off, 1);
  assert.equal(r.sunday_worked, 1);

  // Not a count of marks: A is 1, AD is 2, HF is a half.
  assert.equal(r.days_lost, 3.5);
  // Present + Sunday worked. A Sunday off is not a day at work.
  assert.equal(r.worked_days, 21);
  assert.equal(r.paid_off_days, 1);
  // Straight off the salary sheet, so the two can be read side by side.
  assert.equal(r.payable_days, 22.5);
});

test('attendance % is out of the days somebody was expected, not the calendar', () => {
  const payroll = {
    period,
    rows: [row('A', marks([['1-18', 'P'], ['19-20', 'A'], ['4', 'S'], ['11', 'S'], ['18', 'S']]))],
  };
  const [r] = attendanceSummary(payroll).rows;
  // 15 present + 3 Sundays off + 2 absent. The Sundays are not failures, so
  // the sum is 15 of 17.
  assert.equal(r.worked_days, 15);
  assert.equal(r.days_lost, 2);
  assert.equal(r.attendance_percent, Math.round((15 / 17) * 1000) / 10);
});

test('a month with nothing marked says so rather than claiming 100%', () => {
  const payroll = { period, rows: [row('Nobody', {})] };
  const [r] = attendanceSummary(payroll).rows;
  assert.equal(r.marked_days, 0);
  assert.equal(r.unmarked_days, 31);
  assert.equal(r.attendance_percent, null);
});

test('unmarked days are counted against the real length of the month', () => {
  const feb = { ...period, month: 2, year: 2027, label: 'February 2027' };
  const summary = attendanceSummary({ period: feb, rows: [row('A', marks([['1-10', 'P']]))] });
  assert.equal(summary.daysInMonth, 28);
  assert.equal(summary.rows[0].unmarked_days, 18);
});

test('a figure typed over the formula is shown as such', () => {
  const payroll = {
    period,
    rows: [row('A', marks([['1-20', 'P']]), { present_days: 26, absent_days: 0, overrides: { absent_days: true } })],
  };
  assert.equal(attendanceSummary(payroll).rows[0].overridden, true);
});

test('totals add up per company and overall', () => {
  const payroll = {
    period,
    rows: [
      row('A', marks([['1-20', 'P'], ['21', 'A']]), { id: 1, company_id: 1, company_name: 'BNF' }),
      row('B', marks([['1-18', 'P'], ['19-21', 'A']]), { id: 2, company_id: 2, company_name: 'SCALE' }),
    ],
  };
  const summary = attendanceSummary(payroll);
  assert.equal(summary.totals.people, 2);
  assert.equal(summary.totals.present, 38);
  assert.equal(summary.totals.days_lost, 4);
  assert.deepEqual(summary.companies.map((c) => c.company_name), ['BNF', 'SCALE']);
  assert.equal(summary.companies[0].totals.present, 20);
  assert.equal(summary.companies[1].totals.days_lost, 3);
});

test('the day-wise grid knows which columns are Sundays', () => {
  const daywise = attendanceDaywise({ period, rows: [row('A', marks([['1-3', 'P']]))] });
  assert.equal(daywise.days.length, 31);
  // 4 October 2026 is a Sunday.
  assert.equal(daywise.days[3].day, 4);
  assert.equal(daywise.days[3].sunday, true);
  assert.equal(daywise.days[0].sunday, false);
  assert.deepEqual(daywise.rows[0].marks.slice(0, 4), ['P', 'P', 'P', '']);
});

test('the muster CSV carries a BOM and one column per day', () => {
  const daywise = attendanceDaywise({ period, rows: [row('AJEET', marks([['1', 'P'], ['2', 'A']]))] });
  const csv = daywiseCsv(daywise);
  assert.ok(csv.startsWith('﻿'));
  const [header, line] = csv.replace('﻿', '').trim().split('\n');
  assert.equal(header.split(',').length, 3 + 31);
  assert.ok(header.startsWith('Company,Code,Name,1 Thu'));
  assert.ok(line.startsWith('BNF,3,AJEET,P,A,'));
});

test('a name with a comma in it does not break the CSV', () => {
  const daywise = attendanceDaywise({ period, rows: [row('PATEL, RAJESH', marks([['1', 'P']]))] });
  assert.ok(daywiseCsv(daywise).includes('"PATEL, RAJESH"'));
});

test('a payroll row names the employee employee_name, and both spellings work', () => {
  const fromPayroll = attendanceSummary({
    period,
    rows: [{ employee_id: 9, company_id: 1, company_name: 'BNF', employee_code: '42',
             employee_name: 'AJEET UPADHYAY', attendance: { 1: 'P' }, mark_counts: { P: 1 },
             present_days: 26, absent_days: 0, overrides: {} }],
  }).rows[0];
  assert.equal(fromPayroll.name, 'AJEET UPADHYAY');
  assert.equal(fromPayroll.code, '42');

  const plain = attendanceSummary({
    period,
    rows: [{ employee_id: 9, company_id: 1, company_name: 'BNF', code: '42', name: 'AJEET',
             attendance: { 1: 'P' }, mark_counts: { P: 1 }, present_days: 26, absent_days: 0, overrides: {} }],
  }).rows[0];
  assert.equal(plain.name, 'AJEET');
  assert.equal(plain.code, '42');
});

test('the summary export names every column it writes', () => {
  const [r] = attendanceSummary({ period, rows: [row('A', marks([['1-5', 'P']]))] }).rows;
  for (const [label, key] of SUMMARY_COLUMNS) {
    assert.ok(label, 'a column with no heading');
    assert.ok(key in r, `the export asks for ${key}, which the row does not carry`);
  }
});
