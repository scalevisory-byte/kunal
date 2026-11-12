/**
 * One rule for turning a name into a username.
 *
 * There were two: the server's, for staff logins, and a second one that the
 * Admin screen grew when "admin id se user id login banane ka option do" was
 * asked for. On "Meena-Shah" they already disagreed — meena.shah against
 * meenashah — which is how two people end up being told two different
 * usernames for the same person. It lives in shared/ now, which is the
 * whole point of that folder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { usernameBase } from '../../shared/username.js';

test('a name becomes something sayable', () => {
  assert.equal(usernameBase('Amit Shah'), 'amit.shah');
  assert.equal(usernameBase('Meena Shah'), 'meena.shah');
  assert.equal(usernameBase('dinesh parmar'), 'dinesh.parmar');
  assert.equal(usernameBase('NIDHI'), 'nidhi');
});

test('a hyphen, an apostrophe and a space all read the same way', () => {
  // This is the case the two rules differed on.
  assert.equal(usernameBase('Meena-Shah'), 'meena.shah');
  assert.equal(usernameBase("O'Brien Kumar"), 'o.brien');
  assert.equal(usernameBase('Shah,  Meena'), 'shah.meena');
});

test('accents are stripped, not treated as punctuation', () => {
  // "jose", not "jos" - dropping the letter makes a different person's name.
  assert.equal(usernameBase('José Silva'), 'jose.silva');
  assert.equal(usernameBase('Renée D'), 'renee.d');
});

test('two parts at most, because the third is never typed', () => {
  assert.equal(usernameBase('Amit Kumar Shah'), 'amit.kumar');
  assert.equal(usernameBase('A B C D E'), 'a.b');
});

test('it is only ever letters, digits and a dot', () => {
  for (const name of ['Amit Shah', 'Meena-Shah', "O'Brien", 'José Silva', '  ??  ', '#$%^', 'अमित शाह']) {
    assert.match(usernameBase(name), /^[a-z0-9.]*$/, `"${name}" made something untypable`);
  }
});

test('nothing usable gives nothing, and the caller decides what to do', () => {
  // A name in a script with no Latin letters at all leaves this empty rather
  // than inventing something. createStaffLogin falls back to 'staff'; the
  // Admin screen leaves the box for a person to fill in.
  assert.equal(usernameBase('अमित शाह'), '');
  assert.equal(usernameBase(''), '');
  assert.equal(usernameBase(null), '');
  assert.equal(usernameBase(undefined), '');
});

test('it fits what createUser will accept', () => {
  // createUser wants 3-40 characters of [a-z0-9._-]. A long name must not
  // make a username the very next call refuses.
  const long = usernameBase('Chandrashekhar Venkataraghavan Balasubramanian');
  assert.ok(long.length <= 36, `${long.length} characters`);
  assert.match(long, /^[a-z0-9._-]+$/);
});
