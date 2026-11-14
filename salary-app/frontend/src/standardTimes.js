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

/*
 * The shipped default must ADD UP TO THE DAY.
 *
 * Dinesh's rule, in his own words: "time sabka flexible, 9 hrs complete hone
 * chahiye" and "9 hrs including lunch". So: come when you like, be there nine
 * hours, and the half-hour lunch sits INSIDE those nine - it is not taken off.
 *
 * That makes the usual day 09:30 to 18:30 with the lunch columns LEFT BLANK.
 * Blank is not an oversight here and must not be "fixed" by typing the lunch
 * back in: those two columns exist for an office that DEDUCTS the break, and
 * filling them would take the half hour off every single day.
 *
 * The old default was 09:30-18:30 less a 45-minute lunch - 8h 15m against a
 * nine-hour day - so one click on "Fill the usual timings" docked every
 * person 45 minutes for a full day they had worked. Around 83 rupees each on
 * a 26,000 salary; at 114 people over 26 days, roughly two and a half lakh a
 * month, out of the app's own defaults, with nothing on screen ever adding
 * the timings up. The Time tab now does, and says what any gap costs.
 *
 * Because the time is flexible, nothing is judged by WHEN somebody arrived.
 * Short hours come from how long they stayed, whenever that was: 08:00-17:30
 * and 11:00-20:30 both complete the day and are charged nothing.
 */
export const DEFAULT_STANDARD = {
  in_time: '09:30',
  lunch_out: '',
  lunch_in: '',
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
