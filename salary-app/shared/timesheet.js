/**
 * In / lunch out / lunch in / out times, and the hours they add up to.
 *
 * The attendance grid answers "was this person here"; this answers "for how
 * long". A day carries four clock times, and what falls out of them - hours
 * worked, and the short hours or overtime against the day's expected hours -
 * is the same number the biometric import produces, so a day typed by hand and
 * a day read off the machine are worth exactly the same at the end of the
 * month.
 *
 * Dependency-free, like the rest of shared/, so the server and the standalone
 * browser build cannot drift apart.
 */

/** The four clock times a day can carry, in the order they happen. */
export const TIME_FIELDS = ['in_time', 'lunch_out', 'lunch_in', 'out_time'];

export const TIME_LABELS = {
  in_time: 'In',
  lunch_out: 'Lunch out',
  lunch_in: 'Lunch in',
  out_time: 'Out',
};

/**
 * Shared with the punch importer so a typed day and an imported day are judged
 * the same way.
 *
 *   halfDayHours - anything under this is half a day, not a full one
 *   graceMinutes - short hours under this are not deducted, so a few minutes
 *                  late never turns into money
 */
export const TIME_RULES = {
  halfDayHours: 4.5,
  graceMinutes: 15,
};

/** A day longer than this is almost certainly a typo, not a night shift. */
const MAX_DAY_MINUTES = 16 * 60;
const DAY = 24 * 60;

/**
 * Minutes since midnight from whatever was typed, or null.
 *
 * Takes the shapes people actually type: 9:30, 09:30, 9.30, 930, 9, 6pm,
 * 6:15 PM. A bare number under 24 is read as an hour, so "6" is 06:00 - type
 * "6pm" or "18" for the evening.
 */
export function parseTime(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 && value < DAY ? Math.round(value) : null;
  }

  const text = String(value).trim().toLowerCase();
  if (!text || text === '-') return null;

  const suffix = /(a|p)\.?m\.?$/.exec(text)?.[1] || '';
  const body = text.replace(/\s*(a|p)\.?m\.?$/, '').trim();

  let hours;
  let mins;
  const colon = /^(\d{1,2})[:.](\d{1,2})$/.exec(body);
  if (colon) {
    hours = Number(colon[1]);
    mins = Number(colon[2]);
  } else if (/^\d{3,4}$/.test(body)) {
    // 930 and 0930 both mean half past nine.
    hours = Number(body.slice(0, body.length - 2));
    mins = Number(body.slice(-2));
  } else if (/^\d{1,2}$/.test(body)) {
    hours = Number(body);
    mins = 0;
  } else {
    return null;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  if (suffix === 'p' && hours < 12) hours += 12;
  if (suffix === 'a' && hours === 12) hours = 0;
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** 570 -> "09:30". Null for anything that is not a time. */
export function formatTime(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '';
  const m = ((Math.round(Number(minutes)) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 545 -> "9h 05m", 45 -> "45m". For reading rather than for sums. */
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '';
  const total = Math.round(Number(minutes));
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  if (abs < 60) return `${sign}${abs}m`;
  return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, '0')}m`;
}

/**
 * What a day's four times add up to.
 *
 * @returns {
 *   in, lunchOut, lunchIn, out  minutes since midnight, or null
 *   gross    out - in, counting a shift that ends after midnight as the next day
 *   lunch    the break taken out of it
 *   worked   gross - lunch, or null when in or out is missing
 *   overnight  whether the shift was read as running past midnight
 *   warning  what looks wrong about the times, if anything
 * }
 */
export function readTimes(times = {}) {
  const at = {
    in: parseTime(times.in_time),
    lunchOut: parseTime(times.lunch_out),
    lunchIn: parseTime(times.lunch_in),
    out: parseTime(times.out_time),
  };

  let gross = null;
  let overnight = false;
  if (at.in !== null && at.out !== null) {
    gross = at.out - at.in;
    if (gross <= 0) {
      gross += DAY;
      overnight = true;
    }
  }

  let lunch = 0;
  if (at.lunchOut !== null && at.lunchIn !== null) {
    lunch = at.lunchIn - at.lunchOut;
    if (lunch < 0) lunch += DAY;
  }

  let warning = '';
  if (gross !== null && lunch > gross) {
    warning = 'the lunch break is longer than the day';
    lunch = 0;
  } else if (gross !== null && gross > MAX_DAY_MINUTES) {
    warning = 'that is more than 16 hours - check the in and out times';
  } else if ((at.lunchOut === null) !== (at.lunchIn === null)) {
    warning = 'only one lunch time is filled, so no break was taken off';
  } else if (at.in === null && at.out !== null) {
    warning = 'no in time';
  } else if (at.out === null && at.in !== null) {
    warning = 'no out time';
  }

  return {
    ...at,
    gross,
    lunch,
    worked: gross === null ? null : gross - lunch,
    overnight,
    warning,
  };
}

/** True once a day has enough typed on it to be worth anything. */
export const hasTimes = (times = {}) => TIME_FIELDS.some((f) => parseTime(times[f]) !== null);

/**
 * The mark and the short hours a day's times come to.
 *
 * Only the arithmetic lives here; whether to actually write the mark is the
 * caller's call, because a day already marked as leave or a holiday keeps its
 * own mark - the times still record what was worked on it.
 *
 * @returns { worked, expected, diff, minutes, code, warning }
 *   minutes  what goes in the day's OT/short column, grace already applied
 *   code     'P' or 'HF', or '' when there is nothing to say
 */
export function timesToDay(times, { hoursPerDay = 9, rules } = {}) {
  const settings = { ...TIME_RULES, ...(rules || {}) };
  const read = readTimes(times);
  const expected = Math.round((Number(hoursPerDay) || 9) * 60);

  if (read.worked === null) {
    return { ...read, expected, diff: null, minutes: 0, code: '' };
  }

  const diff = Math.round(read.worked - expected);
  const halfDay = Number(settings.halfDayHours) * 60;
  const code = read.worked < halfDay ? 'HF' : 'P';
  // A few minutes either way is not worth a deduction, and a half day is
  // already paid at half - charging the missing hours again would be double.
  const minutes =
    code === 'HF' || Math.abs(diff) <= Number(settings.graceMinutes) ? 0 : diff;

  return { ...read, expected, diff, minutes, code };
}

/** Everything typed on one person's month, added up. */
export function monthTotals(daysWithTimes = [], options = {}) {
  const totals = { days: 0, worked: 0, expected: 0, short: 0, overtime: 0, lunch: 0 };
  for (const times of daysWithTimes) {
    if (!hasTimes(times)) continue;
    const day = timesToDay(times, options);
    if (day.worked === null) continue;
    totals.days++;
    totals.worked += day.worked;
    totals.expected += day.expected;
    totals.lunch += day.lunch;
    if (day.minutes < 0) totals.short += -day.minutes;
    if (day.minutes > 0) totals.overtime += day.minutes;
  }
  return totals;
}
