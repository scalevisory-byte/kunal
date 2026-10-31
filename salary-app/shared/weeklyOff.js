/**
 * Which day of the week is the day off.
 *
 * The app has always assumed Sunday, which is right for most of the staff and
 * wrong for the rest — a driver off on Thursday, a shop that closes Monday,
 * an office on alternate Saturdays.
 *
 * What does NOT change is the marks: `S` still means "the weekly off" and `SP`
 * still means "worked the weekly off", which is what the Sunday register pays
 * from. Only *which days* get them moves. The salary engine never asks what
 * day of the week it is — it counts marks — so nothing here can move money by
 * itself.
 *
 * Dependency-free, so the grid and the server agree on which squares are grey.
 */

export const WEEKDAYS = [
  { day: 0, label: 'Sunday', short: 'Sun' },
  { day: 1, label: 'Monday', short: 'Mon' },
  { day: 2, label: 'Tuesday', short: 'Tue' },
  { day: 3, label: 'Wednesday', short: 'Wed' },
  { day: 4, label: 'Thursday', short: 'Thu' },
  { day: 5, label: 'Friday', short: 'Fri' },
  { day: 6, label: 'Saturday', short: 'Sat' },
];

/** Sunday off, every week. What the app has always done. */
export const DEFAULT_POLICY = { days: [0], alternate: null };

/**
 * `days`      weekday numbers that are always off (0 = Sunday)
 * `alternate` { day, weeks } — e.g. Saturday on the 2nd and 4th of the month,
 *             which is how half of Gujarat works and cannot be expressed as
 *             "every Saturday" or "no Saturday".
 */
export function readPolicy(value) {
  if (!value) return { ...DEFAULT_POLICY };
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }
  const days = Array.isArray(raw?.days)
    ? [...new Set(raw.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    : DEFAULT_POLICY.days;

  const alt = raw?.alternate;
  const alternate =
    alt && Number.isInteger(Number(alt.day)) && Array.isArray(alt.weeks) && alt.weeks.length
      ? { day: Number(alt.day), weeks: [...new Set(alt.weeks.map(Number).filter((w) => w >= 1 && w <= 5))] }
      : null;

  return { days, alternate };
}

export const writePolicy = (policy) => JSON.stringify(readPolicy(policy));

/** Which occurrence of its weekday a date is — the 2nd Saturday, say. */
export const weekOfMonth = (day) => Math.floor((Number(day) - 1) / 7) + 1;

export function isWeeklyOff(year, month, day, policy) {
  const rules = readPolicy(policy);
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  if (rules.days.includes(weekday)) return true;
  if (rules.alternate && rules.alternate.day === weekday) {
    return rules.alternate.weeks.includes(weekOfMonth(day));
  }
  return false;
}

/** Every day off in a month, for painting the grid and filling blanks. */
export function weeklyOffDays(year, month, policy) {
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const out = [];
  for (let day = 1; day <= last; day += 1) if (isWeeklyOff(year, month, day, policy)) out.push(day);
  return out;
}

/** Said in words, for a settings line nobody should have to decode. */
export function describePolicy(policy) {
  const rules = readPolicy(policy);
  const named = rules.days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => WEEKDAYS[d].label);
  const parts = [];
  if (named.length) parts.push(named.join(' and '));
  if (rules.alternate) {
    const ordinal = ['', '1st', '2nd', '3rd', '4th', '5th'];
    parts.push(
      `${rules.alternate.weeks.sort((a, b) => a - b).map((w) => ordinal[w]).join(' and ')} ${
        WEEKDAYS[rules.alternate.day].label
      }`
    );
  }
  return parts.length ? parts.join(', plus the ') : 'no weekly off';
}

/**
 * The policy that applies to one person: their own if they have one, else
 * their company's, else Sunday.
 */
export const policyFor = (employee, company) =>
  readPolicy(employee?.weekly_off || company?.weekly_off || DEFAULT_POLICY);
