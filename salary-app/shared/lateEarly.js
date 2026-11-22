/**
 * Late arrival, early departure, and the month's concession.
 *
 * Dinesh's own attendance policy, in his words: "300-minute monthly late/early
 * concession", "late arrival - automatic late-minute calculation", "early
 * departure - automatic minute calculation". So: every minute late in and every
 * minute left early is counted, they are pooled for the month, the first 300 are
 * free, and only the excess costs money.
 *
 * Two things this module is careful about.
 *
 * **It does not double-charge.** The app already deducts short hours, worked out
 * as `out - in - lunch` against the day's expected hours - and a person who came
 * in thirty minutes late and left on time is already thirty minutes short there.
 * Charging the lateness again would take the same thirty minutes twice. So the
 * two rules are alternatives, not additions: a period runs on `POLICY.hours`
 * (what the app has always done - the day is judged on the hours it came to) or
 * on `POLICY.concession` (this module - late and early minutes are pooled, 300
 * are free, and the hours-shortfall is no longer charged). `calculateRow` picks
 * one, never both.
 *
 * **A day nobody clocked is not a late day.** No in time means "not known", and
 * that is not the same as "on time" or "late". Nor is a half day, a leave, a
 * holiday or an absence ever judged late: it was not a full day at the office.
 *
 * Dependency-free, like the rest of shared/, so the server and the standalone
 * browser build cannot drift apart.
 */

import { MAX_DAY_MINUTES, parseTime, readTimes } from './timesheet.js';

/**
 * Which rule prices the month. `hours` is what the app has always done.
 *
 * All three are ALTERNATIVES and `calculateRow` picks exactly one, for the
 * reason in the note above: the same missing half hour must not be taken as
 * a short day, as a late arrival and as a monthly shortfall.
 *
 *   hours         each day on its own - short hours charged, overtime paid.
 *   concession    late and early minutes pooled, the first 300 free, and the
 *                 hours-shortfall no longer charged.
 *   monthly       Dinesh's rule: the month owes a TOTAL - nine hours times
 *                 twenty-six days - and a day short cancels a day long. See
 *                 `shared/monthlyHours.js`.
 *   monthly_late  both of those, charged as the GREATER of the two and never
 *                 as the sum. See the note on POLICY.monthlyLate.
 */
export const POLICY = {
  hours: 'hours',
  concession: 'concession',
  monthly: 'monthly',
  /*
   * BOTH of the last two, which are different questions:
   *   the month's total asks DID THEY PUT THE HOURS IN;
   *   the concession asks DID THEY TURN UP ON TIME.
   * Somebody half an hour late who stays half an hour later has answered the
   * first and failed the second, so the two are not the same offence. What
   * they share is the person who is late and does NOT make it up: those
   * minutes are in both counts, and `calculateRow` charges the GREATER of
   * the two rather than the sum, so no minute is ever taken twice.
   */
  monthlyLate: 'monthly_late',
};

/**
 * WHAT A NEWLY OPENED MONTH STARTS ON.
 *
 * Dinesh, having seen what it costs: *"monthly wala on kar do abhi se"*. So a
 * month opened from here on comes up on the monthly-hours rule rather than
 * on `hours`.
 *
 * ---------------------------------------------------------------------------
 * THIS CHANGES NO MONTH THAT ALREADY EXISTS.
 *
 * `late_policy` is a column on `periods`, written once when the month is
 * created, and nothing here rewrites a stored value. Every month already in
 * the database keeps exactly the rule it was run on - including the one open
 * when this release is installed, which has to be switched by hand on the
 * Time tab, priced first. That is the whole reason the policy is per month:
 * a rule changed in December must not rewrite a payslip paid in November.
 * ---------------------------------------------------------------------------
 *
 * One constant, read by `createPeriod` on the server and by `localStore` in
 * the single-file build, so the two cannot open a month on different rules.
 */
export const DEFAULT_POLICY_FOR_NEW_MONTHS = POLICY.monthlyLate;

/**
 * THE POLICIES AS A LIST, so no screen can enumerate them and go stale.
 *
 * The Settings panel hand-wrote two `<option>`s. Two releases later there
 * were four policies and that select still offered two - so a month running
 * on `monthly_late` rendered as "concession", and touching the box would
 * have switched the monthly target OFF without saying so. A live money bug
 * out of a list typed twice.
 *
 * Every screen that offers the choice maps over THIS, so adding a fifth
 * reaches all of them or none.
 */
export const POLICY_CHOICES = [
  {
    key: POLICY.hours,
    label: 'Each day on its own \u2014 short hours charged that day',
    why: 'What the app has always done. A day under its hours is charged that day, a day over it is paid, with a quarter of an hour either way ignored.',
  },
  {
    key: POLICY.concession,
    label: 'Pool late and early minutes, charge past the concession',
    why: 'Every minute late in or left early is pooled for the month, the first few hundred free, the rest off the pay. The hours-shortfall is NOT charged as well.',
  },
  {
    key: POLICY.monthly,
    label: 'The month owes a total \u2014 9 hours \u00d7 the days due, short and long cancel',
    why: 'The month is one account of hours. A day short and a day long cancel; only what is missing from the total comes off. Lateness as such is not charged.',
  },
  {
    key: POLICY.monthlyLate,
    label: 'Both \u2014 the month\u2019s total AND a cap on lateness',
    why: 'The two above together. They ask different questions, so they both apply \u2014 but the month is charged the GREATER of the two, never the sum, because a late minute nobody made up is already inside the shortfall.',
  },
];

export const policyLabel = (key) =>
  POLICY_CHOICES.find((c) => c.key === String(key || POLICY.hours))?.label || String(key);

export const policyWhy = (key) =>
  POLICY_CHOICES.find((c) => c.key === String(key || POLICY.hours))?.why || '';

/**
 * The office's usual day and how much lateness a month absorbs.
 *
 * The 300 is Dinesh's figure. The daily grace is **zero** on purpose: with a
 * monthly pool of five hours, forgiving a quarter of an hour again on every one
 * of 26 days would hand out another six and a half hours nobody decided on.
 */
export const DEFAULT_LATE_RULES = {
  shift_in: '09:30',
  shift_out: '18:30',
  concession_minutes: 300,
  grace_minutes: 0,
};

/**
 * Marks that mean a full day at work, and so can be judged late or early.
 * A blank day is included: somebody with clock times and no mark yet was here.
 */
/* OD is deliberately NOT here. Somebody who went straight to a client at
   eight cannot be "late" against this office's hours, and nobody here saw
   when they arrived - which is "not known", never "on time". */
export const FULL_DAY_MARKS = new Set(['', 'P', 'WH', 'SP', 'HP']);

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const codeOf = (entry) =>
  String((entry && typeof entry === 'object' ? entry.code : entry) || '').trim().toUpperCase();

/** The rules a period runs on, with anything unset falling back to the default. */
export function readLateRules(source = {}) {
  const rules = { ...DEFAULT_LATE_RULES };
  if (parseTime(source.shift_in) !== null) rules.shift_in = source.shift_in;
  if (parseTime(source.shift_out) !== null) rules.shift_out = source.shift_out;
  if (source.late_concession_minutes !== null && source.late_concession_minutes !== undefined && source.late_concession_minutes !== '')
    rules.concession_minutes = Math.max(0, num(source.late_concession_minutes, rules.concession_minutes));
  if (source.late_grace_minutes !== null && source.late_grace_minutes !== undefined && source.late_grace_minutes !== '')
    rules.grace_minutes = Math.max(0, num(source.late_grace_minutes, rules.grace_minutes));
  return rules;
}

/** True when this period prices late and early minutes rather than hours. */
export const onConcession = (period = {}) => {
  const p = String(period.late_policy || POLICY.hours).toLowerCase();
  return p === POLICY.concession || p === POLICY.monthlyLate;
};

/**
 * The shift one person works - their own if they have one, else the office's.
 * Different shifts are normal; a night-shift worker judged against 09:30 would
 * be five hours late every single day.
 */
export function shiftFor(employee = {}, rules = DEFAULT_LATE_RULES) {
  return {
    in: parseTime(employee.shift_in) !== null ? employee.shift_in : rules.shift_in,
    out: parseTime(employee.shift_out) !== null ? employee.shift_out : rules.shift_out,
  };
}

/**
 * Does this person work hours of their own, rather than the office's?
 *
 * COMPARED AGAINST THE OFFICE DAY, not merely "is the column filled in".
 * `employees.shift_in` carries a DEFAULT of 09:30 for everybody, so a
 * non-empty column proves nothing: asking that way reported all eighty-six
 * people as working their own shift, which is both wrong on screen and the
 * wrong branch to take when filling a day.
 *
 * Somebody whose shift happens to equal the office day is not "on their own
 * shift" - there is nothing to tell apart.
 */
export function hasOwnShift(employee = {}, standard = {}) {
  const theirIn = parseTime(employee.shift_in);
  const theirOut = parseTime(employee.shift_out);
  if (theirIn === null && theirOut === null) return false;
  const officeIn = parseTime(standard.in_time ?? standard.shift_in);
  const officeOut = parseTime(standard.out_time ?? standard.shift_out);
  /* With no office day to compare against, a filled-in shift is all there
     is to go on. */
  if (officeIn === null && officeOut === null) return true;
  return (
    (theirIn !== null && officeIn !== null && theirIn !== officeIn) ||
    (theirOut !== null && officeOut !== null && theirOut !== officeOut)
  );
}

/* ================================================================= *
 * HOW LONG THEIR DAY IS
 * ================================================================= */

/**
 * The length of a shift, in minutes, wrapping past midnight.
 *
 * `22:00 → 06:00` is eight hours, not minus sixteen. Equal times are
 * unreadable rather than zero or twenty-four: nobody means either, and
 * guessing which would be a guess about money.
 */
export function shiftMinutes(inTime, outTime) {
  const start = parseTime(inTime);
  const end = parseTime(outTime);
  if (start === null || end === null || start === end) return null;
  return end > start ? end - start : 1440 - start + end;
}

/** Below this, it is a typo rather than a shift. Above it, see MAX_DAY_MINUTES. */
export const MIN_SHIFT_MINUTES = 2 * 60;

/**
 * THE HOURS THIS PERSON'S DAY IS JUDGED AGAINST.
 *
 * Dinesh asked for per-employee shifts and got them for late, early and the
 * fill button - but the SHORT HOURS were still worked out against the
 * month's `hours_per_day` for everybody. Only WHEN their shift started was
 * personal; HOW LONG IT WAS was not read anywhere. So a ten-hour shift
 * collected an hour of overtime every day for simply being worked, and a
 * six-hour part-timer was docked three hours a day for finishing on time.
 *
 * ---------------------------------------------------------------------------
 * IT CAN ONLY MOVE SOMEBODY WHOSE SHIFT IS A DIFFERENT **LENGTH**.
 *
 * Most people with their own shift work the same nine hours at another time
 * of day - 14:00-23:00 is still nine - and for them this returns exactly
 * what it always returned. `hasOwnShift` is asked first and compares against
 * the office day rather than "is the column filled in", because the column
 * carries a 09:30 default for all eighty-six people.
 * ---------------------------------------------------------------------------
 *
 * A length that cannot be read, or that is under two hours or over sixteen,
 * falls back to the month. A mistyped `09:00-09:30` would otherwise make a
 * half-hour day the standard and pay eight and a half hours of overtime
 * every single day; `shiftLengthProblem` names anybody in that state rather
 * than leaving it silent.
 */
export function hoursForEmployee(employee = {}, { period = {}, standard = null } = {}) {
  const monthHours = Number(period?.hours_per_day) > 0 ? Number(period.hours_per_day) : 9;
  const rules = readLateRules(period || {});
  const office = standard || { in_time: rules.shift_in, out_time: rules.shift_out };
  if (!hasOwnShift(employee, office)) return monthHours;

  const shift = shiftFor(employee, { shift_in: office.in_time, shift_out: office.out_time });
  const minutes = shiftMinutes(shift.in, shift.out);
  if (minutes === null || minutes < MIN_SHIFT_MINUTES || minutes > MAX_DAY_MINUTES) {
    return monthHours;
  }
  return minutes / 60;
}

/**
 * Why somebody's shift is not being used, in a sentence, or null.
 *
 * Only ever about a shift that IS their own and cannot be read as a length.
 * Somebody on the office day has nothing to report.
 */
export function shiftLengthProblem(employee = {}, { period = {}, standard = null } = {}) {
  const rules = readLateRules(period || {});
  const office = standard || { in_time: rules.shift_in, out_time: rules.shift_out };
  if (!hasOwnShift(employee, office)) return null;

  const shift = shiftFor(employee, { shift_in: office.in_time, shift_out: office.out_time });
  const minutes = shiftMinutes(shift.in, shift.out);
  if (minutes === null) {
    return `${shift.in} to ${shift.out} cannot be read as a length, so the month’s hours are used`;
  }
  if (minutes < MIN_SHIFT_MINUTES) {
    return `${shift.in} to ${shift.out} is under two hours — almost certainly a typo, so the month’s hours are used`;
  }
  if (minutes > MAX_DAY_MINUTES) {
    return `${shift.in} to ${shift.out} is over sixteen hours, so the month’s hours are used`;
  }
  return null;
}

/**
 * THE TIMES TO WRITE ONTO ONE PERSON'S DAY.
 *
 * Dinesh: *"timing shift har staff ki alag alag ho sakti he"*. Shifts are
 * already held per person and already used to judge late and early - but
 * "Fill the usual timings" wrote the OFFICE'S one day onto everybody, so one
 * click put 09:00-18:00 on somebody who works nights. Their hours came out
 * wrong, and because the fill looks like it worked, nothing said so.
 *
 * Somebody with no shift of their own gets the office day exactly as before,
 * so nothing already set up can move.
 *
 * THE LUNCH IS ONLY CARRIED ACROSS IF IT FALLS INSIDE THEIR SHIFT. The
 * office's 13:00-13:30 means nothing on a 14:00-23:00 shift, and writing it
 * there would take half an hour off a day they worked in full.
 */
export function fillTimesFor(employee = {}, standard = {}) {
  if (!hasOwnShift(employee, standard)) return { ...standard };

  const shift = shiftFor(employee, {
    shift_in: standard.in_time,
    shift_out: standard.out_time,
  });
  const out = { ...standard, in_time: shift.in, out_time: shift.out };

  const start = parseTime(shift.in);
  const end = parseTime(shift.out);
  const lunchOut = parseTime(standard.lunch_out);
  const lunchIn = parseTime(standard.lunch_in);
  /* An overnight shift wraps past midnight, so "inside" cannot be a simple
     comparison - and rather than guess at a break nobody stated, it is left
     off. The office can type it on the day. */
  const overnight = start !== null && end !== null && end <= start;
  const inside =
    !overnight &&
    start !== null && end !== null &&
    lunchOut !== null && lunchIn !== null &&
    lunchOut >= start && lunchIn <= end;
  if (!inside) {
    out.lunch_out = '';
    out.lunch_in = '';
  }
  return out;
}

/**
 * One day's late and early minutes.
 *
 * @returns {{ late: number, early: number, judged: boolean, reason: string }}
 *   judged false means there was nothing to judge - say "not known", never 0.
 */
export function dayLateEarly(entry, { start, end, grace = 0 } = {}) {
  const blank = { late: 0, early: 0, judged: false, reason: '' };
  const code = codeOf(entry);
  if (!FULL_DAY_MARKS.has(code)) return { ...blank, reason: 'not a full working day' };

  const times = entry && typeof entry === 'object' ? entry : {};
  const cameAt = parseTime(times.in_time);
  const leftAt = parseTime(times.out_time);
  if (cameAt === null && leftAt === null) return { ...blank, reason: 'no clock times' };

  const startsAt = parseTime(start);
  const endsAt = parseTime(end);
  const allowance = Math.max(0, num(grace));
  const overnight = readTimes(times).overnight;

  let late = 0;
  if (cameAt !== null && startsAt !== null) {
    const over = cameAt - startsAt;
    if (over > allowance) late = over;
  }

  let early = 0;
  // A shift that runs past midnight is not an early finish.
  if (leftAt !== null && endsAt !== null && !overnight) {
    const under = endsAt - leftAt;
    if (under > allowance) early = under;
  }

  return { late, early, judged: true, reason: '' };
}

/**
 * One person's month: how late, how early, and on which days.
 *
 * @param attendance day number -> mark, or { code, in_time, out_time, ... }
 * @returns {{
 *   late_minutes, early_minutes, total_minutes,
 *   late_days, early_days, judged_days, days
 * }}
 */
export function monthLateEarly(attendance = {}, options = {}) {
  const out = {
    late_minutes: 0,
    early_minutes: 0,
    total_minutes: 0,
    late_days: 0,
    early_days: 0,
    judged_days: 0,
    days: [],
  };

  for (const [day, entry] of Object.entries(attendance || {})) {
    const judged = dayLateEarly(entry, options);
    if (!judged.judged) continue;
    out.judged_days++;
    if (judged.late > 0) {
      out.late_minutes += judged.late;
      out.late_days++;
    }
    if (judged.early > 0) {
      out.early_minutes += judged.early;
      out.early_days++;
    }
    if (judged.late > 0 || judged.early > 0) {
      out.days.push({ day: Number(day), late: judged.late, early: judged.early });
    }
  }

  out.total_minutes = out.late_minutes + out.early_minutes;
  out.days.sort((a, b) => a.day - b.day);
  return out;
}

/**
 * The concession applied: what was used out of the month's allowance and what
 * is left to charge. Never negative, so a tidy month can never earn credit.
 */
export function applyConcession(totalMinutes, concessionMinutes = DEFAULT_LATE_RULES.concession_minutes) {
  const total = Math.max(0, Math.round(num(totalMinutes)));
  const allowed = Math.max(0, Math.round(num(concessionMinutes, DEFAULT_LATE_RULES.concession_minutes)));
  const used = Math.min(total, allowed);
  return { total, allowed, used, left: allowed - used, chargeable: total - used };
}

/**
 * Everything the salary sheet needs for one person's late/early line.
 *
 * @param attendance the month's marks, with clock times on them
 * @param opts { employee, rules, per_minute }
 */
export function lateEarlyLine(attendance = {}, { employee = {}, rules, per_minute = 0 } = {}) {
  const settings = readLateRules(rules || {});
  const shift = shiftFor(employee, settings);
  const month = monthLateEarly(attendance, {
    start: shift.in,
    end: shift.out,
    grace: settings.grace_minutes,
  });
  const concession = applyConcession(month.total_minutes, settings.concession_minutes);
  return {
    ...month,
    ...concession,
    shift_in: shift.in,
    shift_out: shift.out,
    grace_minutes: settings.grace_minutes,
    amount: Math.round(concession.chargeable * num(per_minute) * 100) / 100,
  };
}

/** "5h 00m free, 1h 12m charged" - for the panel that says what a switch costs. */
export function describeConcession(line = {}) {
  const mins = (m) => {
    const v = Math.max(0, Math.round(num(m)));
    if (v < 60) return `${v}m`;
    return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
  };
  if (!line.total) return 'nothing late or early this month';
  const parts = [`${mins(line.total)} late or early`, `${mins(line.allowed)} free`];
  parts.push(line.chargeable > 0 ? `${mins(line.chargeable)} charged` : 'nothing charged');
  return parts.join(', ');
}
