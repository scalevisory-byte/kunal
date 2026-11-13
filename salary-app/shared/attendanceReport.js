/**
 * The absent / present report.
 *
 * Dinesh asked for it by name. It computes nothing of its own: it counts the
 * same attendance marks the salary sheet is paid from, so the report and the
 * payslip can never disagree. If a figure here looks wrong, the mark is wrong,
 * and it is wrong on the grid too.
 *
 * Two shapes, because "absent present report" means both depending on the day:
 *   summary  - one line per person for the month
 *   daywise  - the grid itself, person against day, for printing or filing
 *
 * Dependency-free, so the server and the standalone file build it identically.
 */

import { ATTENDANCE_CODES, STANDARD_WORKING_DAYS, codeOf } from './calc.js';

/** Marks that mean the person was at work. */
const WORKED = ['P', 'SP', 'HP', 'WH'];
/** Marks that are time off and still paid. */
const PAID_OFF = ['CL', 'SL', 'PL', 'PH'];
/** Marks that cost pay. */
const LOST = ['A', 'AD', 'UL', 'HF'];

const sum = (counts, codes) => codes.reduce((n, code) => n + (counts[code] || 0), 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The marks on one row, counted.
 *
 * A payroll row usually carries `mark_counts` already; a row that does not
 * (the dashboard reads the same rows a different way) is counted from its
 * attendance map, so one rule serves both.
 */
export function markCounts(row = {}) {
  if (row.mark_counts) return row.mark_counts;
  const counts = {};
  for (const entry of Object.values(row.attendance || {})) {
    const code = codeOf(entry);
    if (code) counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

/**
 * Attendance as a percentage, over one row or many.
 *
 * **Out of the days somebody was EXPECTED, not out of the calendar.** A Sunday
 * off is not a day anybody failed to attend, so it is in neither the top nor
 * the bottom of the fraction; a half day is half a day lost, not a whole day
 * present.
 *
 * This exists because the dashboard had its own version that counted every
 * marked day and called anything that was not A/AD/UL "present" - so a Sunday
 * and a paid holiday both read as attendance and a half day read as a whole
 * one. On an ordinary month (18 P, 2 A, 2 HF, 4 S, 2 PH) the dashboard said
 * 93% where this report said 87%, for the same person and the same month.
 * Two screens cannot hold two opinions about one number.
 *
 * @returns a number, or null when nobody was expected at all.
 */
export function attendancePercent(rows = []) {
  let worked = 0;
  let paidOff = 0;
  let lost = 0;
  for (const row of [].concat(rows)) {
    const counts = markCounts(row);
    worked += sum(counts, WORKED);
    paidOff += sum(counts, PAID_OFF);
    lost += (counts.A || 0) + (counts.UL || 0) + (counts.AD || 0) * 2 + (counts.HF || 0) * 0.5;
  }
  return percentOf(worked, paidOff, lost);
}

/**
 * The formula itself, over days already counted - for a totals row, which has
 * summed its parts and no longer has the marks. ONE formula, two ways in, so
 * a row and the footer under it cannot disagree.
 */
export function percentOf(worked, paidOff, lost) {
  const expected = worked + paidOff + lost;
  return expected > 0 ? Math.round(((worked + paidOff) / expected) * 1000) / 10 : null;
}

/**
 * One line per person. `days_lost` is in days of pay, not in marks: AD costs
 * two and HF costs a half, which is the whole reason it is not a count.
 */
export function attendanceSummary(payroll) {
  if (!payroll) return { rows: [], companies: [], totals: null, daysInMonth: 0 };
  const { period, rows: payrollRows } = payroll;
  const daysInMonth = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();

  const rows = payrollRows.map((row) => {
    const counts = row.mark_counts || {};
    const marked = Object.keys(row.attendance || {}).filter((day) => codeOf(row.attendance[day])).length;

    const worked = sum(counts, WORKED);
    const paidOff = sum(counts, PAID_OFF);
    const daysLost = round2(
      (counts.A || 0) + (counts.UL || 0) + (counts.AD || 0) * 2 + (counts.HF || 0) * 0.5
    );

    return {
      employee_id: row.employee_id,
      company_id: row.company_id,
      company_name: row.company_name,
      // A payroll row calls these employee_name/employee_code - "name" on a
      // payroll row would be ambiguous - so both spellings are accepted.
      code: row.employee_code ?? row.code ?? '',
      name: row.employee_name ?? row.name ?? '',

      present: counts.P || 0,
      half_day: counts.HF || 0,
      absent: counts.A || 0,
      absent_two: counts.AD || 0,
      casual_leave: counts.CL || 0,
      sick_leave: counts.SL || 0,
      paid_leave: counts.PL || 0,
      unpaid_leave: counts.UL || 0,
      holiday: counts.PH || 0,
      holiday_worked: counts.HP || 0,
      sunday_off: counts.S || 0,
      sunday_worked: counts.SP || 0,
      work_from_home: counts.WH || 0,

      worked_days: worked,
      paid_off_days: paidOff,
      days_lost: daysLost,
      // What the salary sheet actually pays on, override and all - so the two
      // columns can be read side by side and reconciled.
      payable_days: round2((Number(row.present_days) ?? 0) || 0),
      absent_days_charged: round2(Number(row.absent_days) || 0),
      overridden: !!row.overrides?.absent_days,

      marked_days: marked,
      unmarked_days: Math.max(0, daysInMonth - marked),
      // Out of the days somebody was expected, not out of the calendar: a
      // Sunday off is not a day anybody failed to attend.
      attendance_percent: attendancePercent([{ mark_counts: counts }]),
    };
  });

  const byCompany = new Map();
  for (const row of rows) {
    if (!byCompany.has(row.company_id)) {
      byCompany.set(row.company_id, { company_id: row.company_id, company_name: row.company_name, rows: [] });
    }
    byCompany.get(row.company_id).rows.push(row);
  }

  return {
    period,
    daysInMonth,
    workingDays: STANDARD_WORKING_DAYS,
    rows,
    companies: [...byCompany.values()].map((group) => ({
      company_id: group.company_id,
      company_name: group.company_name,
      rows: group.rows,
      totals: totalsOf(group.rows),
    })),
    totals: totalsOf(rows),
  };
}

const TOTALLED = [
  'present', 'half_day', 'absent', 'absent_two',
  'casual_leave', 'sick_leave', 'paid_leave', 'unpaid_leave',
  'holiday', 'holiday_worked', 'sunday_off', 'sunday_worked', 'work_from_home',
  'worked_days', 'paid_off_days', 'days_lost', 'payable_days',
  'marked_days', 'unmarked_days',
];

export function totalsOf(rows) {
  const totals = { people: rows.length };
  for (const key of TOTALLED) totals[key] = round2(rows.reduce((n, r) => n + (r[key] || 0), 0));
  totals.attendance_percent = percentOf(totals.worked_days, totals.paid_off_days, totals.days_lost);
  return totals;
}

/**
 * The grid, person against day, with the day of the week on each column.
 * This is the one that gets printed and signed.
 */
export function attendanceDaywise(payroll) {
  if (!payroll) return { days: [], rows: [] };
  const { period, rows: payrollRows } = payroll;
  const daysInMonth = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const weekday = new Date(Date.UTC(period.year, period.month - 1, day)).getUTCDay();
    return { day, weekday: names[weekday], sunday: weekday === 0 };
  });

  return {
    period,
    days,
    rows: payrollRows.map((row) => ({
      employee_id: row.employee_id,
      company_id: row.company_id,
      company_name: row.company_name,
      code: row.employee_code ?? row.code ?? '',
      name: row.employee_name ?? row.name ?? '',
      marks: days.map(({ day }) => codeOf(row.attendance?.[day]) || ''),
    })),
  };
}

/* ---------------- the exports ---------------- */

export const SUMMARY_COLUMNS = [
  ['Company', 'company_name'], ['Code', 'code'], ['Name', 'name'],
  ['Present', 'present'], ['Half day', 'half_day'],
  ['Absent', 'absent'], ['Absent (2 day)', 'absent_two'],
  ['CL', 'casual_leave'], ['SL', 'sick_leave'], ['PL', 'paid_leave'], ['Unpaid leave', 'unpaid_leave'],
  ['Holiday', 'holiday'], ['Holiday worked', 'holiday_worked'],
  ['Sunday off', 'sunday_off'], ['Sunday worked', 'sunday_worked'],
  ['Work from home', 'work_from_home'],
  ['Days at work', 'worked_days'], ['Paid time off', 'paid_off_days'],
  ['Days lost', 'days_lost'], ['Payable days', 'payable_days'],
  ['Marked', 'marked_days'], ['Not marked', 'unmarked_days'],
  ['Attendance %', 'attendance_percent'],
];

/** The day-wise grid as a CSV: the muster roll, in the order it is read. */
export function daywiseCsv(daywise) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Company', 'Code', 'Name', ...daywise.days.map((d) => `${d.day} ${d.weekday}`)];
  const lines = [header.map(escape).join(',')];
  for (const row of daywise.rows) {
    lines.push([row.company_name, row.code, row.name, ...row.marks].map(escape).join(','));
  }
  return `﻿${lines.join('\n')}\n`;
}

/** What each mark means, printed under the report so it can be read cold. */
export const legend = () =>
  Object.entries(ATTENDANCE_CODES).map(([code, meta]) => ({
    code,
    label: meta.label,
    costs: meta.absent ? `−${meta.absent} day` : meta.sunday ? '+1 day' : 'no change',
  }));
