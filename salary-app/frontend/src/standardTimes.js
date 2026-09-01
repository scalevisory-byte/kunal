import { TIME_FIELDS, formatTime, parseTime } from '../../shared/timesheet.js';

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
