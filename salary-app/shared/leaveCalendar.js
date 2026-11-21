/**
 * A MONTH OF LEAVE, AS A CALENDAR.
 *
 * Dinesh's brief asks for one: approved leave, pending applications, the
 * company's holidays and the weekly offs, by colour, clickable.
 *
 * ---------------------------------------------------------------------------
 * APPROVED LEAVE IS THE MARKS. PENDING IS THE QUEUE. They are different
 * things and the calendar must never blur them: a pending application has
 * moved nobody's pay and nobody's attendance, and showing it in the same
 * colour as an approved day is how somebody plans a shift around a day off
 * that was never granted.
 * ---------------------------------------------------------------------------
 *
 * It assembles. The marks come from the grid, the pending days from the
 * request queue, the holidays from the month, the offs from each person's
 * own policy. Nothing here decides anything.
 *
 * Dependency-free, like the rest of shared/.
 */

import { isWeeklyOff, policyFor } from './weeklyOff.js';

const LEAVE_MARKS = new Set(['CL', 'SL', 'PL', 'UL', 'WH']);

const daysIn = (year, month) => new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @param rows      the month's payroll rows, with their `attendance`
 * @param period    the month
 * @param requests  open attendance requests, as the queue holds them
 * @param holidays  the month's holidays
 */
export function leaveCalendar({ rows = [], period = {}, requests = [], holidays = [] } = {}) {
  const year = Number(period.year);
  const month = Number(period.month);
  const total = year && month ? daysIn(year, month) : 0;

  const holidayOn = new Map();
  for (const h of holidays) if (h?.day) holidayOn.set(Number(h.day), h.name || 'Holiday');

  /* Pending by person and day. A span is spread over its days here rather
     than drawn as a bar, because a calendar is read a day at a time. */
  const pending = new Map();
  for (const r of requests) {
    if (!['pending', 'recommended'].includes(r.status)) continue;
    const from = Number(r.day) || 0;
    const to = Number(r.to_day) || from;
    for (let d = Math.min(from, to); d <= Math.max(from, to); d += 1) {
      if (!d) continue;
      if (!pending.has(d)) pending.set(d, []);
      pending.get(d).push({
        employee_id: r.employee_id,
        name: r.employee_name,
        code: r.code || '',
        kind: r.kind,
        request_id: r.id,
        status: r.status,
      });
    }
  }

  const days = [];
  for (let day = 1; day <= total; day += 1) {
    const onLeave = [];
    let offs = 0;
    for (const row of rows) {
      const entry = row.attendance?.[day];
      const mark = (typeof entry === 'object' ? entry?.code : entry) || '';
      if (LEAVE_MARKS.has(mark)) {
        onLeave.push({
          employee_id: row.employee_id,
          name: row.employee_name,
          code: mark,
          department: row.department || '',
        });
      }
      if (isWeeklyOff(year, month, day, policyFor(row, { weekly_off: row.company_weekly_off }))) {
        offs += 1;
      }
    }
    days.push({
      day,
      weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
      holiday: holidayOn.get(day) || '',
      /* How many people have this day off anyway. Not a list: on a Sunday it
         is everybody, and a hundred names in a calendar square is nothing. */
      weekly_off: offs,
      everybody_off: offs > 0 && offs === rows.length,
      on_leave: onLeave,
      pending: pending.get(day) || [],
    });
  }

  return {
    period: { year, month, label: period.label || '', days: total },
    days,
    summary: {
      /* Days of leave taken, not people - one person off for five days is
         five days of leave and one person. */
      leave_days: days.reduce((t, d) => t + d.on_leave.length, 0),
      people: new Set(days.flatMap((d) => d.on_leave.map((p) => p.employee_id))).size,
      pending_days: days.reduce((t, d) => t + d.pending.length, 0),
      holidays: days.filter((d) => d.holiday).length,
      /* The busiest day, which is the question a calendar is opened for. */
      busiest: days.reduce((best, d) => (d.on_leave.length > (best?.on_leave.length || 0) ? d : best), null),
    },
  };
}
