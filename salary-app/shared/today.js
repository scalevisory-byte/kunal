/**
 * WHAT DAY IT IS HERE — not what day it is in London.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO STOP.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date. On a machine set
 * to IST, which is every machine this runs on, UTC is five and a half hours
 * BEHIND — so between midnight and half past five in the morning it returns
 * YESTERDAY.
 *
 * That was written out eighty-odd times across the server, the dashboard and
 * the offline build, as the default for every date somebody never sees:
 *
 *   - marking a salary row **paid** stamps `payment_date` silently. At half
 *     past midnight on 1 December, a November salary was stamped
 *     **30 November** — the wrong month, which is the one a reconciliation
 *     reads. The comment beside it said the date "can be typed over", and
 *     nobody types over a date they were never shown.
 *   - a penalty's told-on date, a claim's spent-on date, an appraisal, an
 *     asset handover, a document's verified-on date, an acknowledgement, a
 *     leave credit's own date: all the same shape, all a day back.
 *   - and the app was already showing the LOCAL date in the header through
 *     `todayLong()`, so the screen said 24 November while everything it
 *     wrote said the 23rd.
 *
 * Nothing here was ever charged wrong — no figure reads a date like this,
 * and `monthForAuto` already picked the month off the local clock, so the
 * scheduled punch pull could never write into the wrong month. What was
 * wrong is the DATE ON THE RECORD, which is what somebody is answering when
 * they are asked three months later when the money went out.
 *
 * ---------------------------------------------------------------------------
 * ONE ANSWER, BECAUSE THERE WERE EIGHTY.
 *
 * The server, the browser and the single-file build all read this, the same
 * reasoning as `localStamp` in punchClock.js and `shiftTimesFor` in
 * lateEarly.js: a rule written out in three places is how three screens come
 * to disagree. It takes `now` so a test can pin a moment.
 *
 * WHAT IS DELIBERATELY NOT CHANGED: a date read out of a spreadsheet.
 * `assetImport.js`, `employeeSheet.js` and `monthlyStatus.js` turn an Excel
 * serial into a Date at UTC midnight and then render it, which is
 * self-consistent — reading those as local would move every imported date
 * back a day. They are left exactly as they were.
 */

const two = (n) => String(n).padStart(2, '0');

/**
 * Today's calendar date where this is running, as `YYYY-MM-DD`.
 *
 * @param now a moment, for tests; defaults to this one
 */
export const todayIso = (now = new Date()) => isoOf(now);

/**
 * One Date's own calendar date, as `YYYY-MM-DD`, read off the local clock.
 *
 * Use this instead of `.toISOString().slice(0, 10)` for any Date built from
 * local parts or from `Date.now()` — the conversion to UTC is what shifts a
 * day. An invalid Date gives `''` rather than the string `NaN-aN-aN`.
 */
export function isoOf(date) {
  /*
   * Nothing is NOT the epoch. `new Date(null)` is 1 January 1970 and a valid
   * Date, so without this a missing date reads as a real one forty years ago
   * - which on a record is worse than an empty cell. Caught by its own test.
   */
  if (date === null || date === undefined || date === '') return '';
  const at = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(at.getTime())) return '';
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** The local date `days` from now - an expiry, a window, a day either side. */
export const isoPlusDays = (days = 0, now = new Date()) => {
  const at = new Date(now.getTime());
  at.setDate(at.getDate() + Number(days || 0));
  return isoOf(at);
};
