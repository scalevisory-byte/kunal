/**
 * There is a way to lock the dashboard again.
 *
 * Asked as "are vapas lock kese karna he" - the app had a login screen and no
 * way back out of it. The token lives in localStorage, so once a password was
 * typed the dashboard stayed open for ever on that browser: on a shared
 * machine, or the remote desktop this was actually being used from, the only
 * way to shut it was to clear the site's data.
 *
 * These read the source rather than the API, because the whole mechanism is in
 * the client - the server has no session to end.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../frontend/src/${p}`, import.meta.url), 'utf8');
const app = read('App.jsx');
const header = read('components/Header.jsx');
const icons = read('components/Icon.jsx');

describe('locking the dashboard', () => {
  it('drops the token and puts the login screen back', () => {
    const handler = app.match(/onLock=\{[^}]*\}/)?.[0] ?? '';
    assert.match(handler, /setToken\(null\)/, 'the stored password must be forgotten');
    assert.match(handler, /setNeedsAuth\(true\)/, 'and the login screen must come back');
  });

  it('is offered only when a password is actually set', () => {
    assert.match(app, /onLock=\{authRequired \?/, 'the button must be gated on a password existing');
    /* A button that shuts a door with no lock is worse than no button. */
    assert.match(header, /\{onLock && \(/, 'Header must not render it unconditionally');
  });

  it('reads the same answer as the "no password" banner, so the two cannot disagree', () => {
    const call = app.match(/api\.authState\(\)[\s\S]{0,200}?catch/)?.[0] ?? '';
    assert.match(call, /setAuthOpen\(!s\.required\)/);
    assert.match(call, /setAuthRequired\(Boolean\(s\.required\)\)/);
    /* Derived from `!authOpen` it would be wrong until the server answered. */
    assert.doesNotMatch(app, /onLock=\{!authOpen/);
  });

  it('has an icon of its own, on the shared grid', () => {
    assert.match(icons, /\n  lock: '/, 'no lock glyph in the one icon set');
    assert.match(header, /<Icon name="lock"/);
  });

  it('sits with the other one-press controls, not inside a menu', () => {
    const actions = header.match(/topbar-actions[\s\S]*?<\/div>/)?.[0] ?? '';
    assert.match(actions, /aria-label="Lock the dashboard"/, 'it must be in the top bar itself');
  });
});

/*
 * The way in is the first thing anybody sees.
 *
 * It was a heading and a field in the top-left corner of a blank white page,
 * because `.login` centred its TEXT and never itself. Asked as "isko attractive
 * banvo", then "isko bolte he login screen" over a two-panel mock. These pin
 * what a later stylesheet edit could quietly undo - and the two places where
 * the page deliberately departs from that mock, which are the two places a
 * pretty screen would otherwise tell a lie.
 */
describe('the sign-in screen', () => {
  const css = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const login = read('components/Login.jsx');
  const api = read('api.js');
  /* What the screen actually SAYS: comments stripped, wrapping undone. The
     notes below explain why a phrase is absent, and would match a test for it. */
  const words = login.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  const block = (selector) => {
    const re = new RegExp(`(^|[,}])\\s*${selector.replace(/\./g, '\\.')}\\s*\\{([^{}]*)\\}`, 'm');
    return css.match(re)?.[2] ?? null;
  };

  it('is two panels on a wide screen and one on a narrow one', () => {
    const split = block('.login-split');
    assert.ok(split, '.login-split is gone');
    assert.match(split, /grid-template-columns:\s*1\.15fr 1fr/);
    assert.match(split, /min-height:\s*100dvh/);
    /* Below 980 the panel goes above the card instead of beside it. */
    assert.match(css, /max-width:\s*980px\)\s*\{[\s\S]*?\.login-split \{ grid-template-columns: 1fr; \}/);
  });

  it('drops the selling points before the card on a narrow screen', () => {
    /* Four of them above a password field is a page you scroll to log in. */
    assert.match(css, /max-width:\s*980px\)[\s\S]*?\.hero-points, \.hero-foot \{ display: none; \}/);
  });

  it('does not colour the name with the dark sidebar\'s ink', () => {
    assert.doesNotMatch(login, /className="side-name"/, 'that colour is for the navy sidebar');
  });

  it('keeps the wordmark readable in the dark theme', () => {
    /* --brand-deep stays near-black in dark, where this sits on a dark ground. */
    assert.match(block('.hero-title span') || '', /color:\s*var\(--text\)/);
  });

  it('uses the firm\'s published mark, not a type lockup standing in for it', () => {
    assert.match(login, /src="\/brand\/scalevisory\.png"/);
    for (const file of ['scalevisory.png', 'scalevisory-light.png']) {
      const at = new URL(`../../frontend/public/brand/${file}`, import.meta.url);
      assert.ok(fs.existsSync(at), `${file} is missing from public/brand`);
      /* Small enough to belong on a login screen: this is the first request. */
      assert.ok(fs.statSync(at).size < 60_000, `${file} is too heavy for a sign-in screen`);
    }
  });

  it('swaps to the white mark on the dark theme, by the pattern the rest uses', () => {
    /* The navy wordmark on the dark ground is a hole in the panel. */
    assert.match(login, /src="\/brand\/scalevisory-light\.png"/);
    assert.match(css, /prefers-color-scheme: dark\)[\s\S]{0,200}?\.hero-logo \.on-dark \{ display: block; \}/);
    assert.match(css, /:root\[data-theme="dark"\] \.hero-logo \.on-dark \{ display: block; \}/);
    /* Unguarded, :not([data-theme="light"]) also matches a LIGHT default. */
    assert.doesNotMatch(css, /\n:root:not\(\[data-theme="light"\]\) \.hero-logo/);
  });

  it('can show the password, because typing it blind is what cost the lockout', () => {
    assert.match(login, /type=\{reveal \? 'text' : 'password'\}/);
    assert.match(login, /aria-label=\{reveal \? 'Hide password' : 'Show password'\}/);
  });

  it('warns about Caps Lock before the fifth attempt, not after', () => {
    assert.match(login, /getModifierState\?\.\('CapsLock'\)/);
    assert.match(login, /\{caps && /);
  });

  /* ---- the two departures from the mock ---- */

  it('"Keep me signed in" actually decides where the password is kept', () => {
    assert.match(login, /onSubmit\(password\.trim\(\), \{ remember \}\)/);
    assert.match(api, /remember \? window\.localStorage : window\.sessionStorage/);
  });

  it('forgetting clears both stores, so a lock cannot leave a copy behind', () => {
    const fn = api.match(/export function setToken[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(fn, /for \(const store of stores\(\)\)[\s\S]*?removeItem/);
    assert.ok(fn.indexOf('removeItem') < fn.indexOf('if (!token) return'),
      'both stores must be cleared before the new token is written');
  });

  it('offers no "Forgot password?", because there is nothing to reset', () => {
    assert.doesNotMatch(words, /Forgot password\?/);
    /* It says where the password actually lives instead. */
    assert.match(words, /DASHBOARD_PASSWORD/);
  });

  it('makes no security claim the audit does not support', () => {
    /* SQLite and the session file are not encrypted at rest; one shared
       password, no 2FA. "Industry standard security" would be a sentence the
       app cannot stand behind, printed on the first screen. */
    assert.doesNotMatch(words, /industry standard|bank[- ]grade|military/i);
    assert.match(words, /lock the device for fifteen minutes/);
  });
});
