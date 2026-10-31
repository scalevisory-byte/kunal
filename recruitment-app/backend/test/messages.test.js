import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyUrl,
  publicVacancy,
  resumeRequest,
  stageMessage,
  vacancyBroadcast,
  waLink,
  waNumber,
} from '../../shared/messages.js';

const vacancy = {
  id: 7,
  ref_no: 'REQ-003',
  title: 'Accountant',
  client_company: 'Patel Textiles Pvt Ltd',
  public_company: 'A textile manufacturer',
  location: 'Vadodara',
  salary_min: '15000',
  salary_max: '22000',
  experience_band: '1-3 yrs',
  skills: 'Tally, GST',
  status: 'published',
};

test("the public version of a vacancy does not carry the client's name", () => {
  const p = publicVacancy(vacancy);
  const text = JSON.stringify(p);
  assert.ok(!text.includes('Patel Textiles'), 'the client company leaked into the public shape');
  assert.equal(p.company, 'A textile manufacturer');
  assert.equal(p.salary, '15000 - 22000');
  assert.equal(p.ref_no, 'REQ-003');
});

test('the broadcast is shareable and carries the apply link, not the client', () => {
  const text = vacancyBroadcast(vacancy, {
    baseUrl: 'https://jobs.example.com/',
    brand: 'ZYNTA',
  });
  assert.ok(!text.includes('Patel Textiles'));
  assert.ok(text.includes('Accountant'));
  assert.ok(text.includes('https://jobs.example.com/apply/REQ-003'));
  assert.ok(text.includes('REQ-003'));
  assert.ok(text.includes('ZYNTA'));
});

test('with no public URL the broadcast still works, it just asks for a reply', () => {
  const text = vacancyBroadcast(vacancy, { brand: 'ZYNTA' });
  assert.ok(!text.includes('undefined'));
  assert.ok(/reply with your cv/i.test(text));
});

test('a trailing slash on the base URL does not double up', () => {
  assert.equal(applyUrl('https://x.com//', vacancy), 'https://x.com/apply/REQ-003');
});

test('a wa.me link puts the country code on a 10-digit number', () => {
  assert.equal(waNumber('98765 43210'), '919876543210');
  assert.equal(waNumber('+91 98765 43210'), '919876543210');
  assert.equal(waNumber(''), '');
  assert.equal(waLink('', 'hi'), '');
  assert.ok(waLink('9876543210', 'hi there').startsWith('https://wa.me/919876543210?text=hi%20there'));
});

test('every stage worth telling someone about has words for it', () => {
  const candidate = { name: 'Rohit Shah', phone: '9876543210' };
  for (const stage of ['Shortlisted', 'Interview', 'Offer Sent', 'Selected', 'Joined', 'Rejected']) {
    const text = stageMessage(stage, { candidate, vacancy, brand: 'ZYNTA' });
    assert.ok(text, `${stage} has no message`);
    assert.ok(text.includes('Rohit'), `${stage} does not use the candidate's name`);
    assert.ok(!text.includes('undefined'), `${stage} has a hole in it`);
    // Not even in a message to the candidate: they are told by a person.
    assert.ok(!text.includes('Patel Textiles'), `${stage} leaked the client's name`);
  }
  // Nobody needs to be told they are "Under Review".
  assert.equal(stageMessage('Under Review', { candidate, vacancy }), null);
  assert.equal(stageMessage('New', { candidate, vacancy }), null);
});

test('a rejection keeps the person on the books', () => {
  const text = stageMessage('Rejected', { candidate: { name: 'Rohit' }, vacancy });
  assert.ok(/stays with us|come back to you/i.test(text));
});

test('the CV chase names the job and the link', () => {
  const text = resumeRequest({
    candidate: { name: 'Rohit Shah' },
    vacancy,
    baseUrl: 'https://jobs.example.com',
  });
  assert.ok(text.includes('Accountant'));
  assert.ok(text.includes('/apply/REQ-003'));
});
