import crypto from 'node:crypto';
import { config } from './config.js';
import { log } from './logger.js';

export const authEnabled = Boolean(config.dashboardPassword);

if (!authEnabled) {
  log.warn(
    'DASHBOARD_PASSWORD is not set — the API is open to anyone who can reach it. ' +
      'Set it before exposing this service on the public internet.'
  );
}

/* ---------------- brute-force lockout ---------------- */

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const SWEEP_MS = 10 * 60 * 1000;

/** ip -> { failures, firstFailureAt, lockedUntil } */
const attempts = new Map();

// Without this the map grows forever on a long-running server.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) {
    const stale = now - rec.firstFailureAt > WINDOW_MS;
    const unlocked = !rec.lockedUntil || rec.lockedUntil < now;
    if (stale && unlocked) attempts.delete(ip);
  }
}, SWEEP_MS);
sweeper.unref?.();

function clientIp(req) {
  // Railway and most hosts sit behind a proxy; server.js sets `trust proxy`
  // so req.ip is the caller rather than the load balancer.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function lockoutRemaining(ip) {
  const rec = attempts.get(ip);
  if (!rec?.lockedUntil) return 0;
  const left = rec.lockedUntil - Date.now();
  return left > 0 ? left : 0;
}

function recordFailure(ip) {
  const now = Date.now();
  let rec = attempts.get(ip);
  if (!rec || now - rec.firstFailureAt > WINDOW_MS) {
    rec = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    attempts.set(ip, rec);
  }
  rec.failures += 1;
  if (rec.failures >= MAX_FAILURES) {
    rec.lockedUntil = now + LOCKOUT_MS;
    log.warn(`Auth: ${ip} locked out for 15 min after ${rec.failures} failed attempts.`);
  }
  return rec;
}

function clearFailures(ip) {
  attempts.delete(ip);
}

/** Exposed for /api/status so the dashboard can show whether anyone is knocking. */
export function authStats() {
  let locked = 0;
  let failing = 0;
  for (const rec of attempts.values()) {
    if (rec.lockedUntil > Date.now()) locked += 1;
    else if (rec.failures > 0) failing += 1;
  }
  return { lockedOut: locked, failingAddresses: failing };
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length alone must not leak, so compare digests of equal length.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** Bearer-token gate. A no-op when DASHBOARD_PASSWORD is unset (local single-user use). */
export function requireAuth(req, res, next) {
  if (!authEnabled) return next();

  const ip = clientIp(req);
  const remaining = lockoutRemaining(ip);
  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    res.set('Retry-After', String(seconds));
    return res.status(429).json({ error: 'too many attempts', retryAfterSeconds: seconds });
  }

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (token && timingSafeEqual(token, config.dashboardPassword)) {
    clearFailures(ip);
    return next();
  }

  const rec = recordFailure(ip);
  log.warn(`Auth: failed attempt from ${ip} (${rec.failures}/${MAX_FAILURES}) on ${req.method} ${req.originalUrl}`);
  return res.status(401).json({ error: 'unauthorized' });
}

/** Test hook — lets a suite start from a clean slate. */
export function resetAuthAttempts() {
  attempts.clear();
}
