/**
 * THE IN/OUT REGISTER — every person, every day, in and out.
 *
 * Dinesh: *"need all logs / all in out"*. The app could show one DAY across
 * everybody (the Time tab) or one PERSON down the month (their statement),
 * and never both. The punch log lists raw door openings, which is a different
 * question. What was missing is the plain register: who came in and who went
 * home, for the whole month, on one page.
 *
 * The catalogue carried `working-hours` as **partial — "No standalone
 * report"**, and that note had been stale for a long time: every figure here
 * already existed and nobody had built the screen. (CLAUDE.md warns about
 * exactly this: a note explaining why something is impossible outlives the
 * thing that made it so.)
 *
 * ---------------------------------------------------------------------------
 * IT ASSEMBLES. IT DOES NOT RECALCULATE.
 *
 * The hours come from `readTimes` and what the day COSTS comes from the
 * `minutes` stored on it — which is the column the salary sheet has always
 * been paid from. So this register and the payslip cannot disagree. Where
 * somebody typed over the clock, it says so rather than quietly showing a
 * figure that does not follow from the times beside it.
 *
 * A day with no clock times is a DASH, never 00:00: not known is not nought.
 * ---------------------------------------------------------------------------
 */

import {
  dayGrace,
  formatDuration,
  minutesForMark,
  readTimes,
} from './timesheet.js';
import { hoursForEmployee } from './lateEarly.js';
import { punchTimes } from './punchLog.js';

/** Days in the month, without pulling a date library in. */
const daysIn = (year, month) => new Date(Number(year), Number(month), 0).getDate();

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * One line per person-day.
 *
 * @param rows      the month's payroll rows, each with `attendance`
 * @param period    the open month
 * @param punches   optional { employeeId: { day: [{at}] } } — the raw punches
 * @param everyDay  include days with nothing on them at all
 */
export function inOutRegister(rows = [], period = {}, { punches = null, everyDay = false } = {}) {
  const year = Number(period.year);
  const month = Number(period.month);
  const total = daysIn(year, month) || 31;
  const deductLunch = !period.lunch_paid;

  const lines = [];
  let blankDays = 0;
  let withTimes = 0;
  let workedMinutes = 0;
  let otMinutes = 0;
  let shortMinutes = 0;

  for (const row of rows) {
    const stored = row.attendance || {};
    const hoursPerDay = hoursForEmployee(row, { period });
    const forPerson = punches?.[row.employee_id] || null;

    for (let day = 1; day <= total; day += 1) {
      const raw = stored[day];
      const entry = typeof raw === 'object' && raw ? raw : { code: raw || '', minutes: 0 };
      const code = String(entry.code || '').trim().toUpperCase();
      const read = readTimes(entry, { deductLunch });
      const anyTime = read.in !== null || read.out !== null || read.lunchOut !== null || read.lunchIn !== null;

      if (!anyTime && !code) {
        blankDays += 1;
        if (!everyDay) continue;
      }
      if (anyTime) withTimes += 1;

      /*
       * What the day COSTS is the stored figure — the sheet is paid from that
       * column and nothing else. `fromClock` is only here so the register can
       * say when the two differ; it never replaces the stored one.
       */
      const chargeable = Number(entry.minutes) || 0;
      const fromClock = minutesForMark(entry, {
        hoursPerDay,
        code,
        deductLunch,
        /* The month's OWN grace, or every day would read as typed over the
           moment the two disagreed about a few minutes. */
        graceMinutes: dayGrace(period),
      });
      const typedOver = anyTime && chargeable !== fromClock;

      if (read.worked !== null) workedMinutes += read.worked;
      if (chargeable > 0) otMinutes += chargeable;
      if (chargeable < 0) shortMinutes += -chargeable;

      const dayPunches = forPerson?.[day] || [];

      lines.push({
        employee_id: row.employee_id,
        employee_name: row.employee_name || '',
        employee_code: row.employee_code || row.code || '',
        company_name: row.company_name || '',
        department: row.department || '',
        day,
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        weekday: WEEKDAYS[new Date(year, month - 1, day).getDay()],
        code,
        in_time: entry.in_time || '',
        lunch_out: entry.lunch_out || '',
        lunch_in: entry.lunch_in || '',
        out_time: entry.out_time || '',
        /* null, not 0 — a day nobody clocked has unknown hours, and nought
           would read as somebody who turned up and did nothing. */
        worked_minutes: read.worked,
        lunch_minutes: read.lunch || 0,
        lunch_deducted: !!read.lunchDeducted,
        expected_minutes: Math.round(hoursPerDay * 60),
        minutes: chargeable,
        from_clock: fromClock,
        typed_over: typedOver,
        warning: read.warning || '',
        punches: dayPunches.length,
        punch_times: dayPunches.length ? punchTimes(dayPunches) : '',
      });
    }
  }

  // Date first, then name: this is a register, read down the month.
  lines.sort((a, b) =>
    a.day === b.day
      ? String(a.employee_name).localeCompare(String(b.employee_name))
      : a.day - b.day
  );

  return {
    lines,
    totals: {
      people: new Set(lines.map((l) => l.employee_id)).size,
      days: new Set(lines.map((l) => l.day)).size,
      rows: lines.length,
      with_times: withTimes,
      blank_days: blankDays,
      worked_minutes: workedMinutes,
      ot_minutes: otMinutes,
      short_minutes: shortMinutes,
      typed_over: lines.filter((l) => l.typed_over).length,
      no_out: lines.filter((l) => l.in_time && !l.out_time).length,
    },
  };
}

/** What a CSV and a print carry, in order. */
export const IN_OUT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'weekday', label: 'Day' },
  { key: 'employee_name', label: 'Employee' },
  { key: 'employee_code', label: 'Code' },
  { key: 'company_name', label: 'Company' },
  { key: 'department', label: 'Department' },
  { key: 'code', label: 'Mark' },
  { key: 'in_time', label: 'In' },
  { key: 'lunch_out', label: 'Lunch out' },
  { key: 'lunch_in', label: 'Lunch in' },
  { key: 'out_time', label: 'Out' },
  { key: 'worked', label: 'Worked' },
  { key: 'charged', label: 'OT / short' },
  { key: 'punch_times', label: 'Every punch' },
];

/** One row as text, for the CSV and the print. */
export function inOutCells(line = {}) {
  const dash = (v) => (v ? String(v) : '—');
  return {
    date: line.date || '',
    weekday: line.weekday || '',
    employee_name: line.employee_name || '',
    employee_code: line.employee_code || '',
    company_name: line.company_name || '',
    department: line.department || '',
    code: line.code || '—',
    in_time: dash(line.in_time),
    lunch_out: dash(line.lunch_out),
    lunch_in: dash(line.lunch_in),
    out_time: dash(line.out_time),
    worked: line.worked_minutes === null ? '—' : formatDuration(line.worked_minutes),
    charged: line.minutes
      ? `${line.minutes > 0 ? '+' : '−'}${Math.abs(line.minutes)}m${line.typed_over ? ' (typed)' : ''}`
      : '—',
    punch_times: line.punch_times || '',
  };
}
