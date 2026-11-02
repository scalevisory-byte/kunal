import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * The embedded test: Dinesh's own test system in an iframe on the thank-you
 * page, posting a score back when the candidate finishes.
 *
 * Every piece of this existed and none of it was covered, which is the worst
 * combination - it looks finished and nothing says when it stops working. The
 * two things that matter are at opposite ends: the test system must be able to
 * send a score WITHOUT this app's password (it will never have it), and a score
 * arriving must move absolutely nobody.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hiring-test-embed-'));
process.env.APP_PASSWORD = 'open-sesame';
process.env.LINK_SECRET = 'test-secret';
process.env.PUBLIC_URL = 'https://hr.example.com';
process.env.SERVE_FRONTEND = 'false';
process.env.TEST_EMBED_URL = 'https://test.example.com/start?v=2';

const { createServer } = await import('../src/server.js');

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

/** The candidate, and the test system: neither has a password. */
const open = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let vacancyRef;
let applicationId;
let uploadToken;

test('a published opening, applied to', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY PRIVATE LIMITED' });
  const vacancy = await api('POST', '/api/hiring/vacancies', {
    company_id: company.body.id,
    title: 'Travel Consultant',
    status: 'published',
  });
  vacancyRef = vacancy.body.ref_no;

  const applied = await open('POST', `/api/public/vacancies/${vacancyRef}/apply`, {
    name: 'Devanshi Trivedi',
    phone: '9825777123',
  });
  assert.equal(applied.status, 201);
  uploadToken = applied.body.upload_token;
  assert.ok(uploadToken, 'the thank-you page needs a token to fetch the test with');

  const { rows } = (await api('GET', '/api/hiring/applications')).body;
  applicationId = rows[0].id;
  assert.equal(rows[0].stage, 'New');
});

test('the thank-you page is told a test exists, and gets its URL with a token on it', async () => {
  assert.equal((await open('GET', '/api/public/config')).body.test_configured, true);

  const handed = await open('GET', `/api/public/test/${uploadToken}`);
  assert.equal(handed.status, 200);

  const url = new URL(handed.body.url);
  // The configured URL is kept whole - its own query string survives.
  assert.equal(url.origin + url.pathname, 'https://test.example.com/start');
  assert.equal(url.searchParams.get('v'), '2');
  // What the test system needs: who is sitting it, and how to answer.
  assert.equal(url.searchParams.get('ref'), String(applicationId));
  assert.ok(url.searchParams.get('callback_token'), 'no way to send a score back');
});

/*
 * The crux of making the test follow the vacancy: TEST_EMBED_URL is set in
 * this whole file, so an opening carrying its own has to WIN. Getting this
 * backwards would send every candidate the general test and nobody would
 * notice until somebody compared two scores.
 */
test("an opening's own test beats the app-wide one", async () => {
  const company = await api('POST', '/api/companies', { name: 'SCALE' });
  const own = await api('POST', '/api/hiring/vacancies', {
    company_id: company.body.id,
    title: 'Accounts Executive',
    status: 'published',
    test_url: 'https://accounts.example.com/sit?set=B',
    test_pass_percent: 70,
  });

  const applied = await open('POST', `/api/public/vacancies/${own.body.ref_no}/apply`, {
    name: 'Foram Mistry',
    phone: '9825777124',
  });
  const handed = await open('GET', `/api/public/test/${applied.body.upload_token}`);
  const url = new URL(handed.body.url);
  assert.equal(url.origin + url.pathname, 'https://accounts.example.com/sit');
  assert.equal(url.searchParams.get('set'), 'B');
  assert.equal(handed.body.pass_percent, 70, 'its own bar, not the app-wide 50');
  assert.ok(url.searchParams.get('callback_token'), 'a score still has to be able to come back');

  // And the other opening is untouched by it.
  const first = await open('GET', `/api/public/test/${uploadToken}`);
  assert.match(first.body.url, /^https:\/\/test\.example\.com\/start/);
});

test('a made-up link gets nothing', async () => {
  assert.equal((await open('GET', '/api/public/test/not-a-real-token')).status, 403);
  assert.equal((await open('POST', '/api/public/test-result/not-a-real-token', { score: 3 })).status, 403);
});

test('the score comes back with no password, and moves nobody', async () => {
  const token = new URL((await open('GET', `/api/public/test/${uploadToken}`)).body.url)
    .searchParams.get('callback_token');

  const sent = await open('POST', `/api/public/test-result/${token}`, {
    type: 'skills',
    score: 7,
    max_score: 10,
    source: 'the test system',
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.percentage, 70);

  const seen = await api('GET', `/api/hiring/applications/${applicationId}`);
  assert.equal(seen.body.tests.length, 1);
  assert.equal(seen.body.tests[0].percentage, 70);
  assert.equal(seen.body.tests[0].source, 'the test system');

  // The whole point. A score is one more thing to weigh, never a decision.
  assert.equal(seen.body.application.stage, 'New');
});

test('a second sitting is a second result, not a rewrite of the first', async () => {
  const token = new URL((await open('GET', `/api/public/test/${uploadToken}`)).body.url)
    .searchParams.get('callback_token');
  await open('POST', `/api/public/test-result/${token}`, { score: 9, max_score: 10 });

  const seen = await api('GET', `/api/hiring/applications/${applicationId}`);
  assert.equal(seen.body.tests.length, 2);
  assert.equal(seen.body.application.stage, 'New');
});

test('the callback token opens nothing else', async () => {
  const token = new URL((await open('GET', `/api/public/test/${uploadToken}`)).body.url)
    .searchParams.get('callback_token');

  // It is scoped to posting a result. It is not a password for the office.
  assert.equal((await open('GET', '/api/hiring/applications')).status, 401);
  const asPassword = await fetch(`${base}/api/hiring/applications`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(asPassword.status, 401);
});
