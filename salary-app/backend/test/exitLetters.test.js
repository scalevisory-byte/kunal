/**
 * THE RELIEVING LETTER AND THE EXPERIENCE CERTIFICATE.
 *
 * Dinesh: *"Employee exit procedures banavo proper"*. The one step the app
 * stopped short of is the only part the person leaving ever sees.
 *
 * What these pin:
 *
 *  - **"All dues settled" is printed only when the settlement actually is.**
 *    It is read as a receipt by the next employer; printed over an unpaid
 *    full and final it is a statement against the company that cannot be
 *    taken back.
 *  - **How they went decides the words.** A dismissal does not read
 *    "resigned".
 *  - **The conduct sentence is a choice**, not boilerplate.
 *  - **One file holds one person**, and it loads nothing from the internet.
 *  - No letter before there is a last working day to relieve them from.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { experienceLetterHtml, relievingLetterHtml, servedFor } from '../../shared/exitLetters.js';
import { exitSteps } from '../../shared/exitSteps.js';

const amit = { name: 'Amit Shah', code: 'BNF-012', designation: 'Tour Consultant', department: 'Operation', joined_on: '2023-04-01' };
const exit = { type: 'resigned', last_working_day: '2026-11-10', resigned_on: '2026-10-05' };

test('the dues sentence appears only when the full and final is settled', () => {
  const unpaid = relievingLetterHtml({ employee: amit, exit, company: 'BOOKNFLY', settled: false });
  assert.ok(!/dues payable/.test(unpaid), 'nothing may claim the dues are clear');
  assert.match(unpaid, /settlement of accounts is being processed/);

  const paid = relievingLetterHtml({ employee: amit, exit, company: 'BOOKNFLY', settled: true });
  assert.match(paid, /All dues payable by and to the company have been settled/);
});

test('how they went decides the words', () => {
  const quit = relievingLetterHtml({ employee: amit, exit, company: 'BOOKNFLY' });
  assert.match(quit, /resigned from the services/);

  const sacked = relievingLetterHtml({
    employee: amit, exit: { ...exit, type: 'terminated' }, company: 'BOOKNFLY',
  });
  assert.ok(!/resigned/.test(sacked), 'a dismissal must not read as a resignation');
  assert.match(sacked, /ceased to be in the services/);

  const retired = relievingLetterHtml({
    employee: amit, exit: { ...exit, type: 'retired' }, company: 'BOOKNFLY',
  });
  assert.match(retired, /retired from the services/);
});

test('the conduct sentence is a choice, on both letters', () => {
  for (const build of [relievingLetterHtml, experienceLetterHtml]) {
    const without = build({ employee: amit, exit, company: 'BOOKNFLY', conduct: false });
    assert.ok(!/conduct/.test(without));
    const with_ = build({ employee: amit, exit, company: 'BOOKNFLY', conduct: true });
    assert.match(with_, /conduct and performance satisfactory/);
  }
});

test('the experience certificate says how long, and says nothing about money', () => {
  const html = experienceLetterHtml({ employee: amit, exit, company: 'BOOKNFLY' });
  assert.match(html, /3 years 7 months/);
  assert.match(html, /Tour Consultant/);
  assert.ok(!/dues|salary|₹/.test(html), 'an experience certificate is not a pay record');
});

test('a length of service is never guessed', () => {
  assert.equal(servedFor('', '2026-11-10'), '');
  assert.equal(servedFor('2023-04-01', ''), '');
  assert.equal(servedFor('2026-11-10', '2023-04-01'), '', 'and never negative');
  assert.equal(servedFor('2026-10-20', '2026-11-10'), 'less than a month');
});

test('ONE FILE HOLDS ONE PERSON, and it loads nothing from the internet', () => {
  const html = relievingLetterHtml({
    employee: amit, exit, company: 'BOOKNFLY', settled: true, conduct: true,
    note: 'Collected the laptop on the 11th.', signedBy: 'Dinesh Parmar',
  });
  assert.ok(!/src="http|href="http|fetch\(|<img(?![^>]*src="data:)/.test(html));
  assert.ok(!/Priya|Riya|Kiran/.test(html), 'nobody else is on it');
  // The only inline handler is the print button, exactly as the payslip.
  // Anchored on whitespace, or the `content=` of a meta tag reads as one.
  const handlers = (html.match(/\son[a-z]+=/g) || []).map((h) => h.trim());
  assert.deepEqual(handlers, ['onclick=']);
});

test('a name with a script in it is escaped', () => {
  const html = experienceLetterHtml({
    employee: { ...amit, name: '<script>alert(1)</script>' }, exit, company: 'BOOKNFLY',
  });
  assert.ok(!/<script>/.test(html));
});

/* ---------------- the five steps ---------------- */

test('the strip reads the records and invents nothing', () => {
  const nothing = exitSteps({});
  assert.equal(nothing.at, 'resignation');
  assert.equal(nothing.done, false);

  const dated = exitSteps({ exit });
  assert.equal(dated.steps[1].done, true);
  assert.equal(dated.at, 'clearance', 'the clearance is next, and it is not ready by default');

  const whole = exitSteps({
    exit: { ...exit, settled_on: '2026-11-20' },
    clearance: { ready: true, outstanding: 0, blocking: [] },
  });
  assert.equal(whole.done, true);
  assert.match(whole.steps[4].why, /dues settled/);
});

test('the letters step says what it will NOT claim while the dues are open', () => {
  const open = exitSteps({ exit, clearance: { ready: true, outstanding: 0, blocking: [] } });
  const letters = open.steps.find((s) => s.key === 'letters');
  assert.equal(letters.done, false);
  assert.match(letters.why, /will not say the dues are settled/);
});

/* ---------------- over HTTP ---------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-letters-'));
process.env.APP_PASSWORD = 'the-key';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text.startsWith('{') ? JSON.parse(text) : null;
  return { status: res.status, body: json, text, filename: res.headers.get('content-disposition') || '' };
};

let who = 0;

test('no letter before there is a date to relieve them from', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  const made = await api('POST', '/api/employees', {
    name: 'Amit Shah', company_id: company.body.id, monthly_salary: 26000, joined_on: '2023-04-01',
  });
  who = made.body.id;

  const none = await api('GET', `/api/people/exits/${who}/letter/relieving`);
  assert.equal(none.status, 409);
  assert.match(none.body.error, /Nothing is recorded about them leaving/);

  await api('PUT', `/api/people/exits/${who}`, { type: 'resigned', resigned_on: '2026-10-05' });
  const noDate = await api('GET', `/api/people/exits/${who}/letter/relieving`);
  assert.equal(noDate.status, 409);
  assert.match(noDate.body.error, /last working day/);
});

test('and once there is, both letters come back as one file each', async () => {
  await api('PUT', `/api/people/exits/${who}`, { last_working_day: '2026-11-10' });

  const relieving = await api('GET', `/api/people/exits/${who}/letter/relieving?conduct=true&by=Dinesh`);
  assert.equal(relieving.status, 200);
  assert.match(relieving.filename, /Amit-Shah-relieving-letter-2026-11-10\.html/);
  assert.match(relieving.text, /Amit Shah/);
  assert.match(relieving.text, /conduct and performance satisfactory/);
  assert.match(relieving.text, /Dinesh/);
  assert.ok(!/All dues payable/.test(relieving.text), 'the full and final is not settled yet');

  const experience = await api('GET', `/api/people/exits/${who}/letter/experience`);
  assert.equal(experience.status, 200);
  assert.match(experience.filename, /experience-certificate/);
  assert.ok(!/conduct/.test(experience.text), 'not ticked, not printed');
});

test('an unknown letter is refused rather than guessed at', async () => {
  const bad = await api('GET', `/api/people/exits/${who}/letter/promotion`);
  assert.equal(bad.status, 400);
});

test('A PAST EMPLOYEE CANNOT BE DELETED', async () => {
  const check = await api('GET', `/api/employees/${who}/delete-check`);
  assert.match(check.body.problem, /exit is on the record/);
  const refused = await api('DELETE', `/api/employees/${who}`);
  assert.equal(refused.status, 409);

  // Everything about them is still there.
  const still = await api('GET', `/api/employees/${who}`);
  assert.equal(still.status, 200);
  assert.equal(still.body.name, 'Amit Shah');
});
