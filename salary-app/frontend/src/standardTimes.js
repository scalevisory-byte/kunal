import { TIME_FIELDS, TIME_RULES, formatTime, parseTime } from '../../shared/timesheet.js';
import { onConcession, readLateRules } from '../../shared/lateEarly.js';

/**
 * The office's usual day, as set on the Time tab.
 *
 * It is kept in the browser rather than in the database because it is a
 * convenience, not a payroll input - nothing is calculated from it. Two places
 * read it: the Time tab, to fill a screen of blank days, and the dashboard, to
 * say who came in late.
 */
export const STANDARD_KEY = 'salary-app-standard-times';

export const DEFAULT_STANDARD = {
  in_time: '09:30',
  lunch_out: '13:00',
  lunch_in: '13:45',
  out_time: '18:30',
};

export function readStandardTimes() {
  try {
    const stored = JSON.parse(localStorage.getItem(STANDARD_KEY) || 'null');
    if (stored && TIME_FIELDS.every((f) => typeof stored[f] === 'string')) return stored;
  } catch {
    // A corrupt or blocked store just means the usual timings.
  }
  return DEFAULT_STANDARD;
}

export function writeStandardTimes(times) {
  const tidy = {};
  for (const field of TIME_FIELDS) {
    const parsed = parseTime(times[field]);
    tidy[field] = parsed === null ? '' : formatTime(parsed);
  }
  try {
    localStorage.setItem(STANDARD_KEY, JSON.stringify(tidy));
  } catch {
    // Nothing to do - the timings just will not be remembered.
  }
  return tidy;
}

/**
 * The day the month is actually judged against.
 *
 * The stored timings above are a convenience and live in the browser. Once the
 * late/early concession is in play they are no longer only a convenience - a
 * minute late is money - so the month's own `shift_in`/`shift_out` win, and the
 * browser's copy is only the fallback. The grace follows the month too, so the
 * dashboard calls somebody late exactly when the payroll would charge them.
 */
export function shiftOfMonth(period) {
  const stored = readStandardTimes();
  const rules = readLateRules(period || {});
  return {
    in_time: parseTime(period?.shift_in) !== null ? period.shift_in : stored.in_time,
    out_time: parseTime(period?.shift_out) !== null ? period.shift_out : stored.out_time,
    lunch_out: stored.lunch_out,
    lunch_in: stored.lunch_in,
    // On the default policy nothing is charged for lateness, so the roll call
    // keeps the usual quarter-hour grace rather than flagging every minute.
    grace: onConcession(period || {}) ? rules.grace_minutes : TIME_RULES.graceMinutes,
  };
}
