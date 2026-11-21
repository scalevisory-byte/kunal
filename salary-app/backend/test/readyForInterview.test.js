/**
 * SCREENED IN → PAPER → RESULT → INTERVIEW.
 *
 * Dinesh: *"screening me pass hone ke baad interview kiya jayega"*. That is
 * the order the day goes, and the queue could not show it: "Done" held
 * everybody who had sat a paper, so somebody who passed, somebody who did
 * not, and somebody already called for interview were one heap — and the
 * list of people to ring was being kept in somebody's head.
 *
 * What these pin:
 *
 *  - The queue says whether an interview is **already booked**, so nobody is
 *    called twice and nobody is missed.
 *  - **A cancelled interview is not a booking** — that person is waiting
 *    again, which is exactly when they must come back on the list.
 *  - **Passing decides nothing.** It does not move a stage, book anything or
 *    reject anybody; the row simply reads as qualified.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-interview-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
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

let appIds = {};
let interviewId = 0;

const queueRow = async (name) => {
  const got = await api('GET', '/api/hiring/screening/awaiting-test');
  return got.body.rows.find((r) => r.name === name);
};

test('set up: two people screened in, both sat the paper, one passed', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  const vacancy = await api('POST', '/api/hiring/vacancies', {
    company_id: company.body.id, title: 'JR TOUR CONSULTANT', positions: 2,
  });
  await api('PATCH', `/api/hiring/vacancies/${vacancy.body.id}`, { status: 'published' });

  const paper = dbm.db
    .prepare(`INSERT INTO test_papers (name, pass_percent) VALUES ('Accounts test', 50)`)
    .run().lastInsertRowid;

  for (const [name, phone, right, passed] of [
    ['Nidhi Shah', '9825012345', 18, 1],
    ['Rohit Patel', '9898989898', 4, 0],
  ]) {
    await api('POST', `/api/public/vacancies/${vacancy.body.ref_no}/apply`, { name, phone });
    const candidate = dbm.db.prepare(`SELECT id FROM candidates WHERE name = ?`).get(name);
    const application = dbm.db
      .prepare(`SELECT id FROM applications WHERE candidate_id = ?`)
      .get(candidate.id);
    appIds[name] = application.id;
    await api('PUT', `/api/hiring/applications/${application.id}/screening`, {
      verdict: 'Eligible', by: 'Dinesh',
    });
    dbm.db
      .prepare(
        `INSERT INTO test_attempts (paper_id, candidate_id, application_id, token, drawn,
                                    submitted_at, right_count, max_score, percentage, passed)
         VALUES (?, ?, ?, ?, '[1,2,3,4]', '2026-11-20 15:04:00', ?, 20, ?, ?)`
      )
      .run(paper, candidate.id, application.id, `tok-${name.split(' ')[0]}`, right, right * 5, passed);
  }

  const rows = (await api('GET', '/api/hiring/screening/awaiting-test')).body.rows;
  assert.equal(rows.length, 2);
});

test('the queue says who qualified, and that NOBODY is booked yet', async () => {
  const nidhi = await queueRow('Nidhi Shah');
  const rohit = await queueRow('Rohit Patel');

  assert.equal(nidhi.state, 'sat');
  assert.equal(nidhi.attempt.passed, 1, 'she reached the pass mark');
  assert.equal(nidhi.interview, null, 'and is waiting to be called');

  assert.equal(rohit.attempt.passed, 0);
  assert.equal(rohit.interview, null);

  // Passing moved nothing: both are where the office last put them.
  assert.equal(nidhi.stage, rohit.stage, 'a score does not move a stage');
});

test('booking an interview takes them off the list of people to ring', async () => {
  const made = await api('POST', '/api/hiring/interviews', {
    application_id: appIds['Nidhi Shah'],
    at: '2026-11-25T11:00',
    mode: 'in-person',
    round: 1,
    location_or_link: 'Head office',
  });
  assert.equal(made.status, 201);
  interviewId = made.body.id ?? made.body.interview?.id;

  const nidhi = await queueRow('Nidhi Shah');
  assert.ok(nidhi.interview, 'the queue knows');
  assert.match(nidhi.interview.at, /2026-11-25/);
  assert.equal(nidhi.interview.status, 'Scheduled');

  // And the person who did not pass is untouched by somebody else's booking.
  assert.equal((await queueRow('Rohit Patel')).interview, null);
});

test('A CANCELLED INTERVIEW IS NOT A BOOKING — they are waiting again', async () => {
  const off = await api('PATCH', `/api/hiring/interviews/${interviewId}`, { status: 'Cancelled' });
  assert.equal(off.status, 200);
  const nidhi = await queueRow('Nidhi Shah');
  assert.equal(nidhi.interview, null, 'back on the list of people to ring');
});
