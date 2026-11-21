/**
 * SIGNED OUT AFTER DOING NOTHING FOR A WHILE.
 *
 * Dinesh: *"agar ek bar login kiya hua to kabhi logout nahi hota auto"*. The
 * cookie ran for a fortnight and nothing shortened it.
 *
 * Four things this has to get right, and each one is a test below:
 *
 *   1. A session that has sat still past the limit is REFUSED - by the
 *      server, not by a timer in the browser.
 *   2. Working inside the window starts the clock again, so somebody using
 *      the app all afternoon is never thrown out mid-sentence.
 *   3. Nought means never. An office that wants the long session must be
 *      able to say so, or it will be arranged by nobody ever signing out.
 *   4. A cookie minted BEFORE this existed carries no "last seen". It is
 *      read as seen now, not as infinitely old - turning the rule on must
 *      not sign the whole office out in the middle of their afternoon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;
delete process.env.ALLOW_OPEN;
delete process.env.SESSION_IDLE_MINUTES;

const { createServer } = await import('../src/server.js');
const users = await import('../src/users.js');
const auth = await import('../src/auth.js');
const db = await import('../src/db.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const boss = users.createFirstAdmin({
  name: 'Dinesh',
  username: 'dinesh',
  password: 'first-pass-123',
});
db.db.prepare(`UPDATE users SET must_change = 0`).run();

const call = async (cookie, method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    setCookie: res.headers.getSetCookie(),
  };
};

const signIn = async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dinesh', password: 'first-pass-123' }),
  });
  assert.equal(res.status, 200);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
};

/* A cookie saying "last seen `agoMinutes` ago", signed the way the server
   signs its own. The alternative is waiting an hour in a test. */
const cookieLastSeen = (agoMinutes, { withSeen = true } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = { u: boss.id, exp: now + 14 * 24 * 60 * 60 };
  if (withSeen) payload.s = now - Math.round(agoMinutes * 60);
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', users.sessionSecret())
    .update(body)
    .digest('base64url');
  return `salary_session=${body}.${sig}`;
};

test('an hour is the figure it starts on, and it is the server that holds it', async () => {
  const rule = await call(await signIn(), 'GET', '/api/auth/session-rule');
  assert.equal(rule.status, 200);
  assert.equal(rule.body.idle_minutes, 60);
});

test('A SESSION THAT SAT STILL PAST THE LIMIT IS REFUSED', async () => {
  const stale = await call(cookieLastSeen(61), 'GET', '/api/employees');
  assert.equal(stale.status, 401, 'an hour and a minute of nothing is signed out');

  const fresh = await call(cookieLastSeen(59), 'GET', '/api/employees');
  assert.equal(fresh.status, 200, 'fifty-nine minutes is still signed in');
});

test('...and the dead cookie is taken off the browser, so the next load is the sign-in screen', async () => {
  const stale = await call(cookieLastSeen(120), 'GET', '/api/employees');
  const cleared = stale.setCookie.find((c) => c.startsWith('salary_session='));
  assert.ok(cleared, 'a Set-Cookie came back');
  assert.match(cleared, /Max-Age=0/);
});

test('WORKING INSIDE THE WINDOW STARTS THE CLOCK AGAIN', async () => {
  /* Half an hour idle, then one request: the cookie comes back with a fresh
     "last seen", so another hour is on the clock rather than half of one. */
  const answer = await call(cookieLastSeen(30), 'GET', '/api/employees');
  assert.equal(answer.status, 200);
  const reissued = answer.setCookie.find((c) => c.startsWith('salary_session='));
  assert.ok(reissued, 'the cookie was re-issued');
  assert.doesNotMatch(reissued, /Max-Age=0/, 'not cleared - refreshed');

  const token = decodeURIComponent(reissued.split(';')[0].split('=').slice(1).join('='));
  const seen = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).s;
  assert.ok(Date.now() / 1000 - seen < 5, 'last seen is now, not half an hour ago');
});

test('...but not on every single request - a Set-Cookie on every poll is a header for nothing', async () => {
  const answer = await call(cookieLastSeen(0.5), 'GET', '/api/employees');
  assert.equal(answer.status, 200);
  assert.equal(
    answer.setCookie.filter((c) => c.startsWith('salary_session=')).length,
    0,
    'thirty seconds old: left alone'
  );
});

test('A COOKIE FROM BEFORE THIS EXISTED IS NOT SIGNED OUT MID-AFTERNOON', async () => {
  const legacy = await call(cookieLastSeen(0, { withSeen: false }), 'GET', '/api/employees');
  assert.equal(legacy.status, 200, 'no "last seen" is read as seen now, not as infinitely old');
});

test('NOUGHT MEANS NEVER, and it is said out loud rather than hidden', async () => {
  const cookie = await signIn();
  const off = await call(cookie, 'PUT', '/api/auth/session-rule', { idle_minutes: 0 });
  assert.equal(off.status, 200);
  assert.equal(off.body.idle_minutes, 0);

  const ancient = await call(cookieLastSeen(60 * 24 * 10), 'GET', '/api/employees');
  assert.equal(ancient.status, 200, 'ten days idle, and still signed in - which is what off means');

  /* And with it off, nothing is re-issued either: there is no clock to run. */
  assert.equal(
    ancient.setCookie.filter((c) => c.startsWith('salary_session=')).length,
    0
  );
});

test('a figure too small to be a session is lifted to five minutes', async () => {
  const cookie = await signIn();
  const tiny = await call(cookie, 'PUT', '/api/auth/session-rule', { idle_minutes: 1 });
  assert.equal(tiny.body.idle_minutes, 5, 'a one-minute session is a sign-in screen');

  const huge = await call(cookie, 'PUT', '/api/auth/session-rule', { idle_minutes: 99999 });
  assert.equal(huge.body.idle_minutes, 1440, 'and a day is the most it will hold');
});

test('ONLY AN ADMIN MAY CHANGE IT', async () => {
  users.createUser({
    name: 'Riya',
    username: 'riya.hr',
    role: 'hr',
    password: 'riya-pass-123',
  });
  db.db.prepare(`UPDATE users SET must_change = 0`).run();
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'riya.hr', password: 'riya-pass-123' }),
  });
  const hr = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  assert.equal((await call(hr, 'GET', '/api/auth/session-rule')).status, 403);
  assert.equal(
    (await call(hr, 'PUT', '/api/auth/session-rule', { idle_minutes: 480 })).status,
    403
  );
});

test('the change is on the audit trail, by name', async () => {
  const cookie = await signIn();
  await call(cookie, 'PUT', '/api/auth/session-rule', { idle_minutes: 30 });
  const rows = db.listAudit({ entity: 'app_settings' });
  const line = (rows.rows || rows).find((r) => /idle/.test(r.label || ''));
  assert.ok(line, 'the change was recorded');
  assert.equal(line.who, 'Dinesh');
  assert.match(String(line.to_value), /30 minutes/);
});

test('the rule is read fresh, so changing it takes effect at once', async () => {
  const cookie = await signIn();
  await call(cookie, 'PUT', '/api/auth/session-rule', { idle_minutes: 5 });
  assert.equal(auth.idleMinutes(), 5);
  assert.equal((await call(cookieLastSeen(6), 'GET', '/api/employees')).status, 401);
  assert.equal((await call(cookieLastSeen(4), 'GET', '/api/employees')).status, 200);
});
