import { config } from './config.js';

/** Today as YYYY-MM-DD in the configured timezone. */
export function today(tz = config.timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** e.g. "Saturday, 30 August 2026" in the configured timezone. */
export function todayLong(tz = config.timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * An exact moment, as UTC. A string that already carries a zone is kept as it
 * is; a bare wall-clock time ("2026-09-06T12:30") is read in the *user's*
 * timezone rather than the server's, which on a cloud host is UTC and would
 * silently move every deadline. The dashboard and both extractors already send
 * a zoned instant - this is what keeps a direct API call honest.
 */
export function normalizeInstant(value, tz = config.timezone) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (HAS_ZONE.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (!m) return null;
  if (!normalizeDueDate(m[1])) return null;
  const [, day, hh, mm, ss = '00'] = m;
  const guess = new Date(`${day}T${hh}:${mm}:${ss}Z`);
  if (Number.isNaN(guess.getTime())) return null;
  // How far the zone runs from UTC at that moment, subtracted to get the instant.
  const offsetMs = new Date(guess.toLocaleString('en-US', { timeZone: tz })).getTime()
    - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

/** Accept only well-formed, real calendar dates; anything else becomes null. */
export function normalizeDueDate(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) return null;
  const [y, m, d] = trimmed.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return trimmed;
}

/** Negative = overdue by n days, 0 = today, positive = n days away. */
export function daysUntil(dueDate, tz = config.timezone) {
  const from = Date.parse(`${today(tz)}T00:00:00Z`);
  const to = Date.parse(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}
