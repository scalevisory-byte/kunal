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
 * ---------------------------------------------------------------------------
 * THE THING THREE SHAPES EXIST FOR, and it is not a formatting choice.
 *
 * Dinesh: *"short hours & ot ka report aaj ki date ka dusre din jayega / same
 * day kaise jayega / uske liye kya solution he"*.
 *
 * Attendance, late coming and uniform are known by ten in the morning.
 * **Short hours and overtime cannot be known until the person has gone home**
 * — they are `out − in − lunch`, and there is no out time until there is.
 * No data source has it earlier; the readers themselves do not know.
 *
 * So the answer is not to compute it sooner, it is to send it when it exists.
 * One message in the morning carrying what the morning knows, and one after
 * the last shift carrying the hours — both of them today's. Or, for an office
 * that wants one message a day, the morning one carrying **yesterday's**
 * hours under yesterday's own date, which is honest about what it is.
 *
 * WHAT THE MORNING SHAPE MUST NEVER DO IS PRINT "Nobody was short of hours
 * today" AT TEN IN THE MORNING. Every day is inside its grace at that hour,
 * so the sum really does come to nothing — and it would read as a clean day's
 * work to a group of people who have not finished it yet. The hours headings
 * are left out of that shape altogether, with one line saying where they are.
 *
 * Dependency-free, like the rest of shared/.
 */

import { ATTENDANCE_CODES } from './calc.js';
import { FULL_DAY_MARKS, shiftTimesFor } from './lateEarly.js';
import { isEarlyOut, isLateIn, lateByMinutes, formatDuration } from './timesheet.js';
import { onStaffThatDay } from './onStaff.js';

/** Who was at work, so there was a uniform to see. */
export const WORKED_MARKS = new Set(['P', 'HF', 'SP', 'HP']);

/**
 * The three shapes, and WHEN each one is true.
 *
 * `end_of_day` is the default because it is what this report has always
 * been — everything, for the day asked for — so a cron or a saved link that
 * names no shape gets exactly the message it got before.
 */
export const REPORT_SHAPES = [
  {
    key: 'morning',
    label: 'Morning — before anybody has finished',
    why:
      'Attendance, late coming and uniform. The hours are left out on purpose: nobody has ' +
      'clocked out yet, so "nobody was short" would read as a clean day that has not been ' +
      'worked. They go out in the end-of-day message.',
  },
  {
    key: 'with_yesterday',
    label: "Morning + yesterday's hours",
    why:
      "One message a day. Today's attendance, and yesterday's short hours and overtime under " +
      "yesterday's own date, so nothing in it reads as today's.",
  },
  {
    key: 'end_of_day',
    label: 'End of day — everything, today',
    why:
      "Sent after the last shift. Today's attendance and today's hours, with anybody who has " +
      'not clocked out named rather than quietly counted as fine.',
  },
];

export const SHAPE_KEYS = REPORT_SHAPES.map((s) => s.key);
export const DEFAULT_SHAPE = 'end_of_day';

/** An unknown shape falls back to the long-standing one, never to a newer default. */
export const normaliseShape = (value) => {
  const asked = String(value || '').toLowerCase();
  return SHAPE_KEYS.includes(asked) ? asked : DEFAULT_SHAPE;
};

/**
 * WHICH SHAPE IS TRUE RIGHT NOW, off the clock rather than off a preference.
 *
 * A day already gone is finished whatever the hour, so it gets the whole
 * message. Today is `morning` until the usual day has ended and `end_of_day`
 * after it — which is exactly the line the hours cannot be known before. A
 * day still to come can only be `morning`.
 *
 * It SUGGESTS: whoever is sending the message still picks. A shape chosen by
 * the clock and then not shown would be a rule nobody could see.
 */
export const suggestShape = ({ date = '', shiftOut = '', now = new Date() } = {}) => {
  const asked = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked)) return DEFAULT_SHAPE;
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  if (asked < today) return 'end_of_day';
  if (asked > today) return 'morning';
  const [h, m] = String(shiftOut || '18:30').split(':').map(Number);
  const ends = Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : 18 * 60 + 30;
  return now.getHours() * 60 + now.getMinutes() >= ends ? 'end_of_day' : 'morning';
};

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
 * One day of one month, off the rows the roll call is drawn from.
 *
 * Taken out as a function because the morning-plus-yesterday shape reads TWO
 * days out of the same rows, and two copies of this mapping is how the hours
 * and the attendance would come to disagree about what a mark is.
 */
/*
 * ONLY WHO WAS ON THE STAFF THAT DAY.
 *
 * Somebody who left mid-month stays on the month's payroll, so this message
 * went on listing them as absent every day until the month closed - and HR
 * was deleting the names by hand before posting it. `when` is the month the
 * day belongs to; with no month to name the day by, nobody is left out, which
 * is what this always did.
 */
const peopleFor = (rows, day, when = {}) =>
  rows
    .filter((row) => onStaffThatDay(row, { year: when.year, month: when.month, day }).on)
    .map((row) => {
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

/**
 * SHORT HOURS AND OVERTIME, off the day's own `minutes` column.
 *
 * That is the column the salary sheet is paid from, so the message, the roll
 * call and the payslip cannot give three answers — and a figure the office
 * typed over the clock is the one that goes out, because that is the one that
 * is charged. It follows the month's grace without knowing the grace exists:
 * a forgiven day carries 0 and is simply not short.
 *
 * `open` is the half that must never be read as fine: somebody at work who
 * clocked in and never out has no hours to be short of. Before the end of the
 * day that is a person still at their desk; after it, a punch that never
 * arrived. Either way it is "not known", which is not "did their day".
 */
const hoursOf = (people) => ({
  short: people.filter((p) => p.minutes < 0).sort((a, b) => a.minutes - b.minutes),
  overtime: people.filter((p) => p.minutes > 0).sort((a, b) => b.minutes - a.minutes),
  open: people.filter((p) => WORKED_MARKS.has(p.code) && p.in_time && !p.out_time),
});

/**
 * @param period      the open month
 * @param rows        its calculated rows, each with `attendance` and the day's times
 * @param day         which day of the month
 * @param date        that day as ISO, for the heading
 * @param standard    the usual in/out times, for late and early
 * @param typed       office inspection / conduct / incidents, as the office words them
 * @param title       the heading, so another company can use its own
 * @param shape       one of REPORT_SHAPES — which sections are true at this hour
 * @param asOf        "19:10", stamped under the date; omitted leaves the old text alone
 * @param hoursDay    for `with_yesterday`: which day the hours come from
 * @param hoursDate   that day as ISO, for its own heading
 */
export function dailyReport({
  period = null,
  rows = [],
  day,
  date = '',
  standard = {},
  typed = {},
  title = 'DAILY OFFICE REPORT',
  shape = DEFAULT_SHAPE,
  asOf = '',
  hoursDay = null,
  hoursDate = '',
} = {}) {
  const which = normaliseShape(shape);
  /* The month the day belongs to - off the period, else off the heading's
     own date - so a leaving date can be compared with it. */
  const when = period?.year && period?.month
    ? { year: period.year, month: period.month }
    : /^\d{4}-\d{2}/.test(String(date))
      ? { year: Number(String(date).slice(0, 4)), month: Number(String(date).slice(5, 7)) }
      : {};
  const people = peopleFor(rows, day, when);

  const marked = people.filter((p) => p.code);
  const nothingMarked = people.length > 0 && marked.length === 0;

  const absent = people.filter((p) => ['A', 'AD', 'UL'].includes(p.code));
  const onLeave = people.filter((p) => ['CL', 'SL', 'PL'].includes(p.code));
  const halfDay = people.filter((p) => p.code === 'HF');
  /* At work in any form. OD (out on the company's business) and DD (a
     round-the-clock duty) were in NO line of this message - not present, not
     absent, not on leave - so the figures did not add up to the staff. */
  const present = people.filter((p) => ['P', 'WH', 'OD', 'DD', 'SP', 'HP'].includes(p.code));
  const notMarked = people.filter((p) => !p.code);

  /*
   * Late and early are judged only on a full working day, and only where
   * there is a clock time: no time means "not known", which is not "on time".
   */
  const judged = people.filter((p) => FULL_DAY_MARKS.has(p.code));
  const grace = Number.isFinite(Number(standard.grace)) ? Number(standard.grace) : undefined;
  const lateOpts = grace === undefined ? { start: standard.in } : { start: standard.in, grace };
  const earlyOpts = grace === undefined ? { end: standard.out } : { end: standard.out, grace };
  /*
   * EACH PERSON AGAINST THEIR OWN SHIFT, where they have one.
   *
   * This judged everybody against the office day, so a shift typed on a
   * record changed the payslip and not this message - and anybody on an
   * evening shift went out to the group as hours late, every day.
   */
  const dayOf = (p) => shiftTimesFor(p, { in_time: standard.in, out_time: standard.out });
  const late = judged
    .filter((p) => p.in_time && isLateIn({ in_time: p.in_time }, { ...lateOpts, start: dayOf(p).in }))
    .map((p) => ({ ...p, by: lateByMinutes({ in_time: p.in_time }, { start: dayOf(p).in }) }))
    .sort((a, b) => (b.by || 0) - (a.by || 0));
  const early = judged.filter(
    (p) =>
      p.out_time &&
      isEarlyOut({ in_time: p.in_time, out_time: p.out_time }, { ...earlyOpts, end: dayOf(p).out })
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

  /*
   * WHICH DAY THE HOURS ARE FOR.
   *
   * `with_yesterday` reads the day before out of the same rows — and refuses
   * to when that day is in the PREVIOUS MONTH. `attendance` is keyed by day of
   * month, so day 0 is not yesterday, it is nothing at all, and reading it
   * would print a confident "nobody was short" for a day this payroll has
   * never seen.
   */
  const wantsYesterday = which === 'with_yesterday';
  const askedDay = wantsYesterday ? Number(hoursDay) : day;
  const hoursInAnotherMonth = wantsYesterday && !(Number.isFinite(askedDay) && askedDay >= 1);
  const hoursFromDay = which === 'morning' || hoursInAnotherMonth ? null : askedDay;
  const hoursOn = hoursFromDay === day ? date : hoursDate;
  const hoursPeople = hoursFromDay === null ? [] : peopleFor(rows, hoursFromDay, when);
  const { short, overtime, open } = hoursOf(hoursPeople);

  /* ---- the text, in the shape the office already sends ---- */

  const out = [];
  out.push(title);
  out.push(`Date: ${longDate(date)}`);
  /* Stamped only when the caller says what time it is - an absent stamp
   * leaves the message byte-identical to the one this report always sent. */
  if (String(asOf || '').trim()) out.push(`As at: ${String(asOf).trim()}`);
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

  if (hoursFromDay === null) {
    /*
     * NO HOURS HEADINGS AT ALL, and a line saying why.
     *
     * This is the whole reason the morning shape exists: at that hour every
     * day is still inside its grace, so "Nobody was short of hours today"
     * is arithmetically true and completely misleading.
     */
    if (hoursInAnotherMonth) {
      out.push(
        'Short hours and overtime: yesterday falls in the previous month, which is a ' +
          'separate sheet — open that month to report its hours.'
      );
    } else {
      out.push(
        'Short hours and overtime are not in this message: the day is not finished, so ' +
          "nobody's hours are known yet. They go out in the end-of-day message."
      );
    }
    out.push('');
  } else {
    /* The hours' own day is named whenever it is not the message's date. */
    const sameDay = hoursFromDay === day;
    const forDay = sameDay ? '' : ` — ${longDate(hoursOn)}`;

    /* Before Overtime: it is the half somebody reads the message for. */
    out.push(`Short hours${forDay}`);
    if (!short.length) {
      out.push(sameDay ? 'Nobody was short of hours today' : 'Nobody was short of hours');
    } else {
      out.push(
        ...bullets(
          short,
          (p) =>
            `${name(p)} — ${formatDuration(-p.minutes)} short` +
            (p.in_time || p.out_time ? ` (${p.in_time || '—'} to ${p.out_time || '—'})` : '')
        )
      );
    }
    if (open.length) {
      out.push(
        `${open.length} ${open.length === 1 ? 'person' : 'people'} clocked in and ` +
          'not out, so their hours are not known yet: ' +
          open.map((p) => name(p)).join(', ')
      );
    }
    out.push('');

    out.push(`Overtime${forDay}`);
    if (!overtime.length) {
      out.push(sameDay ? 'No overtime logged today' : 'No overtime logged');
    } else {
      out.push(...bullets(overtime, (p) => `${name(p)} — ${formatDuration(p.minutes)}`));
    }
  }

  if (typed.incidents !== undefined) {
    out.push('');
    out.push('Incidents');
    out.push(String(typed.incidents || '').trim() || 'Not recorded');
  }

  return {
    title,
    date,
    shape: which,
    as_of: String(asOf || '').trim(),
    /** Which day the hours in this message are for — null when it carries none. */
    hours_day: hoursFromDay,
    hours_date: hoursFromDay === null ? '' : hoursOn,
    text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    counts: {
      people: people.length,
      /* On the month's payroll and not on the staff that day - left, or not
         joined yet. Counted so a screen can say who the message left out. */
      not_on_staff: rows.length - people.length,
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
      short: short.length,
      /* Minutes, as a positive figure - the message says "1h 32m short". */
      short_minutes: short.reduce((t, p) => t - p.minutes, 0),
      no_clock_out: open.length,
      not_marked: notMarked.length,
      nothing_marked: nothingMarked,
      /** False on the morning shape, so a screen can say so without guessing. */
      hours_in_message: hoursFromDay !== null,
      hours_in_another_month: hoursInAnotherMonth,
    },
    /** Named, so a screen can show who is behind each line without re-deriving it. */
    lists: { absent, onLeave, halfDay, late, early, outOfUniform, overtime, short, noClockOut: open, notMarked },
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
