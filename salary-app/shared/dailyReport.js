/**
 * THE DAILY OFFICE REPORT, as it is already being sent on WhatsApp.
 *
 * Dinesh: *"we have to send attendance report daily in WhatsApp — o kaise
 * aayega"*, with a screenshot of what HR posts in the BNF GROWTH TEAM group
 * every morning: a heading, the date, Attendance with the absent names and
 * their reasons in brackets, Late Coming / Early Going, Uniform, Office
 * Inspection, Conduct, Overtime, Incidents.
 *
 * Four of those eight the app already knows, to the name: who was absent and
 * why, who came late or left early and by how much, who was out of uniform,
 * and who worked overtime. They are typed out by hand every day anyway.
 *
 * THE OTHER THREE ARE NOT INVENTED. Office inspection, conduct and incidents
 * are not in this app, so they come through as whatever the office types —
 * the same words they use now — rather than as a confident line the data does
 * not support. A report that says "All checklist items OK" because nobody
 * recorded anything is worse than one that asks.
 *
 * TWO MORE RULES, both the roll call's own:
 *
 *   **A day nobody has marked is not a day everybody was absent.** With
 *   nothing marked at all the report says so instead of listing the whole
 *   staff as absent.
 *
 *   **"Not known" is never "on time".** Somebody with no clock times is left
 *   out of Late Coming, not counted as punctual.
 *
 * Dependency-free, like the rest of shared/.
 */

import { ATTENDANCE_CODES } from './calc.js';
import { FULL_DAY_MARKS } from './lateEarly.js';
import { isEarlyOut, isLateIn, lateByMinutes, formatDuration } from './timesheet.js';

/** Who was at work, so there was a uniform to see. */
export const WORKED_MARKS = new Set(['P', 'HF', 'SP', 'HP']);

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const longDate = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const name = (row) => row.employee_name || row.name || 'somebody';

/** "Disha Sakre (WENT TO VILLAGE)" — the reason as it was typed, in brackets. */
const withReason = (row) => {
  const why = String(row.reason || '').trim();
  return why ? `${name(row)} (${why})` : name(row);
};

const bullets = (list, each = withReason) => list.map((row) => `  • ${each(row)}`);

/**
 * @param period   the open month
 * @param rows     its calculated rows, each with `attendance` and the day's times
 * @param day      which day of the month
 * @param date     that day as ISO, for the heading
 * @param standard the usual in/out times, for late and early
 * @param typed    office inspection / conduct / incidents, as the office words them
 * @param title    the heading, so another company can use its own
 */
export function dailyReport({
  period = null,
  rows = [],
  day,
  date = '',
  standard = {},
  typed = {},
  title = 'DAILY OFFICE REPORT',
} = {}) {
  const people = rows.map((row) => {
    const entry = (row.attendance || {})[day] || {};
    const code = String(entry.code || entry.mark || '').toUpperCase();
    return {
      ...row,
      code,
      reason: entry.reason || '',
      uniform: entry.uniform,
      in_time: entry.in_time || '',
      out_time: entry.out_time || '',
      minutes: Number(entry.minutes ?? entry.ot_minutes ?? 0) || 0,
    };
  });

  const marked = people.filter((p) => p.code);
  const nothingMarked = people.length > 0 && marked.length === 0;

  const absent = people.filter((p) => ['A', 'AD', 'UL'].includes(p.code));
  const onLeave = people.filter((p) => ['CL', 'SL', 'PL'].includes(p.code));
  const halfDay = people.filter((p) => p.code === 'HF');
  const present = people.filter((p) => ['P', 'WH', 'SP', 'HP'].includes(p.code));
  const notMarked = people.filter((p) => !p.code);

  /*
   * Late and early are judged only on a full working day, and only where
   * there is a clock time: no time means "not known", which is not "on time".
   */
  const judged = people.filter((p) => FULL_DAY_MARKS.has(p.code));
  const grace = Number.isFinite(Number(standard.grace)) ? Number(standard.grace) : undefined;
  const lateOpts = grace === undefined ? { start: standard.in } : { start: standard.in, grace };
  const earlyOpts = grace === undefined ? { end: standard.out } : { end: standard.out, grace };
  const late = judged
    .filter((p) => p.in_time && isLateIn({ in_time: p.in_time }, lateOpts))
    .map((p) => ({ ...p, by: lateByMinutes({ in_time: p.in_time }, { start: standard.in }) }))
    .sort((a, b) => (b.by || 0) - (a.by || 0));
  const early = judged.filter(
    (p) => p.out_time && isEarlyOut({ in_time: p.in_time, out_time: p.out_time }, earlyOpts)
  );

  /*
   * THREE-STATE, as everywhere else: true, false, and nobody has looked.
   *
   * The server answers with a boolean and the offline store with SQLite's
   * 0/1, so both spellings of "no" count - this read `=== 0` at first and
   * quietly reported a floor full of offenders as all in uniform.
   */
  const notProper = (v) => v === false || v === 0;
  const notSeen = (v) => v === null || v === undefined || v === '';
  const atWork = people.filter((p) => WORKED_MARKS.has(p.code));
  const outOfUniform = people.filter((p) => WORKED_MARKS.has(p.code) && notProper(p.uniform));
  const notLookedAt = people.filter((p) => WORKED_MARKS.has(p.code) && notSeen(p.uniform));

  const overtime = people.filter((p) => p.minutes > 0).sort((a, b) => b.minutes - a.minutes);

  /* ---- the text, in the shape the office already sends ---- */

  const out = [];
  out.push(title);
  out.push(`Date: ${longDate(date)}`);
  out.push('');

  out.push('Attendance');
  if (nothingMarked) {
    // The one thing this report must never do.
    out.push('Nothing is marked for this day yet, so nobody is listed as absent.');
  } else {
    out.push(`Present: ${present.length} of ${people.length}`);
    if (absent.length) {
      out.push('Absent:');
      out.push(...bullets(absent));
    } else {
      out.push('Absent: none');
    }
    if (onLeave.length) {
      out.push('On leave:');
      out.push(
        ...bullets(onLeave, (p) => `${name(p)} (${ATTENDANCE_CODES[p.code]?.label || p.code})${p.reason ? ` — ${p.reason}` : ''}`)
      );
    }
    if (halfDay.length) {
      out.push('Half day:');
      out.push(...bullets(halfDay));
    }
    if (notMarked.length) out.push(`Not marked yet: ${notMarked.length}`);
  }
  out.push('');

  out.push('Late Coming / Early Going');
  if (!late.length && !early.length) {
    out.push('None today');
  } else {
    if (late.length) {
      out.push('Late in:');
      out.push(...bullets(late, (p) => `${name(p)} — ${p.in_time}${p.by ? ` (${formatDuration(p.by)} late)` : ''}`));
    }
    if (early.length) {
      out.push('Left early:');
      out.push(...bullets(early, (p) => `${name(p)} — ${p.out_time}`));
    }
  }
  out.push('');

  out.push('Uniform');
  if (outOfUniform.length) {
    out.push('Out of uniform:');
    out.push(...bullets(outOfUniform));
  } else if (atWork.length && notLookedAt.length === atWork.length) {
    /*
     * Measured against WHO WAS AT WORK, not against the present count:
     * somebody working from home is not on the uniform list at all, so
     * adding the two up would never match and the report would claim
     * everybody was in uniform on a floor nobody had walked.
     */
    // Nobody has walked the floor: say that, rather than "all in uniform".
    out.push('Not checked today');
  } else {
    out.push('All staff in proper uniform');
  }
  out.push('');

  if (typed.inspection !== undefined) {
    out.push('Office Inspection');
    out.push(String(typed.inspection || '').trim() || 'Not recorded');
    out.push('');
  }
  if (typed.conduct !== undefined) {
    out.push('Conduct');
    out.push(String(typed.conduct || '').trim() || 'Not recorded');
    out.push('');
  }

  out.push('Overtime');
  if (!overtime.length) {
    out.push('No overtime logged today');
  } else {
    out.push(...bullets(overtime, (p) => `${name(p)} — ${formatDuration(p.minutes)}`));
  }

  if (typed.incidents !== undefined) {
    out.push('');
    out.push('Incidents');
    out.push(String(typed.incidents || '').trim() || 'Not recorded');
  }

  return {
    title,
    date,
    text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    counts: {
      people: people.length,
      present: present.length,
      absent: absent.length,
      leave: onLeave.length,
      half_day: halfDay.length,
      late: late.length,
      early: early.length,
      at_work: atWork.length,
      out_of_uniform: outOfUniform.length,
      uniform_not_checked: notLookedAt.length,
      overtime: overtime.length,
      not_marked: notMarked.length,
      nothing_marked: nothingMarked,
    },
    /** Named, so a screen can show who is behind each line without re-deriving it. */
    lists: { absent, onLeave, halfDay, late, early, outOfUniform, overtime, notMarked },
  };
}

/**
 * The three lines this app cannot know, with the words the office already
 * uses — a starting point to edit, never an answer the data supports.
 */
export const TYPED_DEFAULTS = {
  inspection: 'All checklist items OK',
  conduct: 'No issues today',
  incidents: 'Logged today: 0 | Pending overall: 0',
};
