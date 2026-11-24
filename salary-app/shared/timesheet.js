/**
 * In / lunch out / lunch in / out times, and the hours they add up to.
 *
 * The attendance grid answers "was this person here"; this answers "for how
 * long". A day carries four clock times, and what falls out of them - hours
 * worked, and the short hours or overtime against the day's expected hours -
 * is the same number the biometric import produces, so a day typed by hand and
 * a day read off the machine are worth exactly the same at the end of the
 * month.
 *
 * Dependency-free, like the rest of shared/, so the server and the standalone
 * browser build cannot drift apart.
 */

/** The four clock times a day can carry, in the order they happen. */
export const TIME_FIELDS = ['in_time', 'lunch_out', 'lunch_in', 'out_time'];

export const TIME_LABELS = {
  in_time: 'In',
  lunch_out: 'Lunch out',
  lunch_in: 'Lunch in',
  out_time: 'Out',
};

/**
 * Shared with the punch importer so a typed day and an imported day are judged
 * the same way.
 *
 *   halfDayHours - anything under this is half a day, not a full one
 *   graceMinutes - short hours under this are not deducted, so a few minutes
 *                  late never turns into money
 */
export const TIME_RULES = {
  // Half of the default nine-hour day. `timesToDay` derives it from the month's
  // own hours per day instead; this stands for callers that have no month to
  // hand, such as the punch importer's own defaults.
  halfDayHours: 4.5,
  graceMinutes: 15,
};

/**
 * Everything in TIME_RULES except the half-day line, which `timesToDay` works
 * out from the day's own hours instead of taking the constant.
 */
const { halfDayHours: _fixedHalfDay, ...TIME_RULES_WITHOUT_HALF } = TIME_RULES;

/**
 * A day longer than this is almost certainly a typo, not a night shift.
 *
 * Exported because `shared/lateEarly.js` judges a person's own SHIFT LENGTH
 * against the same bound. Two numbers for "too long to be a real day" is how
 * a 20-hour shift comes to be refused in one place and paid in the other.
 */
export const MAX_DAY_MINUTES = 16 * 60;

/**
 * HOW MANY MINUTES A DAY MAY BE OUT BEFORE IT COUNTS.
 *
 * Dinesh, looking at a Time tab where every + / - column read a dash:
 * *"kuch logo me +- minutes kyu nahi aa rahi he"*. Nothing was wrong - every
 * one of those days was inside the quarter-hour this rule forgives. His own
 * figures that morning: +7, -11, +8, +13, -8, -15, -10, all forgiven.
 *
 * `TIME_RULES.graceMinutes` (15) is what the app has always done and what
 * every month already run was paid on. A month opened from now starts on
 * **0** - every minute counts, which is what he asked to see - and the
 * figure is held PER MONTH, so a rule changed in December never rewrites
 * November.
 *
 * WORTH KNOWING, and it is the thing that made the question confusing: the
 * grace only ever touched this column. `monthlyHours` reads the clock times
 * themselves, so the month's own total has always counted every minute. On
 * his three days above the column read 0, 0, 0 and the month read +9.
 */
export const DEFAULT_DAY_GRACE_FOR_NEW_MONTHS = 0;

/**
 * The grace one month runs on. A month with nothing stored keeps the old
 * quarter of an hour, so no month already run can move.
 */
export const dayGrace = (period = {}) => {
  const given = period?.day_grace_minutes;
  if (given === null || given === undefined || given === '') return TIME_RULES.graceMinutes;
  const n = Number(given);
  return Number.isFinite(n) && n >= 0 && n <= 240 ? Math.round(n) : TIME_RULES.graceMinutes;
};
const DAY = 24 * 60;

/**
 * Minutes since midnight from whatever was typed, or null.
 *
 * Takes the shapes people actually type: 9:30, 09:30, 9.30, 930, 9, 6pm,
 * 6:15 PM. A bare number under 24 is read as an hour, so "6" is 06:00 - type
 * "6pm" or "18" for the evening.
 */
export function parseTime(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 && value < DAY ? Math.round(value) : null;
  }

  const text = String(value).trim().toLowerCase();
  if (!text || text === '-') return null;

  const suffix = /(a|p)\.?m\.?$/.exec(text)?.[1] || '';
  const body = text.replace(/\s*(a|p)\.?m\.?$/, '').trim();

  let hours;
  let mins;
  const colon = /^(\d{1,2})[:.](\d{1,2})$/.exec(body);
  if (colon) {
    hours = Number(colon[1]);
    mins = Number(colon[2]);
  } else if (/^\d{3,4}$/.test(body)) {
    // 930 and 0930 both mean half past nine.
    hours = Number(body.slice(0, body.length - 2));
    mins = Number(body.slice(-2));
  } else if (/^\d{1,2}$/.test(body)) {
    hours = Number(body);
    mins = 0;
  } else {
    return null;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  if (suffix === 'p' && hours < 12) hours += 12;
  if (suffix === 'a' && hours === 12) hours = 0;
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** 570 -> "09:30". Null for anything that is not a time. */
export function formatTime(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '';
  const m = ((Math.round(Number(minutes)) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * 545 -> "9h 05m", 45 -> "45m", 771665 -> "12,861h". For reading rather than
 * for sums: once a figure runs to thousands of hours - a whole company's month
 * - the minutes on the end are noise, and the grouping is what makes it
 * readable at a glance.
 */
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '';
  const total = Math.round(Number(minutes));
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  if (abs < 60) return `${sign}${abs}m`;
  const hours = Math.floor(abs / 60);
  if (hours >= 1000) return `${sign}${hours.toLocaleString('en-IN')}h`;
  return `${sign}${hours}h ${String(abs % 60).padStart(2, '0')}m`;
}

/**
 * What a day's four times add up to.
 *
 * @returns {
 *   in, lunchOut, lunchIn, out  minutes since midnight, or null
 *   gross    out - in, counting a shift that ends after midnight as the next day
 *   lunch    the break taken out of it
 *   worked   gross - lunch, or null when in or out is missing
 *   overnight  whether the shift was read as running past midnight
 *   warning  what looks wrong about the times, if anything
 * }
 */
export function readTimes(times = {}, { deductLunch = true } = {}) {
  const at = {
    in: parseTime(times.in_time),
    lunchOut: parseTime(times.lunch_out),
    lunchIn: parseTime(times.lunch_in),
    out: parseTime(times.out_time),
  };

  let gross = null;
  let overnight = false;
  /*
   * ONE PUNCH IS NOT A TWENTY-FOUR HOUR SHIFT.
   *
   * Somebody who touched the reader once has an arrival and no departure, and
   * the importer writes the same minute into both columns. Read as `out - in`
   * that is 0, and `gross <= 0` then wrapped it to a whole day: his live Time
   * tab showed ABDULHAK BHENSWALA in at 10:50, out at 10:50, "24h 00m worked,
   * +900m" - fifteen hours of overtime for one tap, and ASHOK MISHRA's month
   * reading 317h against a 234h target.
   *
   * The same minute on both sides means there is only one punch, so the
   * departure is NOT KNOWN - exactly the state a blank out time describes.
   * Nothing invents a departure. And an overnight shift is `out < in`, never
   * `out === in`: nobody clocks out at the same minute of the next day.
   */
  const oneTouch = at.in !== null && at.out !== null && at.out === at.in;
  /*
   * The same rule as `departureTime` above, on the READ side: a day whose
   * out time is the minute they came back from lunch has no departure on it,
   * however it got there - imported before this release, or typed by hand.
   */
  const backFromLunch =
    at.out !== null && at.lunchIn !== null && at.out === at.lunchIn;
  if (backFromLunch) at.out = null;
  if (at.in !== null && at.out !== null && !oneTouch) {
    gross = at.out - at.in;
    if (gross < 0) {
      gross += DAY;
      overnight = true;
    }
  }

  let lunch = 0;
  if (at.lunchOut !== null && at.lunchIn !== null) {
    lunch = at.lunchIn - at.lunchOut;
    if (lunch < 0) lunch += DAY;
  }

  let warning = '';
  if (gross !== null && lunch > gross) {
    warning = 'the lunch break is longer than the day';
    lunch = 0;
  } else if (gross !== null && gross > MAX_DAY_MINUTES) {
    warning = 'that is more than 16 hours - check the in and out times';
  } else if ((at.lunchOut === null) !== (at.lunchIn === null)) {
    warning = 'only one lunch time is filled, so no break was taken off';
  } else if (at.in === null && at.out !== null) {
    warning = 'no in time';
  } else if (backFromLunch) {
    /*
     * BEFORE the plain "no out time", because this one says WHY there is
     * none. Both are true; only this one tells somebody what happened, and a
     * column that reads the same for every cause is the "check" pill all over
     * again.
     */
    warning = 'back from lunch - no out time';
  } else if (at.out === null && at.in !== null) {
    warning = 'no out time';
  } else if (oneTouch) {
    /*
     * In and out at the same minute is ONE PUNCH, not a day.
     *
     * Until this it said nothing at all: the hours read as a dash and the two
     * identical times sat there looking like a record. Dinesh asked the
     * obvious question - *"why in time and outtime same coming"* - and the
     * screen had no answer on it. A day that cannot be measured has to say
     * which half is missing.
     */
    warning = 'one punch only - no out time';
  }

  /*
   * Whether the break comes OFF the day.
   *
   * Dinesh's office is "9 hrs including lunch" - the half hour sits inside
   * the nine, so the times are worth recording and must not be subtracted.
   * An office that stops the clock for lunch deducts it, which is what this
   * has always done and remains the default, so no month already paid can
   * move on the strength of a new setting.
   */
  const taken = deductLunch ? lunch : 0;

  return {
    ...at,
    gross,
    lunch,
    lunchDeducted: taken,
    worked: gross === null ? null : gross - taken,
    overnight,
    warning,
  };
}

/**
 * The day's DEPARTURE, given its arrival — '' when there is not one.
 *
 * ONE PUNCH IS NOT AN ARRIVAL AND A DEPARTURE. The readers are door locks,
 * so a day normally carries six or eight openings and the earliest and the
 * latest are taken as in and out. Somebody who went through once has only an
 * arrival, and writing that minute into BOTH columns claims they left the
 * moment they arrived.
 *
 * It is returned as '' and not as "leave it out", because `setAttendance`
 * merges per field: omitting it would keep a stale out time from an earlier
 * import and pay hours nobody worked.
 *
 * ONE function, because this rule was written three times and the third one
 * was wrong. `punches.js` and `punchClock.js` each had their own copy and
 * `monthlyStatus.js` — the eSSL report and the Access pull — had none at
 * all, so that path went on writing 10:50 into both columns after the others
 * had been fixed. A rule that lives in three places is a rule that disagrees
 * with itself.
 *
 * Compared as the TEXT that gets written, so 10:50:01 and 10:50:59 are one
 * punch: they are the same minute on every screen that shows them.
 */
export function departureTime(arrival, departure, lunchReturn = '') {
  const start = String(arrival ?? '').trim();
  const end = String(departure ?? '').trim();
  const back = String(lunchReturn ?? '').trim();
  if (!end) return '';
  if (start && end === start) return '';
  /*
   * AND THE LAST PUNCH OF A DAY STILL RUNNING IS THE RETURN FROM LUNCH.
   *
   * Punches 10:50, 13:37, 14:16 at twenty to three in the afternoon: the
   * earliest is the arrival and the latest is 14:16, which is them coming
   * BACK, not leaving. Dinesh, looking at exactly that: *"jab shift khatam
   * nahi hui to out me time kyu aa raha he"*.
   *
   * It showed as in 10:50, lunch 13:37-14:16, out 14:16, worked 2h 47m - a
   * finished short day, for somebody who was sitting at their desk. Nobody
   * returns from lunch and leaves in the same minute, so that minute is a
   * return and the departure is not known yet.
   */
  if (back && end === back) return '';
  return end;
}

/*
 * Past this hour, call the day finishable whatever the sum says. Without it a
 * shift starting after lunch could never resolve: arrival + nine hours lands
 * past midnight, "not finished" would hold all night, and the day would never
 * be given a departure at all.
 */
const LATEST_FINISH = 22 * 60;

/**
 * Whether a day CANNOT HAVE FINISHED YET, so its last punch is somebody
 * moving about rather than leaving.
 *
 * Dinesh, on the Time tab at twenty past four: *"out time abhi bhi aa raha
 * he"*. v2.0.0 caught the clearest case - a last punch that is the return
 * from lunch - but people with only two punches were still being handed a
 * departure and CHARGED A SHORTFALL while they were sitting at their desks.
 * ANURAG VERMA read 10:49 to 15:37 and −252 minutes at 16:14, on a day with
 * two hours of it left to run.
 *
 * The rule is the one sentence that is always true: **you cannot have
 * finished your day before your day's length has gone by.** Until then the
 * departure is not known, nothing is charged and nothing is paid - and a
 * later pull, once the day really is over, writes the real one.
 *
 * It only ever looks at TODAY. A day in the past is finished whatever it
 * carries, so no stored month can move.
 */
export function dayNotFinished({
  year, month, day, arrival,
  hoursPerDay = 9, lunchMinutes = 0, deductLunch = true,
  now = new Date(),
} = {}) {
  const sameDate =
    now.getFullYear() === Number(year) &&
    now.getMonth() + 1 === Number(month) &&
    now.getDate() === Number(day);
  if (!sameDate) return false;

  const start = typeof arrival === 'number' ? arrival : parseTime(arrival);
  if (start === null) return false;

  const needed =
    Math.round(Number(hoursPerDay) * 60) +
    (deductLunch ? Math.max(0, Number(lunchMinutes) || 0) : 0);
  const couldFinishAt = Math.min(start + needed, LATEST_FINISH);
  return now.getHours() * 60 + now.getMinutes() < couldFinishAt;
}

/** True once a day has enough typed on it to be worth anything. */
export const hasTimes = (times = {}) => TIME_FIELDS.some((f) => parseTime(times[f]) !== null);

/**
 * The mark and the short hours a day's times come to.
 *
 * Only the arithmetic lives here; whether to actually write the mark is the
 * caller's call, because a day already marked as leave or a holiday keeps its
 * own mark - the times still record what was worked on it.
 *
 * @returns { worked, expected, diff, minutes, code, warning }
 *   minutes  what goes in the day's OT/short column, grace already applied
 *   code     'P' or 'HF', or '' when there is nothing to say
 */
export function timesToDay(times, { hoursPerDay = 9, rules, deductLunch = true } = {}) {
  const hours = Number(hoursPerDay) || 9;
  /*
   * The half-day line follows the configured day: half of whatever the month's
   * hours per day are, unless the caller names a figure. Dinesh's own list asks
   * for exactly this - "half day: based on configured working hours" - and the
   * fixed 4½ hours was only right because the default day is nine. An eight-hour
   * day now breaks at four, not at four and a half.
   */
  const settings = { halfDayHours: hours / 2, ...TIME_RULES_WITHOUT_HALF, ...(rules || {}) };
  const read = readTimes(times, { deductLunch });
  const expected = Math.round(hours * 60);

  if (read.worked === null) {
    return { ...read, expected, diff: null, minutes: 0, code: '' };
  }

  const diff = Math.round(read.worked - expected);
  const halfDay = Number(settings.halfDayHours) * 60;
  const code = read.worked < halfDay ? 'HF' : 'P';
  // A few minutes either way is not worth a deduction, and a half day is
  // already paid at half - charging the missing hours again would be double.
  const minutes =
    code === 'HF' || Math.abs(diff) <= Number(settings.graceMinutes) ? 0 : diff;

  return { ...read, expected, diff, minutes, code };
}

/**
 * Marks on which the day's hours are owed, so falling short costs money.
 *
 * Deliberately NOT the same list as the dashboard's late/early one. Somebody
 * who came in on a Sunday can still arrive late - that is about conduct. This
 * is about pay, and a Sunday, a holiday or a day of leave never promised the
 * day's hours in the first place:
 *
 *   P, WH   a full working day, at the desk or at home - hours owed
 *   ''      no mark yet; setAttendance turns a clocked day into P
 *   HF      half a day, already paid at half
 *   A UL AD already docked a whole day, or two
 *   S PH    an off day - nothing was expected
 *   SP HP   worked, but paid BY THE DAY on the Sunday register, not by the
 *           hour, so the salary must not also be reduced for the hours
 *   CL SL PL paid leave - no hours expected
 *   OD      out on the company's business - at work, but not where this
 *           office's clock is, so a shortfall against its hours is not
 *           theirs to answer for
 */
export const HOURS_EXPECTED = new Set(['', 'P', 'WH']);

/**
 * The day's OT/short minutes **given the mark the day will actually carry**.
 *
 * timesToDay zeroes the shortfall once the hours fall under the half-day
 * line, because charging the missing hours on top of half a day's pay would
 * be double. That reasoning only holds if the day IS a half day. A caller
 * that names a full-day mark - the eSSL export writes the device's own P -
 * would otherwise pay a whole day for two hours and fifty-eight minutes with
 * nothing deducted, which is neither the machine's answer nor ours.
 *
 * Only P is corrected. A, UL and AD already dock a day; leave, a holiday and
 * a Sunday are paid without hours being expected; SP and HP are paid by the
 * day on the Sunday register, outside the salary this would come out of.
 *
 * One function so the server, the offline file and the import preview cannot
 * give three answers for the same day.
 */
export function minutesForMark(
  times,
  { hoursPerDay = 9, code = '', deductLunch = true, graceMinutes } = {}
) {
  const judged = timesToDay(times, {
    hoursPerDay,
    deductLunch,
    ...(graceMinutes === undefined ? {} : { rules: { graceMinutes } }),
  });
  const mark = String(code || '').trim().toUpperCase();
  const owesTheDay = HOURS_EXPECTED.has(mark);

  if (judged.code === 'HF' && owesTheDay) {
    return timesToDay(times, { hoursPerDay, deductLunch, rules: { halfDayHours: 0 } }).minutes;
  }

  /*
   * A SHORTFALL is charged on a full working day and nowhere else.
   *
   * Found by filling the usual timings onto a Sunday: the mark stayed S,
   * correctly, and the day was then docked 45 minutes - an off day nobody
   * was due to work, charged for not working long enough. The same held for
   * SP and HP, which are paid by the day on the Sunday register: six hours
   * worked on a Sunday took three hours off the salary AND paid a day rate.
   */
  if (!owesTheDay && judged.minutes < 0) return 0;

  /*
   * AND A DAY OFF PAYS NO OVERTIME EITHER. Dinesh, asked directly:
   * *"Overtime me nahi jayega / Sunday ki full day ki salary lene k liye
   * minimum 6 hours complete karne he wesa he"*.
   *
   * A Sunday is paid BY THE DAY on the Sunday register - six hours on it
   * earns the whole day. Paying the clock as well would pay the same work
   * twice: his ASHOK MISHRA did 10h 11m on Sunday 22 November and drew a
   * full day's Sunday rate AND 71 minutes of overtime on his salary.
   *
   * The set is deliberately narrow (see PAID_BY_THE_DAY): the weekly off,
   * the weekly off worked, a holiday and a holiday worked. Leave is NOT in
   * it, and neither is OD - somebody out on the company's business who puts
   * in eleven hours is doing a working day somewhere else, and taking their
   * overtime away was never asked for.
   *
   * This is the WRITE path, so nothing already stored on a day moves and no
   * month already paid can change. The register's own button clears what an
   * open month is carrying, after saying whose it is and how much.
   */
  if (PAID_BY_THE_DAY.has(mark)) return 0;

  /*
   * AND THE CLOCK IS NOT READ AT ALL ON A ROUND-THE-CLOCK DUTY.
   *
   * Dinesh: *"kuch log 24 hours ofc me rehte he / unki punching kese hogi"*.
   * They do not go home, so the reader gives one punch and nothing after it.
   * Twenty-four hours against a nine-hour day is FIFTEEN HOURS of overtime
   * every single day - near-double pay nobody decided - and the shortfall
   * rule above already lets the day past because DD owes no nine hours.
   *
   * So the day is worth exactly one day, like P, and the hours say nothing.
   * To pay somebody more for a night on the premises, the office types it:
   * their OT min cell or the Add box, with the figure in front of them.
   */
  if (HOURS_NOT_READ.has(mark)) return 0;

  return judged.minutes;
}

/**
 * Marks whose clock hours pay nothing in either direction.
 *
 *   S     the weekly off - nobody was due in
 *   SP    the weekly off WORKED - paid by the day on the Sunday register
 *   HP    a holiday worked - likewise
 *   PH    a paid holiday - nobody was due in
 *
 * Kept here beside `HOURS_EXPECTED` rather than in `sundayDuty.js`, because
 * `sundayDuty` imports this module and the two must not import each other.
 */
export const PAID_BY_THE_DAY = new Set(['S', 'SP', 'HP', 'PH']);

/**
 * Marks whose clock hours are not read in either direction.
 *
 *   DD    round-the-clock duty - they never leave, so there is no departure
 *         to measure and a 24-hour day would read as 15 hours of overtime
 *
 * DELIBERATELY A SECOND SET AND NOT AN ADDITION TO THE ONE ABOVE, because
 * the reason differs and the reason is the whole point. PAID_BY_THE_DAY is
 * paid by the Sunday register, so reading the clock as well pays the same
 * work twice. This one is paid by the month's salary exactly like a present
 * day; what is wrong here is that the clock cannot describe the day at all.
 */
export const HOURS_NOT_READ = new Set(['DD']);

/** Everything typed on one person's month, added up. */
export function monthTotals(daysWithTimes = [], options = {}) {
  // options carries hoursPerDay and deductLunch straight through to timesToDay.
  const totals = { days: 0, worked: 0, expected: 0, short: 0, overtime: 0, lunch: 0 };
  for (const times of daysWithTimes) {
    if (!hasTimes(times)) continue;
    const day = timesToDay(times, options);
    if (day.worked === null) continue;
    totals.days++;
    totals.worked += day.worked;
    totals.expected += day.expected;
    totals.lunch += day.lunch;
    if (day.minutes < 0) totals.short += -day.minutes;
    if (day.minutes > 0) totals.overtime += day.minutes;
  }
  return totals;
}

/**
 * Came in after the usual start, or left before the usual finish.
 *
 * Both need a clock time to judge, so a day nobody clocked is neither - the
 * caller has to say "not known", not "on time". The same grace the short-hours
 * rule uses applies here, so a couple of minutes is never a black mark, and a
 * shift that runs past midnight is not an early finish.
 */
export function isLateIn(times, { start, grace = TIME_RULES.graceMinutes } = {}) {
  const cameAt = parseTime(times?.in_time);
  const startsAt = parseTime(start);
  if (cameAt === null || startsAt === null) return false;
  return cameAt > startsAt + grace;
}

export function lateByMinutes(times, { start } = {}) {
  const cameAt = parseTime(times?.in_time);
  const startsAt = parseTime(start);
  if (cameAt === null || startsAt === null) return null;
  return cameAt - startsAt;
}

export function isEarlyOut(times, { end, grace = TIME_RULES.graceMinutes } = {}) {
  const leftAt = parseTime(times?.out_time);
  const endsAt = parseTime(end);
  if (leftAt === null || endsAt === null) return false;
  if (readTimes(times).overnight) return false;
  return leftAt < endsAt - grace;
}
