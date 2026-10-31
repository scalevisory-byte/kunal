import { config } from './config.js';

/**
 * Bearer token against the single shared secret, for the recruiter side.
 *
 * The public side - viewing an open vacancy and applying to it - never passes
 * through here. That is the whole access model: anybody may apply, only a
 * recruiter may read or move anything.
 */
export function requireAuth(req, res, next) {
  if (!config.appPassword) return next();
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== config.appPassword) return res.status(401).json({ error: 'unauthorized' });
  next();
}
