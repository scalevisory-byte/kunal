/**
 * Getting a dead WhatsApp login back, without shell access.
 *
 * Seen on the live app: `WhatsApp: Disconnected`, "Starts so far 162", a saved
 * login of 1,246 kB on the volume, and a connection log reading `authenticated`
 * four times then OPENING -> PAIRING -> **UNPAIRED**. The device had been
 * removed from the phone, so the stored login was dead — and the disconnected
 * handler only wrote the reason down. No `qr` event ever fired again, every
 * restart authenticated with the same dead session and was unpaired again, and
 * with no shell there was no way back. That is exactly the situation serving
 * the QR over HTTP exists to prevent.
 *
 * The risk in fixing it is the opposite mistake: throwing away a HEALTHY login
 * because the network hiccuped, which costs a scan for nothing. So most of
 * what is pinned here is which reasons must NOT clear the session.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/whatsapp.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../src/routes/system.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(
  new URL('../../frontend/src/components/StatusBar.jsx', import.meta.url), 'utf8');

/** The rule under test, read out of the source so it cannot drift from it. */
const match = src.match(/const isUnlinked = \(reason\) => (.+);/);
const RULE = new RegExp(
  match[1].match(/\/(.+)\/([a-z]*)\.test/)[1],
  match[1].match(/\/(.+)\/([a-z]*)\.test/)[2],
);
const isUnlinked = (reason) => RULE.test(String(reason || ''));

describe('which disconnects mean the login is gone', () => {
  it('treats an unlinked device as gone — the case that stranded the live app', () => {
    assert.equal(isUnlinked('UNPAIRED'), true);
    assert.equal(isUnlinked('LOGOUT'), true);
  });

  it('NEVER throws the login away for a disconnect that heals itself', () => {
    // Each of these leaves the stored login valid. Clearing it would force a
    // scan from his phone because the wifi dropped for a moment.
    for (const reason of ['NAVIGATION', 'CONFLICT', 'TIMEOUT', 'UNLAUNCHED', '', null, undefined]) {
      assert.equal(isUnlinked(reason), false, `${reason} would have cost the login`);
    }
  });
});

describe('the recovery', () => {
  it('destroys the browser before deleting the profile', () => {
    // Chromium holds files inside the profile while it runs. Removing the
    // directory underneath it leaves a half-deleted profile that fails to
    // open, turning "scan again" into "the app will not start".
    const body = src.slice(src.indexOf('export async function relink'));
    const destroy = body.indexOf('client.destroy');
    const remove = body.indexOf('rmSync');
    assert.ok(destroy > -1 && remove > -1, 'relink does not both destroy and delete');
    assert.ok(destroy < remove, 'the profile is deleted while Chromium still holds it');
  });

  it('starts again, so a fresh QR can actually appear', () => {
    const body = src.slice(src.indexOf('export async function relink'));
    assert.match(body, /startWhatsApp\(\)/, 'nothing restarts, so no QR is ever produced');
  });

  it('cannot run twice at once — each one starts a Chromium', () => {
    assert.match(src, /let relinking = false/);
    const body = src.slice(src.indexOf('export async function relink'));
    assert.match(body, /if \(relinking\)/);
    assert.match(body, /finally \{\s*relinking = false/);
  });

  it('is reachable by hand, because a session that died while the app was down sends no event', () => {
    assert.match(routes, /whatsapp\/relink/);
    assert.match(panel, /RelinkButton/, 'the dashboard offers no way to ask for it');
  });

  it('asks before it acts, because it costs a trip to the phone', () => {
    const button = panel.slice(panel.indexOf('function RelinkButton'), panel.indexOf('export default'));
    assert.match(button, /asking/, 'it would clear the login on a single stray click');
    assert.match(button, /have to scan it/i, 'the confirmation does not say what it costs');
  });

  it('only offers the button when the connection is not healthy', () => {
    assert.match(panel, /state !== 'ready' && state !== 'qr' &&\s*\(\s*<RelinkButton/,
      'a working connection should not be offered a button that breaks it');
  });
});
