/*
 * Taking back a "Fill the usual timings" press.
 *
 * Dinesh (v2.37.0): *"by mistake click on fill usual timing / need to revoke
 * / remove this option also / no useful"*. The button wrote each person's
 * usual in and out onto every day on screen that had no times - so on a
 * Saturday morning everybody not yet punched read 09:30 -> 18:30, nine hours,
 * a day nobody had worked yet.
 *
 * Nothing on a row records that a fill wrote it, so this finds them the way
 * the Sunday tab already tells a fill from a punch: the times are EXACTLY the
 * person's usual ones (their own shift where they have one), and there is NO
 * PUNCH ON RECORD for that day. A real arrival at 09:30:00 and departure at
 * 18:30:00 with no punch behind them is indistinguishable from a fill - so the
 * list is shown, named, and nothing is cleared until somebody presses.
 *
 * Without a punch record (the single file) the first half alone decides, and
 * the screen says so.
 */
import { fillTimesFor } from './lateEarly.js';
import { parseTime } from './timesheet.js';

const same = (a, b) => {
  const x = parseTime(a);
  const y = parseTime(b);
  return x === null && y === null ? !String(a || '').trim() && !String(b || '').trim() : x === y;
};

/**
 * @param targets  [{ row, day }] - the days on screen
 * @param standard the office's usual day ({ in_time, out_time, lunch_out, lunch_in })
 * @param entryOf  (row, day) -> the day as it stands
 * @param punches  { [employee_id]: { [day]: [...] } } or null when not known
 */
export function usualFillDays(targets = [], { standard = {}, entryOf, punches = null } = {}) {
  const out = [];
  for (const { row, day } of targets) {
    const e = entryOf(row, day) || {};
    if (!e.in_time || !e.out_time) continue;
    const usual = fillTimesFor(row, standard);
    if (!same(e.in_time, usual.in_time) || !same(e.out_time, usual.out_time)) continue;
    if (!same(e.lunch_out, usual.lunch_out) || !same(e.lunch_in, usual.lunch_in)) continue;
    if (punches && (punches[row.employee_id]?.[day] || []).length) continue;
    out.push({ row, day });
  }
  return out;
}
