/**
 * The app must not run without a password unless somebody asked for it.
 *
 * `APP_PASSWORD` unset disables the wall completely. That is right on a laptop
 * and never right on an address anybody else can reach, and it used to be the
 * silent default - a warning in a log, and every salary, PAN, Aadhaar, bank
 * account and CV readable by whoever found the URL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'index.js');

const start = (env) =>
  spawnSync(process.execPath, [entry], {
    env: {
      ...process.env,
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'salary-start-')),
      SERVE_FRONTEND: 'false',
      PORT: '0',
      APP_PASSWORD: '',
      ALLOW_OPEN: '',
      ...env,
    },
    encoding: 'utf8',
    // The two that DO start stay up, so the timeout is what ends them. Keep it
    // short: this is a check that it came up, not a soak test.
    timeout: 2500,
  });

test('with no password and no permission, it refuses to start and says why', () => {
  const run = start({});
  assert.equal(run.status, 1, 'it must not come up');
  const said = `${run.stdout}${run.stderr}`;
  assert.match(said, /APP_PASSWORD is not set/);
  assert.match(said, /salaries, PAN/, 'it names what would be exposed');
  assert.match(said, /ALLOW_OPEN=true/, 'and how to override it deliberately');
});

test('with a password it starts', () => {
  const run = start({ APP_PASSWORD: 'a-real-password'});
  // It stays up, so the timeout kills it rather than an error doing so.
  assert.notEqual(run.status, 1, `should not have refused: ${run.stderr}`);
  assert.match(`${run.stdout}${run.stderr}`, /listening on/);
});

test('with ALLOW_OPEN=true it starts, and says out loud that it is open', () => {
  const run = start({ ALLOW_OPEN: 'true' });
  assert.notEqual(run.status, 1, 'the deliberate override is honoured');
  const said = `${run.stdout}${run.stderr}`;
  assert.match(said, /listening on/);
  assert.match(said, /Running OPEN/, 'and it is not quiet about it');
});

/*
 * Dinesh: "again sare question ek sath / mene zynta jobs wale example kyu
 * diya tha / ye solve karne k liye na".
 *
 * The server WAS updated - /healthz said the new version and the dashboard's
 * own rail showed it - and the test page went on behaving like a build three
 * releases old. The tab was running cached JavaScript.
 *
 * index.html is the one file with a fixed name and it is what points at the
 * current bundle. A browser or a CDN holding yesterday's copy keeps asking
 * for yesterday's code, and the whole app silently stays old. The hashed
 * files can be kept for ever, because their name changes when they do.
 */
test('index.html is never cached, and the hashed files are cached for ever', async () => {
  /* The real built dashboard, since the folder it is served from is fixed. */
  const dir = new URL('../public/', import.meta.url);
  if (!fs.existsSync(new URL('index.html', dir))) return; // not built here

  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-cache-'));
  process.env.APP_PASSWORD = '';
  process.env.SERVE_FRONTEND = 'true';

  const { createServer } = await import(`../src/server.js?cache=${Date.now()}`);
  const server = createServer().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/`);
    const html = await page.text();
    assert.match(page.headers.get('cache-control') || '', /no-store/);

    const asset = (html.match(/\/assets\/[^"']+\.js/) || [])[0];
    assert.ok(asset, 'no bundle referenced from index.html');
    const got = await fetch(`${base}${asset}`);
    assert.match(got.headers.get('cache-control') || '', /immutable/);

    /* A deep link is the app, and must not be cached either. */
    const deep = await fetch(`${base}/sit/TST-whatever`);
    assert.match(deep.headers.get('cache-control') || '', /no-store/);

    /*
     * A MISSING asset is a 404, not the app. The catch-all used to hand back
     * index.html for it, so a stale page got HTML where it expected
     * JavaScript and failed quietly instead of loudly.
     */
    const gone = await fetch(`${base}/assets/index-OLDHASH.js`);
    assert.equal(gone.status, 404);
  } finally {
    server.close();
  }
});
