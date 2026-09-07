/**
 * Light, dark, or the device.
 *
 * The palettes already existed — `:root` for light, a prefers-color-scheme
 * block for dark, `[data-theme]` overriding both. All that was missing was a
 * way to say which you want, so this is only about that choice: what is stored,
 * what is applied, and what happens when there is nowhere to store it.
 *
 * Three states rather than two. "Match my device" is a real answer, not the
 * absence of one, and it has to be reachable again after choosing — a switch
 * you cannot undo is a trap.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../frontend/src/lib/theme.js', import.meta.url), 'utf8');

/** A browser, as much of one as this needs. */
function browser({ prefersDark = false, storageWorks = true } = {}) {
  const store = new Map();
  const root = {
    attrs: new Map(),
    style: {},
    setAttribute: (k, v) => root.attrs.set(k, v),
    removeAttribute: (k) => root.attrs.delete(k),
    getAttribute: (k) => root.attrs.get(k) ?? null,
  };
  const localStorage = {
    getItem: (k) => { if (!storageWorks) throw new Error('blocked'); return store.get(k) ?? null; },
    setItem: (k, v) => { if (!storageWorks) throw new Error('blocked'); store.set(k, v); },
    removeItem: (k) => { if (!storageWorks) throw new Error('blocked'); store.delete(k); },
  };
  const window = { matchMedia: () => ({ matches: prefersDark }) };
  const api = new Function('document', 'localStorage', 'window',
    src.replace(/^import.*$/gm, '').replace(/export /g, '') +
    '; return { getTheme, setTheme, applyTheme, resolvedTheme, THEMES };'
  )({ documentElement: root }, localStorage, window);
  return { ...api, root, store };
}

let pass = 0, fail = 0;
const run = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };

console.log('\nfollowing the device, which is the default');

run('with no choice made it follows the device', () => {
  const b = browser();
  assert.equal(b.getTheme(), 'system');
  b.applyTheme(b.getTheme());
  assert.equal(b.root.getAttribute('data-theme'), null, 'nothing is forced');
});

run('and it reports what is actually on screen', () => {
  assert.equal(browser({ prefersDark: true }).resolvedTheme(), 'dark');
  assert.equal(browser({ prefersDark: false }).resolvedTheme(), 'light');
});

console.log('\nchoosing one');

run('a choice is applied and remembered', () => {
  const b = browser();
  b.setTheme('dark');
  assert.equal(b.root.getAttribute('data-theme'), 'dark');
  assert.equal(b.getTheme(), 'dark', 'survives a reload');
});

run('a choice beats the device', () => {
  const b = browser({ prefersDark: true });
  b.setTheme('light');
  assert.equal(b.root.getAttribute('data-theme'), 'light');
  assert.equal(b.resolvedTheme(), 'light', 'the device says dark; the choice wins');
});

run('form controls and scrollbars are told too', () => {
  const b = browser();
  b.setTheme('dark');
  assert.equal(b.root.style.colorScheme, 'dark');
});

run('going back to the device is possible', () => {
  // A switch you cannot undo is a trap.
  const b = browser();
  b.setTheme('dark');
  b.setTheme('system');
  assert.equal(b.root.getAttribute('data-theme'), null);
  assert.equal(b.getTheme(), 'system');
  assert.equal(b.root.style.colorScheme, 'light dark');
});

console.log('\nwhen the browser will not cooperate');

run('a private window still switches, it just forgets', () => {
  // localStorage throws outright in some contexts. A theme switch is not worth
  // a broken page.
  const b = browser({ storageWorks: false });
  assert.equal(b.getTheme(), 'system', 'reading falls back rather than throwing');
  b.setTheme('dark');
  assert.equal(b.root.getAttribute('data-theme'), 'dark', 'this tab still went dark');
});

run('a stored value that is not a theme is ignored', () => {
  const b = browser();
  b.store.set('wa-tasks-theme', 'neon');
  assert.equal(b.getTheme(), 'system');
});

run('an unknown theme is refused rather than set', () => {
  const b = browser();
  assert.equal(b.setTheme('neon'), 'system');
  assert.equal(b.root.getAttribute('data-theme'), null);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
