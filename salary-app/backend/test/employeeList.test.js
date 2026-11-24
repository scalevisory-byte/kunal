/*
 * THE EMPLOYEES TAB, AUDITED.
 *
 * Two things, both the same shape: a screen saying something that is not
 * true of the record in front of it.
 *
 * 1. A `bank?` flag sat beside every name with no account number - INCLUDING
 *    everybody paid in cash, who has no bank details to be missing. The
 *    onboarding checklist already skips that step for them, with the comment
 *    *"Cash in hand needs no bank details, and saying otherwise is noise"* -
 *    so the two screens disagreed about the same person, and the flag could
 *    never be cleared. A marker that is permanently on stops being read.
 *
 * 2. The roll call printed the employee code under every name. Dinesh:
 *    *"employee id nikal do na"*. It rides on the title instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bankDetailsMissing, paidInCash, onboardingStatus } from '../../shared/onboarding.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('SOMEBODY PAID IN CASH IS NEVER MISSING BANK DETAILS', () => {
  assert.equal(bankDetailsMissing({ payment_mode: 'Cash', bank_account: '' }), false);
  assert.equal(bankDetailsMissing({ payment_mode: 'cash', bank_account: '' }), false, 'case matters and should not');
});

test('somebody paid by transfer with no account IS', () => {
  assert.equal(bankDetailsMissing({ payment_mode: 'Bank', bank_account: '' }), true);
  assert.equal(bankDetailsMissing({ payment_mode: 'Gpay', bank_account: '' }), true);
  /* No mode chosen yet: a transfer is still the assumption, so it is asked for. */
  assert.equal(bankDetailsMissing({}), true);
});

test('and once the account is there, nothing is flagged', () => {
  assert.equal(bankDetailsMissing({ payment_mode: 'Bank', bank_account: '123456789' }), false);
  assert.equal(bankDetailsMissing({ payment_mode: 'Bank', bank_account: '  123456789  ' }), false, 'spaces');
});

test('THE LIST AND THE CHECKLIST READ ONE RULE', () => {
  /*
   * The whole point: the checklist skipped the bank step for a cash employee
   * while the list flagged them. Both are `paidInCash` now.
   */
  const cash = { payment_mode: 'Cash', bank_account: '', active: 1 };
  const step = onboardingStatus(cash, { paidInCash: paidInCash(cash) }).steps.find((s) => s.key === 'bank');
  assert.equal(step.skipped, true, 'the checklist stopped skipping it');
  assert.equal(bankDetailsMissing(cash), false, 'the list and the checklist disagree again');

  const employees = noComments(read('frontend/src/components/Employees.jsx'));
  assert.match(employees, /bankDetailsMissing\(emp\)/, 'the list works it out itself again');
  assert.doesNotMatch(employees, /!emp\.bank_account &&/, 'the old unconditional flag is back');
});

test('THE ROLL CALL DOES NOT PRINT THE EMPLOYEE CODE UNDER THE NAME', () => {
  const dash = noComments(read('frontend/src/components/Dashboard.jsx'));
  assert.doesNotMatch(
    dash,
    /\{p\.employee_code \? <div className="muted small">\{p\.employee_code\}<\/div> : null\}/,
    'the code is under the name again'
  );
  /* Not deleted outright - it is one hover away. */
  assert.match(dash, /title=\{p\.employee_code \?/, 'the code is gone entirely rather than moved to the title');
});
