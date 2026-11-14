import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-offer-'));
process.env.APP_PASSWORD = '';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = (() => { try { return JSON.parse(text); } catch { return null; } })();
  return { status: res.status, body: json, text };
};

let company;
test.before(async () => {
  company = (await api('POST', '/api/companies', { name: 'BOOKNFLY PVT LTD' })).body;
});

async function reached(name = 'Amit Shah') {
  const v = (await api('POST', '/api/hiring/vacancies', {
    company_id: company.id, title: 'Travel Consultant', department: 'Operations',
    location: 'Surat', status: 'published',
  })).body;
  const c = (await api('POST', '/api/hiring/candidates', {
    name, phone: String(9300000000 + Math.floor(Math.random() * 699999999)),
  })).body;
  const { application } = (await api('POST', '/api/hiring/applications', {
    vacancy_id: v.id, candidate_id: c.id,
  })).body;
  await api('POST', `/api/hiring/applications/${application.id}/stage`, { stage: 'Interview' });
  return { vacancy: v, candidate: c, application };
}

const GOOD = {
  salary: 26000, designation: 'Travel Consultant', department: 'Operations',
  location: 'Surat', joining_date: '2027-01-12', valid_till: '2026-12-20',
  probation: '3 months', working_hours: '10:00 to 19:00',
};

const stageOf = async (id) => (await api('GET', `/api/hiring/applications/${id}`)).body.application.stage;

/* ---------------- the rule ---------------- */

test('THERE IS NO LETTER UNTIL SOMEBODY HAS APPROVED IT', async () => {
  const { application } = await reached();
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, GOOD);

  /*
   * The whole module exists for this. An unapproved letter that can be
   * downloaded is an unapproved letter that gets sent, and Dinesh wrote the
   * rule twice: "do not automatically issue an offer letter without the
   * required approval".
   */
  const early = await api('GET', `/api/hiring/applications/${application.id}/offer/letter`);
  assert.equal(early.status, 409);
  assert.match(early.body.error, /has not been approved/i);

  // ...and it cannot be skipped by jumping the offer straight to "sent".
  const jump = await api('POST', `/api/hiring/applications/${application.id}/offer/move`, {
    to: 'sent',
  });
  assert.equal(jump.status, 400);
  assert.match(jump.body.error, /cannot go from draft straight to sent/i);
  assert.equal(await stageOf(application.id), 'Interview');
});

test('an offer with no salary cannot be approved', async () => {
  const { application } = await reached();
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, {
    designation: 'Travel Consultant', joining_date: '2027-01-12',
  });
  const res = await api('POST', `/api/hiring/applications/${application.id}/offer/move`, {
    to: 'approved',
  });
  assert.equal(res.status, 400);
  // A letter quoting nothing goes out to a person, and a wrong number here is
  // a wrong payslip at the end of the first month.
  assert.match(res.body.error, /needs the monthly salary/i);
});

test('approving tells nobody — only sending moves the candidate', async () => {
  const { application } = await reached();
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, GOOD);

  const approved = await api('POST', `/api/hiring/applications/${application.id}/offer/move`, {
    to: 'approved', remarks: 'Agreed at 26,000',
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.offer.status, 'approved');

  /*
   * An approval is permission to make an offer, not an offer. The candidate
   * has not heard a word, so moving them to "Offer Sent" would be a lie on
   * the board.
   */
  assert.equal(await stageOf(application.id), 'Interview');

  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'sent' });
  assert.equal(await stageOf(application.id), 'Offer Sent');
});

/* ---------------- the letter ---------------- */

test('ONE LETTER HOLDS ONE PERSON, and loads nothing from the internet', async () => {
  const mine = await reached('Amit Shah');
  const other = await reached('Priya Nair');
  await api('PUT', `/api/hiring/applications/${other.application.id}/offer`, {
    ...GOOD, salary: 48000,
  });
  await api('PUT', `/api/hiring/applications/${mine.application.id}/offer`, GOOD);
  await api('POST', `/api/hiring/applications/${mine.application.id}/offer/move`, { to: 'approved' });

  const letter = await api('GET', `/api/hiring/applications/${mine.application.id}/offer/letter`);
  assert.equal(letter.status, 200);
  const html = letter.text;

  assert.match(html, /Amit Shah/);
  assert.match(html, /26,000/);
  // Nobody else, and nobody else's salary.
  assert.ok(!/Priya Nair/.test(html), 'another candidate is in this letter');
  assert.ok(!/48,000/.test(html), "another candidate's salary is in this letter");

  /*
   * It is opened on a phone with no signal as often as not - and a letter
   * that phones home every time it is read tells us when a candidate shows it
   * to a competitor.
   */
  assert.ok(!/\ssrc=/.test(html), 'the letter loads something');
  assert.ok(!/href=/.test(html), 'the letter links out');
  assert.ok(!/https?:\/\//.test(html), 'the letter carries a URL');
  assert.ok(!/<img/.test(html), 'the letter carries an image');

  /*
   * One inline handler, the print button, exactly as the payslip has - and
   * matched the same way. A looser /on[a-z]+=/ finds the "ontent=" inside
   * content="width=device-width" and reports a handler that is not there.
   */
  const handlers = html.match(/\son\w+="[^"]*"/g) || [];
  assert.deepEqual(handlers, [' onclick="window.print()"']);
  assert.equal(/fetch\(|XMLHttpRequest/i.test(html), false);
});

test('a script in a name is escaped, not run', async () => {
  const { application } = await reached('<script>alert(1)</script>');
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, GOOD);
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'approved' });
  const letter = await api('GET', `/api/hiring/applications/${application.id}/offer/letter`);
  assert.ok(!/<script>alert/.test(letter.text));
  assert.match(letter.text, /&lt;script&gt;/);
});

/* ---------------- after it is out ---------------- */

test('an approved offer is locked; changing it means withdrawing it', async () => {
  const { application } = await reached();
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, GOOD);
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'approved' });

  const edit = await api('PUT', `/api/hiring/applications/${application.id}/offer`, {
    ...GOOD, salary: 32000,
  });
  assert.equal(edit.status, 409);
  /*
   * The thing that was approved has to stay the thing that was approved -
   * otherwise the salary on the letter and the salary that was agreed can
   * part company, and the trail cannot say which was which.
   */
  assert.match(edit.body.error, /withdraw it to start again/i);
});

test('declining is recorded as declining, not as a rejection', async () => {
  const { application } = await reached();
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, GOOD);
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'approved' });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'sent' });
  const no = await api('POST', `/api/hiring/applications/${application.id}/offer/move`, {
    to: 'declined', remarks: 'Took another job',
  });
  assert.equal(no.status, 200);

  /*
   * The stage goes to Rejected because that is the only terminal stage this
   * pipeline has - but the OFFER says declined, with the reason. "We turned
   * them down" and "they turned us down" are different facts and only the
   * offer knows which happened.
   */
  assert.equal(await stageOf(application.id), 'Rejected');
  assert.equal(no.body.offer.status, 'declined');
  assert.equal(no.body.offer.decline_reason, 'Took another job');
});

test('an answered offer cannot be answered again', async () => {
  const { application } = await reached();
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, GOOD);
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'approved' });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'sent' });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'accepted' });

  const again = await api('POST', `/api/hiring/applications/${application.id}/offer/move`, {
    to: 'declined',
  });
  // Nothing is wrong with the login; the offer is finished. 400, not 403.
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already accepted/i);
});

test('the approved salary is what goes on the payroll', async () => {
  const { application } = await reached();
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, GOOD);
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'approved' });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'sent' });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'accepted' });
  assert.equal(await stageOf(application.id), 'Selected');

  const hired = await api('POST', `/api/hiring/applications/${application.id}/hire`, {
    monthly_salary: 26000, joined_on: '2027-01-12',
  });
  assert.equal(hired.status, 201);
  assert.equal(hired.body.employee.monthly_salary, 26000);
});

test('every step is on the audit trail', async () => {
  const { application } = await reached('Audited Offer');
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, GOOD);
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, {
    to: 'approved', remarks: 'Agreed at 26,000',
  });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'sent' });

  const { body } = await api('GET', '/api/people/audit?entity=job_offer&limit=50');
  const mine = body.entries.filter((e) => String(e.label || '').includes('Audited Offer'));
  assert.equal(mine.length, 2);
  const approval = mine.find((e) => e.to_value === 'approved');
  assert.equal(approval.action, 'approved');
  assert.equal(approval.note, 'Agreed at 26,000');
});

test('the approved figure is the one the payroll reads, with nobody retyping it', async () => {
  const { application } = await reached();
  await api('PUT', `/api/hiring/applications/${application.id}/offer`, { ...GOOD, salary: 31500 });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'approved' });

  /*
   * There used to be a second box for this on the application panel. Two
   * numbers for one fact is how a letter and a first payslip come to
   * disagree, so the offer is the only place it is typed and approving writes
   * it back to where hireApplication has always looked.
   */
  const { body } = await api('GET', `/api/hiring/applications/${application.id}`);
  assert.equal(body.application.offer_salary, 31500);
  assert.equal(body.application.joining_date, '2027-01-12');

  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'sent' });
  await api('POST', `/api/hiring/applications/${application.id}/offer/move`, { to: 'accepted' });

  // Hired without being told the salary again - it comes off the application.
  const hired = await api('POST', `/api/hiring/applications/${application.id}/hire`, {});
  assert.equal(hired.status, 201);
  assert.equal(hired.body.employee.monthly_salary, 31500);
  assert.equal(hired.body.employee.joined_on, '2027-01-12');
});
