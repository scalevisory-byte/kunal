/**
 * A RUN OF WRONG PASSWORDS IS SLOWED DOWN - AND NEVER SHUT OUT.
 *
 * There was no limit at all: the sign-in route answered as fast as it was
 * asked, for ever. On an address reachable from the internet that makes a
 * short password only as safe as the number of guesses somebody can be
 * bothered to send.
 *
 * The rule it is built on, and the thing these tests exist to hold:
 *
 *   IT IS A WAIT, NOT A LOCKOUT. An account that closes after five wrong
 *   passwords is a lock anybody can turn against the person holding the key -
 *   whoever knows Dinesh signs in as `dinesh` could shut him out of his own
 *   payroll on the day it goes out. So the answers slow down and come back on
 *   their own, and the right password clears the count at once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-'));
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
delete process.env.APP_PASSWORD;
delete process.env.ALLOW_OPEN;

const { createServer } = await import('../src/server.js');
const users = await import('../src/users.js');
const db = await import('../src/db.js');
const { LOGIN_THROTTLE, throttleState, waitInWords, waitSeconds } = await import(
  '../../shared/loginThrottle.js'
);
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

users.createFirstAdmin({ name: 'Dinesh', username: 'dinesh', password: 'first-pass-123' });
db.db.prepare(`UPDATE users SET must_change = 0`).run();

const tryLogin = async (username, password) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, res };
};

/* Push the recorded failures back in time, instead of waiting out the wait. */
const rewind = (username, seconds) =>
  db.db
    .prepare(
      `UPDATE login_events SET at = datetime(at, ?) WHERE username = ? AND ok = 0`
    )
    .run(`-${Math.round(seconds)} seconds`, username);

/* ---------------- the rule itself ---------------- */

test('the first five wrong passwords cost nothing - fingers slip', () => {
  for (let n = 0; n <= LOGIN_THROTTLE.free; n += 1) {
    assert.equal(waitSeconds(n), 0, `${n} wrong should still be free`);
  }
});

test('and then it doubles, up to five minutes and no further', () => {
  assert.equal(waitSeconds(6), 15);
  assert.equal(waitSeconds(7), 30);
  assert.equal(waitSeconds(8), 60);
  assert.equal(waitSeconds(9), 120);
  assert.equal(waitSeconds(10), 240);
  assert.equal(waitSeconds(11), 300);
  // THE POINT: it does not keep growing. A thousand wrong passwords is still
  // a five-minute wait, because it is a wait and not a lockout.
  assert.equal(waitSeconds(1000), 300);
  assert.equal(waitSeconds(1e9), LOGIN_THROTTLE.max_wait_seconds);
});

test('the wait is counted from the LAST wrong password, so it runs out by itself', () => {
  assert.equal(throttleState({ failures: 7, secondsSinceLast: 10 }).blocked, true);
  assert.equal(throttleState({ failures: 7, secondsSinceLast: 10 }).seconds_left, 20);
  assert.equal(throttleState({ failures: 7, secondsSinceLast: 40 }).blocked, false);
});

test('"never a wrong one" is not the same as "one a long time ago"', () => {
  // No last failure at all: nothing to count from, and nothing is blocked.
  assert.equal(throttleState({ failures: 9, secondsSinceLast: null }).blocked, false);
});

test('the wait is said in words somebody reads while cross', () => {
  assert.equal(waitInWords(1), '1 second');
  assert.equal(waitInWords(15), '15 seconds');
  assert.equal(waitInWords(60), '1 minute');
  assert.equal(waitInWords(300), '5 minutes');
});

/* ---------------- against the real route ---------------- */

test('FIVE WRONG PASSWORDS AND THE SIXTH IS MADE TO WAIT', async () => {
  for (let i = 0; i < 5; i += 1) {
    const no = await tryLogin('dinesh', `rubbish-${i}`);
    assert.equal(no.status, 401, `guess ${i + 1} should still be answered`);
  }
  const sixth = await tryLogin('dinesh', 'rubbish-5');
  assert.equal(sixth.status, 401, 'the sixth is the one that EARNS the wait');

  const seventh = await tryLogin('dinesh', 'rubbish-6');
  assert.equal(seventh.status, 429);
  assert.match(seventh.body.error, /Too many wrong passwords/);
  assert.match(seventh.body.error, /15 seconds/);
  assert.equal(seventh.res.headers.get('retry-after'), String(seventh.body.seconds_left));
});

test('...and the RIGHT password is refused too while the wait is on - no way past it', async () => {
  const no = await tryLogin('dinesh', 'first-pass-123');
  assert.equal(no.status, 429, 'the gate is in front of the password check, not behind it');
});

test('THE WAIT RUNS OUT ON ITS OWN. Nothing has to be unlocked.', async () => {
  rewind('dinesh', 60);
  const yes = await tryLogin('dinesh', 'first-pass-123');
  assert.equal(yes.status, 200, 'a minute later and the right password works again');
});

test('...and getting in CLEARS the count: two typos then the real one leaves nothing', async () => {
  // Fresh after that success, so five more are free again.
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await tryLogin('dinesh', `again-${i}`)).status, 401);
  }
  rewind('dinesh', 600);
  assert.equal((await tryLogin('dinesh', 'first-pass-123')).status, 200);
  // The count is "since the last success", so it is back to nothing.
  assert.equal(users.recentFailures('dinesh').failures, 0);
});

test('A USERNAME THAT DOES NOT EXIST WAITS EXACTLY LIKE ONE THAT DOES', async () => {
  // Otherwise the wait itself says which logins are real, which is the thing
  // the one vague 401 message exists to hide.
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await tryLogin('nobody.here', `x-${i}`)).status, 401);
  }
  const next = await tryLogin('nobody.here', 'x-6');
  assert.equal(next.status, 429);
  assert.match(next.body.error, /Too many wrong passwords/);
});

test('ONE PERSON GUESSING CANNOT KEEP ANYBODY ELSE OUT', async () => {
  users.createUser({ name: 'Riya', username: 'riya.hr', role: 'hr', password: 'riya-pass-123' });
  db.db.prepare(`UPDATE users SET must_change = 0`).run();

  for (let i = 0; i < 12; i += 1) await tryLogin('riya.hr', `spray-${i}`);
  assert.equal((await tryLogin('riya.hr', 'riya-pass-123')).status, 429, 'hers is slowed');

  rewind('dinesh', 3600);
  assert.equal((await tryLogin('dinesh', 'first-pass-123')).status, 200, 'his is not');
});

test('wrong passwords from half an hour ago are not held against anybody', async () => {
  rewind('riya.hr', LOGIN_THROTTLE.window_minutes * 60 + 60);
  assert.equal(users.recentFailures('riya.hr').failures, 0);
  assert.equal((await tryLogin('riya.hr', 'riya-pass-123')).status, 200);
});

test('a blank username is not a login to throttle', () => {
  assert.equal(users.recentFailures('').failures, 0);
  assert.equal(users.recentFailures(undefined).failures, 0);
});

test('HAMMERING THE DOOR WHILE BLOCKED DOES NOT DRIVE THE WAIT UP', async () => {
  // Otherwise somebody could hold a real person at the five-minute cap for as
  // long as they cared to keep typing - the lockout by another name.
  users.createUser({ name: 'Krutika', username: 'krutika.fd', role: 'operator', password: 'krut-pass-123' });
  db.db.prepare(`UPDATE users SET must_change = 0`).run();

  for (let i = 0; i < 6; i += 1) await tryLogin('krutika.fd', `n-${i}`);
  const before = users.recentFailures('krutika.fd').failures;
  assert.equal(before, 6);

  // Twenty more while the wait is on: all refused, and none recorded.
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await tryLogin('krutika.fd', `flood-${i}`)).status, 429);
  }
  assert.equal(users.recentFailures('krutika.fd').failures, 6, 'the tally did not move');

  // So the wait is still the first one, not the cap.
  rewind('krutika.fd', 16);
  assert.equal((await tryLogin('krutika.fd', 'krut-pass-123')).status, 200);
});
