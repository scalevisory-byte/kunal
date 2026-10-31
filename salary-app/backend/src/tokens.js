import crypto from 'node:crypto';
import { config } from './config.js';
import { log } from './logger.js';

/*
 * Short-lived signed tokens for the public side, where there is no password to
 * ask for. A token says one thing - "whoever holds this may act on candidate
 * 41 / application 12 until 14:05" - and says it in a way the server can check
 * without storing anything.
 *
 * Used for two things: letting a candidate come back and attach a CV after a
 * quick apply, and letting Dinesh's own test system post a score back.
 */

const secret =
  config.linkSecret ||
  (() => {
    log.warn('LINK_SECRET is not set - apply and test-callback tokens break on restart.');
    return crypto.randomBytes(32).toString('hex');
  })();

const sign = (body) => crypto.createHmac('sha256', secret).update(body).digest('base64url');

/** `purpose` keeps an upload token from being usable as a test-result token. */
export function makeToken(purpose, payload, { minutes = 120 } = {}) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, minutes) * 60;
  const body = Buffer.from(JSON.stringify({ ...payload, p: purpose, exp })).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The payload, or null for anything tampered with, expired or of the wrong kind. */
export function readToken(purpose, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.p !== purpose) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
