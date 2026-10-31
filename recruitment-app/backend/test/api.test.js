import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A throwaway database and résumé folder, set before anything imports config.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'recruit-test-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.PUBLIC_URL = 'https://jobs.example.com';
process.env.SERVE_FRONTEND = 'false';
process.env.FEE_PERCENT = '8.33';
process.env.GST_PERCENT = '18';

const { createServer } = await import('../src/server.js');
const { config } = await import('../src/config.js');

const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/** The recruiter: every call carries the shared secret. */
const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.APP_PASSWORD}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/** A candidate: no password, because a candidate cannot have one. */
const open = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let vacancyId;
let vacancyRef;
let candidateId;
let applicationId;
let uploadToken;

/* ---------------- the wall between the two sides ---------------- */

test('the recruiter side needs the password; the candidate side does not', async () => {
  const noAuth = await fetch(`${base}/api/vacancies`);
  assert.equal(noAuth.status, 401);

  const wrong = await fetch(`${base}/api/vacancies`, {
    headers: { authorization: 'Bearer guess' },
  });
  assert.equal(wrong.status, 401);

  assert.equal((await open('GET', '/api/public/vacancies')).status, 200);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

/* ---------------- step 1: a vacancy ---------------- */

test('a vacancy is created as a draft and published deliberately', async () => {
  const created = await api('POST', '/api/vacancies', {
    title: 'Accountant',
    client_company: 'Patel Textiles Pvt Ltd',
    public_company: 'A textile manufacturer',
    location: 'Vadodara',
    experience_band: '1-3 yrs',
    salary_min: '15000',
    salary_max: '22000',
    skills: 'Tally, GST, Excel',
    education: 'B.Com',
    positions: 2,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'draft');
  assert.match(created.body.ref_no, /^REQ-\d{3}$/);
  vacancyId = created.body.id;
  vacancyRef = created.body.ref_no;

  // A draft is not an advert: nobody outside can see it or apply to it.
  assert.deepEqual((await open('GET', '/api/public/vacancies')).body.vacancies, []);
  assert.equal((await open('GET', `/api/public/vacancies/${vacancyRef}`)).status, 404);
  assert.equal(
    (await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
      name: 'Too Early',
      phone: '9000000000',
    })).status,
    404
  );

  assert.equal((await api('PATCH', `/api/vacancies/${vacancyId}`, { status: 'published' })).status, 200);
  assert.equal((await open('GET', '/api/public/vacancies')).body.vacancies.length, 1);
});

/* ---------------- step 2: sharing it ---------------- */

test("what goes out to share a job never carries the client's name", async () => {
  const share = await api('GET', `/api/vacancies/${vacancyId}/share`);
  assert.equal(share.status, 200);
  assert.equal(share.body.apply_url, `https://jobs.example.com/apply/${vacancyRef}`);
  const everything = JSON.stringify(share.body);
  assert.ok(!everything.includes('Patel Textiles'), 'the client company leaked into the share payload');

  const advert = await open('GET', `/api/public/vacancies/${vacancyRef}`);
  assert.ok(!JSON.stringify(advert.body).includes('Patel Textiles'));
  assert.equal(advert.body.vacancy.company, 'A textile manufacturer');
});

/* ---------------- steps 3 and 4: applying, with and without a CV ---------------- */

test('a candidate applies, and the application scores itself', async () => {
  const applied = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
    name: 'Rohit Shah',
    phone: '+91 98765 43210',
    email: 'rohit@example.com',
    location: 'Bhayli, Vadodara',
    experience: '2 years',
    skills: 'Tally, GST, Excel, Busy',
    education: 'B.Com',
    expected_salary: '20000',
  });
  assert.equal(applied.status, 201);
  assert.equal(applied.body.ok, true);
  assert.equal(applied.body.new_candidate, true);
  assert.match(applied.body.candidate_ref, /^CAN-\d{3}$/);
  uploadToken = applied.body.upload_token;
  assert.ok(uploadToken);

  // A candidate is told nothing about where they stand or how they scored.
  const text = JSON.stringify(applied.body);
  assert.ok(!/match_score|"stage"|Patel Textiles/.test(text), `apply leaked: ${text}`);

  const { rows } = (await api('GET', `/api/applications?vacancy_id=${vacancyId}`)).body;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, 'New');
  assert.ok(rows[0].match_score >= 85, `scored ${rows[0].match_score}`);
  candidateId = rows[0].candidate_id;
  applicationId = rows[0].id;
});

test('a missing name or a short number is refused with something readable', async () => {
  const noName = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, { phone: '9898989898' });
  assert.equal(noName.status, 400);
  assert.match(noName.body.error, /name/i);

  const shortNumber = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
    name: 'Short Number',
    phone: '98765',
  });
  assert.equal(shortNumber.status, 400);
  assert.match(shortNumber.body.error, /10-digit/i);
});

test('applying twice updates the person and does not duplicate the application', async () => {
  const again = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
    name: 'Rohit Shah',
    phone: '9876543210',
    // Blank, and must not wipe what the fuller application already gave us.
    expected_salary: '',
    // New, and must be filled in.
    notice_period: '1 month',
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.already_applied, true);

  const { rows } = (await api('GET', `/api/applications?vacancy_id=${vacancyId}`)).body;
  assert.equal(rows.length, 1);

  const { candidate } = (await api('GET', `/api/candidates/${candidateId}`)).body;
  assert.equal(candidate.notice_period, '1 month');
  assert.equal(candidate.expected_salary, '20000');
  // The mobile number is stored as 10 digits however it was typed, which is
  // the whole reason the same person is one row and not three.
  assert.equal(candidate.phone, '9876543210');
});

test('a CV goes on disk, never into the row, and comes back through a signed link', async () => {
  const form = new FormData();
  form.set('resume', new Blob([Buffer.from('%PDF-1.4 a real-ish cv')], { type: 'application/pdf' }), 'Rohit CV.pdf');
  const upload = await fetch(`${base}/api/public/resume/${uploadToken}`, { method: 'POST', body: form });
  assert.equal(upload.status, 201);

  const { candidate, resume } = (await api('GET', `/api/candidates/${candidateId}`)).body;
  // The row keeps a generated filename, not the one the candidate typed.
  assert.ok(!candidate.resume_path.includes(' '));
  assert.equal(candidate.resume_name, 'Rohit CV.pdf');
  assert.ok(fs.existsSync(path.join(config.resumeDir, candidate.resume_path)));
  assert.ok(resume.url.startsWith(`/files/resume/${candidateId}?exp=`));

  // The signed link works without any password - that is its job.
  const download = await fetch(`${base}${resume.url}`);
  assert.equal(download.status, 200);
  assert.match(await download.text(), /a real-ish cv/);

  // A tampered signature, a tampered expiry, and somebody else's candidate id
  // all get nothing.
  const url = new URL(resume.url, base);
  assert.equal((await fetch(`${base}/files/resume/${candidateId}?exp=${url.searchParams.get('exp')}&sig=nope`)).status, 403);
  assert.equal((await fetch(`${base}/files/resume/${candidateId}?exp=9999999999&sig=${url.searchParams.get('sig')}`)).status, 403);
  assert.equal((await fetch(`${base}/files/resume/${candidateId + 1}${url.search}`)).status, 404);
});

test('only a real CV format is accepted', async () => {
  const form = new FormData();
  form.set('resume', new Blob([Buffer.from('#!/bin/sh\nrm -rf /')], { type: 'application/x-sh' }), 'cv.sh');
  const res = await fetch(`${base}/api/public/resume/${uploadToken}`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /PDF|DOC/i);
});

test('an upload token is not a key to the whole system', async () => {
  const form = new FormData();
  form.set('resume', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'x.pdf');
  const res = await fetch(`${base}/api/public/resume/not-a-token`, { method: 'POST', body: form });
  assert.equal(res.status, 403);
});

/* ---------------- step 5: the test ---------------- */

test('a test result is recorded and moves nobody', async () => {
  const before = (await api('GET', `/api/applications/${applicationId}`)).body.application;

  const recorded = await api('POST', `/api/applications/${applicationId}/test`, {
    score: 18,
    max_score: 25,
    type: 'accounts',
  });
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.test.percentage, 72);
  assert.equal(recorded.body.application.test_score, 72);
  assert.equal(recorded.body.application.test_status, 'passed');
  // The whole point: a score is decision support, not a decision.
  assert.equal(recorded.body.application.stage, before.stage);

  const failed = await api('POST', `/api/applications/${applicationId}/test`, { score: 5, max_score: 25 });
  assert.equal(failed.body.application.test_status, 'below threshold');
  assert.equal(failed.body.application.stage, before.stage);
});

/* ---------------- step 6: the pipeline ---------------- */

test('a stage move is logged and comes back with the message to send', async () => {
  const moved = await api('POST', `/api/applications/${applicationId}/stage`, {
    stage: 'Shortlisted',
    by: 'Dinesh',
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.application.stage, 'Shortlisted');
  assert.equal(moved.body.application.stage_log.length, 2);
  assert.equal(moved.body.application.stage_log.at(-1).by, 'Dinesh');
  assert.ok(moved.body.notify.text.includes('Rohit'));
  assert.ok(moved.body.notify.whatsapp.startsWith('https://wa.me/919876543210'));
  // Even the candidate's own message does not name the client.
  assert.ok(!moved.body.notify.text.includes('Patel Textiles'));

  const nonsense = await api('POST', `/api/applications/${applicationId}/stage`, { stage: 'Hired' });
  assert.equal(nonsense.status, 400);
  const nothing = await api('POST', `/api/applications/${applicationId}/stage`, {});
  assert.equal(nothing.status, 400);
});

test('scheduling an interview puts it on the recruiter own list too', async () => {
  const scheduled = await api('POST', '/api/interviews', {
    application_id: applicationId,
    at: '2026-11-05T11:00',
    mode: 'in-person',
    location_or_link: 'Office, Alkapuri',
  });
  assert.equal(scheduled.status, 201);
  assert.ok(scheduled.body.notify.text.includes('Alkapuri'));

  const followups = (await api('GET', '/api/followups?status=open')).body.followups;
  assert.ok(followups.some((f) => /Interview: Rohit Shah/.test(f.title)));
  // An interview nobody is reminded about is an interview that gets missed.
  assert.ok(followups.some((f) => f.due_on === '2026-11-05'));
});

test('editing a vacancy re-scores everyone already on it', async () => {
  const before = (await api('GET', `/api/applications/${applicationId}`)).body.application.match_score;
  await api('PATCH', `/api/vacancies/${vacancyId}`, {
    skills: 'SAP, Oracle Financials, German',
    experience_band: '10-15 yrs',
  });
  const after = (await api('GET', `/api/applications/${applicationId}`)).body.application.match_score;
  assert.ok(after < before, `${before} -> ${after}`);

  // Put it back, so the rest of the file reads a sane score.
  await api('PATCH', `/api/vacancies/${vacancyId}`, {
    skills: 'Tally, GST, Excel',
    experience_band: '1-3 yrs',
  });
});

test('the score explains itself when a recruiter opens one application', async () => {
  const { match } = (await api('GET', `/api/applications/${applicationId}`)).body;
  assert.ok(match.total > 0);
  assert.ok(match.factors.skills.note);
  assert.ok(Array.isArray(match.missing));
});

test('people already on the books are suggested for a new requirement', async () => {
  const other = await api('POST', '/api/candidates', {
    name: 'Priya Desai',
    phone: '9000011111',
    location: 'Vadodara',
    experience: '3 years',
    skills: 'Tally, GST',
    education: 'M.Com',
    expected_salary: '21000',
  });
  assert.equal(other.status, 201);

  const duplicate = await api('POST', '/api/candidates', { name: 'Priya D', phone: '09000011111' });
  assert.equal(duplicate.status, 409);

  const { suggestions } = (await api('GET', `/api/vacancies/${vacancyId}/suggestions`)).body;
  // Rohit is already on this vacancy, so he is not suggested again.
  assert.ok(suggestions.some((s) => s.candidate.name === 'Priya Desai'));
  assert.ok(!suggestions.some((s) => s.candidate.id === candidateId));
  assert.ok(suggestions[0].factors);
});

/* ---------------- step 7: placement and the fee ---------------- */

test('a placement works out the fee, the GST and the replacement window', async () => {
  await api('POST', `/api/applications/${applicationId}/stage`, { stage: 'Selected' });
  const joined = await api('POST', `/api/applications/${applicationId}/stage`, { stage: 'Joined' });
  assert.equal(joined.body.application.stage, 'Joined');

  const placement = await api('POST', '/api/placements', {
    application_id: applicationId,
    ctc: 264000,
    joined_on: '2026-11-10',
  });
  assert.equal(placement.status, 201);
  assert.equal(placement.body.fee_amount, Math.round((264000 * 8.33) / 100));
  assert.equal(placement.body.gst_amount, Math.round(placement.body.fee_amount * 0.18));
  assert.equal(placement.body.fee_basis, 'annual');
  // 90 days from joining, by default.
  assert.equal(placement.body.replacement_until, '2027-02-08');
  assert.equal(placement.body.invoice_status, 'not raised');

  // A fee on "one month's salary" is the same money by the other route.
  const quote = await api('GET', '/api/placements/quote?ctc=264000&fee_percent=100&basis=monthly');
  assert.equal(quote.body.fee_amount, 22000);

  // Saving it again edits the one placement rather than making a second.
  await api('POST', '/api/placements', { application_id: applicationId, ctc: 300000 });
  assert.equal((await api('GET', '/api/placements')).body.placements.length, 1);
});

/* ---------------- what the recruiter sees ---------------- */

test('the overview counts what is actually there', async () => {
  const o = (await api('GET', '/api/reports/overview')).body;
  assert.equal(o.vacancies.open, 1);
  assert.equal(o.vacancies.positions, 2);
  assert.equal(o.candidates.total, 2);
  assert.equal(o.applications.total, 1);
  assert.equal(o.applications.byStage.Joined, 1);
  assert.equal(o.placements.total, 1);
  assert.ok(o.placements.feeEarned > 0);
  assert.equal(o.placements.feeReceived, 0);
  assert.ok(o.upcoming.length >= 1);
});

test('the candidate export says whether there is a CV, never what is in it', async () => {
  const res = await fetch(`${base}/api/reports/export/candidates.csv`, {
    headers: { authorization: `Bearer ${process.env.APP_PASSWORD}` },
  });
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  // fetch's text() eats a leading BOM, so the bytes are what has to be checked.
  // Without it Excel on Windows mangles a Gujarati name and the rupee sign.
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'no BOM on the CSV');
  const csv = bytes.toString('utf8');
  assert.ok(csv.includes('Rohit Shah'));
  assert.ok(csv.includes('yes'));
  // Not the path on disk, and not the file.
  assert.ok(!/cv-[a-z0-9]+-[a-f0-9]{8}\./.test(csv));
  assert.ok(!csv.includes('%PDF'));
});

test('the pipeline export carries the stage and the match score', async () => {
  const res = await fetch(`${base}/api/reports/export/pipeline.csv`, {
    headers: { authorization: `Bearer ${process.env.APP_PASSWORD}` },
  });
  const csv = await res.text();
  assert.ok(csv.includes('Joined'));
  assert.ok(csv.includes(vacancyRef));
});

test('deleting a candidate takes their CV off the disk with them', async () => {
  const { candidate } = (await api('GET', `/api/candidates/${candidateId}`)).body;
  const file = path.join(config.resumeDir, candidate.resume_path);
  assert.ok(fs.existsSync(file));
  assert.equal((await api('DELETE', `/api/candidates/${candidateId}`)).status, 204);
  assert.ok(!fs.existsSync(file), 'the CV was left behind on disk');
  assert.equal((await api('GET', `/api/candidates/${candidateId}`)).status, 404);
});

/* ---------------- last, because it trips the limiter ---------------- */

test('the public apply form cannot be hammered', async () => {
  let limited = false;
  for (let i = 0; i < 14; i += 1) {
    const res = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
      name: `Flood ${i}`,
      phone: `91000000${String(i).padStart(2, '0')}`,
    });
    if (res.status === 429) {
      limited = true;
      break;
    }
  }
  assert.ok(limited, 'the apply endpoint accepted an unbounded flood');
});
