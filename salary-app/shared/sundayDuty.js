/**
 * A Sunday's duty, and the hours that earn it.
 *
 * Dinesh: *"sundsy duty minimum six hours ki rehti he"*, then
 * *"6 hours work full day salary sunday"*. A Sunday is not a short version of
 * a working day - it is its own thing, six hours long, and six hours on it
 * earns the WHOLE day's Sunday pay.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO, and why
 *
 * It changes NOBODY'S pay by itself. `calculateRow` still pays
 * `sundays_worked x perDay` exactly as it always has, and nothing here is an
 * input to it.
 *
 * What it does is ANSWER A QUESTION the register could not answer before:
 * which Sundays actually carried the six hours. A Sunday worked for two hours
 * and a Sunday worked for nine looked identical on the register and were paid
 * identically - one full day each. Now the short ones are named with their
 * hours, and whoever is handing the money over decides.
 *
 * It is named and not deducted for the same reason an unreturned asset is
 * named and not deducted: somebody who came in at six in the morning and whose
 * second punch never registered has done the day. Docking that automatically
 * is a mistake nobody can see, and getting it back is a conversation.
 *
 * A Sunday with NO clock times at all is "not known", never "nought hours".
 * Most of the staff are not on the readers yet, so treating an unclocked
 * Sunday as a short one would condemn almost every Sunday in the month.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, so the server, the dashboard and the single-file build
 * cannot give three answers.
 */

import { ATTENDANCE_CODES, calculateRow } from './calc.js';
import { PAID_BY_THE_DAY, readTimes } from './timesheet.js';

/**
 * How long a Sunday's duty runs. Six hours, per Dinesh, against the office's
 * ordinary nine - a Sunday is a shorter day that pays a whole one.
 */
export const SUNDAY_DAY_HOURS = 6;

/** Held per month, so a rule changed in December never rewrites November. */
export function sundayHoursFor(period = {}) {
  const typed = Number(period.sunday_hours);
  if (Number.isFinite(typed) && typed > 0 && typed <= 24) return typed;
  return SUNDAY_DAY_HOURS;
}

/** The marks the Sunday register pays a day for: worked on an off day. */
export const SUNDAY_MARKS = new Set(
  Object.keys(ATTENDANCE_CODES).filter((c) => ATTENDANCE_CODES[c].sunday)
);

export const codeOf = (entry) =>
  String((typeof entry === 'object' && entry ? entry.code : entry) || '').trim().toUpperCase();

/**
 * Every Sunday (or holiday) this person worked, with what the clock says.
 *
 * `worked` is null when nothing was clocked - NOT 0. The three states are
 * "they did the hours", "they did not", and "nobody knows", and the third is
 * by far the commonest while the punch IDs are still being filled in.
 */
export function sundayDutyFor(row = {}, period = {}) {
  const hours = sundayHoursFor(period);
  const needed = Math.round(hours * 60);
  const attendance = row.attendance || {};
  const days = [];

  for (const [key, entry] of Object.entries(attendance)) {
    if (!SUNDAY_MARKS.has(codeOf(entry))) continue;
    const day = Number(key);
    if (!Number.isFinite(day)) continue;
    const times = typeof entry === 'object' && entry ? entry : {};
    const read = readTimes(times);
    const worked = read.worked === null ? null : Math.round(read.worked);
    days.push({
      day,
      code: codeOf(entry),
      in_time: times.in_time || '',
      out_time: times.out_time || '',
      worked,
      // null stays null all the way out: "not known" is not "did not do it".
      full: worked === null ? null : worked >= needed,
      short: worked === null ? null : Math.max(0, needed - worked),
    });
  }

  days.sort((a, b) => a.day - b.day);

  const clocked = days.filter((d) => d.worked !== null);
  return {
    hours,
    needed,
    days,
    counted: days.length,
    clocked: clocked.length,
    unclocked: days.length - clocked.length,
    full: clocked.filter((d) => d.full).length,
    shortDays: clocked.filter((d) => !d.full),
  };
}

/**
 * The register's view: one line per person who has a Sunday the clock says
 * was under the six hours. Everybody else is simply not a question.
 */
export function shortSundays(rows = [], period = {}) {
  const lines = [];
  for (const row of rows) {
    const duty = sundayDutyFor(row, period);
    if (!duty.shortDays.length) continue;
    lines.push({
      employee_id: row.employee_id ?? row.id ?? null,
      employee_name: row.employee_name || row.name || '',
      company_name: row.company_name || '',
      days: duty.shortDays,
      counted: duty.counted,
      unclocked: duty.unclocked,
    });
  }
  lines.sort((a, b) => b.days.length - a.days.length || a.employee_name.localeCompare(b.employee_name));
  return lines;
}

/* ---------------- the overtime a day off must not pay ---------------- */

/**
 * Minutes still sitting on days that are paid BY THE DAY.
 *
 * `minutesForMark` stopped writing these, but it is the WRITE path: a figure
 * already stored on a day does not move until that day is saved again, which
 * is exactly the rule that stops a month already paid from changing under
 * anybody. An OPEN month is still carrying whatever it was given before the
 * rule changed, and somebody has to be able to see it and clear it.
 *
 * Reports only. `clearSundayOvertime` below builds the entries; nothing here
 * writes anything.
 */
export function sundayOvertimeIn(rows = [], period = {}) {
  const lines = [];
  for (const row of rows) {
    const attendance = row.attendance || {};
    const days = [];
    for (const [key, entry] of Object.entries(attendance)) {
      if (!PAID_BY_THE_DAY.has(codeOf(entry))) continue;
      const minutes = Number(typeof entry === 'object' && entry ? entry.minutes : 0) || 0;
      if (minutes === 0) continue;
      const day = Number(key);
      if (!Number.isFinite(day)) continue;
      days.push({ day, code: codeOf(entry), minutes });
    }
    if (!days.length) continue;
    days.sort((a, b) => a.day - b.day);

    /*
     * What it is worth is asked of calculateRow with and without those
     * minutes, rather than multiplied out here - the per-minute rate follows
     * the person's own shift length and the month's rule, and a second
     * opinion about it is how two answers come to exist.
     */
    const before = calculateRow(row, period, attendance);
    const cleared = { ...attendance };
    for (const d of days) cleared[d.day] = { ...attendance[d.day], minutes: 0 };
    const after = calculateRow(row, period, cleared);

    lines.push({
      employee_id: row.employee_id ?? row.id ?? null,
      row_id: row.id ?? null,
      employee_name: row.employee_name || row.name || '',
      company_name: row.company_name || '',
      days,
      minutes: days.reduce((n, d) => n + d.minutes, 0),
      worth: Math.round((before.net_salary || 0) - (after.net_salary || 0)),
    });
  }
  lines.sort((a, b) => b.minutes - a.minutes || a.employee_name.localeCompare(b.employee_name));
  return lines;
}

/** The attendance entries that clear it. One per day, naming only `minutes`. */
export function clearSundayOvertime(lines = []) {
  const entries = [];
  for (const line of lines) {
    for (const d of line.days) {
      // Only `minutes` is named, so the same per-field merge rule everything
      // else follows keeps the mark, the clock times and the reason intact.
      entries.push({ employee_id: line.employee_id, day: d.day, minutes: 0 });
    }
  }
  return entries;
}

/* ---------------- what a short Sunday is worth ---------------- */

/**
 * The Sunday amount if a Sunday under the six hours pays `shortPays` of a day.
 *
 * Dinesh: *"Sunday ki full day ki salary lene k liye minimum 6 hours complete
 * karne he"*. He named the line and not what sits below it, so this takes the
 * fraction as an argument and the office picks it on the screen - half a day,
 * or nothing.
 *
 * A Sunday NOBODY CLOCKED still counts as a full day. "Not known" is not
 * "under six hours", and with most of the staff still off the readers the
 * other reading would stop nearly every Sunday in the month being paid.
 */
export function sundayAmountIf(row = {}, period = {}, { shortPays = 0 } = {}) {
  const duty = sundayDutyFor(row, period);
  const calc = calculateRow(row, period, row.attendance || {});
  const perDay = Number(calc.per_day) || 0;
  const short = duty.shortDays.length;
  const full = duty.counted - short;
  return {
    per_day: perDay,
    full,
    short,
    // Rounded like the register's own amount, so the two cannot differ by a rupee.
    amount: Math.round((full + short * shortPays) * perDay),
    now: Math.round(Number(calc.sunday_salary) || 0),
  };
}
