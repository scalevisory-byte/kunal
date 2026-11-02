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

/*
 * A score typed in by hand must be judged by the SAME bar as one the test
 * system posts back. The test system is told the opening's figure when it
 * fetches the test, so it sends the right one; a typed score carries none and
 * was being judged at the app-wide 50 on a seat whose bar is 70 - the two
 * routes disagreeing about the same candidate.
 */
test("a score typed in is judged by the opening's own pass mark", async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY VENTURE LLP' });
  const strict = await api('POST', '/api/hiring/vacancies', {
    company_id: company.body.id,
    title: 'Senior Accountant',
    status: 'published',
    test_pass_percent: 70,
  });
  const applied = await open('POST', `/api/public/vacancies/${strict.body.ref_no}/apply`, {
    name: 'Nirav Desai',
    phone: '9825777125',
  });
  assert.equal(applied.status, 201);
  const { rows } = (await api('GET', '/api/hiring/applications')).body;
  const theirs = rows.find((r) => r.candidate_name === 'Nirav Desai');
  assert.ok(theirs, 'the application should be on the office list');

  // 60% clears the app-wide 50 and misses this opening's 70.
  const typed = await api('POST', `/api/hiring/applications/${theirs.id}/test`, {
    score: 6,
    max_score: 10,
  });
  assert.equal(typed.body.test.percentage, 60);
  assert.equal(typed.body.test.passed, false, 'judged at 70, not the app-wide 50');
  assert.equal(typed.body.test.pass_percent, 70, 'and the bar is recorded on the result');
  assert.equal(typed.body.application.test_status, 'below threshold');
  assert.equal(typed.body.application.stage, 'New', 'and it still moves nobody');
});

/*
 * The per-question limit is HANDED TO the test system, because this app cannot
 * run a clock on somebody typing - only the test page can. So the rule is
 * decided here and published on the URL; with no limit it is left OFF the URL
 * entirely rather than sent as 0, which a test system could read as "no time
 * at all" and fail everybody.
 */
test('the time allowed for one question rides on the test link', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  const timed = await api('POST', '/api/hiring/vacancies', {
    company_id: company.body.id,
    title: 'Data Entry',
    status: 'published',
    test_url: 'https://test.zyntajobs.in/?embed=1',
    test_seconds_per_question: 45,
  });
  const applied = await open('POST', `/api/public/vacancies/${timed.body.ref_no}/apply`, {
    name: 'Krupa Shah',
    phone: '9825777126',
  });
  const handed = await open('GET', `/api/public/test/${applied.body.upload_token}`);
  const url = new URL(handed.body.url);
  assert.equal(url.searchParams.get('seconds_per_question'), '45');
  assert.equal(url.searchParams.get('embed'), '1', 'and the embed flag still survives');
  assert.equal(handed.body.seconds_per_question, 45);

  // An opening with no limit says so by saying nothing.
  const loose = await api('POST', '/api/hiring/vacancies', {
    company_id: company.body.id,
    title: 'Peon',
    status: 'published',
    test_url: 'https://test.zyntajobs.in/?embed=1',
  });
  const b = await open('POST', `/api/public/vacancies/${loose.body.ref_no}/apply`, {
    name: 'Ankit Bhoi',
    phone: '9825777127',
  });
  const second = await open('GET', `/api/public/test/${b.body.upload_token}`);
  assert.equal(new URL(second.body.url).searchParams.has('seconds_per_question'), false);
  assert.equal(second.body.seconds_per_question, null, 'no limit, not nought');
});

test('a result keeps the limit it was sat under', async () => {
  const { rows } = (await api('GET', '/api/hiring/applications')).body;
  const theirs = rows.find((r) => r.candidate_name === 'Krupa Shah');
  const recorded = await api('POST', `/api/hiring/applications/${theirs.id}/test`, {
    score: 8,
    max_score: 10,
  });
  assert.equal(recorded.body.test.seconds_per_question, 45);

  // Changing the opening's limit afterwards must not rewrite what the old
  // result was judged against.
  const app = (await api('GET', `/api/hiring/applications/${theirs.id}`)).body;
  await api('PATCH', `/api/hiring/vacancies/${app.application.vacancy_id}`, {
    test_seconds_per_question: 20,
  });
  const after = (await api('GET', `/api/hiring/applications/${theirs.id}`)).body;
  assert.equal(after.tests[0].seconds_per_question, 45, 'the old sitting keeps its own limit');
  assert.equal(after.test.seconds_per_question, 20, 'while the opening now says 20');
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
