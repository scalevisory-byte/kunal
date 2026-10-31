import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, onboardingStatus, openOnboarding } from '../../shared/onboarding.js';

const complete = {
  id: 1,
  name: 'Rohit Shah',
  dob: '1999-04-12',
  gender: 'Male',
  phone: '9876543210',
  designation: 'Accountant',
  department: 'Accounts',
  joined_on: '2026-11-10',
  monthly_salary: 20000,
  pan: 'ABCDE1234F',
  aadhaar: '123456789012',
  uan: '100200300400',
  esic_no: '1234567890',
  bank_name: 'SBI',
  bank_account: '30012345678',
  ifsc: 'SBIN0001234',
  cl_quota: 7,
  sl_quota: 7,
  pl_quota: 12,
  payment_mode: 'Bank',
  active: 1,
};

test('every step says what it is for, because a silent checklist gets ignored', () => {
  for (const step of STEPS) {
    assert.ok(step.title, 'a step with no title');
    assert.ok(step.why, `${step.key} does not say what breaks without it`);
    assert.ok(step.fields.length);
  }
});

test('a complete record is complete', () => {
  const status = onboardingStatus(complete);
  assert.equal(status.complete, true);
  assert.equal(status.percent, 100);
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.blocking, []);
});

test('somebody straight off the hiring tab is mostly empty, and says what is missing', () => {
  // This is exactly what "Add to payroll" produces: a name, a number, a salary.
  const fresh = {
    id: 2,
    name: 'Priya Desai',
    phone: '9000011111',
    email: 'priya@example.com',
    monthly_salary: 21000,
    joined_on: '2026-11-01',
    designation: 'Accountant',
    payment_mode: 'Bank',
    active: 1,
  };
  const status = onboardingStatus(fresh);
  assert.equal(status.complete, false);
  // Nothing required is missing - payroll will still run.
  assert.deepEqual(status.blocking, []);
  // But the things that bite later are named.
  for (const label of ['UAN', 'ESIC number', 'PAN', 'IFSC', 'Account number']) {
    assert.ok(status.missing.includes(label), `${label} was not flagged`);
  }
});

test('no joining date and no salary are the two that actually block', () => {
  const status = onboardingStatus({ name: 'Nobody', phone: '9876543210', active: 1 });
  assert.ok(status.blocking.includes('Joining date'));
  assert.ok(status.blocking.includes('Monthly salary'));
  // A salary of zero is not an answer; a leave quota of zero is.
  const zero = onboardingStatus({ ...complete, monthly_salary: 0 });
  assert.ok(zero.blocking.includes('Monthly salary'));
  const noLeave = onboardingStatus({ ...complete, cl_quota: 0, sl_quota: 0, pl_quota: 0 });
  assert.equal(noLeave.complete, true);
});

test('somebody paid in cash is not chased for bank details', () => {
  const cash = { ...complete, payment_mode: 'Cash', bank_name: '', bank_account: '', ifsc: '' };
  const chased = onboardingStatus(cash);
  assert.equal(chased.complete, false, 'without the cash hint the bank step is still open');

  const status = onboardingStatus(cash, { paidInCash: true });
  assert.equal(status.steps.find((s) => s.key === 'bank').skipped, true);
  assert.equal(status.complete, true);
});

test('a malformed number is flagged, and only once something has been typed', () => {
  const typo = onboardingStatus({ ...complete, pan: 'NOTAPAN', ifsc: '12345' });
  const statutory = typo.steps.find((s) => s.key === 'statutory');
  const bank = typo.steps.find((s) => s.key === 'bank');
  assert.deepEqual(statutory.malformed.map((f) => f.label), ['PAN']);
  assert.deepEqual(bank.malformed.map((f) => f.label), ['IFSC']);
  assert.equal(typo.complete, false);

  // Blank is "not filled in yet", never "wrong".
  const blank = onboardingStatus({ ...complete, pan: '' });
  assert.deepEqual(blank.steps.find((s) => s.key === 'statutory').malformed, []);
});

test('spaces in a typed number do not make it wrong', () => {
  const spaced = onboardingStatus({ ...complete, aadhaar: '1234 5678 9012' });
  assert.equal(spaced.complete, true);
});

test('the queue lists who is unfinished, newest joiner first, and skips leavers', () => {
  const open = openOnboarding([
    complete,
    { id: 3, name: 'Older', phone: '9000000001', joined_on: '2026-01-01', monthly_salary: 1, active: 1 },
    { id: 4, name: 'Newer', phone: '9000000002', joined_on: '2026-11-20', monthly_salary: 1, active: 1 },
    { id: 5, name: 'Gone', active: 0 },
  ]);
  assert.deepEqual(open.map((o) => o.employee.name), ['Newer', 'Older']);
  assert.ok(open[0].status.missing.length);
});
