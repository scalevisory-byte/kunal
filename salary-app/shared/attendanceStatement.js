/**
 * ONE PERSON'S MONTH, DAY BY DAY.
 *
 * Dinesh: *"Clicking an employee name should open their monthly attendance
 * statement"* - employee details, date-wise attendance, check-in/check-out,
 * working hours, OT hours, leave details, attendance summary.
 *
 * EVERY FIGURE HERE IS ALREADY ON THE ROW. This assembles; it works nothing
 * out of its own. The mark is the mark the grid shows and the sheet is paid
 * from, the hours come from `timesToDay` - the same function the Time tab
 * and the punch import use - and the summary is `markCounts`, which is what
 * the absent/present report counts. A statement that recalculated would be a
 * second opinion on somebody's pay, and two opinions is one too many.
 *
 * Dependency-free, like the rest of shared/.
 */

import { ATTENDANCE_CODES, codeOf } from './calc.js';
import { isWeeklyOff, policyFor } from './weeklyOff.js';
import { hasTimes, timesToDay } from './timesheet.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const n = (v) => Number(v) || 0;
const daysIn = (year, month) => new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();

/** Marks that mean the person was at work somewhere. */
export const AT_WORK = ['P', 'HF', 'SP', 'HP', 'WH', 'OD'];
/** Marks that are time off and still paid. */
export const PAID_OFF = ['CL', 'SL', 'PL', 'PH'];
/** Marks that cost pay. */
export const COSTS_PAY = ['A', 'AD', 'UL', 'HF'];

const tally = (counts, codes) => codes.reduce((sum, c) => sum + (counts[c] || 0), 0);

/**
 * The month for one person.
 *
 * @param row      the payroll row, with its `attendance` map
 * @param period   the month
 * @param holidays the month's holidays, so a festival day says which one
 */
export function attendanceStatement(row = {}, period = {}, { holidays = [] } = {}) {
  const year = Number(period.year);
  const month = Number(period.month);
  const total = year && month ? daysIn(year, month) : 0;
  const hoursPerDay = n(period.hours_per_day) || 9;
  const deductLunch = !period.lunch_paid;
  const policy = policyFor(row, { weekly_off: row.company_weekly_off });

  const holidayOn = new Map();
  for (const h of holidays) {
    const day = Number(h?.day);
    if (!day) continue;
    const covers = h.religions || [];
    const mine = String(row.religion || '').trim().toLowerCase();
    if (covers.length && !covers.some((r) => String(r).trim().toLowerCase() === mine)) continue;
    holidayOn.set(day, h.name || 'Holiday');
  }

  const counts = {};
  const lines = [];
  for (let day = 1; day <= total; day += 1) {
    const entry = row.attendance?.[day];
    const code = codeOf(entry) || '';
    if (code) counts[code] = (counts[code] || 0) + 1;

    const times = typeof entry === 'object' && entry ? entry : {};
    const clocked = hasTimes(times);
    const judged = clocked ? timesToDay(times, { hoursPerDay, deductLunch }) : null;

    lines.push({
      day,
      weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
      /* A fact about the calendar and this person's own policy - NOT a mark.
         A day can be their weekly off and still carry SP, worked. */
      weekly_off: isWeeklyOff(year, month, day, policy),
      holiday: holidayOn.get(day) || '',
      code,
      label: code ? ATTENDANCE_CODES[code]?.label || code : '',
      in_time: times.in_time || '',
      lunch_out: times.lunch_out || '',
      lunch_in: times.lunch_in || '',
      out_time: times.out_time || '',
      /* Hours actually clocked, and the difference from the day expected.
         Null is "not known" - never nought, which would read as a day
         somebody turned up for and did nothing. */
      worked_minutes: judged ? judged.worked : null,
      /* The day's own OT/LT, as the sheet pays it. A day with no clock
         times can still carry minutes typed by hand. */
      ot_minutes: n(times.minutes),
      /* What is WRONG with the times, in words - "no out time", "only one
         lunch time is filled". A day somebody started and did not finish
         reads exactly like a day nobody clocked unless it says so. */
      time_warning: judged ? judged.warning || '' : '',
      reason: times.reason || '',
      approved: times.approved === null || times.approved === undefined ? null : !!times.approved,
      uniform: times.uniform === null || times.uniform === undefined ? null : !!times.uniform,
    });
  }

  const clockedDays = lines.filter((l) => l.worked_minutes !== null);
  const workedMinutes = clockedDays.reduce((t, l) => t + n(l.worked_minutes), 0);
  const otMinutes = lines.reduce((t, l) => t + Math.max(0, l.ot_minutes), 0);
  const shortMinutes = lines.reduce((t, l) => t + Math.min(0, l.ot_minutes), 0);

  return {
    employee: {
      id: row.employee_id ?? row.id ?? null,
      name: row.employee_name || row.name || '',
      code: row.employee_code || row.code || '',
      company: row.company_name || '',
      branch: row.branch_name || '',
      department: row.department || '',
      designation: row.designation || '',
    },
    period: { year, month, label: period.label || '', days: total },
    days: lines,
    summary: {
      marked_days: lines.filter((l) => l.code).length,
      unmarked_days: lines.filter((l) => !l.code).length,
      at_work: tally(counts, AT_WORK),
      paid_off: tally(counts, PAID_OFF),
      /* Days of PAY, not days on the calendar: a half day costs 0.5 and a
         double absence costs 2 - the same arithmetic the report uses. */
      days_lost:
        (counts.A || 0) + (counts.UL || 0) + (counts.AD || 0) * 2 + (counts.HF || 0) * 0.5,
      counts,
      /* The sheet's own figure, override and all, so the statement and the
         payslip cannot disagree about what was paid. */
      payable_days: row.present_days ?? null,
      clocked_days: clockedDays.length,
      worked_minutes: workedMinutes,
      overtime_minutes: otMinutes,
      short_minutes: Math.abs(shortMinutes),
    },
  };
}

/** The statement as rows for a CSV, in the order the screen shows them. */
export const STATEMENT_COLUMNS = [
  ['day', 'Date'],
  ['weekday', 'Day'],
  ['code', 'Mark'],
  ['label', 'What it means'],
  ['in_time', 'In'],
  ['lunch_out', 'Lunch out'],
  ['lunch_in', 'Lunch in'],
  ['out_time', 'Out'],
  ['hours', 'Hours worked'],
  ['ot_minutes', 'OT / short (min)'],
  ['reason', 'Reason'],
  ['approved', 'Approved'],
];
