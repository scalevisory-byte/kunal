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
 * banvo". These pin the two things a stylesheet edit can quietly undo.
 */
describe('the sign-in screen', () => {
  const css = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const login = read('components/Login.jsx');
  const block = (selector) => {
    const re = new RegExp(`(^|[,}])\\s*${selector.replace('.', '\\.')}\\s*\\{([^{}]*)\\}`, 'm');
    return css.match(re)?.[2] ?? null;
  };

  it('sits in the middle of the page, not in its corner', () => {
    const page = block('.login-page');
    assert.ok(page, '.login-page is gone');
    assert.match(page, /place-items:\s*center/);
    assert.match(page, /min-height:\s*100dvh/, 'it must fill the screen to centre against');
    assert.match(login, /className="login-page"/);
  });

  it('does not colour its name with the dark sidebar\'s ink', () => {
    /* --nav-text is pale, for the navy sidebar. On the white card it vanished. */
    assert.doesNotMatch(login, /className="side-name"/, 'reuse the mark, never the name block');
    assert.match(block('.login-name strong') || '', /color:\s*var\(--text\)/);
  });

  it('can show the password, because typing it blind is what cost the lockout', () => {
    assert.match(login, /type=\{reveal \? 'text' : 'password'\}/);
    assert.match(login, /aria-label=\{reveal \? 'Hide password' : 'Show password'\}/);
  });

  it('warns about Caps Lock before the fifth attempt, not after', () => {
    assert.match(login, /getModifierState\?\.\('CapsLock'\)/);
    assert.match(login, /\{caps && /);
  });
});
