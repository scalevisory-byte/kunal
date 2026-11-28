/**
 * The Admin redesign (v2.44.0).
 *
 * Tabs with a header, a Logins screen with figures, search, filters, badges,
 * a row menu, paging and Add/Edit/Reset dialogs, a role grid read from the
 * server, and a search on Sign-ins. What these tests hold it to:
 *
 *   - THE SERVER STILL DECIDES: the screen calls exactly the routes it always
 *     called, and nothing about who may do what is restated in the browser;
 *   - the role grid is drawn from the server's ROLES, so it cannot disagree
 *     with what is enforced;
 *   - the status badge never calls a switched-off login active;
 *   - the panels keep their keys, so nothing that opens one has to move.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROLES } from '../src/users.js';
import { loginStatus } from '../../shared/loginStatus.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const users = strip(read('frontend/src/components/admin/Users.jsx'));
const admin = strip(read('frontend/src/components/admin/Admin.jsx'));

test('the screen calls only the login routes that already existed', () => {
  const calls = [...users.matchAll(/api\.(get|post|patch|put|del)\(`?'?([^`',)]+)/g)].map((m) => `${m[1]} ${m[2]}`);
  const allowed = [
    'get /auth/users',
    'post /auth/users',
    'patch /auth/users/${user.id}',
    'del /auth/users/${user.id}',
    'post /auth/users/${user.id}/password',
    'get /auth/session-rule',
    'put /auth/session-rule',
  ];
  for (const c of calls) assert.ok(allowed.includes(c), `unexpected call: ${c}`);
});

test('the role grid is read from the server’s roles, and every ability it carries has a column', () => {
  assert.match(users, /roles\.map\(\(role\) =>/);
  assert.match(users, /role\.abilities\.includes\(key\)/);
  const columns = [...users.matchAll(/\['(read|write|destroy|approve|admin)', '/g)].map((m) => m[1]);
  const used = new Set(ROLES.filter((r) => !r.staff).flatMap((r) => r.abilities));
  for (const a of used) assert.ok(columns.includes(a), `ability ${a} has no column`);
});

test('a switched-off login is never shown as active, whatever else is true of it', () => {
  assert.deepEqual(loginStatus({ active: false, must_change: true, last_login_at: 'x' })[0], 'off');
  assert.deepEqual(loginStatus({ active: true, must_change: true, last_login_at: 'x' })[0], 'change');
  assert.deepEqual(loginStatus({ active: true, must_change: false, last_login_at: null })[0], 'never');
  assert.deepEqual(loginStatus({ active: true, must_change: false, last_login_at: '2026-11-28' })[0], 'on');
});

test('an Admin is never offered module ticks, and switching off asks first', () => {
  assert.match(users, /draft\.role === 'admin' \? \(/);
  assert.match(users, /areas: key === 'admin' \? \[\] :/);
  assert.match(users, /user\.active && !window\.confirm\(`Switch off/);
  assert.match(users, /window\.confirm\(`Remove the login/);
});

test('the password box can be hidden, and starts shown because it is read out', () => {
  assert.match(users, /useState\(true\)[\s\S]{0,120}type=\{shown \? 'text' : 'password'\}/);
  assert.match(users, /autoComplete="new-password"/);
});

test('the panels keep their keys', () => {
  for (const key of ['users', 'staff', 'branches', 'logos', 'settings', 'backups', 'logins']) {
    assert.match(admin, new RegExp(`\\['${key}', '`), key);
  }
});

test('every ad- class has a rule in styles.css', () => {
  const css = read('frontend/src/styles.css');
  const all = users + admin + strip(read('frontend/src/components/admin/Logins.jsx'));
  const used = new Set([...all.matchAll(/\bad-[a-z-]+/g)].map((m) => m[0]));
  for (const cls of used) assert.ok(css.includes(`.${cls}`), `.${cls} has no rule`);
});
