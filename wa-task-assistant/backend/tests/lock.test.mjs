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
    assert.match(css, /max-width:\s*980px\)\s*\{[\s\S]*?\.login-split \{ grid-template-columns: 1fr;/);
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

  it('"Forgot password?" opens the answer rather than going nowhere', () => {
    /* There IS no reset; the password is a variable in the hosting provider.
       The label is the mock's, the behaviour is the only useful one it has. */
    assert.match(words, /Forgot password\?/);
    assert.match(login, /onClick=\{\(\) => setWhereIsIt\(\(v\) => !v\)\}/);
    assert.match(words, /DASHBOARD_PASSWORD/);
    assert.doesNotMatch(login, /href=/, 'a link here would have nowhere to go');
  });

  it('carries the specified copy, word for word', () => {
    for (const line of ['Organize. Follow Up. Get Things Done.',
      'Manage your WhatsApp tasks, follow-ups and communications efficiently — all in one place',
      'Capture & Track', 'All your WhatsApp tasks in one place',
      'Never Miss a Follow-up', 'Stay updated with automatic reminders',
      'Be More Productive', 'Turn conversations into results',
      'Secure & Reliable', 'Your data is safe with us',
      'Welcome Back', 'Enter the dashboard password to continue.',
      'Dashboard Password', 'Keep me signed in', 'Forgot password?', 'Unlock',
      'Secure Access', 'Your data is safe and secure.',
      'Protected with industry standard security.']) {
      assert.ok(words.includes(line), `missing: ${line}`);
    }
  });

  it('still says what a lockout costs, outside that box', () => {
    /* The one fact on this screen anybody needs: an hour went to a lockout
       nothing on the page had warned about. It is not part of the two
       specified lines, so it sits under them rather than inside them. */
    assert.match(words, /Five wrong attempts lock this device for 15 minutes/);
    assert.match(login, /className="login-fine"/);
  });

  it('puts the card before the pitch on a narrow screen, with the mark above both', () => {
    /* Somebody on a phone is here to get in, not to be sold what they own. */
    const narrow = css.match(/@media \(max-width: 980px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(narrow, /\.login-hero \{ display: contents; \}/,
      'the hero must stop being a panel so its parts can be ordered');
    const order = (sel) => Number(narrow.match(new RegExp(`\\${sel}[^}]*?order:\\s*(\\d)`))?.[1] ?? -1);
    assert.ok(order('.hero-top') < order('.login-pane'), 'the mark stays on top');
    assert.ok(order('.login-pane') < order('.hero-body'), 'the card comes before the pitch');
    assert.ok(order('.hero-body') < order('.hero-foot'));
  });

  it('is right with the desk photograph and right without it', () => {
    /* The firm's own picture, not in the repository yet. No placeholder and
       no broken-image icon: the img reports its own absence and the geometric
       watermark stands back up in its place. */
    assert.match(login, /onError=\{\(\) => setDeskAt\(\(i\) => i \+ 1\)\}/);
    assert.match(login, /\{desk && \(/, 'it must stop being rendered, not merely hidden');
    /* Uploaded by hand, so the extension is whatever the phone produced. */
    assert.match(login, /const DESK = \[[^\]]*desk\.jpg[^\]]*desk\.png[^\]]*\]/s);
    assert.match(login, /const desk = deskAt < DESK\.length;/);
    /* If it is there, it must be light enough to belong on the first screen. */
    const at = new URL('../../frontend/public/brand/desk.jpg', import.meta.url);
    if (fs.existsSync(at)) {
      assert.ok(fs.statSync(at).size < 250_000, 'the desk photograph needs shrinking');
    }
    assert.match(login, /className=\{`login-pane \$\{desk \? 'has-desk' : ''\}`\}/);
    assert.match(css, /\.login-pane\.has-desk::after \{ opacity: \.025; \}/,
      'two large marks in one corner is noise: the watermark stands down');
  });

  it('keeps the photograph off a phone, with the rest of the marginalia', () => {
    assert.match(css, /max-width:\s*980px\)[\s\S]*?\.pane-desk \{ display: none; \}/);
  });

  it('draws its wallpaper from the same mark file, not a second copy of it', () => {
    assert.match(css, /\.login-pane::after[\s\S]*?brand\/scalevisory-mark\.png/);
    /* Behind the card and unclickable: it is wallpaper, not an image. */
    assert.match(css, /\.login-pane::after[\s\S]*?pointer-events: none/);
    assert.match(css, /max-width:\s*980px\)[\s\S]*?\.login-pane::after, \.pane-script, \.pane-foot, \.pane-desk \{ display: none; \}/);
  });

  it('claims no encryption it does not do', () => {
    /* The wording of the box is the owner's, asked for twice and in writing.
       What must never appear is a claim of something specific the app does
       not do: SQLite and the WhatsApp session are unencrypted at rest. */
    assert.doesNotMatch(words, /end[- ]to[- ]end|encrypt|bank[- ]grade|military/i);
  });
});

/*
 * The parent brand inside the app, not only on the way in.
 *
 * Asked as "andar bhi kahi pe scale visory ka logo laga do". It sits at the
 * foot of the navigation, which is where a product says whose it is without
 * arguing with its own name at the top of the same panel.
 */
describe('Scale Visory inside the app', () => {
  const sidebar = read('components/Sidebar.jsx');
  const css = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('shows the mark at the foot of the sidebar', () => {
    assert.match(sidebar, /className="side-parent"/);
    assert.match(sidebar, /A product of/i);
  });

  it('uses the white artwork, because that panel is navy', () => {
    /* The colour wordmark would be a dark shape on a dark sidebar. */
    assert.match(sidebar, /src="\/brand\/scalevisory-light\.png"/);
    assert.doesNotMatch(sidebar, /src="\/brand\/scalevisory\.png"/);
  });

  it('stays quieter than the app\'s own name above it', () => {
    const block = css.match(/\.side-parent img \{([^}]*)\}/)?.[1] ?? '';
    assert.match(block, /width:\s*132px/);
    const brand = css.match(/\.side-name strong \{([^}]*)\}/)?.[1] ?? '';
    assert.ok(brand.includes('700'), 'the product name keeps the heavier weight');
  });
});

/*
 * Which build is on screen, before anybody logs in.
 *
 * "I cannot see any changes" and "that has not deployed yet" look identical
 * from outside, and until now the answer sat behind the very password this
 * screen asks for. Nothing on this line is typed by a person: the commit comes
 * from the host, the bundle name is a hash of the dashboard's own contents.
 */
describe('the build stamp on the way in', () => {
  const login = read('components/Login.jsx');
  const app = read('App.jsx');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

  it('rides the one endpoint that needs no password', () => {
    assert.match(server, /auth-state[\s\S]{0,120}?required: authEnabled, build/);
    assert.match(app, /setBuild\(s\.build \|\| null\)/);
    assert.match(app, /build=\{build\}/);
  });

  it('shows nothing rather than a blank when the host reports nothing', () => {
    assert.match(login, /\{build && \(build\.commit \|\| build\.bundle\) && \(/);
  });

  it('is never hand-written', () => {
    /* A version a person types drifts from what is running, which is worse
       than no version at all. Both halves are derived. */
    assert.doesNotMatch(login, /v\d+\.\d+\.\d+/);
    assert.match(login, /build\.commit/);
    assert.match(login, /build\.bundle/);
  });
});
