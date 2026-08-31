import { config } from './config.js';

/** Bearer token against the single shared secret. No secret set = open. */
export function requireAuth(req, res, next) {
  if (!config.appPassword) return next();
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== config.appPassword) return res.status(401).json({ error: 'unauthorized' });
  next();
}
