import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_FIELDS,
  NEVER_ON_A_CONTACT_LIST,
  contactLine,
  contactList,
} from '../../shared/contactList.js';

const AMIT = {
  id: 1, name: 'Amit Shah', code: 'BNF-001', company_id: 1, company_name: 'BOOKNFLY',
  department: 'Accounts', designation: 'Accountant', phone: '9800000001', email: 'amit@x.com',
  /* Everything that must not travel. */
  monthly_salary: 26000, basic: 13000, pan: 'ABCDE1234F', aadhaar: '1111 2222 3333',
  bank_account: '0123456789', ifsc: 'HDFC0001234', uan: '100200300400', dob: '1990-01-01',
};

test('A CONTACT LIST CARRIES NO SALARY, NO PAN AND NO BANK DETAILS', () => {
  /* It gets printed, forwarded and left on a desk. The employee export
     carries forty columns including salaries; this is deliberately not
     that. */
  const line = contactLine(AMIT);
  const text = JSON.stringify(line);
  for (const field of NEVER_ON_A_CONTACT_LIST) {
    assert.ok(!(field in line), `${field} is on the contact line`);
  }
  assert.ok(!text.includes('26000'), 'the salary travelled');
  assert.ok(!text.includes('ABCDE1234F'), 'the PAN travelled');
  assert.ok(!text.includes('0123456789'), 'the bank account travelled');
  assert.ok(!text.includes('1990-01-01'), 'the date of birth travelled');
});

test('the whole of what it can ever show is one list', () => {
  const line = contactLine(AMIT);
  const extra = Object.keys(line).filter(
    (k) => !CONTACT_FIELDS.some(([key]) => key === k) && !['employee_id', 'missing'].includes(k)
  );
  /* A column cannot be added to this by accident later. */
  assert.deepEqual(extra, []);
});

test('somebody who has left is not on the list', () => {
  const { lines, totals } = contactList([
    AMIT,
    { id: 2, name: 'Gone Away', active: 0, company_name: 'BOOKNFLY' },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(totals.people, 1);
});

test('a missing number is SHOWN as missing, not left out', () => {
  const { lines, totals } = contactList([
    AMIT,
    { id: 2, name: 'Riya Pal', company_name: 'BOOKNFLY', department: 'Sales' },
  ]);
  /* Dropping them would hide exactly the people the list exists to chase. */
  assert.equal(lines.length, 2);
  const riya = lines.find((l) => l.name === 'Riya Pal');
  assert.equal(riya.phone, '');
  assert.deepEqual(riya.missing.sort(), ['email', 'mobile', 'role']);
  assert.equal(totals.no_mobile, 1);
  assert.equal(totals.with_mobile, 1);
});

test('it narrows by company, by department and by what you type', () => {
  const people = [
    AMIT,
    { id: 2, name: 'Riya Pal', company_id: 1, company_name: 'BOOKNFLY', department: 'Sales',
      phone: '9800000002' },
    { id: 3, name: 'Kiran Desai', company_id: 2, company_name: 'SCALE', department: 'Sales' },
  ];
  assert.equal(contactList(people, { company_id: 1 }).lines.length, 2);
  assert.equal(contactList(people, { department: 'Sales' }).lines.length, 2);
  assert.equal(contactList(people, { q: 'account' }).lines.length, 1, 'matches the role too');
  assert.equal(contactList(people, { q: '9800000002' }).lines.length, 1, 'matches a number');
});

test('it reads in the order somebody looks things up in', () => {
  const { lines } = contactList([
    { id: 1, name: 'Zoya', company_name: 'BOOKNFLY', department: 'Sales' },
    { id: 2, name: 'Amit', company_name: 'SCALE', department: 'Accounts' },
    { id: 3, name: 'Bela', company_name: 'BOOKNFLY', department: 'Accounts' },
  ]);
  /* Company, then department, then name - how you read it when you are
     looking for "whoever is in Accounts". */
  assert.deepEqual(lines.map((l) => l.name), ['Bela', 'Zoya', 'Amit']);
});
