/**
 * Is the attendance still arriving?
 *
 * Dinesh: *"abhi pura kam live log k upar depend he ... usi attendance k hisab
 * se salary gini jayegi"*. So the chain reader → punch → mark → salary has to
 * say when it breaks, and must not cry wolf when it has not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { QUIET_DAYS_BEFORE_WORRY, daysSince, feedHealth } from '../../shared/feedHealth.js';

const NOW = new Date('2026-11-22T18:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
const spool = (over = {}) => ({ key: 'biz', name: 'Bizcompass spool', configured: true, ...over });
const reader = (over = {}) => ({ key: 'dev', name: 'Our own readers', configured: true, ...over });
const keys = (r) => r.concerns.map((c) => c.key);

/* ---------------- the rule the module exists for ---------------- */

test('A FEED NEVER SET UP IS NOT A FEED THAT BROKE', () => {
  /*
   * An office marking the grid by hand is not faulty. Reporting that as a
   * failure every morning teaches somebody to ignore the whole list, and an
   * ignored alert is worse than none - it is believed to be watching.
   */
  const got = feedHealth({ sources: [spool({ configured: false })], people: { total: 10 }, now: NOW });
  assert.deepEqual(keys(got), ['no-feed']);
  assert.equal(got.concerns[0].tone, 'info', 'not having set one up is not a warning');
  assert.equal(got.ok, true);
});

test('a feed set up and never used says exactly that', () => {
  const got = feedHealth({ sources: [reader({ lastAt: null })], people: { total: 10 }, now: NOW });
  assert.deepEqual(keys(got), ['never:dev']);
  assert.match(got.concerns[0].text, /never brought anything/);
});

/* ---------------- quiet, and too quiet ---------------- */

test('a weekend of quiet is not a broken feed', () => {
  const got = feedHealth({ sources: [spool({ lastAt: ago(QUIET_DAYS_BEFORE_WORRY) })], people: { total: 10 }, now: NOW });
  assert.deepEqual(keys(got), []);
  assert.equal(got.ok, true);
});

test('NOTHING ARRIVING WITH NO OTHER FEED IS THE BAD ONE', () => {
  const got = feedHealth({ sources: [spool({ lastAt: ago(5) })], people: { total: 10 }, now: NOW });
  const quiet = got.concerns.find((c) => c.key === 'quiet:biz');
  assert.equal(quiet.tone, 'bad');
  assert.match(quiet.text, /nothing collected for 5 days/);
  assert.match(quiet.text, /NOTHING is reaching the attendance grid/);
});

test('one feed quiet while another runs is a warning, and says so', () => {
  // Two feeds is the real protection, so the message must not read as a stop.
  const got = feedHealth({
    sources: [spool({ lastAt: ago(5) }), reader({ lastAt: ago(0) })],
    people: { total: 10 },
    now: NOW,
  });
  const quiet = got.concerns.find((c) => c.key === 'quiet:biz');
  assert.equal(quiet.tone, 'warn');
  assert.match(quiet.text, /Another feed is still arriving/);
});

test('a failure recorded on a feed is repeated in words', () => {
  const got = feedHealth({
    sources: [reader({ lastAt: ago(0), lastError: 'IN gate did not answer' })],
    people: { total: 10 },
    now: NOW,
  });
  assert.ok(keys(got).includes('error:dev'));
  assert.match(got.concerns.find((c) => c.key === 'error:dev').text, /did not answer/);
});

/* ---------------- the link that breaks most quietly ---------------- */

test('NOBODY WITH A PUNCH ID MEANS NO PUNCH REACHES ANYBODY', () => {
  // His live state: the feed is perfectly healthy and nothing arrives.
  const got = feedHealth({
    sources: [spool({ lastAt: ago(0) })],
    people: { total: 86, withoutId: 86, unknownIds: 81 },
    now: NOW,
  });
  const line = got.concerns.find((c) => c.key === 'no-punch-id');
  assert.equal(line.tone, 'bad', 'a healthy feed reaching nobody is as bad as no feed');
  assert.match(line.text, /Nobody on the staff list has a punch ID/);
  assert.equal(line.go, 'employees', 'it must point where the number is filled in');

  const unknown = got.concerns.find((c) => c.key === 'unknown-ids');
  assert.match(unknown.text, /81 punch IDs/);
});

test('some people without an ID is a warning, not a stop', () => {
  const got = feedHealth({
    sources: [spool({ lastAt: ago(0) })],
    people: { total: 86, withoutId: 4 },
    now: NOW,
  });
  const line = got.concerns.find((c) => c.key === 'no-punch-id');
  assert.equal(line.tone, 'warn');
  assert.match(line.text, /4 people have no punch ID/);
});

test('everything healthy raises nothing at all', () => {
  const got = feedHealth({
    sources: [spool({ lastAt: ago(0) }), reader({ lastAt: ago(1) })],
    people: { total: 86, withoutId: 0, unknownIds: 0 },
    now: NOW,
  });
  assert.deepEqual(got.concerns, []);
  assert.equal(got.ok, true);
});

/* ---------------- "not known" is never zero ---------------- */

test('an unknown last-seen is null, never 0 days', () => {
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince('', NOW), null);
  assert.equal(daysSince('not a date', NOW), null);
  assert.equal(daysSince(ago(0), NOW), 0);
  assert.equal(daysSince(ago(3), NOW), 3);
});

test('a clock running ahead of ours is today, not the future', () => {
  // The readers and this server do not agree to the second, and a punch
  // stamped ten minutes from now must not read as a feed from tomorrow.
  const ahead = new Date(NOW.getTime() + 10 * 60000).toISOString();
  assert.equal(daysSince(ahead, NOW), 0);
});
