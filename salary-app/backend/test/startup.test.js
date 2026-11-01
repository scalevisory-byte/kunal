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
