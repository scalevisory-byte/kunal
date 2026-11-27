/**
 * Appraisals: what one is FOR, and the month's own sheet behind it.
 *
 * Dinesh: *"Appraisal drop down list. appraisal means any salary increment?
 * any other target achieved, good work related?"* - and *"auto appraisal list
 * for proper in uniform whole month, discipline, time, attendance, target"*.
 *
 * Two answers.
 *
 * 1. AN APPRAISAL IS A REVIEW, and an increment is only one thing it can be
 *    for. The record always had a rating, a summary and an optional new
 *    salary; what it never had was a word for WHY it was written, so every
 *    one read as a pay rise. `APPRAISAL_KINDS` is that word.
 *
 * 2. THE MONTH ALREADY KNOWS MOST OF WHAT AN APPRAISAL ASKS. Uniform, time
 *    and attendance are on the attendance grid; discipline is the warnings
 *    on the record. This reads them and lays them side by side.
 *
 * IT ASSEMBLES AND DECIDES NOTHING. No appraisal is raised by it, no rating is
 * given, and nobody's pay moves - it is a list to look at before somebody
 * raises one. And every criterion is THREE-state: yes, no, and NOT KNOWN. A
 * floor nobody walked is not a month in proper uniform, and somebody who never
 * clocked in was not "on time all month". Counting not-known as a yes would
 * put the people with the least on record at the top of the list.
 *
 * Dependency-free apart from the rules it reads, so the office sheet and the
 * single-file build cannot score one person two ways.
 */
import { calculateRow } from './calc.js';
import { FULL_DAY_MARKS, shiftTimesFor } from './lateEarly.js';
import { PAID_BY_THE_DAY, isEarlyOut, isLateIn } from './timesheet.js';

/** What an appraisal is for. The first is the only one that is about pay. */
export const APPRAISAL_KINDS = [
  ['increment', 'Salary increment', 'A rise in pay. Fill in the new salary and from when.'],
  ['target', 'Target achieved', 'A target met or beaten. Say which one in the summary.'],
  ['good_work', 'Good work', 'Work worth putting on record, with no change in pay.'],
  ['promotion', 'Promotion', 'A new designation, with or without a rise.'],
  ['annual', 'Annual review', 'The yearly review, whatever comes of it.'],
  ['other', 'Other', 'Anything else. Say what in the summary.'],
];

export const APPRAISAL_KIND_KEYS = APPRAISAL_KINDS.map(([key]) => key);

export const appraisalKindLabel = (key) => APPRAISAL_KINDS.find(([k]) => k === key)?.[1] || '';

/** Marks on which somebody was at work and could be seen: the uniform walk's own list. */
const AT_WORK = new Set(['P', 'HF', 'SP', 'HP']);

export const CRITERIA = [
  ['uniform', 'Uniform', 'In proper uniform on every day somebody looked'],
  ['discipline', 'Discipline', 'No warning on the record this month'],
  ['time', 'Time', 'Never late in and never early out, by their own shift'],
  ['attendance', 'Attendance', 'No day of pay lost to absence'],
  ['target', 'Target', 'Ticked by the office - nothing in the app measures a target'],
];

const codeOf = (entry) => String((entry && typeof entry === 'object' ? entry.code : entry) || '').trim().toUpperCase();

/**
 * One person's month against the five criteria.
 *
 * @param warnings  how many warnings they were given this month, or null when
 *                  that is not known here (the single-file build has no record)
 */
export function scoreMonth(row = {}, period = {}, { warnings = null, grace = 15 } = {}) {
  const attendance = row.attendance || {};
  const shift = shiftTimesFor(row, { shift_in: period.shift_in, shift_out: period.shift_out });

  let atWork = 0;
  let looked = 0;
  let outOfUniform = 0;
  let clocked = 0;
  let late = 0;
  let early = 0;
  let marked = 0;
  for (const entry of Object.values(attendance)) {
    const code = codeOf(entry);
    if (code) marked += 1;
    if (!entry || typeof entry !== 'object') continue;
    if (AT_WORK.has(code)) {
      atWork += 1;
      if (entry.uniform === true || entry.uniform === false) {
        looked += 1;
        if (entry.uniform === false) outOfUniform += 1;
      }
    }
    // A half day, leave or a holiday was never a full day to be late for.
    /*
     * A day off that was worked (SP, HP) is paid by the day and its duty is
     * six hours, not the weekday's nine - so somebody who did seven hours on
     * a Sunday did not "leave early". Found by driving it: the sheet marked a
     * person down on Time for coming in on their day off.
     */
    if (FULL_DAY_MARKS.has(code) && !PAID_BY_THE_DAY.has(code) && entry.in_time) {
      clocked += 1;
      if (isLateIn(entry, { start: shift.in, grace })) late += 1;
      if (entry.out_time && isEarlyOut(entry, { end: shift.out, grace })) early += 1;
    }
  }

  const calc = calculateRow(row, period, attendance);
  const lost = Number(calc.absent_days) || 0;
  const target = row.target_met === null || row.target_met === undefined || row.target_met === '' ? null : Boolean(Number(row.target_met));

  const marks = {
    uniform: {
      ok: looked ? outOfUniform === 0 : null,
      detail: !looked
        ? 'nobody looked this month'
        : outOfUniform
          ? `out of uniform on ${outOfUniform} of ${looked} day(s) looked at`
          : looked < atWork
            ? `proper on all ${looked} day(s) looked at, of ${atWork} at work`
            : `proper on all ${looked} day(s)`,
    },
    discipline: {
      ok: warnings === null ? null : warnings === 0,
      detail: warnings === null ? 'not known here' : warnings ? `${warnings} warning(s) this month` : 'no warning this month',
    },
    time: {
      ok: clocked ? late === 0 && early === 0 : null,
      detail: !clocked
        ? 'no clock times this month'
        : late || early
          ? [late ? `late ${late} time(s)` : '', early ? `left early ${early} time(s)` : ''].filter(Boolean).join(', ')
          : `on time on all ${clocked} day(s) clocked`,
    },
    attendance: {
      ok: marked ? lost === 0 : null,
      detail: !marked ? 'nothing marked this month' : lost ? `${lost} day(s) of pay lost` : 'no day lost',
    },
    target: {
      ok: target,
      detail: target === null ? 'not ticked yet' : target ? 'met' : 'not met',
    },
  };

  const keys = CRITERIA.map(([key]) => key);
  return {
    row_id: row.id,
    employee_id: row.employee_id ?? row.id,
    name: row.employee_name || row.name || '',
    code: row.employee_code || row.code || '',
    company: row.company_name || '',
    department: row.department || '',
    marks,
    passed: keys.filter((k) => marks[k].ok === true).length,
    failed: keys.filter((k) => marks[k].ok === false).length,
    unknown: keys.filter((k) => marks[k].ok === null).length,
  };
}

/**
 * The month's sheet: everybody scored, best first, in three piles that are
 * three different statements and are never added together.
 *   clear       all five known, all five yes
 *   soFar       nothing against them, but something is not known yet
 *   notClear    at least one no
 */
export function appraisalSheet(rows = [], period = {}, { warnings = null, grace } = {}) {
  const lines = rows.map((row) =>
    scoreMonth(row, period, {
      warnings: warnings ? Number(warnings[row.employee_id ?? row.id]) || 0 : null,
      grace,
    })
  );
  lines.sort((a, b) => a.failed - b.failed || b.passed - a.passed || a.name.localeCompare(b.name));
  return {
    lines,
    clear: lines.filter((l) => !l.failed && !l.unknown),
    soFar: lines.filter((l) => !l.failed && l.unknown),
    notClear: lines.filter((l) => l.failed),
  };
}
