import crypto from 'node:crypto';
import { db } from './db.js';
import { log } from './logger.js';

/*
 * Logins, roles, and the record of who signed in.
 *
 * Until now this app had one shared password and no users at all: everybody who
 * had it could do everything, and the audit trail had to say honestly that
 * `who` was a name typed on a form rather than anybody the server knew. This
 * module is what lets that caveat come off the page.
 *
 * Deliberately small. No framework, no new dependency: scrypt out of
 * `node:crypto` for the passwords and the signed-token module this project
 * already has for the session. Three roles, because three is what an office of
 * this size needs and a permission matrix nobody maintains is worse than none.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer',
    -- scrypt. The salt is per user and stored beside the hash; neither is a
    -- secret on its own, and the password itself is never stored anywhere.
    salt          TEXT NOT NULL,
    hash          TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    -- Forces a change on next login. Set when an admin resets somebody.
    must_change   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  -- Who signed in, when, and from where. Append-only, and it records the
  -- failures too: ten refusals in a minute is the thing worth seeing.
  CREATE TABLE IF NOT EXISTS login_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL DEFAULT (datetime('now')),
    username  TEXT,
    user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ok        INTEGER NOT NULL DEFAULT 0,
    reason    TEXT,
    ip        TEXT,
    agent     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_login_at ON login_events(at);

  -- Small key/value store for things that belong to the installation rather
  -- than to a month: the session secret, and later the settings screen.
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/**
 * The installation's own settings, as plain key/value.
 *
 * Only for things that belong to the INSTALLATION rather than to a month or a
 * company - today, the public web address. Deliberately not a settings
 * framework: two functions and a table.
 */
export const getSetting = (key) =>
  db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key)?.value ?? null;

export function setSetting(key, value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!text) {
    db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
    return null;
  }
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ key, value: text });
  return text;
}

/* ================================================================= *
 * roles
 * ================================================================= */

/**
 * What each role may do. Three abilities, not a matrix:
 *
 *   read     see anything in the office side
 *   write    create and change operational records - employees, attendance,
 *            leave, payroll figures, assets, the people registers, hiring
 *   admin    users and roles, companies and branches, a month's settings,
 *            closing and reopening a month, and deleting a company or a month
 *
 * Dinesh's decision: **HR can see salaries.** So the line between Admin and HR
 * is not what they can see, it is what they can change about the installation
 * itself. HR runs payroll; Admin decides the rules payroll runs on.
 */
export const ROLES = [
  {
    key: 'admin',
    label: 'Admin',
    abilities: ['read', 'write', 'admin'],
    what: 'Everything, including logins, branches, a month’s settings and closing a month.',
  },
  {
    key: 'hr',
    label: 'HR',
    abilities: ['read', 'write'],
    what: 'Employees, attendance, leave, payroll and assets — salaries included. Cannot change settings or logins.',
  },
  {
    key: 'viewer',
    label: 'Viewer',
    abilities: ['read'],
    what: 'Can look at everything and change nothing.',
  },
];

const ROLE = Object.fromEntries(ROLES.map((r) => [r.key, r]));

export const abilitiesOf = (role) => ROLE[role]?.abilities || [];
export const isRole = (role) => Boolean(ROLE[role]);

/* ================================================================= *
 * passwords
 * ================================================================= */

const KEY_LENGTH = 64;

const hashWith = (password, salt) =>
  crypto.scryptSync(String(password), salt, KEY_LENGTH).toString('hex');

/**
 * What is wrong with a password, if anything. Length only: a rule that demands
 * a symbol and a digit mostly produces `Password1!` on a sticky note.
 */
export function passwordProblem(password) {
  const text = String(password || '');
  if (text.length < 8) return 'a password needs at least 8 characters';
  if (text.length > 200) return 'that is longer than 200 characters';
  return '';
}

/* ================================================================= *
 * the session secret
 * ================================================================= */

/**
 * Kept in the database rather than in an environment variable, so that a
 * restart does not sign everybody out of a self-hosted app nobody configured.
 * Generated once, on first use.
 */
export function sessionSecret() {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'session_secret'`).get();
  if (row?.value) return row.value;
  const made = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('session_secret', ?)`).run(made);
  log.info('Generated a session secret and stored it, so logins survive a restart.');
  return made;
}

/* ================================================================= *
 * users
 * ================================================================= */

const publicUser = (row) =>
  row && {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    must_change: Boolean(row.must_change),
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    abilities: abilitiesOf(row.role),
  };

export const countUsers = () => db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;

export const getUser = (id) => publicUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(id));

export const listUsers = () =>
  db.prepare(`SELECT * FROM users ORDER BY active DESC, name`).all().map(publicUser);

const tidyName = (v) => String(v || '').trim();
const tidyUsername = (v) => String(v || '').trim().toLowerCase();

export function createUser({ username, name, password, role = 'viewer' } = {}) {
  const user = tidyUsername(username);
  if (!/^[a-z0-9._-]{3,40}$/.test(user)) {
    throw new Error('a username is 3-40 characters: letters, numbers, dot, dash or underscore');
  }
  if (!tidyName(name)) throw new Error('what is their name?');
  if (!isRole(role)) throw new Error(`unknown role: ${role}`);
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(user)) {
    throw new Error(`there is already a login called ${user}`);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const id = db
    .prepare(
      `INSERT INTO users (username, name, role, salt, hash) VALUES (?, ?, ?, ?, ?)`
    )
    .run(user, tidyName(name), role, salt, hashWith(password, salt)).lastInsertRowid;
  return getUser(id);
}

export function updateUser(id, patch = {}) {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!row) throw new Error('not found');

  const fields = [];
  const values = [];
  if ('name' in patch) {
    if (!tidyName(patch.name)) throw new Error('what is their name?');
    fields.push('name = ?');
    values.push(tidyName(patch.name));
  }
  if ('role' in patch) {
    if (!isRole(patch.role)) throw new Error(`unknown role: ${patch.role}`);
    // The last active admin cannot demote themselves out of existence - there
    // would then be nobody who could create one.
    if (row.role === 'admin' && patch.role !== 'admin' && lastAdmin(row.id)) {
      throw new Error('this is the only admin left - make somebody else an admin first');
    }
    fields.push('role = ?');
    values.push(patch.role);
  }
  if ('active' in patch) {
    const next = patch.active ? 1 : 0;
    if (!next && row.role === 'admin' && lastAdmin(row.id)) {
      throw new Error('this is the only admin left - make somebody else an admin first');
    }
    fields.push('active = ?');
    values.push(next);
  }
  if (!fields.length) return getUser(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getUser(id);
}

/** True when this is the only admin anybody could still sign in as. */
function lastAdmin(exceptId) {
  const n = db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?`)
    .get(exceptId).n;
  return n === 0;
}

/**
 * Set a password. `current` is required when somebody is changing their own and
 * is not being forced to; an admin resetting somebody else's does not need it,
 * and the reset forces a change on next login.
 */
export function setPassword(id, { password, current, byAdmin = false } = {}) {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!row) throw new Error('not found');
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  if (!byAdmin) {
    if (!row.must_change && !verify(row, current)) throw new Error('that is not the current password');
    if (verify(row, password)) throw new Error('that is the password you already have');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(`UPDATE users SET salt = ?, hash = ?, must_change = ? WHERE id = ?`).run(
    salt,
    hashWith(password, salt),
    byAdmin ? 1 : 0,
    id
  );
  return getUser(id);
}

export function deleteUser(id) {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!row) return false;
  if (row.role === 'admin' && lastAdmin(row.id)) {
    throw new Error('this is the only admin left - make somebody else an admin first');
  }
  return db.prepare(`DELETE FROM users WHERE id = ?`).run(id).changes > 0;
}

/** Constant-time compare, so a wrong password cannot be timed character by character. */
function verify(row, password) {
  if (!row || !password) return false;
  const given = Buffer.from(hashWith(password, row.salt), 'hex');
  const stored = Buffer.from(row.hash, 'hex');
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

/* ================================================================= *
 * signing in
 * ================================================================= */

export function recordLogin({ username, user_id = null, ok, reason = null, ip, agent }) {
  try {
    db.prepare(
      `INSERT INTO login_events (username, user_id, ok, reason, ip, agent)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      username ? String(username).slice(0, 80) : null,
      user_id,
      ok ? 1 : 0,
      reason,
      ip ? String(ip).slice(0, 60) : null,
      agent ? String(agent).slice(0, 200) : null
    );
  } catch (err) {
    // A login must not fail because its log line would not fit.
    log.error(`Could not record the login: ${err.message}`);
  }
}

/**
 * Check a username and password.
 *
 * Every outcome is recorded, the refusals included: it is the ten refusals in a
 * minute that are worth seeing. The message back is always the same whether the
 * username was wrong or the password was, so it cannot be used to find out
 * which names exist.
 */
export function signIn({ username, password, ip, agent } = {}) {
  const user = tidyUsername(username);
  const row = db.prepare(`SELECT * FROM users WHERE username = ?`).get(user);

  if (!row || !row.active || !verify(row, password)) {
    recordLogin({
      username: user,
      user_id: row?.id || null,
      ok: false,
      reason: !row ? 'no such login' : !row.active ? 'login is switched off' : 'wrong password',
      ip,
      agent,
    });
    return null;
  }

  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id);
  recordLogin({ username: user, user_id: row.id, ok: true, ip, agent });
  return getUser(row.id);
}

export function listLogins({ limit = 200, ok } = {}) {
  const where = ok === true ? 'WHERE ok = 1' : ok === false ? 'WHERE ok = 0' : '';
  return db
    .prepare(`SELECT * FROM login_events ${where} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(Math.min(1000, Number(limit) || 200))
    .map((row) => ({ ...row, ok: Boolean(row.ok) }));
}

/**
 * The very first admin, creatable only while there are no users at all.
 *
 * This is the one unauthenticated write in the whole office side. It closes the
 * moment it is used, so it cannot be used twice.
 */
/**
 * Creating the first admin signs them in, so record it as a sign-in. Without
 * this the login list says "never" for somebody who is plainly looking at it.
 */
export function noteFirstSignIn(id, { ip, agent } = {}) {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!row) throw new Error('not found');
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(id);
  recordLogin({ username: row.username, user_id: id, ok: true, reason: 'first admin created', ip, agent });
  return getUser(id);
}

export function createFirstAdmin(input = {}) {
  if (countUsers() > 0) throw new Error('there are already logins - ask an admin to add you');
  return createUser({ ...input, role: 'admin' });
}
