/**
 * WHAT THEY HAVE EARNED SO FAR THIS MONTH.
 *
 * Dinesh: *"jo date ko open kare o date tak ki earning bhi dikhavo"*. An
 * employee opening their own page on the 20th sees the month's net pay —
 * which is the WHOLE month, including eleven days they have not worked yet.
 * What they actually want to know is what the month is worth so far.
 *
 * THREE RULES, and the first is the one that matters:
 *
 *   **IT IS NOT A PROMISE OF WHAT WILL BE PAID.** It is what the days up to
 *   today add up to at the day rate, before PF, ESI, PT, a loan instalment
 *   or anything else that comes off at the end of the month. The page says
 *   exactly that beside it. A figure that looked like take-home and was not
 *   would be worse than no figure at all.
 *
 *   **IT COUNTS DAYS THE WAY THE MONTH DOES.** A day nobody has marked
 *   counts as worked, because that is how the sheet pays it; an absence
 *   takes a day off, a half day half, a double absence two. The weekly off
 *   is not counted, because it is not a working day — and the month is paid
 *   on its fixed working days, so a Sunday is neither earned nor lost.
 *
 *   **IT STOPS AT TODAY.** Days after today are not counted at all, marked
 *   or not. Somebody's approved leave next week is not a day they have
 *   already earned, and it is not a day they have already lost either.
 *
 * Dependency-free, like the rest of shared/.
 */

import { ATTENDANCE_CODES, markFor } from './calc.js';

const codeOf = (entry) =>
  String((entry && typeof entry === 'object' ? entry.code : entry) || '').toUpperCase();

/** Sunday by the calendar, which is the off day unless a mark says otherwise. */
const isSunday = (year, month, day) => new Date(year, month - 1, day).getDay() === 0;

/**
 * @param period      the month, for its year/month
 * @param attendance  the marks, keyed by day of the month
 * @param calc        what `calculateRow` returned — for `per_day` only
 * @param upto        day of the month to count to (today, normally)
 * @returns null when there is nothing sensible to say, else the figures
 */
export function earnedSoFar({ period, attendance = {}, calc = {}, upto } = {}) {
  const perDay = Number(calc.per_day) || 0;
  const last = Number(upto) || 0;
  if (!period || !perDay || last < 1) return null;

  let worked = 0;
  let lost = 0;
  let off = 0;
  let marked = 0;

  for (let day = 1; day <= last; day += 1) {
    const entry = attendance?.[day];
    const code = codeOf(entry);
    if (code) marked += 1;

    /*
     * A day off is neither earned nor lost. `S` says so explicitly; with no
     * mark at all a Sunday is read as the off day, which is what the grid
     * shades and what the office means by a blank Sunday.
     */
    if (code === 'S' || (!code && isSunday(period.year, period.month, day))) {
      off += 1;
      continue;
    }

    const absent = Number(markFor(code, period)?.absent) || 0;
    if (absent) {
      lost += absent;
      // A half day is half worked and half lost.
      worked += Math.max(0, 1 - absent);
    } else {
      // Present, leave, a holiday, working from home - and an unmarked day,
      // which the month pays, so it is counted here the same way.
      worked += 1;
    }
  }

  return {
    upto: last,
    days_worked: Math.round(worked * 100) / 100,
    days_lost: Math.round(lost * 100) / 100,
    days_off: off,
    days_marked: marked,
    days_unmarked: last - off - marked,
    per_day: perDay,
    /** The day-rate earning to date. Deductions are NOT in it, and it says so. */
    amount: Math.round(worked * perDay),
  };
}
