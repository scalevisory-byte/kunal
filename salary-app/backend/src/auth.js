import { areaLabel, may, withoutPay } from '../../shared/rights.js';
import crypto from 'node:crypto';
import { config } from './config.js';
import { abilitiesOf, countUsers, getSetting, getUser, sessionSecret, setSetting } from './users.js';

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

/**
 * SIGNED OUT AFTER DOING NOTHING FOR A WHILE.
 *
 * Dinesh: *"agar ek bar login kiya hua to kabhi logout nahi hota auto"*. The
 * cookie ran for a fortnight and nothing shortened it, so a browser left
 * open at the front desk stayed signed in all month - and that desk is the
 * one machine in the building strangers stand in front of.
 *
 * ENFORCED ON THE SERVER, not by a timer in the browser. A timer that logs
 * you out is a convenience; a session the server stops honouring is the
 * rule. The clock is kept in the signed cookie itself, so nothing new has
 * to be stored and no session table has to be swept.
 *
 * `0` switches it off deliberately - some offices want the long one, and a
 * setting that cannot say "off" gets worked around by never signing out.
 */
const IDLE_DEFAULT = 60;
const IDLE_KEY = 'session_idle_minutes';

export function idleMinutes() {
  const saved = getSetting(IDLE_KEY);
  const stored = saved === null ? NaN : Number(saved);
  const fromEnv = Number(process.env.SESSION_IDLE_MINUTES);
  const picked = Number.isFinite(stored) && stored >= 0
    ? stored
    : Number.isFinite(fromEnv) && fromEnv >= 0
      ? fromEnv
      : IDLE_DEFAULT;
  /* Nought is off. Anything else is held between five minutes and a day: a
     one-minute session is a login screen, not a session. */
  if (picked === 0) return 0;
  return Math.min(1440, Math.max(5, Math.round(picked)));
}

export const setIdleMinutes = (value) => {
  const n = Math.max(0, Math.round(Number(value) || 0));
  setSetting(IDLE_KEY, n === 0 ? '0' : String(Math.min(1440, Math.max(5, n))));
  return idleMinutes();
};

const sign = (body) => crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');

export function makeSession(userId, seen = Math.floor(Date.now() / 1000)) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const body = Buffer.from(JSON.stringify({ u: userId, exp, s: seen })).toString('base64url');
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
    /*
     * Idle for too long is the same as not signed in. A cookie minted before
     * this existed carries no `s`; it is read as last seen NOW rather than
     * as infinitely old, so turning this on does not sign everybody out in
     * the middle of their afternoon.
     */
    const idle = idleMinutes();
    if (idle > 0 && payload.s && Date.now() - payload.s * 1000 > idle * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Keep the clock running while somebody is working.
 *
 * Re-issues the cookie with a fresh "last seen", but only once the old one
 * is a couple of minutes stale - a Set-Cookie on every request would put a
 * header on every poll and every image for no gain.
 *
 * It does NOT refuse anything: an expired session simply has no actor, and
 * the route's own requireAuth answers 401 as it always did.
 */
const TOUCH_AFTER = 120;

export function touchSession(req, res, next) {
  const token = cookieOf(req, COOKIE);
  if (token) {
    const session = readSession(token);
    const now = Math.floor(Date.now() / 1000);
    if (session?.u && idleMinutes() > 0 && now - (session.s || 0) > TOUCH_AFTER) {
      setSessionCookie(res, makeSession(session.u, now));
    } else if (!session) {
      /* Gone: take the dead cookie off the browser so the next load shows the
         sign-in screen rather than a page that 401s on everything. Done
         whatever killed it - idle, the fortnight, or a changed secret. */
      clearSessionCookie(res);
    }
  }
  next();
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
        /*
         * Read fresh with the role, for the same reason: narrowing a login
         * has to take effect NOW, not in a fortnight when the cookie runs
         * out. Leaving it off here was the whole feature doing nothing -
         * `may` saw no areas and read that as "not narrowed".
         */
        areas: user.areas ?? [],
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

/**
 * Anything that is not a plain read needs `write` - and a DELETE needs
 * `destroy` as well.
 *
 * One gate, so the rule reaches every route mounted behind it rather than
 * being remembered at forty of them. Taking something away is a different
 * act from filling it in: an Operator can write the day's visitors and
 * cannot empty the register.
 */
export const requireWriteForChanges = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.method === 'DELETE') return requireAbility('destroy')(req, res, next);
  return requireAbility('write')(req, res, next);
};

/**
 * Approving is its own ability, and an Admin has it.
 *
 * Approving a month and running the installation are different jobs; they
 * were the same check, which is why everybody who had to approve anything
 * was an Admin.
 */
export const requireApproval = (req, res, next) => {
  const abilities = req.actor?.abilities || [];
  if (abilities.includes('approve') || abilities.includes('admin')) return next();
  if (!req.actor) return res.status(401).json({ error: 'unauthorized' });
  return res.status(403).json({
    error: 'Approving needs a Manager or an Admin login.',
  });
};

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

/* ===================================================================== *
 * Which PART of the app a login may use
 * ===================================================================== */

/**
 * Refuse an area this login has not been given.
 *
 * Dinesh: *"rights me aur option do"* — four people all Admin, and no way to
 * say that one of them handles attendance and has no business on the salary
 * sheet.
 *
 * ENFORCED HERE, ON THE SERVER, not by hiding a tab. The Admin screen has
 * promised exactly that about roles since it was written, and a right that
 * only hides a button is not a right — somebody who knows the address still
 * gets the data.
 *
 * A login with nothing ticked may use everything, so turning this on moves
 * nobody.
 */
export const requireArea = (area) => (req, res, next) => {
  if (may(req.actor, area)) return next();
  return res.status(403).json({
    error: `This login does not cover ${areaLabel(area)}. An admin can change that under Admin → Logins.`,
  });
};

/**
 * TAKE THE PAY OUT OF EVERY ANSWER, for a login without the salary area.
 *
 * One place, wrapping res.json, rather than a filter remembered on each of
 * the dozen routes that carry a figure — the employee master, a payroll row,
 * a payslip, a register, a report, an export. A list of screens to remember
 * is a list somebody forgets, and a figure that leaks once has leaked.
 *
 * It does NOT touch /api/me: that is somebody's own payslip, which is the one
 * salary they are always allowed to see.
 */
export function hidePay(req, res, next) {
  if (may(req.actor, 'salary')) return next();
  const json = res.json.bind(res);
  res.json = (body) => json(withoutPay(body));
  return next();
}
