/**
 * FROM A TEST RESULT TO THE PERSON — and taking a paper off the list.
 *
 * Dinesh, standing on Screening → Test results with ten papers on screen,
 * nine of them his own practice runs: *"yaha se interview k liye kisko
 * bhejna he / interview kese schedule krana he / and agar koi data delete
 * karna he to kya option he"*.
 *
 * All three were the same shape: the screen showed scores and offered no way
 * out of them. The score is on the row, the decision is taken on the
 * application, and nothing on the row opened it.
 *
 * What these pin:
 *
 *  - **A removed paper is taken off the list, never wiped.** It moves to
 *    Removed, it is counted there, and one button puts it back. A hard
 *    delete of somebody's answer sheet is the one thing here that could not
 *    be undone.
 *  - Removing is **recorded** — "who took that result off" has an answer.
 *  - The row carries what the screen needs to open the person: the
 *    application where there is one, the candidate where there is not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'test-results-place-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const hiring = await import('../src/hiring.js');
const dbm = await import('../src/db.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

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

/* A sat paper, made directly: the sitting itself is tested next door. */
let attemptId = 0;
let candidateId = 0;

test('set up: one candidate with a submitted paper', async () => {
  const company = dbm.createCompany({ name: 'BOOKNFLY PRIVATE LIMITED' });
  const paper = dbm.db
    .prepare(`INSERT INTO test_papers (name, pass_percent) VALUES ('Accounts test', 50)`)
    .run();
  const candidate = dbm.db
    .prepare(`INSERT INTO candidates (ref_no, name, phone) VALUES ('CAN-001', 'Dinesh Parmar', '8000229067')`)
    .run();
  candidateId = candidate.lastInsertRowid;
  const attempt = dbm.db
    .prepare(
      `INSERT INTO test_attempts (paper_id, candidate_id, token, drawn, submitted_at,
                                  right_count, max_score, percentage, passed)
       VALUES (?, ?, 'tok-1', '[1,2,3,4]', '2026-11-15 23:04:00', 0, 20, 0, 0)`
    )
    .run(paper.lastInsertRowid, candidateId);
  attemptId = attempt.lastInsertRowid;
  assert.ok(company.id && attemptId);
});

test('the row carries who it is, so the screen can open them', async () => {
  const got = await api('GET', '/api/hiring/test-results');
  const row = got.body.results.find((r) => r.id === attemptId);
  assert.ok(row);
  assert.equal(row.candidate_id, candidateId, 'the person with no opening yet still opens');
  assert.equal(row.application_id ?? null, null, 'and this one applied to nothing');
  assert.ok(!('token' in row), 'the sitting token never travels');
});

test('A REMOVED PAPER IS OFF THE LIST, NOT WIPED', async () => {
  const gone = await api('DELETE', `/api/hiring/test-results/${attemptId}`);
  assert.equal(gone.status, 200);

  const list = await api('GET', '/api/hiring/test-results');
  assert.ok(!list.body.results.some((r) => r.id === attemptId), 'off the results');
  assert.equal(list.body.counts.removed, 1, 'and counted where it went');

  const removed = await api('GET', '/api/hiring/test-results?verdict=removed');
  const row = removed.body.results.find((r) => r.id === attemptId);
  assert.ok(row, 'there is a place to go and look');
  assert.ok(row.removed_at, 'with when');

  // The paper itself is untouched - the answer sheet still opens.
  const sheet = await api('GET', `/api/hiring/attempts/${attemptId}`);
  assert.equal(sheet.status, 200);
});

test('and one button puts it back', async () => {
  const back = await api('POST', `/api/hiring/test-results/${attemptId}/restore`, {});
  assert.equal(back.status, 200);
  const list = await api('GET', '/api/hiring/test-results');
  assert.ok(list.body.results.some((r) => r.id === attemptId));
  assert.equal(list.body.counts.removed, 0);
});

test('taking one off is recorded — "who removed that result" has an answer', async () => {
  await api('DELETE', `/api/hiring/test-results/${attemptId}`);
  const trail = dbm.listAudit({ entity: 'test_attempts' });
  const line = trail.find((a) => a.entity_id === attemptId && a.action === 'removed');
  assert.ok(line, 'nothing on the trail');
  assert.match(line.label, /Dinesh Parmar/);
  assert.match(line.note, /0\/20/, 'and what it scored, because the row may be put back or not');
});

test('a paper nobody has sat cannot be removed from this list', async () => {
  const unsat = dbm.db
    .prepare(
      `INSERT INTO test_attempts (paper_id, candidate_id, token, drawn)
       VALUES ((SELECT id FROM test_papers LIMIT 1), ?, 'tok-2', '[]')`
    )
    .run(candidateId);
  const no = await api('DELETE', `/api/hiring/test-results/${unsat.lastInsertRowid}`);
  assert.equal(no.status, 400);
  assert.match(no.body.error, /not been sat/);
});
