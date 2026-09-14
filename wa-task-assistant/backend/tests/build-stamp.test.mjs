/**
 * Which build is actually running, said on the screen.
 *
 * Three times running, something was reported as still broken when it was
 * fixed and simply had not reached the browser yet — and from a screenshot
 * there is no way to tell those two apart. That ambiguity is the bug: it costs
 * a round trip every time, and it sends the next fix looking in the wrong
 * place.
 *
 * The commit from the host's environment is one answer, and it is null wherever
 * the host does not set it — which is exactly when it is needed. The bundle
 * name is the answer that needs nothing: Vite names it after a hash of its own
 * contents, so if the name the server reports matches the file the browser
 * loaded, the screen is running that code. Full stop.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-build-'));
process.env.DATA_DIR = dir;
process.env.EXTRACTION_MODE = 'manual';

const { build } = await import('../src/diagnostics.js');

describe('the build stamp', () => {
  it('names the dashboard file this server hands out', () => {
    const assets = new URL('../public/assets/', import.meta.url);
    let built = [];
    try {
      built = fs.readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f));
    } catch { /* no dashboard bundled - the API alone is a valid way to run */ }

    if (!built.length) {
      assert.equal(build.bundle, null, 'nothing bundled, nothing claimed');
      return;
    }
    assert.ok(built.includes(build.bundle), `${build.bundle} is not one of ${built.join(', ')}`);
    assert.ok(build.builtAt, 'and says when it was built');
  });

  it('never invents a commit it was not given', () => {
    // A hand-written version number drifts from what is running, which is worse
    // than saying nothing: the whole point is that this figure cannot lie.
    const src = fs.readFileSync(new URL('../src/diagnostics.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('export const build'), src.indexOf('/** Recursive size'));
    assert.match(block, /RAILWAY_GIT_COMMIT_SHA/, 'it comes from the host');
    assert.ok(!/['"][0-9a-f]{7}['"]/.test(block), 'no literal sha anywhere');
  });

  it('the panel shows it whether or not WhatsApp is connected', () => {
    // It used to sit inside the diagnostics block, which only opens when the
    // session is down - so the one fact that says "this is the new code" was
    // hidden exactly when everything looked fine and was not.
    const panel = fs.readFileSync(
      new URL('../../frontend/src/components/StatusBar.jsx', import.meta.url), 'utf8');
    const render = panel.slice(panel.indexOf('<div className="status-detail"') > 0
      ? panel.indexOf('<div className="status-detail"') : 0);
    assert.match(panel, /<Build build=\{status\?\.diagnostics\?\.build\}/);
    const gated = /state !== 'ready' && <Build/.test(panel);
    assert.equal(gated, false, 'not hidden behind a healthy connection');
    assert.match(panel, /build\.bundle/, 'and it names the bundle');
  });

  it('the service worker cannot serve a deploy stale for ever', () => {
    // activate deletes every cache whose name is not the current one. With a
    // name that never changed, that swept nothing, ever.
    const sw = fs.readFileSync(new URL('../../frontend/public/sw.js', import.meta.url), 'utf8');
    const name = sw.match(/const CACHE = '([^']+)'/)?.[1];
    assert.ok(name, 'it names its cache');
    assert.notEqual(name, 'wa-tasks-v1', 'and that name moves with the release');
  });
});

process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
