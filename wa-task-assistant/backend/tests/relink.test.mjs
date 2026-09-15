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
    assert.match(body, /startWhatsApp\(\{ force: true \}\)/,
      'nothing restarts, so no QR is ever produced');
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

/**
 * Not asking WhatsApp to pair a thousand times while nobody is holding a phone.
 *
 * Reported as "still scan nahi ho raha — phone me Try again later hi aa raha
 * he". The library defaults `qrMaxRetries` to 0, which means UNLIMITED, and
 * this app never set it: an unpaired client asks for a fresh pairing code
 * every ~20 seconds, for ever. Sitting disconnected for seven hours, as it
 * was, that is over a thousand requests to link one account — and WhatsApp
 * answers that with "Try again later", so the one scan actually being watched
 * fails too.
 */
const config = fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');

describe('how many pairing codes the app may ask for', () => {
  it('is bounded — the library default is unlimited and that is the bug', () => {
    assert.match(config, /qrMaxRetries: num\(process\.env\.QR_MAX_RETRIES, (\d+)\)/);
    const limit = Number(config.match(/QR_MAX_RETRIES, (\d+)\)/)[1]);
    assert.ok(limit > 0, 'unlimited again — this is what earned "Try again later"');
    assert.ok(limit <= 60, `${limit} codes is twenty minutes of asking nobody`);
  });

  it('is actually passed to the client, not merely configured', () => {
    assert.match(src, /qrMaxRetries: config\.qrMaxRetries/,
      'the setting exists but the client still uses the unlimited default');
  });

  it('giving up is a resting state, never a reason to clear the login', () => {
    // From the handler to the unlink branch inside it. Sliced by those two
    // markers rather than by "relink({ reason", which also matches the
    // function's own signature far earlier in the file.
    const handler = src.slice(
      src.indexOf("client.on('disconnected'"),
      src.indexOf('if (isUnlinked(reason))'),
    );
    assert.match(handler, /Max qrcode retries/i, 'giving up is not recognised');
    // It must return before the unlink branch: losing the stored login because
    // nobody scanned for four minutes would be a much worse bug than the one
    // being fixed.
    const gaveUp = src.indexOf('Max qrcode retries');
    const unlink = src.indexOf('if (isUnlinked(reason))');
    assert.ok(gaveUp < unlink, 'the give-up case falls through to clearing the login');
    assert.equal(/Max qrcode retries/i.test('UNPAIRED'), false);
    assert.equal(isUnlinked('Max qrcode retries reached'), false,
      'giving up would have wiped the session');
  });

  it('offers a way to ask again that does NOT throw the login away', () => {
    assert.match(src, /export async function showQr/);
    const body = src.slice(src.indexOf('export async function showQr'), src.indexOf('export async function relink'));
    assert.ok(!/rmSync/.test(body), 'the safe button deletes the session too');
    assert.match(body, /startWhatsApp\(\{ force: true \}\)/);
  });

  it('tells him to open Linked devices BEFORE pressing it', () => {
    // A code that appears while the phone is still locked is a code that
    // expires before it is scanned, which is how the retries got spent.
    assert.match(panel, /Linked devices/);
    assert.match(panel, /Try again later/, 'the panel does not name the message he is seeing');
  });
});

/**
 * Which row in his Linked devices list is this app, and how long it has been
 * dead.
 *
 * From his phone: a device he had renamed by hand to "WA TASK", reported as
 * "Google Chrome (Mac OS)", **last active 22 July** — eight weeks — with
 * WhatsApp's own banner saying "Logging out today. Linked devices
 * automatically log out if they haven't been active in a while."
 *
 * Two things were wrong, and both are the app's. It linked under a name
 * indistinguishable from any browser left signed in, on a list capped at four
 * devices where telling a dead row from a live one decides whether you free a
 * slot or unlink the wrong thing. And the dashboard said "Disconnected" — the
 * same word after a minute and after two months, with the link rotting toward
 * an unlink somewhere in between.
 */
describe('the linked device', () => {
  it('says which app it is, instead of posing as a browser', () => {
    assert.match(src, /deviceName: 'WA Tasks'/);
    assert.match(src, /browserName: 'WA Tasks'/);
  });

  it('records the moment the link genuinely worked, and keeps it across restarts', () => {
    // Derived state would reset on every deploy - and it restarts on every
    // deploy - so the one figure worth having has to be written down.
    assert.match(src, /setMeta\('last_ready_at'/, 'nothing records when it last worked');
    assert.match(src, /getMeta\('last_ready_at'\)/, 'it is written but never read back');
    // Searched FROM the handler, not from the top of the file: runCatchUpOnce
    // is declared far above it, so a bare indexOf ends the slice before it
    // begins and quietly matches nothing.
    const readyAt = src.indexOf("client.on('ready'");
    const ready = src.slice(readyAt, src.indexOf('runCatchUpOnce', readyAt));
    assert.match(ready, /last_ready_at/, 'it is not recorded at the moment it became ready');
  });

  it('reports it, so the panel can say how long rather than just "Disconnected"', () => {
    assert.match(routes, /lastReadyAt: state\.lastReadyAt/);
    assert.match(panel, /last worked/i);
    assert.match(panel, /idle/i, 'the panel does not explain why an old link stops working');
  });

  it('stays quiet about a link that dropped a moment ago', () => {
    // A blip is not a rotting link, and saying so on every brief disconnect is
    // how a warning stops being read.
    assert.match(panel, /days < 2\) return null/);
  });
});

/**
 * Not spending pairing attempts on an empty room.
 *
 * With the QR appearing correctly and the phone still answering "Try again
 * later", the limit is already in force on the account — and something was
 * still feeding it. A client that starts unlinked begins requesting pairing
 * codes at once, a dozen of them, whether or not anyone is holding a phone.
 * This app restarts on every deploy, so an ordinary day of work spends scores
 * of pairing requests nobody ever saw, which is exactly what keeps the refusal
 * in force for the one scan that IS being watched.
 */
describe('when the app may ask WhatsApp to pair', () => {
  it('does not ask at all when there is no saved login', () => {
    const body = src.slice(src.indexOf('export function startWhatsApp'));
    assert.match(body, /if \(!force && !sessionOnDisk\(\)\.loggedIn\)/,
      'an unlinked restart still starts requesting codes on its own');
    const gate = body.slice(0, body.indexOf('client = new Client'));
    assert.match(gate, /return null/, 'the gate does not actually stop the client starting');
  });

  it('still reconnects by itself when a login IS saved', () => {
    // The gate must not cost a working install its automatic reconnect after
    // a deploy; that would trade one problem for a worse one.
    const body = src.slice(src.indexOf('export function startWhatsApp'));
    const gate = body.slice(0, body.indexOf('client = new Client'));
    assert.match(gate, /!sessionOnDisk\(\)\.loggedIn/,
      'the gate fires on something other than the absence of a login');
  });

  it('both deliberate paths force it, because a person is waiting', () => {
    const showQr = src.slice(src.indexOf('export async function showQr'), src.indexOf('export async function relink'));
    const relink = src.slice(src.indexOf('export async function relink'));
    assert.match(showQr, /startWhatsApp\(\{ force: true \}\)/, 'the QR button would do nothing');
    assert.match(relink.slice(0, relink.indexOf('\n}')), /startWhatsApp\(\{ force: true \}\)/,
      'relink would clear the login and then not come back');
  });

  it('says so on the page, including that only time clears the refusal', () => {
    assert.match(panel, /needs_link/);
    assert.match(panel, /only time clears it/i,
      'the page does not say that pressing again makes the wait longer');
  });
});
