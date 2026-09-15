/**
 * The dashboard gate. The case that matters most is the one that was wrong:
 * a request with no token is the dashboard on first load, not a password guess,
 * and counting it spent most of the allowance before the user typed anything.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';
process.env.DASHBOARD_PASSWORD = 'correct-horse';

const { requireAuth, resetAuthAttempts, authEnabled } = await import('../src/auth.js');

let passed = 0;
let failed = 0;
const run = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

/** Minimal Express-shaped req/res, enough for the middleware under test. */
function call(token, ip = '1.2.3.4') {
  const req = {
    ip,
    method: 'GET',
    originalUrl: '/api/tasks',
    get: (name) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : ''),
  };
  const out = { status: 200, body: null, headers: {} };
  const res = {
    status(code) { out.status = code; return res; },
    json(body) { out.body = body; return res; },
    set(name, value) { out.headers[name] = value; return res; },
  };
  let passedThrough = false;
  requireAuth(req, res, () => { passedThrough = true; });
  return { ...out, passed: passedThrough };
}

console.log('\nthe gate');

run('a password is required at all', () => {
  assert.equal(authEnabled, true);
});

run('the right password gets through', () => {
  resetAuthAttempts();
  assert.equal(call('correct-horse').passed, true);
});

run('a wrong password does not', () => {
  resetAuthAttempts();
  const res = call('wrong');
  assert.equal(res.passed, false);
  assert.equal(res.status, 401);
});

run('no password at all does not', () => {
  resetAuthAttempts();
  const res = call(null);
  assert.equal(res.passed, false);
  assert.equal(res.status, 401);
});

console.log('\nlocking out guesses, and only guesses');

run('five wrong passwords lock the address out', () => {
  resetAuthAttempts();
  for (let i = 0; i < 5; i += 1) assert.equal(call('wrong').status, 401);
  const locked = call('wrong');
  assert.equal(locked.status, 429);
  assert.ok(locked.body.retryAfterSeconds > 0, 'it says how long to wait');
});

run('the lockout holds even against the right password', () => {
  resetAuthAttempts();
  for (let i = 0; i < 5; i += 1) call('wrong');
  // Otherwise the limit is no limit: an attacker who guesses right walks in.
  assert.equal(call('correct-horse').status, 429);
});

run('requests carrying no token never count towards it', () => {
  resetAuthAttempts();
  // The dashboard fires several of these before it has a token to send.
  for (let i = 0; i < 50; i += 1) assert.equal(call(null).status, 401);
  // Nothing has been spent, so the real password still works...
  assert.equal(call('correct-horse').passed, true);
  // ...and a genuine guessing run still has its full allowance.
  for (let i = 0; i < 5; i += 1) assert.equal(call('wrong').status, 401);
  assert.equal(call('wrong').status, 429);
});

run('a success clears the failures behind it', () => {
  resetAuthAttempts();
  for (let i = 0; i < 4; i += 1) call('wrong');
  assert.equal(call('correct-horse').passed, true);
  // Back to a full allowance rather than one attempt from a lockout.
  for (let i = 0; i < 5; i += 1) assert.equal(call('wrong').status, 401);
});

run('addresses are locked out separately', () => {
  resetAuthAttempts();
  for (let i = 0; i < 6; i += 1) call('wrong', '10.0.0.1');
  assert.equal(call('wrong', '10.0.0.1').status, 429);
  assert.equal(call('correct-horse', '10.0.0.2').passed, true);
});

/*
 * Whitespace around the password — how a correct password stops working for
 * ever, reported as "login nahi ho raha he" the day after it was first set.
 *
 * A password pasted into a hosting provider's variable box very easily carries
 * a trailing space or a newline, and the box shows neither. It is much worse
 * than being hard to type: HTTP strips leading and trailing whitespace from a
 * header value, so a password ending in a space CANNOT be sent in an
 * Authorization header at all. The right password is refused, the fifth
 * refusal locks the address out for fifteen minutes, and nothing says why.
 */
run('whitespace the browser sends around the password is ignored', () => {
  resetAuthAttempts();
  assert.equal(call(' correct-horse ', '10.0.0.3').passed, true,
    'a space nobody can see stood between him and his own task list');
});

run('trimming did not make the check loose', () => {
  resetAuthAttempts();
  assert.equal(call('correct-hors', '10.0.0.4').status, 401);
  assert.equal(call('correct-horse-extra', '10.0.0.5').status, 401);
  assert.equal(call('', '10.0.0.6').status, 401);
});

run('a password CONFIGURED with whitespace still lets its owner in', () => {
  /*
   * The half that matters most, and the one that cannot be checked in this
   * process: config.js reads the variable once at import. So it runs for real
   * in a child, with the padding a paste actually leaves behind.
   */
  const { execFileSync } = require('node:child_process');
  const probe = `
    const { config } = await import('../src/config.js');
    const { requireAuth } = await import('../src/auth.js');
    const req = { ip: '9.9.9.9', method: 'GET', originalUrl: '/api/tasks',
      get: () => 'Bearer MySecret123!' };
    let ok = false;
    requireAuth(req, { status: () => ({ json: () => {} }), set: () => {} }, () => { ok = true; });
    console.log(JSON.stringify({ ok, stored: config.dashboardPassword }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: new URL('.', import.meta.url).pathname,
    env: { ...process.env, DASHBOARD_PASSWORD: '  MySecret123!\n', DATA_DIR: dir },
    encoding: 'utf8',
  });
  const result = JSON.parse(out.trim().split('\n').pop());
  assert.equal(result.stored, 'MySecret123!', 'the variable was not trimmed on the way in');
  assert.equal(result.ok, true, 'the correct password was refused');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
