/*
 * "Too many wrong passwords. This device is locked out for about 6 minutes",
 * over a dashboard of zeros nobody had typed into: a password saved in the
 * browser that the server no longer accepts, sent by every request of a page
 * load and every thirty-second poll. The server half (one stale password is
 * one failure) is in auth.test.mjs; this is the dashboard half.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../../frontend/src/${rel}`, import.meta.url), 'utf8');
const api = read('api.js');
const app = read('App.jsx');
const login = read('components/Login.jsx');

describe('a refused password is not sent again', () => {
  it('every 401 goes through one door that forgets the password it refused', () => {
    assert.doesNotMatch(api, /throw new UnauthorizedError\(\)/);
    const n = (api.match(/if \(response\.status === 401\) throw refused\(token\);/g) || []).length;
    assert.ok(n >= 5, `all ${n} places`);
    assert.match(api, /function refused\(sent\) \{[\s\S]*?if \(sent && getToken\(\) === sent\) setToken\(null\);[\s\S]*?new UnauthorizedError\(Boolean\(sent\)\)/);
  });

  it('a lockout puts the login screen up, says how long, and drops what was saved', () => {
    assert.match(app, /err instanceof LockedOutError\) \{[\s\S]*?setToken\(null\);[\s\S]*?lockedMins:[\s\S]*?setNeedsAuth\(true\);/);
    assert.doesNotMatch(app, /setError\(`Too many wrong passwords/, 'not a red line over a dashboard of zeros');
    assert.match(login, /Too many wrong passwords\. Try again in about \$\{lockedMins\}/);
  });

  it('"rejected" is said only when a password was actually sent', () => {
    assert.match(app, /hadToken=\{authNote\.rejected\}/);
    assert.match(app, /rejected: err\.hadToken \|\| n\.rejected/);
  });
});
