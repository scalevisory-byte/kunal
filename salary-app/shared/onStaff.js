/**
 * WAS THIS PERSON ON THE STAFF ON THAT DAY?
 *
 * Dinesh, off the live roll call with seventeen names under Absent while HR's
 * own message listed ten: *"isme left wale bhi aa rahe he absent me"*.
 *
 * Somebody who leaves mid-month STAYS on that month's payroll, deliberately:
 * they worked part of it and are owed for it, so the row cannot go. But the
 * roll call asks a different question - who was due in TODAY - and it never
 * read the leaving date at all. So everybody who had gone was listed as
 * absent every morning for the rest of the month, the absent count and the
 * attendance percentage were both wrong, and the real absences were buried
 * among people nobody was expecting.
 *
 * ---------------------------------------------------------------------------
 * THIS DECIDES WHO IS LISTED. IT DOES NOT DECIDE WHAT ANYBODY IS PAID.
 *
 * Nothing here is an input to `calculateRow`. Whatever is marked on a
 * leaver's days still prices their last month exactly as it did - an absence
 * marked after the leaving date still comes off, which is how a part month
 * comes out right. This only stops a day's roll call, a day's trend bar and
 * the day's message from counting somebody who was not on the staff that day.
 * ---------------------------------------------------------------------------
 *
 * Three rules, in order:
 *
 *   1. BEFORE THE JOINING DATE they are not on the staff yet.
 *
 *   2. AFTER THE LEAVING DATE they are gone. The last working day itself is
 *      still a working day - somebody absent on their last day was absent.
 *      A date in the future (serving notice) changes nothing until it passes.
 *
 *   3. MARKED AS LEFT WITH NO DATE. The office unticked Active and nobody
 *      said when. "Gone, date not known" must not read as "absent every day",
 *      and it must not erase the days they demonstrably worked either. So
 *      they are on the staff up to the LAST DAY THE MONTH HAS EVIDENCE OF
 *      THEM - at work, or on leave somebody granted - and off it after. With
 *      no such day at all they are off the whole month. It is an inference,
 *      it is stated as one (`why` says "no leaving date on record"), and the
 *      fix is a date on their record, which rule 2 then takes over from.
 *
 * Dependency-free, like the rest of shared/, so the dashboard, the server's
 * daily message and the single-file build cannot give three answers.
 */

/**
 * Marks that are EVIDENCE somebody was on the staff that day: at work in any
 * form, or on leave that was theirs to take.
 *
 * Deliberately NOT an absence (that is the very thing in question), and NOT
 * the weekly off or a paid holiday - those are filled across the whole grid
 * in one press and say nothing about one person.
 */
export const ON_STAFF_EVIDENCE = new Set([
  'P', 'HF', 'WH', 'OD', 'DD', 'SP', 'HP', 'CL', 'SL', 'PL',
]);

const isoOnly = (value) => {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
};

const two = (n) => String(n).padStart(2, '0');

/** That day of that month as an ISO date, or '' when it cannot be one. */
export const isoDay = ({ year, month } = {}, day) => {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || !m || !d) return '';
  return `${y}-${two(m)}-${two(d)}`;
};

const codeOf = (entry) =>
  String((typeof entry === 'object' && entry ? entry.code || entry.mark : entry) || '')
    .trim()
    .toUpperCase();

/**
 * The last day of the month that carries evidence of the person - a mark
 * from ON_STAFF_EVIDENCE, or a clock-in. 0 when there is none.
 */
export function lastSeenDay(attendance = {}) {
  let last = 0;
  for (const [key, entry] of Object.entries(attendance || {})) {
    const day = Number(key);
    if (!day) continue;
    const clockedIn = typeof entry === 'object' && entry && String(entry.in_time || '').trim() !== '';
    if (ON_STAFF_EVIDENCE.has(codeOf(entry)) || clockedIn) last = Math.max(last, day);
  }
  return last;
}

/** Marked as no longer on the staff. Only an explicit no counts. */
const markedAsLeft = (person = {}) =>
  person.active === 0 || person.active === false || person.active === '0';

/**
 * @param person  a payroll row or an employee: joined_on, left_on, active,
 *                and (for rule 3) the month's `attendance`
 * @param when    { year, month, day }
 * @returns {{ on: boolean, why: string }} `why` is empty when they are on
 *   the staff, and says which rule took them off when they are not
 */
export function onStaffThatDay(person = {}, when = {}) {
  const date = isoDay(when, when.day);
  /* A day that cannot be named cannot be judged. Leaving everybody on is the
     old behaviour, which is the safe side of not knowing. */
  if (!date) return { on: true, why: '' };

  const joined = isoOnly(person.joined_on);
  if (joined && joined > date) return { on: false, why: `joins on ${joined}` };

  const left = isoOnly(person.left_on);
  if (left) {
    return left < date ? { on: false, why: `left on ${left}` } : { on: true, why: '' };
  }

  if (markedAsLeft(person)) {
    const seen = lastSeenDay(person.attendance);
    if (Number(when.day) > seen) {
      return {
        on: false,
        why: seen
          ? `left, no leaving date on record - last seen on day ${seen}`
          : 'left, no leaving date on record',
      };
    }
  }
  return { on: true, why: '' };
}

/**
 * Split a month's rows for one day.
 *
 * @returns {{ staff: object[], gone: Array<{ row: object, why: string }> }}
 *   `gone` is kept, with the reason, so a screen can SAY who it left out -
 *   a list that silently got shorter reads as people going missing.
 */
export function staffOn(rows = [], when = {}) {
  const staff = [];
  const gone = [];
  for (const row of rows) {
    const verdict = onStaffThatDay(row, when);
    if (verdict.on) staff.push(row);
    else gone.push({ row, why: verdict.why });
  }
  return { staff, gone };
}

/* ---------------------------------------------------------------------------
 * A LEAVER, SEEN FROM THE MONTH
 *
 * Dinesh: *"Exit employee ka still attendance and salary register me dikh
 * raha he"*. Two different people were behind that sentence, and they want
 * opposite answers:
 *
 *   left BEFORE the month began  - should not be on that month at all. They
 *                                  were only there because a punch import or
 *                                  "Mark everyone Present" had written marks
 *                                  onto their row, and a row with marks was
 *                                  never cleared away. (The server does the
 *                                  clearing - see `strandedRows` in db.js.)
 *   left DURING the month        - MUST stay: they are owed for the days they
 *                                  worked. What was missing is anything on
 *                                  the row saying so.
 *
 * And a third, who is neither: marked as left with NO leaving date. Nobody
 * can say which month they stop belonging to, so they stay and are named,
 * with the one thing that settles it - the date.
 * ------------------------------------------------------------------------ */

const inactive = (person = {}) => person.active === 0 || person.active === false || person.active === '0';

/**
 * How a person's leaving bears on one month.
 *   { left: 'during', day }   the last working day, in this month
 *   { left: 'before' }        gone before the 1st
 *   { left: 'undated' }       marked as left, no date on record
 *   { left: '' }              on the staff, or leaving later
 */
export function leaverIn(person = {}, period = {}) {
  const date = String(person.left_on || '').slice(0, 10);
  const first = isoDay(period, 1);
  if (date && first) {
    const last = isoDay(period, new Date(Date.UTC(Number(period.year), Number(period.month), 0)).getUTCDate());
    if (date < first) return { left: 'before', on: date };
    if (date <= last) return { left: 'during', on: date, day: Number(date.slice(8, 10)) };
    return { left: '', on: date };
  }
  if (!date && inactive(person)) return { left: 'undated' };
  return { left: '' };
}

/**
 * Days after the last working day that are still being PAID.
 *
 * The sheet pays 26 days less what is marked absent, so a day nobody marked
 * after somebody left is a day they are paid for. This counts them and takes
 * nothing off: stopping somebody's month is done by marking those days, where
 * it can be seen and undone - never by a rule that quietly cuts a final
 * salary. A day already costing a day (A, UL, AD) or carrying leave or an off
 * is somebody's decision and is not counted.
 */
export function paidAfterLeaving(person = {}, period = {}, attendance = {}) {
  const seen = leaverIn(person, period);
  if (seen.left !== 'during') return { days: [], from: null };
  const last = new Date(Date.UTC(Number(period.year), Number(period.month), 0)).getUTCDate();
  const days = [];
  for (let day = seen.day + 1; day <= last; day += 1) {
    const entry = attendance[day];
    const code = String((entry && typeof entry === 'object' ? entry.code : entry) || '').trim().toUpperCase();
    if (code === '' || code === 'P') days.push(day);
  }
  return { days, from: seen.day + 1 };
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The few words that go beside a leaver's name on a month's rows: "left 12
 * Nov", or "left, no date" - and nothing at all for somebody still here or
 * only serving notice. One wording for the salary sheet and the grid.
 */
export function leftLabel(person = {}, today = '') {
  const date = String(person.left_on || '').slice(0, 10);
  if (date) {
    if (today && date > String(today).slice(0, 10)) return '';
    const [, m, d] = date.split('-').map(Number);
    return m >= 1 && m <= 12 && d ? `left ${d} ${MONTHS_SHORT[m - 1]}` : 'left';
  }
  return inactive(person) ? 'left, no date' : '';
}
