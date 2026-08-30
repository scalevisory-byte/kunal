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

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Bearer-token gate. A no-op when DASHBOARD_PASSWORD is unset (local single-user use). */
export function requireAuth(req, res, next) {
  if (!authEnabled) return next();

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token && timingSafeEqual(token, config.dashboardPassword)) return next();

  return res.status(401).json({ error: 'unauthorized' });
}
