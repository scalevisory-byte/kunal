import { Router } from 'express';
import { actorOf, clearSessionCookie, makeSession, requireAbility, setSessionCookie, wideOpen } from '../auth.js';
import {
  ROLES,
  countUsers,
  createFirstAdmin,
  createUser,
  deleteUser,
  getUser,
  listLogins,
  listUsers,
  setPassword,
  signIn,
  updateUser,
} from '../users.js';
import { log } from '../logger.js';
import { backupDirectory, backupFile, listBackups, pruneBackups, takeBackup } from '../backup.js';

/*
 * Signing in, and managing who can.
 *
 * `/api/auth/state`, `/api/auth/setup` and `/api/auth/login` are the only three
 * that can be reached without being signed in, and `setup` closes itself the
 * moment the first login exists.
 */
export const authRouter = Router();

/*
 * This router is mounted WITHOUT requireAuth, because `state`, `setup` and
 * `login` have to be reachable by somebody who is not signed in. So it resolves
 * the actor itself and lets each route decide: `requireAbility` below then has
 * something to read, which it did not when this was first wired up - every
 * admin call came back 401 with a perfectly good cookie attached.
 */
authRouter.use((req, _res, next) => {
  req.actor = actorOf(req) || undefined;
  next();
});

const bad = (res, err) => res.status(400).json({ error: err.message });
const where = (req) => ({
  ip: req.ip,
  agent: req.get('user-agent') || '',
});

/** What the login screen needs to know before anybody has typed anything. */
authRouter.get('/state', (req, res) => {
  const actor = actorOf(req);
  res.json({
    // No logins at all yet: the browser should offer to make the first admin.
    needs_setup: countUsers() === 0,
    // Nothing guarding this installation. Said out loud rather than hidden.
    open: wideOpen(),
    roles: ROLES,
    signed_in: actor
      ? {
          id: actor.id,
          name: actor.name,
          username: actor.username,
          role: actor.role,
          abilities: actor.abilities,
          must_change: actor.must_change,
          via: actor.via,
        }
      : null,
  });
});

/** The first admin. Only possible while there are no users at all. */
authRouter.post('/setup', (req, res) => {
  try {
    const user = createFirstAdmin(req.body || {});
    const token = makeSession(user.id);
    setSessionCookie(res, token);
    log.info(`First admin created: ${user.username}`);
    res.status(201).json({ user });
  } catch (err) {
    bad(res, err);
  }
});

authRouter.post('/login', (req, res) => {
  const user = signIn({ ...(req.body || {}), ...where(req) });
  if (!user) {
    // One message for both a wrong name and a wrong password, so this cannot be
    // used to find out which logins exist.
    return res.status(401).json({ error: 'that username and password do not match' });
  }
  setSessionCookie(res, makeSession(user.id));
  res.json({ user });
});

authRouter.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Changing your own password. Needs the current one unless you were reset. */
authRouter.post('/password', (req, res) => {
  const actor = actorOf(req);
  if (!actor?.id) {
    return res.status(401).json({ error: 'sign in first' });
  }
  try {
    res.json({ user: setPassword(actor.id, { ...(req.body || {}), byAdmin: false }) });
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- managing logins (admin only) ---------------- */

authRouter.get('/users', requireAbility('admin'), (_req, res) => {
  res.json({ users: listUsers(), roles: ROLES });
});

authRouter.post('/users', requireAbility('admin'), (req, res) => {
  try {
    res.status(201).json(createUser(req.body || {}));
  } catch (err) {
    bad(res, err);
  }
});

authRouter.patch('/users/:id', requireAbility('admin'), (req, res) => {
  try {
    res.json(updateUser(Number(req.params.id), req.body || {}));
  } catch (err) {
    bad(res, err);
  }
});

/**
 * An admin resetting somebody's password. It does not need their old one, and
 * it forces a change at their next login so the admin does not keep knowing it.
 */
authRouter.post('/users/:id/password', requireAbility('admin'), (req, res) => {
  try {
    res.json(setPassword(Number(req.params.id), { ...(req.body || {}), byAdmin: true }));
  } catch (err) {
    bad(res, err);
  }
});

authRouter.delete('/users/:id', requireAbility('admin'), (req, res) => {
  try {
    const user = getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: deleteUser(user.id) });
  } catch (err) {
    bad(res, err);
  }
});

/* ---------------- backups (admin only) ---------------- */

authRouter.get('/backups', requireAbility('admin'), (_req, res) => {
  res.json({ backups: listBackups(), folder: backupDirectory() });
});

/** Take one now, without waiting for the daily run. */
authRouter.post('/backups', requireAbility('admin'), (_req, res) => {
  try {
    const made = takeBackup();
    pruneBackups();
    res.status(201).json({ backup: { name: made.name, size: made.size, at: made.at } });
  } catch (err) {
    bad(res, err);
  }
});

/** Download one, so a copy can leave the machine. */
authRouter.get('/backups/:name', requireAbility('admin'), (req, res) => {
  const file = backupFile(req.params.name);
  if (!file) return res.status(404).json({ error: 'not found' });
  res.download(file, req.params.name);
});

authRouter.get('/logins', requireAbility('admin'), (req, res) => {
  const ok = req.query.ok === 'true' ? true : req.query.ok === 'false' ? false : undefined;
  res.json({ logins: listLogins({ limit: req.query.limit, ok }) });
});
