import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPublicUrl, reachablePublicly } from '../../shared/publicUrl.js';

/*
 * Where candidates reach this app. It used to be PUBLIC_URL in the server's
 * environment and nowhere else, so the only thing a screen could say was "set
 * PUBLIC_URL on the server" - useless to somebody holding a laptop. It is a
 * setting now, so what somebody can type has to be judged properly.
 */

test('an address typed the way people type it still works', () => {
  assert.equal(cleanPublicUrl('hr.booknfly.in').url, 'https://hr.booknfly.in');
  assert.equal(cleanPublicUrl('https://hr.booknfly.in/').url, 'https://hr.booknfly.in');
  assert.equal(cleanPublicUrl('  hr.booknfly.in  ').url, 'https://hr.booknfly.in');
  // A path is kept: the app may not be at the root of the domain.
  assert.equal(cleanPublicUrl('booknfly.in/hr/').url, 'https://booknfly.in/hr');
  assert.equal(cleanPublicUrl('http://hr.booknfly.in').url, 'http://hr.booknfly.in');
});

test('blank is not an error - it is "not set yet"', () => {
  assert.deepEqual(cleanPublicUrl(''), { url: '', problem: '' });
  assert.deepEqual(cleanPublicUrl(null), { url: '', problem: '' });
});

test('what is refused, and why, in the words that are actually wrong', () => {
  // This one came out as "a name on your own network" before, which is true of
  // what URL() made of it but not of what the person typed.
  assert.match(cleanPublicUrl('not a link !!').problem, /spaces/);
  assert.match(cleanPublicUrl('hrms').problem, /your own network/);
  assert.match(cleanPublicUrl('ftp://hr.booknfly.in').problem, /http/);
  assert.match(cleanPublicUrl('hr.booknfly.in/apply?ref=1').problem, /no \? or #/);
});

test('localhost can be SET but is never something to put on an advert', () => {
  // Somebody testing on their own machine is doing the right thing, so it
  // saves - but the screen has to say the link works for them alone.
  assert.equal(cleanPublicUrl('localhost:3000').url, 'https://localhost:3000');
  assert.equal(reachablePublicly('http://localhost:3000'), false);
  assert.equal(reachablePublicly('http://127.0.0.1:3000'), false);
  assert.equal(reachablePublicly('http://192.168.1.40:3000'), false);
  assert.equal(reachablePublicly('http://10.0.0.5'), false);
  assert.equal(reachablePublicly('http://172.16.4.2'), false);
  assert.equal(reachablePublicly('http://hrms.local'), false);
  assert.equal(reachablePublicly('https://hr.booknfly.in'), true);
  assert.equal(reachablePublicly(''), false);
});
