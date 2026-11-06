import crypto from 'node:crypto';
import { config } from './config.js';
import { abilitiesOf, countUsers, getUser, sessionSecret } from './users.js';

/*
 * Who is asking, and what they may do.
 *
 * Two ways in, on purpose:
 *
 *   A SESSION    somebody signed in with a username and password. The cookie
 *                carries a signed user id and nothing else; the role is read
 *                from the database on every request, so demoting somebody takes
 *                effect at once rather than when their cookie expires.
 *
 *   THE API KEY  `APP_PASSWORD` as a Bearer token, which is how this app has
 *                always been reached and how the reminder digest is fetched by
 *                anything on a schedule. It is full access, and it is now
 *                described as what it is: a key for machines, not a login for a
 *                person. It leaves no name behind, so the audit trail records
 *                it as "the API key" rather than inventing somebody.
 *
 * With neither, and no password set and no users created, the app is open - see
 * the guard in index.js, which refuses to start that way unless it was asked
 * for deliberately.
 */

const COOKIE = 'salary_session';
const SESSION_DAYS = 14;

const sign = (body) => crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');

export function makeSession(userId) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const body = Buffer.from(JSON.stringify({ u: userId, exp })).toString('base64url');
  return `${body}.${sign(body)}`;
}

function readSession(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookies without a parser - there is exactly one we care about. */
function cookieOf(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function setSessionCookie(res, token) {
  const bits = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  // Only over https, because a Secure cookie on a plain-http address is a
  // cookie the browser silently drops - which reads as "login does not work".
  if (config.secureCookies) bits.push('Secure');
  res.append('set-cookie', bits.join('; '));
}

export function clearSessionCookie(res) {
  res.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Whoever is making this request, or null. */
export function actorOf(req) {
  const session = readSession(cookieOf(req, COOKIE));
  if (session?.u) {
    const user = getUser(session.u);
    // Read the role fresh every time: a demotion or a switched-off login must
    // take effect now, not in a fortnight when the cookie runs out.
    if (user && user.active) {
      return {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        abilities: user.abilities,
        must_change: user.must_change,
        // Which person this login IS, for a staff login. Read fresh with the
        // role, for the same reason: it is the whole of their authority.
        employee_id: user.employee_id ?? null,
        employee_name: user.employee_name ?? null,
        via: 'session',
      };
    }
  }

  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (config.appPassword && bearer === config.appPassword) {
    return {
      id: null,
      name: 'the API key',
      username: null,
      role: 'admin',
      abilities: abilitiesOf('admin'),
      must_change: false,
      via: 'api-key',
    };
  }

  return null;
}

/** True when nothing is guarding this installation at all. */
export const wideOpen = () => !config.appPassword && countUsers() === 0;

/**
 * Attaches `req.actor` and refuses when there is nobody.
 *
 * An installation with no password AND no users is open, exactly as it always
 * was, so a laptop still works with nothing configured. index.js refuses to
 * start that way unless ALLOW_OPEN=true.
 */
export function requireAuth(req, res, next) {
  const actor = actorOf(req);
  if (actor) {
    req.actor = actor;
    return next();
  }
  if (wideOpen()) {
    req.actor = {
      id: null,
      name: 'nobody (open)',
      username: null,
      role: 'admin',
      abilities: abilitiesOf('admin'),
      must_change: false,
      via: 'open',
    };
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}

/**
 * Requires an ability on top of being signed in.
 *
 * Enforced here, on the server, rather than by hiding buttons: a Viewer who
 * knows the URL still cannot write, and that is the only version of this that
 * means anything.
 */
export function requireAbility(ability) {
  return (req, res, next) => {
    const actor = req.actor;
    if (!actor) return res.status(401).json({ error: 'unauthorized' });
    if (!actor.abilities.includes(ability)) {
      return res.status(403).json({
        error:
          ability === 'admin'
            ? 'that is an admin’s to change'
            : 'your login can look at this but not change it',
        need: ability,
        role: actor.role,
      });
    }
    return next();
  };
}

/**
 * A plain read passes; anything that changes something needs the ability named.
 *
 * One line instead of a tag on every route, so it cannot be forgotten on a
 * route added later. Reads are deliberately NOT gated beyond being signed in:
 * the company list is needed on every screen in the app, so locking reads
 * behind `admin` would break the filter and the employee form for HR.
 */
export const requireForChanges = (ability) => (req, res, next) =>
  req.method === 'GET' || req.method === 'HEAD'
    ? next()
    : requireAbility(ability)(req, res, next);

/** Anything that is not a plain read needs `write`. */
export const requireWriteForChanges = requireForChanges('write');

/** Reads for anybody signed in; changes are an admin's. */
export const requireAdminForChanges = requireForChanges('admin');

/**
 * The staff side: a login that IS somebody.
 *
 * Deliberately not an ability check. An office login may also be tied to an
 * employee row - Dinesh looking at his own payslip - and a staff login has no
 * `read` at all, so neither "has self" nor "has read" is the question. The
 * question is: whose payslip would this be? `req.employeeId` is the answer,
 * and every route under /api/me reads only that.
 */
export function requireSelf(req, res, next) {
  const actor = req.actor;
  if (!actor) return res.status(401).json({ error: 'unauthorized' });
  const id = Number(actor.employee_id) || null;
  if (!id) {
    return res.status(403).json({
      error:
        'This login is not tied to an employee, so there is no “my salary” to show. ' +
        'An admin can link it on the Admin tab.',
    });
  }
  req.employeeId = id;
  return next();
}

/**
 * The office side needs `read`.
 *
 * It used to need only a signed-in session, which was fine while every login
 * was an office login. A staff login would have been able to fetch the whole
 * payroll through any GET, so the gate is explicit now.
 */
export const requireRead = requireAbility('read');
