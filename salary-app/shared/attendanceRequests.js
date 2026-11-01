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
];

export const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];

export const kindLabel = (key) => REQUEST_KINDS.find((k) => k.key === key)?.label || key;

const needsOf = (kind) => REQUEST_KINDS.find((k) => k.key === kind)?.needs || 'both';

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
export function entryFor(request = {}, day = Number(request.day)) {
  const entry = { employee_id: Number(request.employee_id), day: Number(day) };
  const needs = needsOf(request.kind);

  if ((needs === 'mark' || needs === 'both') && request.code) entry.code = request.code;
  if (needs === 'times' || needs === 'both') {
    for (const field of TIME_FIELDS) {
      if (request[field] === undefined || request[field] === null || request[field] === '') continue;
      entry[field] = request[field];
    }
  }
  return entry;
}

/**
 * Everything approving this request would write - one entry per day it covers.
 *
 * Clock times are deliberately NOT repeated across a span: "in at 9:30" on a
 * fortnight of leave is meaningless, and a leave request only ever names a
 * mark anyway.
 */
export function entriesFor(request = {}) {
  return daysOf(request).map((day) => entryFor(request, day));
}

/** A one-line summary for the approval list, so nobody has to open each one. */
export function describe(request = {}) {
  const bits = [];
  const days = daysOf(request);
  if (days.length > 1) bits.push(`days ${days[0]}\u2013${days[days.length - 1]} (${days.length} days)`);
  if (request.code) bits.push(`mark it ${ATTENDANCE_CODES[request.code]?.label || request.code}`);
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
