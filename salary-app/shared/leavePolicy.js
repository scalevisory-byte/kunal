/*
 * THE YEAR'S LEAVE: CASUAL AND SICK TOGETHER, AGAINST ONE LIMIT (v2.38.0).
 *
 * Dinesh: *"leave balance is 20 unpaid leave / ese set karo ki 20 unpaid
 * leave me se kitni leave le li he / after 20 leave complete in year they are
 * not eligible to take any leave"*.
 *
 * So it is ONE figure, not one per kind: CL and SL added up, against a yearly
 * limit (20 by default, held in settings). The days are counted off the grid
 * - the marks the salary is paid from - only on months that charge them, so
 * a CL from before the rule changed is not part of this year's twenty.
 *
 * What the limit does, and what it deliberately does not:
 *   - an APPLICATION that would take somebody past it is refused, by name,
 *     with how many they have used and how many are left;
 *   - an APPROVAL is checked again, because two applications raised the same
 *     week can each fit alone and not together;
 *   - the OFFICE marking the grid is not refused. Somebody who is off sick on
 *     their twenty-first day is still off; the grid must be able to say so.
 *     It is flagged instead, on the day menu and in the register.
 */

export const DEFAULT_YEARLY_LEAVE = 20;
export const LIMITED_LEAVE = ['CL', 'SL'];

const days = (n) => `${n} day${Number(n) === 1 ? '' : 's'}`;

/** `{ limit, used, waiting, left, over }` - `left` never hides a minus. */
export function yearlyLeave({ limit = DEFAULT_YEARLY_LEAVE, used = 0, waiting = 0 } = {}) {
  const cap = Number(limit) > 0 ? Number(limit) : DEFAULT_YEARLY_LEAVE;
  const taken = Number(used) || 0;
  const left = cap - taken;
  return { limit: cap, used: taken, waiting: Number(waiting) || 0, left, over: left < 0 };
}

/**
 * Why an application of `asking` days cannot go through, or null when it can.
 * `waiting` is the days already applied for and not yet decided, which count
 * against what is left - otherwise three applications of eight would each
 * pass on their own.
 */
export function leaveLimitProblem({ limit, used = 0, waiting = 0, asking = 0, year }) {
  const y = yearlyLeave({ limit, used, waiting });
  const free = y.left - y.waiting;
  if (asking <= free) return null;
  const when = year ? ` in ${year}` : ' this year';
  if (free <= 0) {
    return (
      `the yearly leave limit of ${days(y.limit)} is used up${when} ` +
      `(${days(y.used)} taken${y.waiting ? `, ${days(y.waiting)} waiting for a decision` : ''}) — no more leave can be applied for`
    );
  }
  return (
    `only ${days(free)} of the yearly ${days(y.limit)} are left${when} ` +
    `(${days(y.used)} taken${y.waiting ? `, ${days(y.waiting)} waiting` : ''}) — this asks for ${asking}`
  );
}

/** The one line shown beside an application, on all three screens. */
export function yearlyLine(y) {
  if (!y) return '';
  return y.over
    ? `${days(y.used)} of ${y.limit} used — ${days(-y.left)} over the yearly limit`
    : `${days(y.used)} of ${y.limit} used · ${days(y.left)} left this year`;
}
