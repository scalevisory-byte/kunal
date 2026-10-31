/**
 * Punching in and out from a phone, and the fence around where that counts.
 *
 * The biometric machine is still the main source — this is for the people the
 * machine cannot see: somebody at a client's office, a driver, a site
 * supervisor, or a day the device was down.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT do, and why
 *
 * A punch outside the fence is **recorded and flagged, never refused**. Refusing
 * it means the person who really was at a client's office has no attendance at
 * all, and somebody retypes it by hand that evening with no record of what
 * actually happened. A flag can be looked at; a missing row cannot.
 *
 * Nor does this pretend to stop buddy punching. A link can be forwarded and a
 * phone can be handed over. The fence narrows it, the log makes it visible, and
 * that is the honest limit of punching from a phone.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, so the server and the dashboard judge a punch identically.
 */

import { TIME_RULES, formatTime, parseTime } from './timesheet.js';

export const PUNCH_KINDS = ['in', 'out'];

export const PUNCH_RULES = {
  // How far from the office still counts as "at the office". Phone GPS is
  // comfortably worse than this indoors, which is why it is not 50.
  fenceMetres: 200,
  // A fix vaguer than this is treated as "location not known" rather than as
  // evidence of being somewhere - a 2 km accuracy circle proves nothing.
  maxAccuracyMetres: 500,
};

/* ---------------- how far apart two points are ---------------- */

const R = 6371000; // the Earth, in metres
const rad = (deg) => (Number(deg) * Math.PI) / 180;

/** Haversine. Good to a metre or so at these distances, which is plenty. */
export function distanceMetres(a, b) {
  if (!a || !b) return null;
  const [lat1, lon1, lat2, lon2] = [a.lat, a.lng, b.lat, b.lng].map(Number);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;

  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Which office a punch was at, if any.
 *
 * Returns the nearest one whatever the distance, so a punch 3 km away says
 * "3 km from the Alkapuri office" rather than "nowhere".
 */
export function nearestOffice(point, offices = [], rules = {}) {
  const { fenceMetres } = { ...PUNCH_RULES, ...(rules || {}) };
  if (!point || !offices.length) return null;

  let best = null;
  for (const office of offices) {
    const metres = distanceMetres(point, office);
    if (metres === null) continue;
    if (!best || metres < best.metres) best = { office, metres };
  }
  if (!best) return null;

  const radius = Number(best.office.radius_m) || fenceMetres;
  return { ...best, radius, inside: best.metres <= radius };
}

/**
 * What to make of one punch: where it was, whether that is inside a fence, and
 * whether the fix is good enough to mean anything.
 */
export function judgePunch({ point, accuracy, offices = [] } = {}, rules = {}) {
  const settings = { ...PUNCH_RULES, ...(rules || {}) };
  const hasFix = !!point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
  const vague = hasFix && Number(accuracy) > settings.maxAccuracyMetres;

  if (!hasFix) {
    return {
      located: false,
      vague: false,
      office_id: null,
      distance_m: null,
      inside_fence: null,
      note: 'location not shared',
    };
  }

  const near = nearestOffice(point, offices, settings);
  if (!near) {
    return {
      located: true,
      vague,
      office_id: null,
      distance_m: null,
      inside_fence: null,
      note: offices.length ? 'no office within reach' : 'no office locations set',
    };
  }

  return {
    located: true,
    vague,
    office_id: near.office.id ?? null,
    office_name: near.office.name,
    distance_m: near.metres,
    // A vague fix cannot say somebody was inside; it can only fail to say so.
    inside_fence: vague ? null : near.inside,
    note: vague
      ? `location only accurate to ${Math.round(Number(accuracy))} m`
      : near.inside
        ? `at ${near.office.name}`
        : `${formatDistance(near.metres)} from ${near.office.name}`,
  };
}

export const formatDistance = (metres) =>
  metres === null || metres === undefined
    ? ''
    : metres < 1000
      ? `${metres} m`
      : `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;

/* ---------------- turning punches into a day ---------------- */

const minutesOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
};

/**
 * The day's in and out from however many punches there were.
 *
 * The earliest counts as the arrival and the latest as the departure, exactly
 * as the biometric import does — somebody who steps out for lunch and punches
 * four times should read the same either way.
 *
 * Returns the two clock times as strings, for the SAME `in_time`/`out_time`
 * columns the Time tab writes, so a phone punch and a typed time are worth the
 * same money with nothing else touched.
 */
export function punchesToDay(punches = []) {
  const stamps = punches
    .map((p) => ({ ...p, minutes: minutesOf(p.at) }))
    .filter((p) => p.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  if (!stamps.length) return null;

  const ins = stamps.filter((p) => p.kind === 'in');
  const outs = stamps.filter((p) => p.kind === 'out');

  // Fall back to first and last of anything when somebody only ever taps one
  // button - half a record is better than none, and the office can see it.
  const first = (ins[0] || stamps[0]).minutes;
  const last = (outs.at(-1) || stamps.at(-1)).minutes;

  return {
    in_time: formatTime(first),
    out_time: last > first ? formatTime(last) : '',
    punches: stamps.length,
    // Anything the office should look at before trusting the day.
    flags: [
      !ins.length && 'never punched in',
      !outs.length && 'never punched out',
      stamps.some((p) => p.inside_fence === 0 || p.inside_fence === false) && 'punched away from the office',
      stamps.some((p) => p.inside_fence === null && p.located) && 'location too vague to place',
      stamps.some((p) => !p.located) && 'location not shared',
    ].filter(Boolean),
  };
}

/** Did they already punch in and not out? Drives which button the phone shows. */
export function nextKind(todaysPunches = []) {
  const last = [...todaysPunches].sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1);
  return last?.kind === 'in' ? 'out' : 'in';
}

/* ---------------- what the office allows ---------------- */

export const DEFAULT_RESTRICTIONS = {
  // Punching from a phone at all. Off until somebody turns it on.
  enabled: false,
  // Require a location before a punch is accepted at all.
  requireLocation: true,
  // Record-and-flag rather than refuse. See the note at the top of this file.
  allowOutsideFence: true,
  fenceMetres: PUNCH_RULES.fenceMetres,
};

/**
 * Whether a punch may be recorded. The only hard refusals are the ones that
 * would otherwise store a meaningless row.
 */
export function punchAllowed(judgement, restrictions = {}) {
  const rules = { ...DEFAULT_RESTRICTIONS, ...(restrictions || {}) };
  if (!rules.enabled) {
    return { ok: false, reason: 'Punching from a phone is switched off. Ask the office.' };
  }
  if (rules.requireLocation && !judgement.located) {
    return {
      ok: false,
      reason: 'Your location is needed to punch. Allow location access and try again.',
    };
  }
  if (!rules.allowOutsideFence && judgement.inside_fence === false) {
    return { ok: false, reason: `You are ${formatDistance(judgement.distance_m)} from the office.` };
  }
  return { ok: true, reason: '' };
}

export { TIME_RULES, parseTime };
