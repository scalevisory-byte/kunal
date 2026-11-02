import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTestUrl, testFor } from '../../shared/hiringTest.js';

/*
 * The test follows the vacancy.
 *
 * Two things matter here: an opening's own test wins over the app-wide one and
 * says so, and nothing but http(s) ever reaches a candidate's iframe.
 */

const DEFAULTS = { url: 'https://tests.example.com/general', passPercent: 50 };

test("an opening's own test wins, and the answer says where it came from", () => {
  const own = testFor({ test_url: 'https://tests.example.com/accounts' }, DEFAULTS);
  assert.equal(own.url, 'https://tests.example.com/accounts');
  assert.equal(own.source, 'opening');

  const shared = testFor({ test_url: '' }, DEFAULTS);
  assert.equal(shared.url, DEFAULTS.url);
  assert.equal(shared.source, 'default', 'falling back is not the same as having its own');
});

test('no test anywhere is "none", not an error and not a blank url that looks set', () => {
  const none = testFor({}, {});
  assert.equal(none.url, '');
  assert.equal(none.source, null);
  assert.equal(none.problem, '');
});

test('a pass mark can be raised for one opening while sharing the same test', () => {
  const senior = testFor({ test_pass_percent: 70 }, DEFAULTS);
  assert.equal(senior.url, DEFAULTS.url);
  assert.equal(senior.passPercent, 70);
  assert.equal(testFor({}, DEFAULTS).passPercent, 50, 'and the default otherwise');
});

test('only http and https reach a candidate', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<h1>hi', 'file:///etc/passwd']) {
    const checked = checkTestUrl(bad);
    assert.equal(checked.url, '', bad);
    assert.notEqual(checked.problem, '', `${bad} must be reported, not silently dropped`);
  }
  assert.equal(checkTestUrl('http://localhost:3000/t').url, 'http://localhost:3000/t');
});

test('a bad link on an opening falls back but still reports the problem', () => {
  const fell = testFor({ test_url: 'javascript:alert(1)' }, DEFAULTS);
  assert.equal(fell.url, DEFAULTS.url, 'the candidate still gets a test');
  assert.notEqual(fell.problem, '', 'and the office is told its own link is wrong');
});

test('nonsense typed into the box is a problem, not a crash', () => {
  const typed = testFor({ test_url: 'ask Hema for the link' }, {});
  assert.equal(typed.url, '');
  assert.match(typed.problem, /web address/);
});

test('a pass mark the database has not set is the fallback, not a bar of nought', () => {
  // This is what SQLite hands over for a column nobody filled in, and
  // Number(null) is 0 - which is finite, and would pass everybody.
  assert.equal(testFor({ test_pass_percent: null }, DEFAULTS).passPercent, 50);
  assert.equal(testFor({ test_pass_percent: '' }, DEFAULTS).passPercent, 50);
  assert.equal(testFor({ test_pass_percent: null }, {}).passPercent, 50, 'and with no defaults');
  // Nought typed in deliberately is still nought.
  assert.equal(testFor({ test_pass_percent: 0 }, DEFAULTS).passPercent, 0);
});

test('a pass mark outside 0-100 is pulled back into range', () => {
  assert.equal(testFor({ test_pass_percent: 140 }, DEFAULTS).passPercent, 100);
  assert.equal(testFor({ test_pass_percent: -5 }, DEFAULTS).passPercent, 0);
  assert.equal(testFor({ test_pass_percent: 'abc' }, DEFAULTS).passPercent, 50, 'falls back');
});
