/**
 * Turning punches into attendance — the ONE path, whatever read them.
 *
 * There are now three sources: the Bizcompass spool on disk, our own pull
 * straight off the readers, and a spreadsheet somebody exports by hand. Two
 * code paths writing attendance is how two sets of rules come to disagree, so
 * each source's job ends at a list of `{ user, when }` and everything from
 * there happens here.
 */
import { PUNCH_MAPPING, protectDecided, punchRows } from '../../shared/bizcompassLogs.js';
import { punchesToMarks } from '../../shared/punches.js';
import { settleOffDays, sundayHoursFor } from '../../shared/sundayDuty.js';
import { listAttendance, listEmployees, missingOutSetting, setAttendance } from './db.js';
import { MISSING_OUT_CODE, wroteByRule } from '../../shared/missingOut.js';
import { buildPayroll } from './payroll.js';

/**
 * `period` is read without syncing: an import must not backdate today's new
 * hires into the month or post a loan instalment into one already paid.
 */
export function periodFor(periodId) {
  const payroll = buildPayroll(Number(periodId), { sync: false });
  if (!payroll) return { error: 'period not found', status: 404 };
  if (payroll.period.locked) return { error: 'period is locked', status: 409 };
  return { period: payroll.period };
}

export function applyPunches(period, punches, { dryRun = true } = {}) {
  const employees = listEmployees();
  const mapped = punchRows(punches, employees);
  // Read per import, not per day: the setting can be switched between two
  // pulls and the next one must follow it.
  const missingOut = missingOutSetting();
  const result = punchesToMarks({
    rows: mapped.rows,
    mapping: PUNCH_MAPPING,
    employees,
    period,
    deductLunch: period.lunch_paid !== 1,
    missingOutHalfDay: missingOut.on,
  });

  /*
   * A PUNCH MAY NOT OVERRULE A DECISION.
   *
   * Leave, a holiday, a weekly off worked, a day at home: the clock times
   * still land, the mark stays. Somebody on casual leave who came in for ten
   * minutes would otherwise have their CL turned into a present day and taken
   * off the leave register with it.
   */
  const had = new Map();
  const hadLunch = new Set();
  // Days whose mark the missing-out rule wrote, and nobody has changed since.
  const byRule = new Set();
  const hadMinutes = new Map();
  for (const row of listAttendance(period.id)) {
    if (row.code) had.set(`${row.employee_id}:${row.day}`, row.code);
    hadMinutes.set(`${row.employee_id}:${row.day}`, Number(row.minutes) || 0);
    if (row.lunch_out || row.lunch_in) hadLunch.add(`${row.employee_id}:${row.day}`);
    if (wroteByRule(row)) byRule.add(`${row.employee_id}:${row.day}`);
  }
  /*
   * A WEEKLY OFF IS JUDGED AS A WEEKLY OFF, before the guard below.
   *
   * `punchesToMarks` knows nothing about a day off: it wrote P or HF onto a
   * blank Sunday - HF docks half a day from somebody who came in on their day
   * off - and a Sunday already marked S kept its S. Nothing but a person ever
   * produced SP, which is the only mark the Sunday register reads, so with the
   * readers feeding the grid nobody reached it. Six hours done is SP; anything
   * less, or not yet known, is the day off with the times kept.
   */
  const byId = new Map(employees.map((e) => [e.id, e]));
  const offDays = settleOffDays(result.entries, {
    period,
    personOf: (id) => byId.get(id),
    stored: (id, day) => had.get(`${id}:${day}`) || '',
  });
  /* The importer counted those days as present, half day, short or over
     before anybody asked what day it was. They are none of those now, and a
     dry run that says "12 half days" when it will write none is a dry run
     nobody can check against the grid. */
  const summary = {
    ...result.summary,
    present: Math.max(0, (result.summary.present || 0) - offDays.summary.wasPresent),
    halfDay: Math.max(0, (result.summary.halfDay || 0) - offDays.summary.wasHalfDay),
    shortHours: Math.max(0, (result.summary.shortHours || 0) - offDays.summary.wasShort),
    overtime: Math.max(0, (result.summary.overtime || 0) - offDays.summary.wasOver),
    ...(result.summary.missingOut ? { missingOut: result.summary.missingOut } : {}),
  };
  /*
   * THE MISSING-OUT HALF DAY NEVER OVERWRITES A MARK SOMEBODY SET.
   *
   * A day the rule has NOT written before (or one a person set by hand) keeps
   * its mark, and only the clock times land. Only a blank day, or one the rule
   * itself wrote and nobody has touched since, may become HF. That way the
   * rule cannot quietly change a month that was paid on P before it existed.
   * A rule-written mark on a day that is now complete is put back to P by the
   * write itself (see writeAttendance), not here.
   */
  const missingOutKept = [];
  const settled = offDays.entries.map((entry) => {
    if (entry.missing_out !== 1) return entry;
    const key = `${entry.employee_id}:${entry.day}`;
    if (entry.code !== MISSING_OUT_CODE) return { ...entry, missing_out: null };
    const was = offDays.settled.has(key) ? '' : had.get(key) || '';
    if (!was || byRule.has(key)) return entry;
    /*
     * Somebody's own mark: keep it, write the times, and say so. The stored
     * mark AND its minutes go back in with the entry. Leaving the code out
     * would let the write treat the day as blank, and an A on an automatic-mark
     * day would come back as P - the same trap as the Sunday settle path.
     */
    const { code, minutes, missing_out, ...times } = entry;
    missingOutKept.push({ employee_id: entry.employee_id, day: entry.day, code: was });
    return { ...times, code: was, minutes: hadMinutes.get(key) ?? 0, missing_out: null };
  });

  const guarded = protectDecided(settled, (id, day) =>
    // What the off-day rule decided goes through whole: it only ever decided
    // a day whose mark it is allowed to replace.
    offDays.settled.has(`${id}:${day}`) ? '' : had.get(`${id}:${day}`) || ''
  );

  /*
   * A LUNCH SOMEBODY TYPED IS NEVER REPLACED BY ONE WE WORKED OUT.
   *
   * `findLunchGap` reads the day's own punches and calls the longest gap in
   * the window the break. That is a good guess and it is still a guess: a
   * person who was there knows which gap was lunch and which was a client at
   * the counter. A lunch read off a mapped COLUMN is not touched here - it
   * came from a record somebody kept, and that path behaves as it always did.
   *
   * `lunch_found` never reaches the database: it is this module's flag.
   */
  let lunchKept = 0;
  for (const entry of guarded.entries) {
    if (!entry.lunch_found) continue;
    delete entry.lunch_found;
    if (hadLunch.has(`${entry.employee_id}:${entry.day}`)) {
      delete entry.lunch_out;
      delete entry.lunch_in;
      lunchKept++;
    }
  }

  if (!dryRun && guarded.entries.length) setAttendance(period.id, guarded.entries);

  return {
    ...result,
    summary,
    // A month is a couple of thousand entries; the screen needs the shape.
    entries: undefined,
    unknownIds: mapped.unknown,
    matchedPeople: mapped.matched.length,
    keptMarks: guarded.protected.length,
    // Days the missing-out rule would have set, left alone because a person
    // had already set a mark on them.
    missingOutKept: missingOutKept.length,
    // Weekly offs somebody clocked in on, by the six-hour line.
    offDays: offDays.summary,
    sundayHours: sundayHoursFor(period),
    lunchKept,
    period: { month: period.month, year: period.year },
    dryRun,
    written: dryRun ? 0 : guarded.entries.length,
  };
}
