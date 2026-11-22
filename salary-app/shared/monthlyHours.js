/**
 * THE MONTH OWES A TOTAL: nine hours times twenty-six days.
 *
 * Dinesh: *"26 days fix / monthly hour full salary k liye 9*26 hone chiaye /
 * kabhi working hours kam hue kabhi jyada hue to uska working hours monthly
 * ke hisab me aana chiaye / agar monthly 234 hour nhi ho raha he to salry
 * dedct hoga"*.
 *
 * Until now every day was settled on its own: short hours charged that day,
 * overtime paid that day, with a quarter-hour of grace on each. Under this
 * rule the month is one account. A Tuesday an hour short and a Thursday an
 * hour long cancel, and only what is missing from the **total** is deducted.
 *
 * ---------------------------------------------------------------------------
 * IT IS AN ALTERNATIVE, NOT AN ADDITION.
 *
 * The same trap as the late/early concession, and the same answer. Somebody
 * an hour short on Tuesday is already an hour short in the month's total;
 * charging both takes the hour twice. So a period runs on ONE of
 * `POLICY.hours`, `POLICY.concession` or `POLICY.monthly`, and `calculateRow`
 * picks one. The daily minutes are still stored and still shown - they are
 * what this adds up - but on this policy they are not what is charged.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * AND IT NEVER CHARGES A DAY THAT IS ALREADY PAID FOR SEPARATELY.
 *
 * The target is NOT a flat 234. It is the hours expected of the days that
 * were actually owed: somebody absent two days owes 24 × 9, not 26 × 9,
 * because those two days have already come off their salary as absences.
 * A flat target would dock them twice for one absence - which is exactly the
 * mistake this file exists to avoid.
 *
 * Leave, a holiday, a weekly off and a half day are all settled by the day
 * count in the same way, so none of them adds to the target either. Only the
 * marks where a full day's hours were genuinely expected count:
 * `HOURS_EXPECTED` - a blank day, P, and WH.
 * ---------------------------------------------------------------------------
 *
 * A DAY NOBODY CLOCKED IS NOT A DAY OF MISSING HOURS. No in time means "not
 * known", which is not zero. Such a day counts on NEITHER side - it adds
 * nothing to the target and nothing to what was worked - because booking nine
 * hours against somebody and crediting none would deduct a full day from a
 * person who was there and simply did not punch.
 *
 * Dependency-free, like the rest of shared/.
 */

import { HOURS_EXPECTED, readTimes } from './timesheet.js';
import { POLICY, hoursForEmployee } from './lateEarly.js';

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** True when this period settles hours once a month rather than day by day. */
export const onMonthlyHours = (period = {}) =>
  String(period.late_policy || POLICY.hours).toLowerCase() === POLICY.monthly;

/** How many minutes a month may fall short before anything is charged. */
export const DEFAULT_MONTHLY_GRACE = 0;

export const monthlyGrace = (period = {}) => {
  const given = period.monthly_hours_grace;
  if (given === null || given === undefined || given === '') return DEFAULT_MONTHLY_GRACE;
  return Math.max(0, num(given, DEFAULT_MONTHLY_GRACE));
};

const codeOf = (entry) =>
  String((entry && typeof entry === 'object' ? entry.code : entry) || '').trim().toUpperCase();

/**
 * One person's month, as a single account of hours.
 *
 * @param attendance the month's marks, with clock times on them
 * @param opts { employee, period, per_minute }
 * @returns {{
 *   days, worked, expected, typed, diff, grace, chargeable, amount,
 *   target_days, judged
 * }}
 *   `judged` false means there was nothing to judge - say "not known", never
 *   that they completed their hours.
 */
export function monthlyHoursLine(attendance = {}, { employee = {}, period = {}, per_minute = 0 } = {}) {
  const hoursPerDay = hoursForEmployee(employee, { period });
  const perDayMinutes = Math.round(hoursPerDay * 60);
  const deductLunch = !period.lunch_paid;

  let days = 0;
  let worked = 0;
  let expected = 0;
  let typed = 0;

  for (const entry of Object.values(attendance || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const code = codeOf(entry);
    if (!HOURS_EXPECTED.has(code)) continue;

    const read = readTimes(entry, { deductLunch });
    if (read.worked === null) {
      /*
       * Nobody clocked it. The hours typed straight onto the grid still
       * stand - somebody put "40 minutes short" there on purpose and
       * dropping it would quietly forgive it - but no target is booked
       * against a day with no times, because that would deduct a full day
       * from somebody who was present and did not punch.
       */
      typed += num(entry.minutes);
      continue;
    }
    days += 1;
    worked += read.worked;
    expected += perDayMinutes;
  }

  const judged = days > 0 || typed !== 0;
  const diff = Math.round(worked - expected + typed);
  const grace = monthlyGrace(period);
  /* Grace only forgives a SHORTFALL. It is not a floor under overtime. */
  const chargeable = diff < 0 ? Math.min(0, diff + grace) : 0;

  return {
    days,
    target_days: days,
    worked: Math.round(worked),
    expected,
    typed: Math.round(typed),
    diff,
    grace,
    chargeable,
    /* Negative when money comes off, positive when overtime is owed - the
       same sign convention the daily minutes already use, so `calculateRow`
       can hand either to the same multiplication. */
    minutes: diff < 0 ? chargeable : diff,
    amount: Math.round((diff < 0 ? chargeable : diff) * num(per_minute) * 100) / 100,
    judged,
  };
}

/** "234h owed, 229h 20m worked, 4h 40m short" - for the panel and the sheet. */
export function describeMonthlyHours(line = {}) {
  const mins = (m) => {
    const v = Math.abs(Math.round(num(m)));
    return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
  };
  if (!line.judged) return 'no clock times this month, so nothing is judged';
  const parts = [`${mins(line.expected)} owed`, `${mins(line.worked + line.typed)} worked`];
  if (line.diff === 0) parts.push('exactly on');
  else if (line.diff > 0) parts.push(`${mins(line.diff)} over`);
  else parts.push(`${mins(line.diff)} short`);
  if (line.diff < 0 && line.chargeable === 0) parts.push('within the grace');
  return parts.join(', ');
}
