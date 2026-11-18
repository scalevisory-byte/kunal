import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEMES, THEME_KEY, applyTheme, cleanTheme, readTheme, themeAttribute, writeTheme,
} from '../../shared/theme.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, '../../frontend/src/styles.css'), 'utf8');

/*
 * Dinesh: "light dark option do". Dark already worked - it followed the
 * device. What did not exist was a way to DISAGREE with the device.
 */

test('three choices, because "follow the device" is a real answer', () => {
  assert.deepEqual(THEMES.map(([k]) => k), ['system', 'light', 'dark']);
});

test('"system" writes NO attribute, so the device can keep changing its mind', () => {
  // Resolving it to light or dark here would freeze it at page load, and a
  // phone going dark at sunset would leave the app light until a reload.
  assert.equal(themeAttribute('system'), '');
  assert.equal(themeAttribute('dark'), 'dark');
  assert.equal(themeAttribute('light'), 'light');
});

test('anything unrecognised means "follow the device", never a guess', () => {
  for (const bad of ['', null, undefined, 'DARK', 'blue', 0]) {
    assert.equal(cleanTheme(bad), 'system', JSON.stringify(bad));
  }
});

test('a storage that throws cannot take the app down', () => {
  // A private window throws on merely touching localStorage - the same trap
  // the sign-in screen's Remember Me hit.
  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.equal(readTheme(hostile), 'system');
  assert.equal(writeTheme(hostile, 'dark'), 'dark', 'the choice still applies to this tab');
  assert.equal(readTheme(undefined), 'system');
});

test('choosing it stores it; going back to the device clears it', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  writeTheme(storage, 'dark');
  assert.equal(store.get(THEME_KEY), 'dark');
  assert.equal(readTheme(storage), 'dark');

  writeTheme(storage, 'system');
  assert.equal(store.has(THEME_KEY), false, 'a stored "system" would outlive a later default');
  assert.equal(readTheme(storage), 'system');
});

test('applying it puts the attribute on, and takes it off again', () => {
  const attrs = new Map();
  const el = {
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
  };
  applyTheme(el, 'dark');
  assert.equal(attrs.get('data-theme'), 'dark');
  applyTheme(el, 'system');
  assert.equal(attrs.has('data-theme'), false);
  assert.equal(applyTheme(null, 'dark'), 'dark', 'no element is not a crash');
});

/* ---------------- the stylesheet's half of the bargain ---------------- */

/** Every rule body inside a `prefers-color-scheme: dark` media query. */
const darkMediaBlocks = () => {
  const blocks = [];
  const needle = '@media (prefers-color-scheme: dark)';
  let at = css.indexOf(needle);
  while (at >= 0) {
    let i = css.indexOf('{', at);
    let depth = 0;
    let j = i;
    while (j < css.length) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') { depth -= 1; if (depth === 0) break; }
      j += 1;
    }
    blocks.push(css.slice(at, j + 1));
    at = css.indexOf(needle, j);
  }
  return blocks;
};

test('every dark block can be overruled by a light choice', () => {
  const blocks = darkMediaBlocks();
  assert.ok(blocks.length >= 3, `expected the palette, the tiles and the sign-in screen, got ${blocks.length}`);
  for (const block of blocks) {
    assert.ok(
      block.includes("[data-theme='light']"),
      `a dark block with no escape hatch means somebody on a dark laptop can never have this app light:\n${block.slice(0, 180)}`
    );
  }
});

test('choosing dark gives the same colours the device would have', () => {
  /*
   * The two bodies are identical on purpose - CSS cannot give one rule body
   * two selectors across a media query. Letting them drift is how the switch
   * and the system setting slowly stop agreeing about what dark looks like.
   */
  /** The body of the first rule after `at` whose selector matches. */
  const bodyAfter = (needle) => {
    const at = css.indexOf(needle);
    assert.ok(at >= 0, `could not find ${needle} in the stylesheet`);
    const open = css.indexOf('{', at);
    let depth = 0;
    let j = open;
    while (j < css.length) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') { depth -= 1; if (depth === 0) break; }
      j += 1;
    }
    return css.slice(open + 1, j);
  };

  const autoBody = bodyAfter("[data-theme='light']) {\n    --bg:");
  const chosenBody = bodyAfter(":root[data-theme='dark'] {\n  --bg:");

  const declarations = (body) =>
    body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes(':') && l.endsWith(';'))
      .sort();

  const a = declarations(autoBody);
  assert.ok(a.length > 10, `expected a full palette, found ${a.length}`);
  assert.deepEqual(a, declarations(chosenBody));
});

test('the theme is set before the first paint, not by a component', () => {
  // Setting it from React draws the page light and then jumps to dark - a
  // white flash on every load of a screen somebody opens forty times a day.
  const html = fs.readFileSync(path.join(here, '../../frontend/index.html'), 'utf8');
  assert.match(html, /bnf-hrms-theme/);
  assert.match(html, /data-theme/);
  assert.ok(
    html.indexOf('<script>') < html.indexOf('</head>'),
    'it has to run in the head, before anything has painted'
  );
  assert.match(html, /try\s*\{/, 'and it must survive a private window');
});
