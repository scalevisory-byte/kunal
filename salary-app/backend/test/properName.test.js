/**
 * TIDYING THE CAPITALISATION OF NAMES.
 *
 * What these pin:
 *
 *  - **A name somebody has already mixed is never touched.** McDonald and
 *    D'Souza are not mistakes, and there is no way to tell a deliberate
 *    capital from an accidental one.
 *  - ALL CAPS and all lower case both come out as ordinary names.
 *  - Initials stay capitals.
 *  - The plan says what WOULD change and nothing saves itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { namePlan, needsTidying, tidyName } from '../../shared/properName.js';

test('shouting is taken out', () => {
  assert.equal(tidyName('ANSHIKA GUPTA'), 'Anshika Gupta');
  assert.equal(tidyName('JAY RAKESH PATIL'), 'Jay Rakesh Patil');
  assert.equal(tidyName('payal wahurwagh'), 'Payal Wahurwagh');
});

test('a name already written properly is left exactly as it is', () => {
  for (const name of ['Mahek Gotawala', 'McDonald', "D'Souza", 'de Souza', 'DiMaggio', 'NaRayan']) {
    assert.equal(needsTidying(name), false, `${name} was going to be rewritten`);
  }
});

test('initials stay capitals', () => {
  assert.equal(tidyName('A. K. SHARMA'), 'A. K. Sharma');
  assert.equal(tidyName('R K GUPTA'), 'R K Gupta');
});

test('an apostrophe and a hyphen are joins inside a name, not gaps between two', () => {
  assert.equal(tidyName("D'SOUZA"), "D'Souza");
  assert.equal(tidyName('JEAN-PAUL MEHTA'), 'Jean-Paul Mehta');
});

test('two spaces are one space — otherwise it is two rows to a computer', () => {
  assert.equal(tidyName('RAKESH  DAS'), 'Rakesh Das');
  assert.equal(tidyName('  HETAL NAKUM '), 'Hetal Nakum');
});

test('the plan names what would change and counts what it deliberately left', () => {
  const plan = namePlan([
    { id: 1, name: 'ANSHIKA GUPTA', code: 'BNF-EMP-0140' },
    { id: 2, name: 'Mahek Gotawala' },
    { id: 3, name: 'payal wahurwagh' },
    { id: 4, name: 'Riya Pal' },
    { id: 5, name: "D'Souza Fernandes" },
  ]);
  assert.equal(plan.count, 2);
  assert.deepEqual(plan.changing.map((c) => c.to), ['Anshika Gupta', 'Payal Wahurwagh']);
  assert.equal(plan.changing[0].code, 'BNF-EMP-0140', 'the code travels, so the office knows who');
  assert.equal(plan.left_mixed, 3, 'the three already mixed are reported, not silently skipped');
  assert.equal(plan.total, 5);
});

test('nothing in here saves anything', () => {
  const people = [{ id: 1, name: 'ANSHIKA GUPTA' }];
  namePlan(people);
  assert.equal(people[0].name, 'ANSHIKA GUPTA', 'the plan rewrote the row it was shown');
});

test('a blank or figure-only name is not a name to tidy', () => {
  assert.equal(needsTidying(''), false);
  assert.equal(needsTidying('   '), false);
  assert.equal(needsTidying('12345'), false);
  assert.equal(namePlan([{ id: 1, name: '' }]).count, 0);
});
