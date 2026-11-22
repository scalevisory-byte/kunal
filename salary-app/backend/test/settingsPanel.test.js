import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { POLICY, POLICY_CHOICES, policyLabel, policyWhy } from '../../shared/lateEarly.js';

const src = (file) =>
  fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'frontend', 'src', file), 'utf8');

/**
 * A SELECT THAT ENUMERATES A CONSTANT GOES STALE, and this one did.
 *
 * The Settings panel hand-wrote two `<option>`s. Two releases later there
 * were four policies and it still offered two - so a month running on
 * `monthly_late` rendered as "concession", and touching the box would have
 * switched the month's hours target off without a word. A live money bug out
 * of a list typed in two places.
 */

test('every policy is on the one list, with a label and a reason', () => {
  for (const value of Object.values(POLICY)) {
    const choice = POLICY_CHOICES.find((c) => c.key === value);
    assert.ok(choice, `${value} is a policy with no entry on POLICY_CHOICES`);
    assert.ok(choice.label.length > 20, `${value} needs a label somebody can read`);
    assert.ok(choice.why.length > 40, `${value} needs to say what it does`);
  }
  assert.equal(POLICY_CHOICES.length, Object.values(POLICY).length);
  assert.equal(policyLabel('monthly_late').startsWith('Both'), true);
  assert.match(policyWhy('monthly_late'), /GREATER of the two, never the sum/);
  // An unknown value reads as itself rather than throwing.
  assert.equal(policyLabel('nonsense'), 'nonsense');
});

test('BOTH screens that offer the choice map over that list', () => {
  for (const file of ['components/LatePolicy.jsx', 'components/admin/Settings.jsx']) {
    const text = src(file);
    assert.match(text, /POLICY_CHOICES\.map\(/, `${file} does not read the list`);
    /*
     * And neither writes its own options. A hand-written one is exactly what
     * went stale; the comments that explain this are stripped first so an
     * explanation cannot pass for the thing it warns about.
     */
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const hardCoded = code.match(/<option value=\{POLICY\.\w+\}/g) || [];
    assert.deepEqual(hardCoded, [], `${file} still writes its own options`);
  }
});

test('the Settings select shows the month’s REAL policy', () => {
  const text = src('components/admin/Settings.jsx').replace(/\/\*[\s\S]*?\*\//g, '');
  /*
   * It used to render `onConcession ? concession : hours`, which can only
   * ever say one of two things about a month that has four.
   */
  assert.ok(
    !/value=\{\s*onConcession\s*\?/.test(text),
    'the select is guessing the policy from a boolean again'
  );
  assert.match(text, /value=\{policy\}/);
});

test('the month’s own rules are all on the Settings panel', () => {
  const text = src('components/admin/Settings.jsx');
  for (const field of [
    'hours_per_day',
    'pt_threshold',
    'pt_amount',
    'late_policy',
    'shift_in',
    'shift_out',
    'late_concession_minutes',
    'late_grace_minutes',
    'monthly_hours_grace',
  ]) {
    assert.ok(text.includes(field), `${field} belongs to the month and is not on the panel`);
  }
});

test('and it says where everything else is set, with a way to get there', () => {
  const text = src('components/admin/Settings.jsx');
  assert.match(text, /Set elsewhere/);
  assert.match(text, /onGo\?\.\(tab\)/, 'the list names tabs but cannot open them');
  // The honest half stays: what is deliberately not adjustable at all.
  assert.match(text, /What is deliberately not a setting/);
  assert.match(text, /26 working days/);
});

test('the panel still refuses to change a closed month', () => {
  const text = src('components/admin/Settings.jsx');
  assert.match(text, /That month is closed/);
  assert.match(text, /disabled=\{locked\}/);
});
