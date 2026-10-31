import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyUrl,
  hiringDigest,
  publicVacancy,
  resumeRequest,
  stageMessage,
  vacancyBroadcast,
  waLink,
  waNumber,
} from '../../shared/hiringMessages.js';

const vacancy = {
  id: 7,
  ref_no: 'JOB-003',
  title: 'Accountant',
  company_id: 1,
  company_name: 'BOOKNFLY PRIVATE LIMITED',
  department: 'Accounts',
  reports_to: 'Dinesh Parmar',
  internal_notes: 'Replacing Hiral, do not mention',
  location: 'Vadodara',
  salary_min: '15000',
  salary_max: '22000',
  experience_band: '1-3 yrs',
  skills: 'Tally, GST',
  status: 'published',
};

test('the public version shows the company and hides what the office keeps', () => {
  const p = publicVacancy(vacancy);
  // Our own name, named. There is no client to keep anonymous here.
  assert.equal(p.company, 'BOOKNFLY PRIVATE LIMITED');
  assert.equal(p.salary, '15000 - 22000');
  const text = JSON.stringify(p);
  assert.ok(!text.includes('Replacing Hiral'), 'internal notes leaked');
  assert.ok(!text.includes('Dinesh Parmar'), 'who it reports to leaked');
});

test('the advert names the company and carries the apply link', () => {
  const text = vacancyBroadcast(vacancy, { baseUrl: 'https://hr.example.com/' });
  assert.ok(text.includes('Accountant'));
  assert.ok(text.includes('BOOKNFLY PRIVATE LIMITED'));
  assert.ok(text.includes('https://hr.example.com/apply/JOB-003'));
  assert.ok(text.includes('JOB-003'));
  assert.ok(!text.includes('Replacing Hiral'));
});

test('with no public URL the advert still works, it just asks for a reply', () => {
  const text = vacancyBroadcast(vacancy);
  assert.ok(!text.includes('undefined'));
  assert.ok(/reply with your cv/i.test(text));
});

test('a trailing slash on the base URL does not double up', () => {
  assert.equal(applyUrl('https://x.com//', vacancy), 'https://x.com/apply/JOB-003');
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
    const text = stageMessage(stage, { candidate, vacancy });
    assert.ok(text, `${stage} has no message`);
    assert.ok(text.includes('Rohit'), `${stage} does not use the candidate's name`);
    assert.ok(!text.includes('undefined'), `${stage} has a hole in it`);
    assert.ok(!text.includes('Replacing Hiral'), `${stage} leaked an internal note`);
  }
  // Nobody needs to be told they are "Under Review".
  assert.equal(stageMessage('Under Review', { candidate, vacancy }), null);
  assert.equal(stageMessage('New', { candidate, vacancy }), null);
});

test('the offer carries the salary and the joining date when they are known', () => {
  const text = stageMessage('Offer Sent', {
    candidate: { name: 'Rohit' },
    vacancy,
    offer: { salary: 20000, joining_date: '2026-12-01' },
  });
  assert.ok(text.includes('₹20,000'));
  assert.ok(text.includes('2026-12-01'));
});

test('selection says what to bring, because payroll will need it', () => {
  const text = stageMessage('Selected', { candidate: { name: 'Rohit' }, vacancy });
  assert.ok(/pan/i.test(text) && /aadhaar/i.test(text) && /bank/i.test(text));
});

test('a rejection keeps the person on file', () => {
  const text = stageMessage('Rejected', { candidate: { name: 'Rohit' }, vacancy });
  assert.ok(/on file|come back to you/i.test(text));
});

test('the CV chase names the job and the link', () => {
  const text = resumeRequest({
    candidate: { name: 'Rohit Shah' },
    vacancy,
    baseUrl: 'https://hr.example.com',
  });
  assert.ok(text.includes('Accountant'));
  assert.ok(text.includes('/apply/JOB-003'));
});

test('the digest says nothing pending rather than nothing at all', () => {
  assert.ok(/nothing pending/i.test(hiringDigest({})));
  const busy = hiringDigest({
    newApplications: 2,
    interviews: [{ at: '2026-11-05T11:00', candidate_name: 'Rohit Shah', job_title: 'Accountant' }],
    tasks: [{ title: 'Call Priya', due_on: '2020-01-01' }],
  });
  assert.ok(busy.includes('2 new applications'));
  assert.ok(busy.includes('11:00 Rohit Shah'));
  assert.ok(busy.includes('1 overdue'));
});
