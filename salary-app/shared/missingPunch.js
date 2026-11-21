/**
 * DAYS THE CLOCK CANNOT ACCOUNT FOR.
 *
 * The flags already existed - `punches.js` refuses to invent a departure, the
 * eSSL import sends an empty out time rather than omitting it, and the Time
 * tab shows a warning on the day. What was missing is anywhere to see them
 * together, so a fortnight's worth were only ever found one day at a time.
 *
 * ---------------------------------------------------------------------------
 * IT COUNTS NOTHING AND CHANGES NOTHING.
 *
 * Every day here is already paid, one way or the other: a day with no out
 * time has its hours worked out by whatever rule the sheet used, and this
 * report does not touch that. It is a LIST OF THINGS TO GO AND ASK ABOUT,
 * not a deduction and not a correction.
 *
 * And the distinction the whole report hangs on: **a day nobody clocked is
 * not the same as a day half-clocked**. Somebody who punched in at 9 and
 * never out has a machine record that is wrong; somebody with no times at
 * all may simply be on a job where nobody punches. They are counted apart
 * and named apart, because the first is a correction and the second may be
 * nothing at all.
 * ---------------------------------------------------------------------------
 */

import { ATTENDANCE_CODES } from './calc.js';
import { WORKED_MARKS } from './dailyReport.js';
import { formatDuration, hasTimes, parseTime, readTimes } from './timesheet.js';

/** What is wrong with the day, worst first. */
export const PROBLEMS = [
  ['no_out', 'Punched in, never out', 'the day has a start and no finish'],
  ['no_in', 'Out time with no in', 'somebody finished a day they never started'],
  ['lunch_half', 'Half a lunch break', 'one of the two lunch times is missing'],
  ['nothing', 'At work, no times at all', 'nothing was clocked and nothing typed'],
];

export const problemLabel = (key) => PROBLEMS.find(([k]) => k === key)?.[1] || key;

const codeOf = (entry) => (typeof entry === 'object' ? entry?.code : entry) || '';
const timesOf = (entry) => (typeof entry === 'object' && entry ? entry : {});

/** What, if anything, is wrong with one day's clock times. */
export function problemOf(entry, { code = '' } = {}) {
  const times = timesOf(entry);
  const inAt = parseTime(times.in_time);
  const outAt = parseTime(times.out_time);
  const lunchOut = parseTime(times.lunch_out);
  const lunchIn = parseTime(times.lunch_in);

  /* Only a day somebody was AT WORK can be missing a punch. There is nothing
     to clock on an absence, a holiday or a day of leave, and listing those
     would bury the real ones under a hundred that were never going to have
     times. */
  if (!WORKED_MARKS.has(code)) return null;

  if (inAt !== null && outAt === null) return 'no_out';
  if (outAt !== null && inAt === null) return 'no_in';
  if ((lunchOut === null) !== (lunchIn === null)) return 'lunch_half';
  if (!hasTimes(times)) return 'nothing';
  return null;
}

/**
 * The whole month.
 *
 * `rows` are calculated rows with their `attendance`, exactly as every other
 * report here takes them.
 */
export function missingPunches(rows = [], { hoursPerDay = 9 } = {}) {
  const lines = [];
  for (const row of rows) {
    const attendance = row.attendance || {};
    for (const key of Object.keys(attendance)) {
      const day = Number(key);
      if (!day) continue;
      const entry = attendance[key];
      const code = codeOf(entry);
      const problem = problemOf(entry, { code });
      if (!problem) continue;
      const times = timesOf(entry);
      const judged = hasTimes(times) ? readTimes(times) : null;
      lines.push({
        employee_id: row.employee_id,
        name: row.employee_name || '',
        code: row.employee_code || '',
        company_name: row.company_name || '',
        department: row.department || '',
        day,
        mark: code,
        mark_label: ATTENDANCE_CODES[code]?.label || code,
        problem,
        problem_label: problemLabel(problem),
        in_time: times.in_time || '',
        lunch_out: times.lunch_out || '',
        lunch_in: times.lunch_in || '',
        out_time: times.out_time || '',
        /* What the sheet worked the day out as, so the row says what it is
           already being paid - NOT a figure this report arrives at. */
        worked: judged && judged.minutes ? formatDuration(judged.minutes) : '',
        reason: (typeof entry === 'object' ? entry.reason : '') || '',
      });
    }
  }

  lines.sort(
    (a, b) =>
      PROBLEMS.findIndex(([k]) => k === a.problem) - PROBLEMS.findIndex(([k]) => k === b.problem) ||
      String(a.name).localeCompare(String(b.name)) ||
      a.day - b.day
  );

  const count = (p) => lines.filter((l) => l.problem === p).length;
  const people = new Set(lines.map((l) => l.employee_id));
  /* Somebody with the same gap over and over is a different problem from
     somebody who forgot once - a finger that does not read, or a door
     nobody passes. Named, because a list of 200 days is not actionable and
     "these four people are 180 of them" is. */
  const worst = [...people]
    .map((id) => {
      const theirs = lines.filter((l) => l.employee_id === id);
      return { employee_id: id, name: theirs[0].name, days: theirs.length };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  return {
    lines,
    totals: {
      days: lines.length,
      people: people.size,
      no_out: count('no_out'),
      no_in: count('no_in'),
      lunch_half: count('lunch_half'),
      nothing: count('nothing'),
      hours_per_day: hoursPerDay,
    },
    worst,
  };
}

export const MISSING_PUNCH_COLUMNS = [
  ['Name', 'name'],
  ['Code', 'code'],
  ['Company', 'company_name'],
  ['Department', 'department'],
  ['Day', 'day'],
  ['Mark', 'mark'],
  ['What is missing', 'problem_label'],
  ['In', 'in_time'],
  ['Lunch out', 'lunch_out'],
  ['Lunch in', 'lunch_in'],
  ['Out', 'out_time'],
  ['Worked', 'worked'],
  ['Reason', 'reason'],
];
