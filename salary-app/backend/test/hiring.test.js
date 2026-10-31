import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A throwaway database and résumé folder, set before anything imports config.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hiring-test-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.PUBLIC_URL = 'https://hr.example.com';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const { config } = await import('../src/config.js');

const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/** The office: every call carries the shared secret. */
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

let companyId;
let vacancyId;
let vacancyRef;
let candidateId;
let applicationId;
let uploadToken;

/* ---------------- the wall ---------------- */

test('hiring needs the password; the apply page does not; payroll is never public', async () => {
  assert.equal((await fetch(`${base}/api/hiring/vacancies`)).status, 401);
  assert.equal(
    (await fetch(`${base}/api/hiring/candidates`, { headers: { authorization: 'Bearer guess' } })).status,
    401
  );
  // The payroll side has no public door at all.
  assert.equal((await fetch(`${base}/api/employees`)).status, 401);
  assert.equal((await fetch(`${base}/api/periods`)).status, 401);
  assert.equal((await open('GET', '/api/public/vacancies')).status, 200);
});

/* ---------------- an opening against one of our own companies ---------------- */

test('an opening belongs to a company that already exists here', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  assert.equal(company.status, 201);
  companyId = company.body.id;

  // No company, no opening - otherwise there is nobody to put them on the
  // payroll of later.
  const orphan = await api('POST', '/api/hiring/vacancies', { title: 'Accountant' });
  assert.equal(orphan.status, 400);
  assert.match(orphan.body.error, /company/i);

  const created = await api('POST', '/api/hiring/vacancies', {
    company_id: companyId,
    title: 'Accountant',
    department: 'Accounts',
    reports_to: 'Dinesh Parmar',
    internal_notes: 'Replacing Hiral, do not mention',
    location: 'Vadodara',
    experience_band: '1-3 yrs',
    education: 'B.Com',
    salary_min: '15000',
    salary_max: '22000',
    skills: 'Tally, GST, Excel',
    positions: 2,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'draft');
  assert.match(created.body.ref_no, /^JOB-\d{3}$/);
  assert.equal(created.body.company_name, 'BOOKNFLY PRIVATE LIMITED');
  vacancyId = created.body.id;
  vacancyRef = created.body.ref_no;

  // A draft is not an advert.
  assert.deepEqual((await open('GET', '/api/public/vacancies')).body.vacancies, []);
  assert.equal((await open('GET', `/api/public/vacancies/${vacancyRef}`)).status, 404);
  assert.equal(
    (await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, { name: 'Too Early', phone: '9000000000' }))
      .status,
    404
  );

  await api('PATCH', `/api/hiring/vacancies/${vacancyId}`, { status: 'published' });
  assert.equal((await open('GET', '/api/public/vacancies')).body.vacancies.length, 1);
});

test('the advert names our company and keeps the office notes inside', async () => {
  const share = await api('GET', `/api/hiring/vacancies/${vacancyId}/share`);
  assert.equal(share.body.apply_url, `https://hr.example.com/apply/${vacancyRef}`);
  assert.ok(share.body.broadcast.includes('BOOKNFLY PRIVATE LIMITED'));
  assert.ok(!share.body.broadcast.includes('Replacing Hiral'));
  assert.ok(!share.body.broadcast.includes('Dinesh Parmar'));

  const advert = JSON.stringify((await open('GET', `/api/public/vacancies/${vacancyRef}`)).body);
  assert.ok(advert.includes('BOOKNFLY PRIVATE LIMITED'));
  assert.ok(!advert.includes('Replacing Hiral'), 'internal notes reached the advert');
  assert.ok(!advert.includes('Dinesh Parmar'), 'reports_to reached the advert');
});

/* ---------------- applying ---------------- */

test('a candidate applies and the application scores itself', async () => {
  const applied = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
    name: 'Rohit Shah',
    phone: '+91 98765 43210',
    email: 'rohit@example.com',
    location: 'Bhayli, Vadodara',
    experience: '2 years',
    skills: 'Tally, GST, Excel, Busy',
    education: 'B.Com',
    expected_salary: '20000',
    dob: '1999-04-12',
  });
  assert.equal(applied.status, 201);
  assert.equal(applied.body.new_candidate, true);
  uploadToken = applied.body.upload_token;

  // A candidate is told nothing about where they stand or how they scored.
  const text = JSON.stringify(applied.body);
  assert.ok(!/match_score|"stage"|Replacing Hiral/.test(text), `apply leaked: ${text}`);

  const { rows } = (await api('GET', `/api/hiring/applications?vacancy_id=${vacancyId}`)).body;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, 'New');
  assert.ok(rows[0].match_score >= 85, `scored ${rows[0].match_score}`);
  candidateId = rows[0].candidate_id;
  applicationId = rows[0].id;
});

test('a missing name or a short number is refused readably', async () => {
  const noName = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, { phone: '9898989898' });
  assert.equal(noName.status, 400);
  assert.match(noName.body.error, /name/i);

  const short = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
    name: 'Short Number',
    phone: '98765',
  });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /10-digit/i);
});

test('applying twice tops the person up and does not duplicate', async () => {
  const again = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
    name: 'Rohit Shah',
    phone: '9876543210',
    expected_salary: '',          // blank must not wipe what we already had
    notice_period: '1 month',     // new, must be filled in
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.already_applied, true);

  assert.equal((await api('GET', `/api/hiring/applications?vacancy_id=${vacancyId}`)).body.rows.length, 1);
  const { candidate } = (await api('GET', `/api/hiring/candidates/${candidateId}`)).body;
  assert.equal(candidate.notice_period, '1 month');
  assert.equal(candidate.expected_salary, '20000');
  assert.equal(candidate.phone, '9876543210');
});

test('a CV goes on disk and comes back through a signed link', async () => {
  const form = new FormData();
  form.set('resume', new Blob([Buffer.from('%PDF-1.4 a real-ish cv')], { type: 'application/pdf' }), 'Rohit CV.pdf');
  assert.equal((await fetch(`${base}/api/public/resume/${uploadToken}`, { method: 'POST', body: form })).status, 201);

  const { candidate, resume } = (await api('GET', `/api/hiring/candidates/${candidateId}`)).body;
  assert.ok(!candidate.resume_path.includes(' '));
  assert.equal(candidate.resume_name, 'Rohit CV.pdf');
  assert.ok(fs.existsSync(path.join(config.resumeDir, candidate.resume_path)));

  const download = await fetch(`${base}${resume.url}`);
  assert.equal(download.status, 200);
  assert.match(await download.text(), /a real-ish cv/);

  const url = new URL(resume.url, base);
  assert.equal((await fetch(`${base}/files/resume/${candidateId}?exp=${url.searchParams.get('exp')}&sig=nope`)).status, 403);
  assert.equal((await fetch(`${base}/files/resume/${candidateId}?exp=9999999999&sig=${url.searchParams.get('sig')}`)).status, 403);
  assert.equal((await fetch(`${base}/files/resume/${candidateId + 1}${url.search}`)).status, 404);
});

test('only a real CV format is accepted, and a bad token gets nothing', async () => {
  const bad = new FormData();
  bad.set('resume', new Blob([Buffer.from('#!/bin/sh')], { type: 'application/x-sh' }), 'cv.sh');
  const wrongType = await fetch(`${base}/api/public/resume/${uploadToken}`, { method: 'POST', body: bad });
  assert.equal(wrongType.status, 400);

  const ok = new FormData();
  ok.set('resume', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'x.pdf');
  assert.equal((await fetch(`${base}/api/public/resume/not-a-token`, { method: 'POST', body: ok })).status, 403);
});

/* ---------------- the pipeline ---------------- */

test('a test result is recorded and moves nobody', async () => {
  const before = (await api('GET', `/api/hiring/applications/${applicationId}`)).body.application.stage;
  const recorded = await api('POST', `/api/hiring/applications/${applicationId}/test`, {
    score: 18,
    max_score: 25,
    type: 'accounts',
  });
  assert.equal(recorded.body.test.percentage, 72);
  assert.equal(recorded.body.application.test_status, 'passed');
  assert.equal(recorded.body.application.stage, before);

  const failed = await api('POST', `/api/hiring/applications/${applicationId}/test`, { score: 5, max_score: 25 });
  assert.equal(failed.body.application.test_status, 'below threshold');
  assert.equal(failed.body.application.stage, before);
});

test('a stage move is logged and comes back with the message to send', async () => {
  const moved = await api('POST', `/api/hiring/applications/${applicationId}/stage`, {
    stage: 'Shortlisted',
    by: 'Dinesh',
  });
  assert.equal(moved.body.application.stage, 'Shortlisted');
  assert.equal(moved.body.application.stage_log.length, 2);
  assert.equal(moved.body.application.stage_log.at(-1).by, 'Dinesh');
  assert.ok(moved.body.notify.text.includes('Rohit'));
  assert.ok(moved.body.notify.text.includes('BOOKNFLY PRIVATE LIMITED'));
  assert.ok(!moved.body.notify.text.includes('Replacing Hiral'));
  assert.ok(moved.body.notify.whatsapp.startsWith('https://wa.me/919876543210'));

  assert.equal((await api('POST', `/api/hiring/applications/${applicationId}/stage`, { stage: 'Hired' })).status, 400);
  assert.equal((await api('POST', `/api/hiring/applications/${applicationId}/stage`, {})).status, 400);
});

test('scheduling an interview puts it on the office list too', async () => {
  const scheduled = await api('POST', '/api/hiring/interviews', {
    application_id: applicationId,
    at: '2026-11-05T11:00',
    mode: 'in-person',
    location_or_link: 'Office, Alkapuri',
  });
  assert.equal(scheduled.status, 201);
  assert.ok(scheduled.body.notify.text.includes('Alkapuri'));

  const tasks = (await api('GET', '/api/hiring/tasks?status=open')).body.tasks;
  assert.ok(tasks.some((t) => /Interview: Rohit Shah/.test(t.title) && t.due_on === '2026-11-05'));
});

test('editing an opening re-scores everyone already on it', async () => {
  const before = (await api('GET', `/api/hiring/applications/${applicationId}`)).body.application.match_score;
  await api('PATCH', `/api/hiring/vacancies/${vacancyId}`, {
    skills: 'SAP, Oracle Financials, German',
    experience_band: '10-15 yrs',
  });
  const after = (await api('GET', `/api/hiring/applications/${applicationId}`)).body.application.match_score;
  assert.ok(after < before, `${before} -> ${after}`);
  await api('PATCH', `/api/hiring/vacancies/${vacancyId}`, {
    skills: 'Tally, GST, Excel',
    experience_band: '1-3 yrs',
  });
});

test('people already on file are suggested for a new opening', async () => {
  assert.equal(
    (await api('POST', '/api/hiring/candidates', {
      name: 'Priya Desai',
      phone: '9000011111',
      location: 'Vadodara',
      experience: '3 years',
      skills: 'Tally, GST',
      education: 'M.Com',
      expected_salary: '21000',
    })).status,
    201
  );
  assert.equal((await api('POST', '/api/hiring/candidates', { name: 'Priya D', phone: '09000011111' })).status, 409);

  const { suggestions } = (await api('GET', `/api/hiring/vacancies/${vacancyId}/suggestions`)).body;
  assert.ok(suggestions.some((s) => s.candidate.name === 'Priya Desai'));
  assert.ok(!suggestions.some((s) => s.candidate.id === candidateId));
});

/* ---------------- the handover to payroll: the point of all this ---------------- */

test('hiring somebody puts them on the payroll of the opening own company', async () => {
  await api('PATCH', `/api/hiring/applications/${applicationId}`, {
    offer_salary: 20000,
    joining_date: '2026-11-10',
  });
  await api('POST', `/api/hiring/applications/${applicationId}/stage`, { stage: 'Selected' });

  const before = (await api('GET', '/api/employees')).body.employees.length;
  const hired = await api('POST', `/api/hiring/applications/${applicationId}/hire`, {});
  assert.equal(hired.status, 201);
  assert.equal(hired.body.created, true);

  const employee = hired.body.employee;
  // The company comes from the opening, never from the form.
  assert.equal(employee.company_id, companyId);
  assert.equal(employee.name, 'Rohit Shah');
  assert.equal(employee.monthly_salary, 20000);
  assert.equal(employee.joined_on, '2026-11-10');
  assert.equal(employee.designation, 'Accountant');
  assert.equal(employee.department, 'Accounts');
  // Carried across so nobody types them twice.
  assert.equal(employee.phone, '9876543210');
  assert.equal(employee.email, 'rohit@example.com');
  assert.equal(employee.dob, '1999-04-12');

  // They are a real employee now, on the salary side.
  const employees = (await api('GET', '/api/employees')).body.employees;
  assert.equal(employees.length, before + 1);
  assert.ok(employees.some((e) => e.id === employee.id && e.name === 'Rohit Shah'));

  // And the application is finished: Joined, and linked to the employee.
  assert.equal(hired.body.application.stage, 'Joined');
  assert.equal(hired.body.application.employee_id, employee.id);
});

test('hiring the same person twice does not make a second employee', async () => {
  const again = await api('POST', `/api/hiring/applications/${applicationId}/hire`, {});
  assert.equal(again.body.created, false);
  const names = (await api('GET', '/api/employees')).body.employees.filter((e) => e.name === 'Rohit Shah');
  assert.equal(names.length, 1);
});

test('nobody goes on the payroll without a salary', async () => {
  const { candidate } = { candidate: (await api('POST', '/api/hiring/candidates', {
    name: 'Nitin Rao',
    phone: '9811122233',
  })).body };
  const app = await api('POST', '/api/hiring/applications', {
    vacancy_id: vacancyId,
    candidate_id: candidate.id,
  });
  const refused = await api('POST', `/api/hiring/applications/${app.body.application.id}/hire`, {});
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /salary/i);
  assert.ok(!(await api('GET', '/api/employees')).body.employees.some((e) => e.name === 'Nitin Rao'));
});

/* ---------------- what the office sees ---------------- */

test('the overview counts what is actually there', async () => {
  const o = (await api('GET', '/api/hiring/overview')).body;
  assert.equal(o.vacancies.open, 1);
  assert.equal(o.vacancies.positions, 2);
  assert.equal(o.hires.total, 1);
  // Two seats asked for, one filled.
  assert.equal(o.vacancies.unfilled, 1);
  assert.equal(o.applications.byStage.Joined, 1);
  assert.ok(o.upcoming.length >= 1);
});

test('the candidate export says whether there is a CV, never what is in it', async () => {
  const res = await fetch(`${base}/api/hiring/export/candidates.csv`, {
    headers: { authorization: `Bearer ${process.env.APP_PASSWORD}` },
  });
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'no BOM on the CSV');
  const csv = bytes.toString('utf8');
  assert.ok(csv.includes('Rohit Shah'));
  assert.ok(!/cv-[a-z0-9]+-[a-f0-9]{8}\./.test(csv), 'the path on disk reached the export');
  assert.ok(!csv.includes('%PDF'));
});

test('deleting a candidate takes their CV off the disk with them', async () => {
  const { candidate } = (await api('GET', `/api/hiring/candidates/${candidateId}`)).body;
  const file = path.join(config.resumeDir, candidate.resume_path);
  assert.ok(fs.existsSync(file));
  assert.equal((await api('DELETE', `/api/hiring/candidates/${candidateId}`)).status, 204);
  assert.ok(!fs.existsSync(file), 'the CV was left behind on disk');
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
