/**
 * A Sunday's duty, and the hours that earn it.
 *
 * Dinesh: *"sundsy duty minimum six hours ki rehti he"*, then
 * *"6 hours work full day salary sunday"*. A Sunday is not a short version of
 * a working day - it is its own thing, six hours long, and six hours on it
 * earns the WHOLE day's Sunday pay.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO, and why
 *
 * It changes NOBODY'S pay by itself. `calculateRow` still pays
 * `sundays_worked x perDay` exactly as it always has, and nothing here is an
 * input to it.
 *
 * What it does is ANSWER A QUESTION the register could not answer before:
 * which Sundays actually carried the six hours. A Sunday worked for two hours
 * and a Sunday worked for nine looked identical on the register and were paid
 * identically - one full day each. Now the short ones are named with their
 * hours, and whoever is handing the money over decides.
 *
 * It is named and not deducted for the same reason an unreturned asset is
 * named and not deducted: somebody who came in at six in the morning and whose
 * second punch never registered has done the day. Docking that automatically
 * is a mistake nobody can see, and getting it back is a conversation.
 *
 * A Sunday with NO clock times at all is "not known", never "nought hours".
 * Most of the staff are not on the readers yet, so treating an unclocked
 * Sunday as a short one would condemn almost every Sunday in the month.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, so the server, the dashboard and the single-file build
 * cannot give three answers.
 */

import { ATTENDANCE_CODES, calculateRow } from './calc.js';
import { PAID_BY_THE_DAY, parseTime, readTimes } from './timesheet.js';
import { shiftTimesFor } from './lateEarly.js';
import { isWeeklyOff, policyFor } from './weeklyOff.js';

/**
 * How long a Sunday's duty runs. Six hours, per Dinesh, against the office's
 * ordinary nine - a Sunday is a shorter day that pays a whole one.
 */
export const SUNDAY_DAY_HOURS = 6;

/** Held per month, so a rule changed in December never rewrites November. */
export function sundayHoursFor(period = {}) {
  const typed = Number(period.sunday_hours);
  if (Number.isFinite(typed) && typed > 0 && typed <= 24) return typed;
  return SUNDAY_DAY_HOURS;
}

/** The marks the Sunday register pays a day for: worked on an off day. */
export const SUNDAY_MARKS = new Set(
  Object.keys(ATTENDANCE_CODES).filter((c) => ATTENDANCE_CODES[c].sunday)
);

export const codeOf = (entry) =>
  String((typeof entry === 'object' && entry ? entry.code : entry) || '').trim().toUpperCase();

/**
 * Every Sunday (or holiday) this person worked, with what the clock says.
 *
 * `worked` is null when nothing was clocked - NOT 0. The three states are
 * "they did the hours", "they did not", and "nobody knows", and the third is
 * by far the commonest while the punch IDs are still being filled in.
 */
export function sundayDutyFor(row = {}, period = {}) {
  const hours = sundayHoursFor(period);
  const needed = Math.round(hours * 60);
  const attendance = row.attendance || {};
  const days = [];

  for (const [key, entry] of Object.entries(attendance)) {
    if (!SUNDAY_MARKS.has(codeOf(entry))) continue;
    const day = Number(key);
    if (!Number.isFinite(day)) continue;
    const times = typeof entry === 'object' && entry ? entry : {};
    /* The month's own lunch rule. This read the default - lunch always taken
       out - so on a month whose break is INSIDE the paid day a Sunday of
       exactly six hours with a forty-minute lunch read 5h 20m and was listed
       as short. Same miss as the Time tab in v2.0.0, one screen over. */
    const read = readTimes(times, { deductLunch: !period.lunch_paid });
    const worked = read.worked === null ? null : Math.round(read.worked);
    days.push({
      day,
      code: codeOf(entry),
      in_time: times.in_time || '',
      out_time: times.out_time || '',
      worked,
      // null stays null all the way out: "not known" is not "did not do it".
      full: worked === null ? null : worked >= needed,
      short: worked === null ? null : Math.max(0, needed - worked),
    });
  }

  days.sort((a, b) => a.day - b.day);

  const clocked = days.filter((d) => d.worked !== null);
  return {
    hours,
    needed,
    days,
    counted: days.length,
    clocked: clocked.length,
    unclocked: days.length - clocked.length,
    full: clocked.filter((d) => d.full).length,
    shortDays: clocked.filter((d) => !d.full),
  };
}

/**
 * The register's view: one line per person who has a Sunday the clock says
 * was under the six hours. Everybody else is simply not a question.
 */
export function shortSundays(rows = [], period = {}) {
  const lines = [];
  for (const row of rows) {
    const duty = sundayDutyFor(row, period);
    if (!duty.shortDays.length) continue;
    lines.push({
      employee_id: row.employee_id ?? row.id ?? null,
      employee_name: row.employee_name || row.name || '',
      company_name: row.company_name || '',
      days: duty.shortDays,
      counted: duty.counted,
      unclocked: duty.unclocked,
    });
  }
  lines.sort((a, b) => b.days.length - a.days.length || a.employee_name.localeCompare(b.employee_name));
  return lines;
}

/* ---------------- the overtime a day off must not pay ---------------- */

/**
 * Minutes still sitting on days that are paid BY THE DAY.
 *
 * `minutesForMark` stopped writing these, but it is the WRITE path: a figure
 * already stored on a day does not move until that day is saved again, which
 * is exactly the rule that stops a month already paid from changing under
 * anybody. An OPEN month is still carrying whatever it was given before the
 * rule changed, and somebody has to be able to see it and clear it.
 *
 * Reports only. `clearSundayOvertime` below builds the entries; nothing here
 * writes anything.
 */
export function sundayOvertimeIn(rows = [], period = {}) {
  const lines = [];
  for (const row of rows) {
    const attendance = row.attendance || {};
    const days = [];
    for (const [key, entry] of Object.entries(attendance)) {
      if (!PAID_BY_THE_DAY.has(codeOf(entry))) continue;
      const minutes = Number(typeof entry === 'object' && entry ? entry.minutes : 0) || 0;
      if (minutes === 0) continue;
      const day = Number(key);
      if (!Number.isFinite(day)) continue;
      days.push({ day, code: codeOf(entry), minutes });
    }
    if (!days.length) continue;
    days.sort((a, b) => a.day - b.day);

    /*
     * What it is worth is asked of calculateRow with and without those
     * minutes, rather than multiplied out here - the per-minute rate follows
     * the person's own shift length and the month's rule, and a second
     * opinion about it is how two answers come to exist.
     */
    const before = calculateRow(row, period, attendance);
    const cleared = { ...attendance };
    for (const d of days) cleared[d.day] = { ...attendance[d.day], minutes: 0 };
    const after = calculateRow(row, period, cleared);

    lines.push({
      employee_id: row.employee_id ?? row.id ?? null,
      row_id: row.id ?? null,
      employee_name: row.employee_name || row.name || '',
      company_name: row.company_name || '',
      days,
      minutes: days.reduce((n, d) => n + d.minutes, 0),
      worth: Math.round((before.net_salary || 0) - (after.net_salary || 0)),
    });
  }
  lines.sort((a, b) => b.minutes - a.minutes || a.employee_name.localeCompare(b.employee_name));
  return lines;
}

/** The attendance entries that clear it. One per day, naming only `minutes`. */
export function clearSundayOvertime(lines = []) {
  const entries = [];
  for (const line of lines) {
    for (const d of line.days) {
      // Only `minutes` is named, so the same per-field merge rule everything
      // else follows keeps the mark, the clock times and the reason intact.
      entries.push({ employee_id: line.employee_id, day: d.day, minutes: 0 });
    }
  }
  return entries;
}

/* ---------------- what a short Sunday is worth ---------------- */

/**
 * The Sunday amount if a Sunday under the six hours pays `shortPays` of a day.
 *
 * Dinesh: *"Sunday ki full day ki salary lene k liye minimum 6 hours complete
 * karne he"*. He named the line and not what sits below it, so this takes the
 * fraction as an argument and the office picks it on the screen - half a day,
 * or nothing.
 *
 * A Sunday NOBODY CLOCKED still counts as a full day. "Not known" is not
 * "under six hours", and with most of the staff still off the readers the
 * other reading would stop nearly every Sunday in the month being paid.
 */
export function sundayAmountIf(row = {}, period = {}, { shortPays = 0 } = {}) {
  const duty = sundayDutyFor(row, period);
  const calc = calculateRow(row, period, row.attendance || {});
  const perDay = Number(calc.per_day) || 0;
  const short = duty.shortDays.length;
  const full = duty.counted - short;
  return {
    per_day: perDay,
    full,
    short,
    // Rounded like the register's own amount, so the two cannot differ by a rupee.
    amount: Math.round((full + short * shortPays) * perDay),
    now: Math.round(Number(calc.sunday_salary) || 0),
  };
}

/* ---------------------------------------------------------------------------
 * A WEEKLY OFF SOMEBODY CLOCKED IN ON
 *
 * HR, off the live Sunday tab: *"ama sunday present show nathi thatu / count
 * alag thi nathi krtu"* - Sunday presence is not showing, and it is not
 * counted separately.
 *
 * The cause was upstream of the register. The punch importer knew nothing
 * about a weekly off: a punch on a blank Sunday was written as `P` (or `HF`,
 * which DOCKS half a day from somebody who came in on their day off), and a
 * Sunday already marked `S` kept its `S`, because a punch may not overrule a
 * mark it did not set. `SP` was never produced by anything but a person, and
 * `SP` is the only thing the register reads. So with the readers feeding the
 * grid, nobody ever reached it.
 *
 * The line is Dinesh's own: *"Sunday ki full day ki salary lene k liye
 * minimum 6 hours complete karne he"*.
 *
 *   six hours done      -> SP   on the register, a day's Sunday pay
 *   under six hours     -> S    the day off stands, the times are kept
 *   no out time yet     -> S    NOT KNOWN IS NOT SIX HOURS - and it is not
 *                               half a day either. The evening's pull settles it.
 *
 * `S` has to be among the marks this may replace, or the rule cannot work on
 * a live feed: the first punch of a Sunday arrives with no departure and is
 * written as `S`, and the evening's pull must be able to turn that into `SP`.
 * "Mark everyone Present" writes `S` on every Sunday too.
 *
 * `SP`, `HP`, `PH` and leave are never touched: somebody chose those. An
 * office that does NOT want a clocked Sunday paid says so with the Amount on
 * the register - visible, and typed over at will.
 * ------------------------------------------------------------------------ */

/** Marks a clocked weekly off may replace: the ones nobody chose, and the off itself. */
export const OFF_DAY_MAY_BECOME = new Set(['', 'P', 'A', 'HF', 'S']);

/**
 * Is this day this person's own weekly off?
 *
 * Their own policy, else their company's, else Sunday - a driver off on
 * Thursday is on the "Sunday" register for the Thursday they worked.
 */
export const ownWeeklyOff = (person = {}, period = {}, day) =>
  isWeeklyOff(
    period.year,
    period.month,
    day,
    policyFor({ weekly_off: person.weekly_off }, { weekly_off: person.company_weekly_off })
  );

/** What a clocked weekly off comes to, by the month's own six-hour line. */
export function offDayVerdict(times = {}, period = {}) {
  const needed = Math.round(sundayHoursFor(period) * 60);
  const read = readTimes(times, { deductLunch: !period.lunch_paid });
  const worked = read.worked === null ? null : Math.round(read.worked);
  const full = worked === null ? null : worked >= needed;
  return {
    code: full ? 'SP' : 'S',
    worked,
    needed,
    full,
    short: worked === null ? null : Math.max(0, needed - worked),
  };
}

/**
 * The importer's entries, with a weekly off judged as a weekly off.
 *
 * `personOf(id)` hands back whoever carries `weekly_off` /
 * `company_weekly_off`; `stored(id, day)` the mark already on the day.
 * `settled` holds the keys this decided, so the caller's "a punch may not
 * overrule a decision" guard lets exactly those through.
 */
export function settleOffDays(entries = [], { period = {}, personOf = () => null, stored = () => '' } = {}) {
  const out = [];
  const settled = new Set();
  const summary = { worked: 0, short: 0, unknown: 0, wasHalfDay: 0, wasPresent: 0, wasShort: 0, wasOver: 0 };
  for (const entry of entries) {
    const person = personOf(entry.employee_id);
    const was = String(stored(entry.employee_id, entry.day) || '').trim().toUpperCase();
    if (
      !person ||
      !entry.in_time ||
      !OFF_DAY_MAY_BECOME.has(was) ||
      !ownWeeklyOff(person, period, entry.day)
    ) {
      out.push(entry);
      continue;
    }
    const verdict = offDayVerdict(entry, period);
    if (verdict.full) summary.worked += 1;
    else if (verdict.full === false) summary.short += 1;
    else summary.unknown += 1;
    if (entry.code === 'HF') summary.wasHalfDay += 1;
    else if (entry.code === 'P') summary.wasPresent += 1;
    if (Number(entry.minutes) < 0) summary.wasShort += 1;
    else if (Number(entry.minutes) > 0) summary.wasOver += 1;
    // Paid by the day or not at all - never by the minute.
    out.push({ ...entry, code: verdict.code, minutes: 0 });
    settled.add(`${entry.employee_id}:${entry.day}`);
  }
  return { entries: out, settled, summary };
}

/**
 * The catch-up: weekly offs already on the grid with a clock-in, that are not
 * on the register.
 *
 * A fix to the write path never reaches back - whatever an earlier import
 * wrote stays until that day is saved again. So the days are FOUND and named,
 * in three piles that are not the same question: six hours done, under six,
 * and not known. Only the first is the rule's to answer.
 */
export function offDaysNotOnRegister(rows = [], period = {}, { punches = null } = {}) {
  /*
   * TIMES ON A DAY ARE NOT PROOF ANYBODY WAS THERE.
   *
   * Found by driving it: a Sunday that "Fill the usual timings" had been
   * pressed on carries 09:30-18:30 for the whole office, and this list called
   * every one of them "nine hours, done" and offered to put them all on the
   * register in one press - a day's pay each for a day nobody worked.
   *
   * So a line has to say where its times came from. `punches` is the month's
   * own punch record ({ employeeId: { day: [...] } }) when there is one: a day
   * with a punch on it was clocked, a day without was typed or filled. Where
   * there is no record to ask (the single-file build), the only evidence left
   * is the times themselves - and times that are EXACTLY the usual day, in and
   * out, are a fill and not a person.
   */
  const usual = (row) => shiftTimesFor(row, { shift_in: period.shift_in, shift_out: period.shift_out });
  const same = (a, b) => parseTime(a) !== null && parseTime(a) === parseTime(b);
  const lines = [];
  for (const row of rows) {
    for (const [key, entry] of Object.entries(row.attendance || {})) {
      const day = Number(key);
      if (!Number.isFinite(day) || !entry || typeof entry !== 'object') continue;
      if (!entry.in_time) continue;
      const code = codeOf(entry);
      if (!OFF_DAY_MAY_BECOME.has(code)) continue;
      if (!ownWeeklyOff(row, period, day)) continue;
      const verdict = offDayVerdict(entry, period);
      const id = row.employee_id ?? row.id;
      const shift = usual(row);
      const looksFilled = same(entry.in_time, shift.in) && same(entry.out_time, shift.out);
      const punched = punches ? Boolean(punches[id]?.[day]?.length) : null;
      lines.push({
        // true: a punch is on record. false: none is, or the times are exactly
        // the usual day. Never guessed the generous way.
        clocked: punched === null ? !looksFilled : punched,
        punched,
        looksFilled,
        row_id: row.id,
        employee_id: row.employee_id ?? row.id,
        employee_name: row.employee_name || row.name || '',
        day,
        code,
        in_time: entry.in_time || '',
        out_time: entry.out_time || '',
        worked: verdict.worked,
        needed: verdict.needed,
        full: verdict.full,
        short: verdict.short,
      });
    }
  }
  lines.sort((a, b) => a.day - b.day || a.employee_name.localeCompare(b.employee_name));
  const clocked = lines.filter((l) => l.clocked);
  return {
    lines,
    clocked,
    // Times on the day and nothing to say a person made them. Listed, never
    // offered in bulk: counting one is a decision somebody takes by name.
    typed: lines.filter((l) => !l.clocked),
    full: clocked.filter((l) => l.full === true),
    short: clocked.filter((l) => l.full === false),
    unknown: clocked.filter((l) => l.full === null),
    /* Marked half day or absent by an import on a day they were never due:
       that is costing them pay for having come in. */
    docked: clocked.filter((l) => l.code === 'HF' || l.code === 'A'),
  };
}

/**
 * What marking those days would move, taken off `calculateRow` rather than
 * multiplied out: a typed Amount, a half day being lifted and the month's own
 * hours rule all bear on it, and one of them is always forgotten by hand.
 */
export function priceOffDays(row = {}, period = {}, marks = {}) {
  const before = calculateRow(row, period, row.attendance || {});
  const attendance = { ...(row.attendance || {}) };
  for (const [day, code] of Object.entries(marks)) {
    attendance[day] = { ...(attendance[day] || {}), code, minutes: 0 };
  }
  const after = calculateRow(row, period, attendance);
  return {
    sunday: Math.round((Number(after.sunday_salary) || 0) - (Number(before.sunday_salary) || 0)),
    net: Math.round((Number(after.net_salary) || 0) - (Number(before.net_salary) || 0)),
  };
}

/** The write: only the mark and its minutes, so the times and the reason stay. */
export const offDayEntries = (lines = [], code = 'SP') =>
  lines.map((l) => ({ employee_id: l.employee_id, day: l.day, code, minutes: 0 }));

/**
 * The off-day line of an import's dry run, in words. One sentence read by
 * both import panels, because they end in one `applyPunches` and two wordings
 * would read as two rules.
 */
export function offDaySentence(summary = {}, hours = SUNDAY_DAY_HOURS) {
  const worked = Number(summary.worked) || 0;
  const short = Number(summary.short) || 0;
  const unknown = Number(summary.unknown) || 0;
  if (!worked && !short && !unknown) return '';
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const parts = [];
  if (worked) {
    parts.push(
      `${n(worked, 'weekly off was', 'weekly offs were')} worked for the ${hours} hours and ` +
        `${worked === 1 ? 'goes' : 'go'} on the Sunday register as SP - a day's Sunday pay each, ` +
        `settled there and not in the month's net`
    );
  }
  if (short) parts.push(`${n(short, 'was', 'were')} under ${hours} hours and ${short === 1 ? 'stays' : 'stay'} the day off`);
  if (unknown) parts.push(`${n(unknown, 'has', 'have')} no out time yet and ${unknown === 1 ? 'stays' : 'stay'} the day off until one arrives`);
  return `${parts.join('; ')}. The times are kept on all of them.`;
}
