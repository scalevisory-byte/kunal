/**
 * The lunch break, found in the day's own punches.
 *
 * Dinesh: *"JO 30 MINUTES GAP HO O LUNCH ME COUNT HO ESA HO SAKTA HE?"*
 *
 * It could not be, until the raw punches started being kept (v1.97): the app
 * held a day's first and last punch and nothing between them, so there was no
 * gap to find. The readers are door locks, so stepping out for lunch and
 * coming back is two punches like any other - the only thing that marks it
 * out is HOW LONG the gap is.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 *
 * It does not decide what lunch costs. Whether the break comes off the paid
 * day is the month's own `lunch_paid` setting and has been for a long time;
 * this only fills the two columns the office could already type by hand. On a
 * month where lunch sits INSIDE the paid day - which is how Dinesh's office
 * runs - filling it cannot move a rupee.
 *
 * And it never overwrites a lunch somebody typed. A person who was there
 * knows better than a rule about gap lengths.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, so the import, the server and the dashboard find the same
 * break in the same day.
 */

export const LUNCH_RULES = {
  /*
   * The window a gap has to fall in to be lunch, in minutes.
   *
   * Ten minutes is tea and nobody calls it a break. Four hours is not lunch
   * either - that is somebody who went home and came back, and booking it as
   * a break would quietly shorten a day that was really two half days. Dinesh
   * named thirty; the window is wide enough that a short lunch and a long one
   * both land in it, and narrow enough that neither of the other two do.
   */
  minMinutes: 20,
  maxMinutes: 90,
  /*
   * ...and WHEN it has to happen, because length alone is not enough.
   *
   * Found by a failing test: a day of 09:00, 10:30, 11:00, 13:00, 13:40,
   * 18:00 has a ninety-minute gap right after the arrival, and the
   * longest-gap rule called THAT lunch instead of the 13:00 one. Somebody who
   * popped out first thing is not at lunch, and on a month where lunch comes
   * off the hours that mistake costs them an hour and a half.
   *
   * The window is wide on purpose - an early shift eats at eleven and a late
   * one at four - and it is data, so an office that really does lunch at ten
   * can be given its own.
   */
  startsAfter: 11 * 60,
  endsBefore: 16 * 60 + 30,
  /* Where the middle of the day is, for choosing between two equal gaps. */
  middayMinutes: 13 * 60,
};

/**
 * The lunch break in one day's punches, or null.
 *
 * @param times  minutes-of-day, in any order, with or without repeats
 * @returns { out, in, minutes } | null
 */
export function findLunchGap(times = [], rules = {}) {
  const { minMinutes, maxMinutes, startsAfter, endsBefore, middayMinutes } =
    { ...LUNCH_RULES, ...(rules || {}) };
  const stamps = [...new Set(times.filter((t) => Number.isFinite(t)))].sort((a, b) => a - b);
  // Two punches are an arrival and a departure: there is no gap INSIDE the
  // day to look at, and the time between them is the day itself.
  if (stamps.length < 3) return null;

  let best = null;
  for (let i = 0; i < stamps.length - 1; i++) {
    const gap = stamps[i + 1] - stamps[i];
    if (gap < minMinutes || gap > maxMinutes) continue;
    // A break has to happen around the middle of the day, not on the way in
    // or on the way out.
    if (stamps[i] < startsAfter || stamps[i + 1] > endsBefore) continue;
    const middle = (stamps[i] + stamps[i + 1]) / 2;
    const candidate = { out: stamps[i], in: stamps[i + 1], minutes: gap, from: Math.abs(middle - middayMinutes) };
    /*
     * The longest qualifying gap is the break; the rest of the day's comings
     * and goings are shorter. Two gaps of exactly the same length is a real
     * tie, and the one nearer the middle of the day is the one people mean.
     */
    if (!best || candidate.minutes > best.minutes ||
        (candidate.minutes === best.minutes && candidate.from < best.from)) {
      best = candidate;
    }
  }
  return best ? { out: best.out, in: best.in, minutes: best.minutes } : null;
}

/** Minutes-of-day as 'HH:MM'. */
export const asTime = (m) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
