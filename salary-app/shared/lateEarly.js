/**
 * Late arrival, early departure, and the month's concession.
 *
 * Dinesh's own attendance policy, in his words: "300-minute monthly late/early
 * concession", "late arrival - automatic late-minute calculation", "early
 * departure - automatic minute calculation". So: every minute late in and every
 * minute left early is counted, they are pooled for the month, the first 300 are
 * free, and only the excess costs money.
 *
 * Two things this module is careful about.
 *
 * **It does not double-charge.** The app already deducts short hours, worked out
 * as `out - in - lunch` against the day's expected hours - and a person who came
 * in thirty minutes late and left on time is already thirty minutes short there.
 * Charging the lateness again would take the same thirty minutes twice. So the
 * two rules are alternatives, not additions: a period runs on `POLICY.hours`
 * (what the app has always done - the day is judged on the hours it came to) or
 * on `POLICY.concession` (this module - late and early minutes are pooled, 300
 * are free, and the hours-shortfall is no longer charged). `calculateRow` picks
 * one, never both.
 *
 * **A day nobody clocked is not a late day.** No in time means "not known", and
 * that is not the same as "on time" or "late". Nor is a half day, a leave, a
 * holiday or an absence ever judged late: it was not a full day at the office.
 *
 * Dependency-free, like the rest of shared/, so the server and the standalone
 * browser build cannot drift apart.
 */

import { parseTime, readTimes } from './timesheet.js';

/** Which rule prices the month. `hours` is what the app has always done. */
export const POLICY = {
  hours: 'hours',
  concession: 'concession',
};

/**
 * The office's usual day and how much lateness a month absorbs.
 *
 * The 300 is Dinesh's figure. The daily grace is **zero** on purpose: with a
 * monthly pool of five hours, forgiving a quarter of an hour again on every one
 * of 26 days would hand out another six and a half hours nobody decided on.
 */
export const DEFAULT_LATE_RULES = {
  shift_in: '09:30',
  shift_out: '18:30',
  concession_minutes: 300,
  grace_minutes: 0,
};

/**
 * Marks that mean a full day at work, and so can be judged late or early.
 * A blank day is included: somebody with clock times and no mark yet was here.
 */
export const FULL_DAY_MARKS = new Set(['', 'P', 'WH', 'SP', 'HP']);

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const codeOf = (entry) =>
  String((entry && typeof entry === 'object' ? entry.code : entry) || '').trim().toUpperCase();

/** The rules a period runs on, with anything unset falling back to the default. */
export function readLateRules(source = {}) {
  const rules = { ...DEFAULT_LATE_RULES };
  if (parseTime(source.shift_in) !== null) rules.shift_in = source.shift_in;
  if (parseTime(source.shift_out) !== null) rules.shift_out = source.shift_out;
  if (source.late_concession_minutes !== null && source.late_concession_minutes !== undefined && source.late_concession_minutes !== '')
    rules.concession_minutes = Math.max(0, num(source.late_concession_minutes, rules.concession_minutes));
  if (source.late_grace_minutes !== null && source.late_grace_minutes !== undefined && source.late_grace_minutes !== '')
    rules.grace_minutes = Math.max(0, num(source.late_grace_minutes, rules.grace_minutes));
  return rules;
}

/** True when this period prices late and early minutes rather than hours. */
export const onConcession = (period = {}) =>
  String(period.late_policy || POLICY.hours).toLowerCase() === POLICY.concession;

/**
 * The shift one person works - their own if they have one, else the office's.
 * Different shifts are normal; a night-shift worker judged against 09:30 would
 * be five hours late every single day.
 */
export function shiftFor(employee = {}, rules = DEFAULT_LATE_RULES) {
  return {
    in: parseTime(employee.shift_in) !== null ? employee.shift_in : rules.shift_in,
    out: parseTime(employee.shift_out) !== null ? employee.shift_out : rules.shift_out,
  };
}

/**
 * One day's late and early minutes.
 *
 * @returns {{ late: number, early: number, judged: boolean, reason: string }}
 *   judged false means there was nothing to judge - say "not known", never 0.
 */
export function dayLateEarly(entry, { start, end, grace = 0 } = {}) {
  const blank = { late: 0, early: 0, judged: false, reason: '' };
  const code = codeOf(entry);
  if (!FULL_DAY_MARKS.has(code)) return { ...blank, reason: 'not a full working day' };

  const times = entry && typeof entry === 'object' ? entry : {};
  const cameAt = parseTime(times.in_time);
  const leftAt = parseTime(times.out_time);
  if (cameAt === null && leftAt === null) return { ...blank, reason: 'no clock times' };

  const startsAt = parseTime(start);
  const endsAt = parseTime(end);
  const allowance = Math.max(0, num(grace));
  const overnight = readTimes(times).overnight;

  let late = 0;
  if (cameAt !== null && startsAt !== null) {
    const over = cameAt - startsAt;
    if (over > allowance) late = over;
  }

  let early = 0;
  // A shift that runs past midnight is not an early finish.
  if (leftAt !== null && endsAt !== null && !overnight) {
    const under = endsAt - leftAt;
    if (under > allowance) early = under;
  }

  return { late, early, judged: true, reason: '' };
}

/**
 * One person's month: how late, how early, and on which days.
 *
 * @param attendance day number -> mark, or { code, in_time, out_time, ... }
 * @returns {{
 *   late_minutes, early_minutes, total_minutes,
 *   late_days, early_days, judged_days, days
 * }}
 */
export function monthLateEarly(attendance = {}, options = {}) {
  const out = {
    late_minutes: 0,
    early_minutes: 0,
    total_minutes: 0,
    late_days: 0,
    early_days: 0,
    judged_days: 0,
    days: [],
  };

  for (const [day, entry] of Object.entries(attendance || {})) {
    const judged = dayLateEarly(entry, options);
    if (!judged.judged) continue;
    out.judged_days++;
    if (judged.late > 0) {
      out.late_minutes += judged.late;
      out.late_days++;
    }
    if (judged.early > 0) {
      out.early_minutes += judged.early;
      out.early_days++;
    }
    if (judged.late > 0 || judged.early > 0) {
      out.days.push({ day: Number(day), late: judged.late, early: judged.early });
    }
  }

  out.total_minutes = out.late_minutes + out.early_minutes;
  out.days.sort((a, b) => a.day - b.day);
  return out;
}

/**
 * The concession applied: what was used out of the month's allowance and what
 * is left to charge. Never negative, so a tidy month can never earn credit.
 */
export function applyConcession(totalMinutes, concessionMinutes = DEFAULT_LATE_RULES.concession_minutes) {
  const total = Math.max(0, Math.round(num(totalMinutes)));
  const allowed = Math.max(0, Math.round(num(concessionMinutes, DEFAULT_LATE_RULES.concession_minutes)));
  const used = Math.min(total, allowed);
  return { total, allowed, used, left: allowed - used, chargeable: total - used };
}

/**
 * Everything the salary sheet needs for one person's late/early line.
 *
 * @param attendance the month's marks, with clock times on them
 * @param opts { employee, rules, per_minute }
 */
export function lateEarlyLine(attendance = {}, { employee = {}, rules, per_minute = 0 } = {}) {
  const settings = readLateRules(rules || {});
  const shift = shiftFor(employee, settings);
  const month = monthLateEarly(attendance, {
    start: shift.in,
    end: shift.out,
    grace: settings.grace_minutes,
  });
  const concession = applyConcession(month.total_minutes, settings.concession_minutes);
  return {
    ...month,
    ...concession,
    shift_in: shift.in,
    shift_out: shift.out,
    grace_minutes: settings.grace_minutes,
    amount: Math.round(concession.chargeable * num(per_minute) * 100) / 100,
  };
}

/** "5h 00m free, 1h 12m charged" - for the panel that says what a switch costs. */
export function describeConcession(line = {}) {
  const mins = (m) => {
    const v = Math.max(0, Math.round(num(m)));
    if (v < 60) return `${v}m`;
    return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
  };
  if (!line.total) return 'nothing late or early this month';
  const parts = [`${mins(line.total)} late or early`, `${mins(line.allowed)} free`];
  parts.push(line.chargeable > 0 ? `${mins(line.chargeable)} charged` : 'nothing charged');
  return parts.join(', ');
}
