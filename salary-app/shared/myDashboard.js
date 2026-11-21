/**
 * THE EMPLOYEE'S OWN DASHBOARD, ASSEMBLED.
 *
 * Dinesh's brief for the self-service portal: today's attendance, working
 * hours, leave balance, last month's pay, an attendance trend, upcoming
 * holidays. And, in his own words: *"All values must be fetched from actual
 * employee-specific data. Never use static demo numbers"* and *"If some
 * dashboard data is unavailable, display a proper empty state instead of
 * inventing values."*
 *
 * SO THIS FILE INVENTS NOTHING. Every figure it returns came out of
 * `calculateRow` or off the attendance row, through `/api/me`, which reads
 * the employee id from the LOGIN. Where there is no answer it returns null
 * and the page says so - a nought would read as "you worked no hours today"
 * when the truth is "nobody has marked today yet".
 *
 * Dependency-free, like the rest of shared/.
 */

import { ATTENDANCE_CODES, codeOf } from './calc.js';
import { hasTimes, timesToDay } from './timesheet.js';

/** Marks that mean the person was at work somewhere. */
const AT_WORK = ['P', 'HF', 'SP', 'HP', 'WH', 'OD'];
/** Marks that are time off and still paid. */
const ON_LEAVE = ['CL', 'SL', 'PL', 'PH'];
/** Marks that cost pay. */
const ABSENT = ['A', 'AD', 'UL'];

const n = (v) => Number(v) || 0;
const count = (marks, codes) => codes.reduce((t, c) => t + (marks[c] || 0), 0);

/**
 * TODAY, for the card at the top.
 *
 * `state` is one of: at-work, on-leave, absent, holiday, weekly-off, or
 * `not-marked` - which is NOT absent. A day nobody has got round to marking
 * is the commonest state of all before lunch, and calling it an absence on
 * somebody's own screen is the fastest way to have them ring the office.
 */
export function todayFor({ attendance = {}, period = {}, today = '', hoursPerDay = 9, lunchPaid = false } = {}) {
  const stamp = String(today || '').slice(0, 10);
  const tag = `${period.year}-${String(period.month).padStart(2, '0')}`;
  /* Only if today is actually in the month being looked at. Showing
     October's 21st as "today" in November would be wrong, not merely blank. */
  const inMonth = stamp.slice(0, 7) === tag;
  const day = inMonth ? Number(stamp.slice(8, 10)) : 0;
  const entry = day ? attendance[day] : null;
  const code = codeOf(entry) || '';

  const times = entry && typeof entry === 'object' ? entry : {};
  const clocked = hasTimes(times);
  const judged = clocked ? timesToDay(times, { hoursPerDay, deductLunch: !lunchPaid }) : null;

  const state = !inMonth
    ? 'other-month'
    : !code
      ? 'not-marked'
      : code === 'S'
        ? 'weekly-off'
        : code === 'PH'
          ? 'holiday'
          : AT_WORK.includes(code)
            ? 'at-work'
            : ON_LEAVE.includes(code)
              ? 'on-leave'
              : 'absent';

  const expected = Math.round(n(hoursPerDay) * 60);
  return {
    day: day || null,
    code,
    label: code ? ATTENDANCE_CODES[code]?.label || code : '',
    state,
    in_time: times.in_time || '',
    out_time: times.out_time || '',
    lunch_out: times.lunch_out || '',
    lunch_in: times.lunch_in || '',
    /* null is "not known", never 0 - see the note at the top. */
    worked_minutes: judged ? judged.worked : null,
    expected_minutes: expected,
    /*
     * Null when the hours are not known. `judged` is truthy as soon as an in
     * time is typed, but `judged.worked` is null until there is an out time
     * as well - and `expected - null` is `expected`, so a day somebody had
     * only clocked INTO reported the whole day still remaining, which reads
     * as "you have done nothing" rather than "we cannot tell yet".
     */
    remaining_minutes:
      judged && judged.worked !== null && judged.worked !== undefined
        ? Math.max(0, expected - judged.worked)
        : null,
    /* In but not out: the day is still running, or they forgot. Either way
       the hours are not final and the card must not pretend otherwise. */
    still_in: !!(times.in_time && !times.out_time),
  };
}

/** The month's marks, counted the way the absent/present report counts them. */
export function monthFor({ marks = {}, payable_days = null, worked_minutes = null } = {}) {
  return {
    at_work: count(marks, AT_WORK),
    on_leave: count(marks, ON_LEAVE),
    absent: count(marks, ABSENT),
    half_days: marks.HF || 0,
    weekly_off: marks.S || 0,
    payable_days: payable_days === null || payable_days === undefined ? null : n(payable_days),
    worked_minutes: worked_minutes === null || worked_minutes === undefined ? null : n(worked_minutes),
    marked_days: Object.values(marks).reduce((t, v) => t + n(v), 0),
  };
}

/**
 * Leave: what they have, what they have used, what is left.
 *
 * Unpaid leave is reported with NO quota, because it has none - it was taken
 * anyway and docked. Showing it against a quota of nought would read as being
 * over an allowance that never existed.
 */
export function leaveFor({ quotas = {}, taken = {} } = {}, pending = 0) {
  const kinds = ['CL', 'SL', 'PL'].map((code) => {
    const quota = n(quotas[code]);
    const used = n(taken[code]);
    return { code, quota, used, left: quota - used, over: used > quota };
  });
  return {
    kinds,
    total_quota: kinds.reduce((t, k) => t + k.quota, 0),
    total_used: kinds.reduce((t, k) => t + k.used, 0),
    total_left: kinds.reduce((t, k) => t + k.left, 0),
    unpaid_taken: n(taken.UL),
    pending,
  };
}

/**
 * The attendance trend: one bar per month, newest last.
 *
 * It counts what is marked and says how many days that was out of, rather
 * than a percentage on its own - 100% of two marked days is not a good month,
 * it is an unmarked one.
 */
export function trendFor(months = []) {
  return months.map(({ period, marks = {} }) => {
    const m = monthFor({ marks });
    const expected = m.at_work + m.on_leave + m.absent;
    return {
      period_id: period?.id ?? null,
      label: period?.label || '',
      year: period?.year ?? null,
      month: period?.month ?? null,
      at_work: m.at_work,
      on_leave: m.on_leave,
      absent: m.absent,
      half_days: m.half_days,
      marked_days: m.marked_days,
      /* Null, not nought, when nothing is marked: a month nobody filled in
         is not a month of perfect attendance and not one of none either. */
      percent: expected > 0 ? Math.round((m.at_work / expected) * 100) : null,
    };
  });
}

/**
 * What is coming up, soonest first: holidays that cover them, and their own
 * birthday and work anniversary.
 *
 * ONLY THEIR OWN. Other people's birthdays are other people's, and an
 * employee portal is the one screen in this app that must not leak sideways.
 */
export function comingUp({ holidays = [], employee = {}, today = '', within = 60 } = {}) {
  const stamp = String(today || '').slice(0, 10);
  if (!stamp) return [];
  const from = Date.parse(`${stamp}T00:00:00Z`);
  if (!Number.isFinite(from)) return [];
  const limit = from + within * 24 * 60 * 60 * 1000;
  const out = [];

  for (const h of holidays) {
    const at = Date.parse(`${h.date}T00:00:00Z`);
    if (!Number.isFinite(at) || at < from || at > limit) continue;
    out.push({
      kind: 'holiday',
      date: h.date,
      title: h.name,
      /* A holiday the office has not applied to the grid yet is PLANNED, not
         a day off. Saying otherwise is how somebody does not turn up. */
      note: h.applied ? '' : 'not marked on the grid yet',
      days_away: Math.round((at - from) / 86400000),
    });
  }

  const yearly = (iso, kind, title) => {
    const text = String(iso || '').slice(0, 10);
    if (text.length !== 10) return;
    const [, mm, dd] = text.split('-');
    for (const year of [Number(stamp.slice(0, 4)), Number(stamp.slice(0, 4)) + 1]) {
      const at = Date.parse(`${year}-${mm}-${dd}T00:00:00Z`);
      if (!Number.isFinite(at) || at < from || at > limit) continue;
      const years = year - Number(text.slice(0, 4));
      out.push({
        kind,
        date: `${year}-${mm}-${dd}`,
        title,
        note: kind === 'anniversary' && years > 0 ? `${years} year${years === 1 ? '' : 's'}` : '',
        days_away: Math.round((at - from) / 86400000),
      });
      return;
    }
  };
  yearly(employee.dob, 'birthday', 'Your birthday');
  yearly(employee.joined_on, 'anniversary', 'Your work anniversary');

  out.sort((a, b) => a.days_away - b.days_away || a.title.localeCompare(b.title));
  return out;
}
