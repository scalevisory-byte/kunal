/**
 * A MONTH LAID OUT AS WEEKS, for any calendar that draws one.
 *
 * Dinesh: *"calendar bana do usme sari date dikh jayengi"*.
 *
 * There was already a calendar here - the leave one - and it worked the
 * layout out inline in its own component. A second calendar copying that
 * code is how two calendars come to disagree about which square the 1st
 * sits in, so the rule lives here once and both read it.
 *
 * It is only the LAYOUT. What goes in a square is the caller's business,
 * because a leave calendar and an attendance calendar are not answering the
 * same question.
 *
 * Dependency-free, like the rest of shared/.
 */

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** How many days that month really has - February is not a guess. */
export const daysInMonth = (year, month) =>
  new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();

/** Which column the 1st falls in: 0 = Sunday. */
export const firstWeekday = (year, month) =>
  new Date(Date.UTC(Number(year), Number(month) - 1, 1)).getUTCDay();

/**
 * Rows of seven. A square with no date in it is `null`, at the start of the
 * first week and the end of the last - NOT the neighbouring month's dates,
 * which on a payroll calendar would be days from another sheet sitting in a
 * month somebody is reading.
 *
 * @param cells  one entry per day, in order, 1st first. Numbers, objects,
 *               whatever the caller draws; it is passed straight through.
 *               Left out, the days are numbered 1..n.
 */
export function monthWeeks({ year, month, cells = null } = {}) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) return [];
  const total = daysInMonth(y, m);
  const days = Array.isArray(cells) ? cells.slice(0, total) : Array.from({ length: total }, (_, i) => i + 1);
  /* A short list is padded, never silently dropped: a month whose rows have
     not all arrived must still draw as that month. */
  while (days.length < total) days.push(null);

  const squares = [...Array(firstWeekday(y, m)).fill(null), ...days];
  while (squares.length % 7 !== 0) squares.push(null);

  const weeks = [];
  for (let i = 0; i < squares.length; i += 7) weeks.push(squares.slice(i, i + 7));
  return weeks;
}
