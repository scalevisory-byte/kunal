import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * DELETE IS THE ONE ACT HERE THAT CANNOT BE UNDONE.
 *
 * Dinesh asked for it beside Archive. Two things have to hold: the files go
 * with the rows, and somebody on the payroll is refused - their hiring record
 * is how that appointment is explained, and archiving is what was wanted.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cand-delete-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const hiring = await import('../src/hiring.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const auth = { authorization: `Bearer ${process.env.APP_PASSWORD}` };
const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const attach = async (candidateId, kind) => {
  const form = new FormData();
  form.set('document', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), `${kind}.pdf`);
  form.set('kind', kind);
  const res = await fetch(`${base}/api/hiring/candidates/${candidateId}/documents`, {
    method: 'POST', headers: auth, body: form,
  });
  assert.equal(res.status, 201);
};

const docFiles = () => fs.readdirSync(path.join(process.env.DATA_DIR, 'documents'));

const company = (await api('POST', '/api/companies', { name: 'BOOKNFLY PVT LTD' })).body;
const vacancy = (await api('POST', '/api/hiring/vacancies', {
  company_id: company.id, title: 'Travel Consultant', openings: 2, status: 'published',
})).body;
const vacancyId = vacancy.vacancy?.id ?? vacancy.id;

const applicant = async (name, phone) => {
  const made = await api('POST', '/api/hiring/candidates', { name, phone });
  const candidateId = made.body.candidate?.id ?? made.body.id;
  const app = await api('POST', '/api/hiring/applications', {
    vacancy_id: vacancyId, candidate_id: candidateId,
  });
  return { candidateId, applicationId: app.body.application?.id ?? app.body.id };
};

test('deleting takes the documents off the disk, not just the rows', async () => {
  const { candidateId } = await applicant('Asha Mehta', '9200000001');
  await attach(candidateId, 'aadhaar');
  await attach(candidateId, 'pan');
  assert.equal(docFiles().length, 2);

  assert.equal((await api('DELETE', `/api/hiring/candidates/${candidateId}`)).status, 204);
  assert.equal(
    docFiles().length,
    0,
    'a row cascaded away and a file left behind is a folder of strangers’ Aadhaar cards nothing points at'
  );
  assert.equal((await api('GET', `/api/hiring/candidates/${candidateId}`)).status, 404);
});

test('it takes the whole file with it', async () => {
  const { candidateId, applicationId } = await applicant('Kiran Rao', '9200000002');
  await api('PUT', `/api/hiring/applications/${applicationId}/screening`, { verdict: 'Eligible' });
  assert.ok(hiring.getScreening(applicationId));

  await api('DELETE', `/api/hiring/candidates/${candidateId}`);
  assert.ok(!hiring.getScreening(applicationId), 'the screening went with them');
  assert.ok(!hiring.getApplication(applicationId), 'and so did the application');
});

test('somebody on the payroll is refused, and told to archive instead', async () => {
  const { candidateId, applicationId } = await applicant('Riya Shah', '9200000003');
  const hired = await api('POST', `/api/hiring/applications/${applicationId}/hire`, {
    monthly_salary: 25000,
  });
  assert.ok([200, 201].includes(hired.status), JSON.stringify(hired.body));

  const refused = await api('DELETE', `/api/hiring/candidates/${candidateId}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /on the payroll/);
  assert.match(refused.body.error, /archive/i, 'a refusal has to say what to do instead');

  assert.ok(hiring.getCandidate(candidateId), 'and nothing was removed');
  assert.ok(
    hiring.listCandidates({ archived: true }).rows.some((r) => r.id === candidateId),
    'they are already archived, which is what was wanted'
  );
});

test('an archived person can still be deleted — archiving is not a lock', async () => {
  const { candidateId } = await applicant('Manish Jain', '9200000004');
  hiring.archiveCandidate(candidateId, { reason: 'duplicate' });
  assert.equal((await api('DELETE', `/api/hiring/candidates/${candidateId}`)).status, 204);
});

test('deleting somebody who is not there is 404, not a crash', async () => {
  assert.equal((await api('DELETE', '/api/hiring/candidates/999999')).status, 404);
});
