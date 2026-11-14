/**
 * Missing punch and attendance correction requests.
 *
 * Somebody forgot to punch, or the machine missed them, or a day is marked
 * absent that was really leave. Until now the only route was to tell the
 * office and hope somebody edited the grid. This gives it a shape: the
 * employee asks, the office decides, and the decision is on the record.
 *
 * ---------------------------------------------------------------------------
 * The rule this module exists to enforce:
 *
 *   A REQUEST NEVER WRITES ATTENDANCE. AN APPROVAL DOES.
 *
 * Nothing here is auto-approved, however reasonable it looks, and a pending
 * request changes nobody's pay. The same discipline as everywhere else in this
 * app: a calculation can happen by itself, a decision cannot.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, so the server and the dashboard agree on what a request is.
 */

import { ATTENDANCE_CODES } from './calc.js';
import { TIME_FIELDS, parseTime } from './timesheet.js';

export const REQUEST_KINDS = [
  {
    key: 'leave',
    label: 'Leave',
    hint: 'I want days off — casual, sick or privilege leave',
    needs: 'mark',
    // The one kind that can run across days: a fortnight off is one request
    // and one decision, not fourteen.
    span: true,
  },
  {
    key: 'missing_punch',
    label: 'Missing punch',
    hint: 'I was here but the machine has no record',
    needs: 'times',
  },
  {
    key: 'correction',
    label: 'Wrong mark',
    hint: 'the day is marked wrongly — absent when it was leave, say',
    needs: 'mark',
  },
  {
    key: 'regularise',
    label: 'Regularise a day',
    hint: 'both the mark and the hours need fixing',
    needs: 'both',
  },
  /*
   * A few hours off, not the whole day.
   *
   * Dinesh: *"what if employee apply leave for 2 hrs 3 hrs 4 hrs / need
   * deduction for that type of leave"*. The app could already DEDUCT a few
   * hours - that is the minutes column the salary sheet has always paid from -
   * but there was no way for anybody to ASK for them, so it was recorded as a
   * shortfall with no reason beside it.
   *
   * It needs minutes, not a mark and not times: the day stays Present, and
   * only the hours move.
   */
  {
    key: 'short_leave',
    label: 'A few hours off',
    hint: 'two or three hours, not the whole day',
    needs: 'minutes',
  },
  /*
   * Working from home.
   *
   * The WH mark already existed and is paid in full - what was missing is any
   * way to ASK for it, so a remote day could only be arranged by someone in
   * the office remembering to type it.
   *
   * It `needs` nothing. Every other kind asks the employee for something,
   * because only they know it; here the mark is always WH, and offering a
   * picker would just be a chance to choose the wrong one. `writes` says what
   * approving it puts on the day, so the mark is a property of the KIND and
   * not of the request - and the rule still holds, because asking is not
   * getting: nothing reaches the grid until somebody approves it.
   *
   * It spans, like leave: a week at home is one request and one decision.
   */
  {
    key: 'remote',
    label: 'Work from home',
    hint: 'I will be working, away from the office',
    needs: 'none',
    writes: 'WH',
    span: true,
  },
];

/** The shortest and longest a few hours off can sensibly be. */
export const SHORT_LEAVE_MIN_MINUTES = 15;

export const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];

export const kindLabel = (key) => REQUEST_KINDS.find((k) => k.key === key)?.label || key;

const needsOf = (kind) => REQUEST_KINDS.find((k) => k.key === kind)?.needs || 'both';

/**
 * The mark this KIND of request always writes, if it is one of those.
 *
 * Only work-from-home so far. It is held on the kind rather than asked for,
 * because there is exactly one right answer and a picker would only let
 * somebody get it wrong.
 */
export const markOf = (kind) => REQUEST_KINDS.find((k) => k.key === kind)?.writes || '';

/** Whether this kind of request can cover a run of days. */
export const spans = (kind) => Boolean(REQUEST_KINDS.find((k) => k.key === kind)?.span);

/**
 * The days a request covers, in order. A single day for everything but a leave
 * application; `to_day` before `day` is read as a typo and treated as one day
 * rather than silently covering nothing.
 */
export function daysOf(request = {}) {
  const from = Number(request.day);
  if (!Number.isInteger(from)) return [];
  const to = Number(request.to_day);
  if (!spans(request.kind) || !Number.isInteger(to) || to <= from) return [from];
  const days = [];
  for (let d = from; d <= Math.min(to, 31); d++) days.push(d);
  return days;
}

/**
 * Is this request even askable? Shape only — whether it is *right* is the
 * office's call, which is the whole point.
 */
export function validateRequest(request = {}) {
  const problems = [];
  const kind = String(request.kind || '');
  if (!REQUEST_KINDS.some((k) => k.key === kind)) problems.push('pick what kind of request this is');

  const day = Number(request.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) problems.push('pick a day');
  if (!request.period_id) problems.push('a request belongs to a month');

  if (request.to_day !== undefined && request.to_day !== null && request.to_day !== '') {
    const to = Number(request.to_day);
    if (!Number.isInteger(to) || to < 1 || to > 31) problems.push('the last day is not a date');
    else if (!spans(kind)) problems.push(`a ${kindLabel(kind).toLowerCase()} request covers one day`);
    else if (to < day) problems.push('the last day is before the first');
  }

  const needs = needsOf(kind);
  /*
   * A few hours off. More than a working day is a DAY's leave, which is a
   * different request with a different mark and a different quota - so it is
   * refused here rather than quietly deducting a day and a half of hours.
   */
  if (needs === 'minutes') {
    const minutes = Number(request.minutes);
    const dayMinutes = Math.round((Number(request.hours_per_day) || 9) * 60);
    if (!Number.isFinite(minutes) || minutes < SHORT_LEAVE_MIN_MINUTES) {
      problems.push(`say how long — at least ${SHORT_LEAVE_MIN_MINUTES} minutes`);
    } else if (minutes >= dayMinutes) {
      problems.push(
        `that is a whole day or more — apply for leave instead (a day is ${Math.round(dayMinutes / 60)} hours)`
      );
    }
  }
  if (needs === 'times' || needs === 'both') {
    const any = TIME_FIELDS.some((f) => parseTime(request[f]) !== null);
    if (!any && needs === 'times') problems.push('give at least one time');
  }
  if (needs === 'mark' || needs === 'both') {
    if (request.code && !ATTENDANCE_CODES[request.code]) problems.push(`unknown mark: ${request.code}`);
    if (needs === 'mark' && !request.code) problems.push('pick what the day should be');
  }
  if (!String(request.reason || '').trim()) problems.push('say why — the office has to decide on something');

  return { ok: problems.length === 0, problems };
}

/**
 * What approving this request would write onto the grid.
 *
 * Only the fields the request actually names: approving "I was in at 9:30"
 * must not blank a lunch somebody else typed, which is the same merge rule
 * `setAttendance` already follows.
 */
export function entryFor(request = {}, day = Number(request.day), stored = null) {
  const entry = { employee_id: Number(request.employee_id), day: Number(day) };
  const needs = needsOf(request.kind);

  /*
   * A few hours off, and THE RULE THAT MATTERS: it must never charge the same
   * hours twice.
   *
   * The app already deducts a shortfall worked out from the clock - out minus
   * in minus lunch against the day's expected hours - so somebody who left
   * three hours early is ALREADY three hours short there. Writing another 180
   * minutes on top would dock the afternoon twice, which is the same trap the
   * late/early concession was built around.
   *
   * So: the minutes are written only when nothing else is accounting for the
   * day. Where the day carries clock times, those hours stand and the approval
   * records WHY they are short - which is what was missing, not the deduction.
   * `charged` says which happened, so the decision can say so out loud.
   */
  if (needs === 'minutes') {
    const minutes = Math.round(Number(request.minutes) || 0);
    const clocked = stored
      ? TIME_FIELDS.some((f) => String(stored[f] || '').trim() !== '')
      : false;
    if (minutes > 0 && !clocked) entry.minutes = -minutes;
    entry.short_leave_charged = minutes > 0 && !clocked;
  }

  /*
   * A kind that always writes the same mark writes it here, whatever the
   * request happens to carry - a work-from-home request that arrived with
   * `code: 'A'` on it still marks the day WH and nothing else.
   */
  const fixed = markOf(request.kind);
  if (fixed) entry.code = fixed;
  else if ((needs === 'mark' || needs === 'both') && request.code) entry.code = request.code;
  if (needs === 'times' || needs === 'both') {
    for (const field of TIME_FIELDS) {
      if (request[field] === undefined || request[field] === null || request[field] === '') continue;
      entry[field] = request[field];
    }
  }
  /*
   * The reason travels with it, and the day is marked approved.
   *
   * Somebody asking for the day off has already said why; typing it again onto
   * the grid afterwards is how the grid and the queue come to disagree. And a
   * day written BY an approval is approved by definition - it is the one case
   * in the app where that is not a separate judgement.
   */
  const why = String(request.reason || '').trim();
  if (why) entry.reason = why;
  entry.approved = true;
  return entry;
}

/**
 * Everything approving this request would write - one entry per day it covers.
 *
 * Clock times are deliberately NOT repeated across a span: "in at 9:30" on a
 * fortnight of leave is meaningless, and a leave request only ever names a
 * mark anyway.
 */
export function entriesFor(request = {}, { storedOf } = {}) {
  return daysOf(request).map((day) =>
    entryFor(request, day, storedOf ? storedOf(day) : null)
  );
}

/** "2h 30m", the way somebody asking for a few hours off would say it. */
export function describeMinutes(minutes) {
  const total = Math.abs(Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!total) return '0m';
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A one-line summary for the approval list, so nobody has to open each one. */
export function describe(request = {}) {
  const bits = [];
  const days = daysOf(request);
  if (days.length > 1) bits.push(`days ${days[0]}\u2013${days[days.length - 1]} (${days.length} days)`);
  const mark = markOf(request.kind) || request.code;
  if (mark) bits.push(`mark it ${ATTENDANCE_CODES[mark]?.label || mark}`);
  if (request.kind === 'short_leave' && request.minutes) {
    bits.push(`${describeMinutes(request.minutes)} off`);
  }
  const times = TIME_FIELDS.filter((f) => request[f]).map((f) => `${f.replace('_', ' ')} ${request[f]}`);
  if (times.length) bits.push(times.join(', '));
  return bits.join(' · ') || 'no change named';
}

/**
 * Whether a decision may be made. A month that is locked is closed, and a
 * request already decided is not re-decidable - a second approval would write
 * the grid twice and leave two entries in the history saying different things.
 */
export function canDecide(request, { periodLocked = false } = {}) {
  if (!request) return { ok: false, reason: 'not found' };
  if (request.status !== 'pending') {
    return { ok: false, reason: `this was already ${request.status}` };
  }
  if (periodLocked) return { ok: false, reason: 'that month is locked' };
  return { ok: true, reason: '' };
}

/** Oldest first: the one that has been waiting longest is the one to answer. */
export const sortForReview = (requests = []) =>
  [...requests].sort(
    (a, b) =>
      Number(a.status !== 'pending') - Number(b.status !== 'pending') ||
      String(a.created_at).localeCompare(String(b.created_at))
  );
