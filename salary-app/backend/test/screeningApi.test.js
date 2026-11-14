import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-screen-'));
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
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let company;
test.before(async () => {
  company = (await api('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
});

async function applied(candidate = {}, vacancy = {}) {
  const v = (await api('POST', '/api/hiring/vacancies', {
    company_id: company.id, title: 'Travel Consultant', status: 'published',
    age_min: 21, age_max: 35, experience_band: '1-3 yrs', salary_max: '26000',
    location: 'Surat', skills: 'Amadeus, ticketing', education: 'B.Com', ...vacancy,
  })).body;
  const c = (await api('POST', '/api/hiring/candidates', {
    name: `Person ${Math.random().toString(36).slice(2, 7)}`,
    phone: String(9200000000 + Math.floor(Math.random() * 799999999)), ...candidate,
  })).body;
  const { application } = (await api('POST', '/api/hiring/applications', {
    vacancy_id: v.id, candidate_id: c.id,
  })).body;
  return { vacancy: v, candidate: c, application };
}

const stageOf = async (id) => (await api('GET', `/api/hiring/applications/${id}`)).body.application.stage;

/* ---------------- the report ---------------- */

test('a candidate who stated nothing does not read as failing everything', async () => {
  const { application } = await applied();
  const { body } = await api('GET', `/api/hiring/applications/${application.id}/screening`);

  /*
   * The rule the module is careful for. Somebody who did not give a date of
   * birth has not failed the age criterion - nobody asked. Reading silence as
   * a failure would paint every fresh application red and the report would be
   * ignored within a week.
   */
  assert.equal(body.report.meets, true);
  assert.deepEqual(body.report.misses, []);
  assert.ok(body.report.not_known.includes('Age'));
  assert.ok(body.report.not_known.includes('Experience'));
  assert.equal(body.screening, null, 'nobody has screened them yet');
});

test('the report names what actually misses', async () => {
  const { application } = await applied({
    dob: '1975-01-01', experience: '9 years', expected_salary: '45000',
  });
  const { body } = await api('GET', `/api/hiring/applications/${application.id}/screening`);
  assert.equal(body.report.meets, false);
  assert.deepEqual(body.report.misses, ['Age', 'Experience', 'Expected salary']);

  // Free text is reported side by side and never judged: "B.Com" against
  // "Bachelor of Commerce" is a string comparison that would be wrong often
  // enough to be worse than useless.
  const qual = body.report.lines.find((l) => l.label === 'Qualification');
  assert.equal(qual.ok, null);
  const skills = body.report.lines.find((l) => l.label === 'Skills');
  assert.equal(skills.ok, null);
});

test('an opening that asks for no age range gets no age line', async () => {
  const { application } = await applied({ dob: '1998-04-12' }, { age_min: null, age_max: null });
  const { body } = await api('GET', `/api/hiring/applications/${application.id}/screening`);
  assert.ok(!body.report.lines.some((l) => l.label === 'Age'));
});

/* ---------------- the verdict ---------------- */

test('THE REPORT CANNOT REJECT ANYBODY', async () => {
  const { application } = await applied({
    dob: '1975-01-01', experience: '9 years', expected_salary: '45000',
  });
  const before = await api('GET', `/api/hiring/applications/${application.id}/screening`);
  assert.equal(before.body.report.meets, false, 'this candidate misses three criteria');

  /*
   * ...and is taken anyway, without an argument. People are hired against the
   * criteria every day and are usually right to be. The report is advice; the
   * screener decides.
   */
  const res = await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'Eligible', remarks: 'Worth seeing — knows the Surat market',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.screening.verdict, 'Eligible');
  assert.equal(await stageOf(application.id), 'Shortlisted');
});

test('a rejection and a hold each have to say why', async () => {
  const { application } = await applied();
  const bare = await api('PUT', `/api/hiring/applications/${application.id}/screening`, {});
  assert.equal(bare.status, 400);
  assert.match(bare.body.error, /whether they are eligible/i);

  const noReason = await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'Rejected',
  });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /has to say why/i);

  const noHold = await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'On Hold',
  });
  assert.equal(noHold.status, 400);
  assert.match(noHold.body.error, /waiting for/i);
});

test('a hold keeps them exactly where they are', async () => {
  const { application } = await applied();
  await api('POST', `/api/hiring/applications/${application.id}/stage`, { stage: 'Under Review' });
  const res = await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'On Hold', hold_reason: 'Waiting for their CV',
  });
  assert.equal(res.status, 200);
  // "Retain the candidate in the pipeline" is the whole point of a hold.
  assert.equal(await stageOf(application.id), 'Under Review');
});

test('a rejection moves them and the reason lands on the stage log', async () => {
  const { application } = await applied();
  await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'Rejected', rejection_reason: 'Not enough experience',
  });
  assert.equal(await stageOf(application.id), 'Rejected');
  const { body } = await api('GET', `/api/hiring/applications/${application.id}`);
  assert.match(body.application.stage_log.at(-1).note, /Not enough experience/);
});

test('changing a verdict clears the reason that no longer applies', async () => {
  const { application } = await applied();
  await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'Rejected', rejection_reason: 'Not enough experience',
  });
  const picked = await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'Eligible', remarks: 'Second look — the CV arrived',
  });

  /*
   * Somebody rejected in March and picked up in June must not keep "not
   * enough experience" on their record under a verdict of Eligible, where the
   * rejection report would go on counting it.
   */
  assert.equal(picked.body.screening.rejection_reason, null);
  assert.equal(await stageOf(application.id), 'Shortlisted');
});

test('a changed verdict is on the audit trail with both values', async () => {
  const { application, candidate } = await applied({ name: 'Audited Person' });
  await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'On Hold', hold_reason: 'Keep for a future opening',
  });
  await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
    verdict: 'Rejected', rejection_reason: 'Position filled',
  });
  const { body } = await api('GET', '/api/people/audit?entity=screening&limit=50');
  const lines = body.entries.filter((e) => e.entity_id === application.id);
  assert.equal(lines.length, 2);
  const latest = lines[0];
  assert.equal(latest.from_value, 'On Hold');
  assert.equal(latest.to_value, 'Rejected');
  assert.equal(latest.note, 'Position filled');
  assert.ok(candidate.id);
});

/* ---------------- the queue and the counts ---------------- */

test('the queue is oldest first and drops anybody already screened', async () => {
  const fresh = (await api('POST', '/api/companies', { name: `Queue ${Math.random()}` })).body;
  const made = [];
  for (const name of ['First In', 'Second In', 'Third In']) {
    made.push(await applied({ name }, { company_id: fresh.id }));
  }
  const first = (await api('GET', `/api/hiring/screening/queue?company_id=${fresh.id}`)).body.queue;
  assert.equal(first.length, 3);

  /*
   * Oldest first, NOT by match score. A screening list sorted by score puts
   * the strongest candidate on top for ever and leaves a merely good one from
   * three weeks ago at the bottom until they take another job.
   */
  assert.deepEqual(first.map((r) => r.application_id), made.map((m) => m.application.id));

  await api('PUT', `/api/hiring/applications/${made[0].application.id}/screening`, {
    verdict: 'Eligible',
  });
  const after = (await api('GET', `/api/hiring/screening/queue?company_id=${fresh.id}`)).body.queue;
  assert.equal(after.length, 2);
  assert.ok(!after.some((r) => r.application_id === made[0].application.id));

  // Each row carries its own report, so the queue can be worked without
  // opening every candidate.
  assert.ok(after[0].report);
});

test('the summary counts the reasons, which is why one is required', async () => {
  const fresh = (await api('POST', '/api/companies', { name: `Counts ${Math.random()}` })).body;
  for (const reason of ['Not enough experience', 'Not enough experience', 'Position filled']) {
    const { application } = await applied({}, { company_id: fresh.id });
    await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
      verdict: 'Rejected', rejection_reason: reason,
    });
  }
  const { application } = await applied({}, { company_id: fresh.id });
  await api('PUT', `/api/hiring/applications/${application.id}/screening`, { verdict: 'Eligible' });

  const { body } = await api('GET', `/api/hiring/screening/summary?company_id=${fresh.id}`);
  const rejected = body.verdicts.find((v) => v.verdict === 'Rejected');
  assert.equal(rejected.n, 3);
  assert.deepEqual(body.rejection_reasons[0], { reason: 'Not enough experience', n: 2 });
  assert.equal(body.waiting, 0);
});
