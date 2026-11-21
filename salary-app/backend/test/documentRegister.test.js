import test from 'node:test';
import assert from 'node:assert/strict';
import { documentRegister, documentState, documentStatus } from '../../shared/documents.js';

/**
 * THE DOCUMENT REGISTER, and the three-state check behind it.
 */

test('NOT CHECKED IS NOT REJECTED, and the two are counted apart', () => {
  const status = documentStatus([
    { kind: 'pan', verified: 1 },
    { kind: 'aadhaar' },
    { kind: 'photo', verified: 0 },
    { kind: 'bank_proof', verified: null },
  ]);
  assert.equal(status.verified, 1);
  assert.equal(status.rejected, 1);
  assert.equal(status.unchecked, 2);
  /* All four ON FILE and all four CHECKED are different questions. */
  assert.equal(status.complete, true);
  assert.equal(status.checked, false);
});

test('one document’s state reads in a word, and expiry wins', () => {
  const today = '2026-11-21';
  assert.equal(documentState({ verified: 1 }, { today }).key, 'verified');
  assert.equal(documentState({ verified: 0 }, { today }).key, 'rejected');
  assert.equal(documentState({}, { today }).key, 'unchecked');
  /* A verified document that has since expired is EXPIRED - the tick was
     true when it was given and is not true now. */
  assert.equal(documentState({ verified: 1, expires_on: '2026-01-01' }, { today }).key, 'expired');
});

test('the register names what is missing, per person', () => {
  const reg = documentRegister(
    [{ id: 1, name: 'Amit' }, { id: 2, name: 'Riya' }],
    (id) => (id === 1 ? [{ kind: 'pan', verified: 1 }] : []),
  );
  const amit = reg.rows[0];
  assert.equal(amit.kinds.pan.key, 'verified');
  assert.equal(amit.kinds.aadhaar.key, 'missing');
  assert.ok(amit.missing.includes('Aadhaar'));
  /* Somebody with nothing at all is missing all four, not "complete". */
  assert.equal(reg.rows[1].missing.length, 4);
  assert.equal(reg.totals.complete, 0);
  assert.equal(reg.totals.missing_something, 2);
});
