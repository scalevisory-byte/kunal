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
import { listAttendance, listEmployees, setAttendance } from './db.js';
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
  const result = punchesToMarks({
    rows: mapped.rows,
    mapping: PUNCH_MAPPING,
    employees,
    period,
    deductLunch: period.lunch_paid !== 1,
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
  for (const row of listAttendance(period.id)) {
    if (row.code) had.set(`${row.employee_id}:${row.day}`, row.code);
    if (row.lunch_out || row.lunch_in) hadLunch.add(`${row.employee_id}:${row.day}`);
  }
  const guarded = protectDecided(result.entries, (id, day) => had.get(`${id}:${day}`) || '');

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
    // A month is a couple of thousand entries; the screen needs the shape.
    entries: undefined,
    unknownIds: mapped.unknown,
    matchedPeople: mapped.matched.length,
    keptMarks: guarded.protected.length,
    lunchKept,
    period: { month: period.month, year: period.year },
    dryRun,
    written: dryRun ? 0 : guarded.entries.length,
  };
}
