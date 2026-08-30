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
