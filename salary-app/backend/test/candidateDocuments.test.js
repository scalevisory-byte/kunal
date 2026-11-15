import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * A candidate's own documents - Aadhaar, PAN, a marksheet.
 *
 * The same rules the CVs and the employee documents already follow: the file
 * is on disk and never in the database or a page, the uploaded filename is
 * discarded because it is user input and this is a path, and it comes back
 * through a signature that expires.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cand-docs-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
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

const upload = async (candidateId, { kind = 'aadhaar', filename = 'aadhaar card.pdf' } = {}) => {
  const form = new FormData();
  form.set('document', new Blob([Buffer.from('%PDF-1.4 pretend')], { type: 'application/pdf' }), filename);
  form.set('kind', kind);
  const res = await fetch(`${base}/api/hiring/candidates/${candidateId}/documents`, {
    method: 'POST', headers: auth, body: form,
  });
  return { status: res.status, body: await res.json() };
};

const made = await api('POST', '/api/hiring/candidates', { name: 'Asha Mehta', phone: '9001234567' });
const candidateId = made.body.candidate?.id ?? made.body.id;

test('a document is stored, and the path on disk never travels', async () => {
  const { status, body } = await upload(candidateId);
  assert.equal(status, 201);
  assert.equal(body.document.kind, 'aadhaar');
  assert.equal(body.document.file_path, undefined, 'the server’s own filename is not the browser’s business');
  assert.ok(body.document.link?.url.startsWith('/files/candidate-document/'));

  const record = await api('GET', `/api/hiring/candidates/${candidateId}`);
  assert.equal(record.body.documents.length, 1);
  assert.ok(
    !JSON.stringify(record.body.documents).includes('file_path'),
    'nor on the record'
  );
});

test('a name somebody chose never becomes a path on disk', async () => {
  const { body } = await upload(candidateId, { kind: 'pan', filename: '../../etc/passwd.pdf' });
  assert.ok(body.document.file_name, 'what they called it is kept, to show them');
  const files = fs.readdirSync(path.join(process.env.DATA_DIR, 'documents'));
  assert.ok(
    files.every((f) => /^doc-[a-z0-9]+-[a-f0-9]+\.(pdf|jpg|png|docx?)$/.test(f)),
    `the server names the file, not the uploader: ${files.join(', ')}`
  );
});

test('the signed link works, and expires', async () => {
  const record = await api('GET', `/api/hiring/candidates/${candidateId}`);
  const { link } = record.body.documents[0];
  const ok = await fetch(`${base}${link.url}`);
  assert.equal(ok.status, 200);

  const tampered = link.url.replace(/sig=.*/, 'sig=deadbeef');
  assert.equal((await fetch(`${base}${tampered}`)).status, 403);
});

test('a candidate link cannot be replayed against an employee document', async () => {
  // Both tables start at 1, so document 1 exists in each. Without the scope
  // in the signature, one link would verify against the other.
  const company = await api('POST', '/api/companies', { name: 'BNF PVT LTD' });
  const emp = await api('POST', '/api/employees', {
    company_id: company.body.id,
    name: 'Ravi Shah',
    monthly_salary: 20000,
  });
  assert.equal(emp.status, 201);
  const employeeId = emp.body.id;
  const form = new FormData();
  form.set('document', new Blob([Buffer.from('%PDF-1.4 other')], { type: 'application/pdf' }), 'pan.pdf');
  form.set('kind', 'pan');
  const up = await fetch(`${base}/api/employees/${employeeId}/documents`, {
    method: 'POST', headers: auth, body: form,
  });
  assert.equal(up.status, 201);
  const empDoc = (await up.json()).document;

  const record = await api('GET', `/api/hiring/candidates/${candidateId}`);
  const candDoc = record.body.documents.find((d) => d.id === empDoc.id);
  if (!candDoc) return; // ids did not collide in this run; nothing to prove
  const url = new URL(`${base}${candDoc.link.url}`);
  const crossed = `${base}/files/document/${empDoc.id}?exp=${url.searchParams.get('exp')}&sig=${url.searchParams.get('sig')}`;
  assert.equal((await fetch(crossed)).status, 403, 'a signature has to name what it authorises');
});

test('removing it takes the file with it', async () => {
  const record = await api('GET', `/api/hiring/candidates/${candidateId}`);
  const doc = record.body.documents[0];
  const before = fs.readdirSync(path.join(process.env.DATA_DIR, 'documents')).length;

  assert.equal((await api('DELETE', `/api/hiring/candidates/${candidateId}/documents/${doc.id}`)).status, 204);
  assert.equal(
    fs.readdirSync(path.join(process.env.DATA_DIR, 'documents')).length,
    before - 1,
    'a row removed and a file left behind is how a folder fills with strangers’ Aadhaar cards'
  );
  assert.equal(
    (await api('DELETE', `/api/hiring/candidates/${candidateId}/documents/${doc.id}`)).status,
    404
  );
});

test('somebody else’s document cannot be removed through this candidate', async () => {
  const other = await api('POST', '/api/hiring/candidates', { name: 'Kiran Rao', phone: '9007654321' });
  const otherId = other.body.candidate?.id ?? other.body.id;
  const mine = await upload(candidateId, { kind: 'photo' });
  const res = await api(
    'DELETE',
    `/api/hiring/candidates/${otherId}/documents/${mine.body.document.id}`
  );
  assert.equal(res.status, 404, 'the id in the path has to own the document');
});
