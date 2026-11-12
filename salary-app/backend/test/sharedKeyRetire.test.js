/**
 * The shared password is a way IN, not a person — and it can be taken away.
 *
 * APP_PASSWORD is full admin with no name on it: actorOf hands back
 * `name: 'the API key'`, so anything done with it is on the record as that
 * rather than as somebody. Creating named logins does NOT switch it off, so
 * left in backend\.env it is a permanent nameless admin sitting in a text
 * file on the server.
 *
 * The way out is to delete the line once a real admin exists. That rests on
 * one expression in index.js —
 *
 *     const guarded = Boolean(config.appPassword) || countUsers() > 0;
 *
 * — and if the `countUsers()` half of it ever goes, the app will refuse to
 * start without the shared key and everyone will put it back. These drive
 * two real servers, one with the key and one without, because that is the
 * only way to see a startup guard do its job.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '../src/index.js');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-'));
const PORT = 5181;
const base = `http://127.0.0.1:${PORT}`;

let child = null;

const start = (appPassword) =>
  new Promise((resolve, reject) => {
    child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        PORT: String(PORT),
        LINK_SECRET: 'retire-secret',
        SERVE_FRONTEND: 'false',
        APP_PASSWORD: appPassword,
        ALLOW_OPEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const watch = (b) => {
      out += String(b);
      if (/listening on/.test(out)) resolve(out);
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
    setTimeout(() => reject(new Error(`never started: ${out}`)), 15000);
  });

const stop = () =>
  new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on('exit', () => resolve());
    child.kill();
  });

const status = async (url, headers) => (await fetch(base + url, { headers })).status;

test.after(() => stop());

let cookie = '';

test('with the shared key: it gets in, and it is nobody', async () => {
  await start('theofficepassword');
  const key = { authorization: 'Bearer theofficepassword' };
  assert.equal(await status('/api/employees', key), 200);

  const who = await (await fetch(`${base}/api/auth/state`, { headers: key })).json();
  assert.equal(who.signed_in.role, 'admin', 'the shared key is full admin');
  assert.equal(who.signed_in.via, 'api-key');
  assert.equal(who.signed_in.name, 'the API key', 'no name — which is the problem with leaving it on');
  assert.equal(who.needs_setup, true, 'no named logins yet');
});

test('the first admin is made on the sign-in screen', async () => {
  const res = await fetch(`${base}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dinesh', name: 'Dinesh Parmar', password: 'a-long-enough-one' }),
  });
  assert.equal(res.status, 201);
  const { user } = await res.json();
  assert.equal(user.role, 'admin');

  // Making logins does NOT retire the shared key. This is the fact the
  // guide has to state, because nothing on screen says it.
  assert.equal(await status('/api/employees', { authorization: 'Bearer theofficepassword' }), 200);
  await stop();
});

test('with the line deleted: the old key is dead and the person is not', async () => {
  // It still STARTS, because a named login is what `guarded` wants. If this
  // throws, the retire path is gone and the shared key is permanent.
  await start('');

  assert.equal(
    await status('/api/employees', { authorization: 'Bearer theofficepassword' }),
    401,
    'the retired shared password still works'
  );
  assert.equal(await status('/api/employees'), 401, 'no credentials at all');

  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dinesh', password: 'a-long-enough-one' }),
  });
  assert.equal(res.status, 200);
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'no session cookie');

  assert.equal(await status('/api/employees', { cookie }), 200, 'the named admin cannot work');

  const who = await (await fetch(`${base}/api/auth/state`, { headers: { cookie } })).json();
  assert.equal(who.signed_in.via, 'session');
  assert.equal(who.signed_in.username, 'dinesh', 'the trail now carries a name');
});

test('an installation with nothing guarding it refuses to start', async () => {
  // The other half of the same guard, and the reason the retire path is
  // safe: no key AND no logins is the case that exits rather than serving
  // every salary to whoever found the address.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-open-'));
  const died = await new Promise((resolve) => {
    const p = spawn(process.execPath, [entry], {
      env: { ...process.env, DATA_DIR: empty, PORT: String(PORT + 1), APP_PASSWORD: '', ALLOW_OPEN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (b) => { out += String(b); });
    p.stderr.on('data', (b) => { out += String(b); });
    p.on('exit', (code) => resolve({ code, out }));
    setTimeout(() => { p.kill(); resolve({ code: null, out }); }, 10000);
  });
  assert.equal(died.code, 1, 'it served an unguarded installation');
  assert.match(died.out, /APP_PASSWORD is not set/);
});
