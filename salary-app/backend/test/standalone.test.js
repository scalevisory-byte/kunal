import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', '..', 'frontend', 'src', p), 'utf8');

/*
 * The single-file build has no server, so localStore.js answers the same API
 * paths. The risk is one-sided and quiet: a new call added to the server build
 * costs nothing there, and the standalone file simply stops working.
 *
 * It happened. The logins work added `GET /auth/state` to App.jsx's first load,
 * localStore 404'd it, `setAuthed(true)` never ran, and the file opened on "No
 * months yet" with every tab blank - no error beyond one dismissible banner.
 * So the first load is pinned here: whatever App.jsx asks for before it will
 * show anything at all, the standalone file has to be able to answer.
 */
test('the standalone file can answer everything the first load asks for', () => {
  const app = read('App.jsx');
  const store = read('localStore.js');

  // The bootstrap effect, as far as its closing `}, []);`.
  const start = app.indexOf('// First load:');
  assert.ok(start > -1, 'the first-load effect has moved - this test needs rewriting');
  const bootstrap = app.slice(start, app.indexOf('}, []);', start));

  const asked = [...bootstrap.matchAll(/api\.get\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(asked.length >= 2, `expected the first load to fetch something, saw ${asked.length}`);

  for (const p of asked) {
    assert.ok(
      store.includes(`'GET /${p.replace(/^\//, '')}'`),
      `the first load fetches ${p}, which localStore.js does not answer - the standalone build will open empty`
    );
  }
});
