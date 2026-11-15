/**
 * The test result, the answer sheet, and one candidate's whole file.
 *
 * Dinesh: *"Test k liye link bhejna ka bhi bana dena / Test ka result show ho
 * / And uski puri answer sheet bhi show ho"*, then *"Agar kisi candidate ma
 * pura detail pdf ya print me chiaye to — Resume / Interview k time me jo form
 * fill kiya hoga o / Test wala sheet / Interviewer ka observations ka form —
 * sab nikle"*.
 *
 * The lines these tests hold:
 *   - a skipped question is NOT a wrong one, in either direction;
 *   - the answer key never reaches a candidate's screen;
 *   - the pack ASSEMBLES, so its figures are the stored ones;
 *   - one file holds one person;
 *   - sending the link again is the SAME attempt, never a fresh draw.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { answerRows, minutesTaken, sheetSummary } from '../../shared/testSheet.js';
import { candidatePackHtml } from '../../shared/candidatePack.js';

/* ---------------- the answer sheet, on its own ---------------- */

const QS = [
  { id: 1, category: 'Accounts', question: 'GST?', option_a: 'no', option_b: 'yes', correct: 'b', marks: 1 },
  { id: 2, category: 'Accounts', question: 'TDS?', option_a: 'no', option_b: 'yes', correct: 'a', marks: 1 },
  { id: 3, category: 'English', question: 'Spelling?', option_a: 'no', option_b: 'yes', correct: 'b', marks: 1 },
];

test('a skipped question is not a wrong one', () => {
  const rows = answerRows({ drawn: QS, answers: { 1: 'b', 2: 'b' } });
  assert.deepEqual(rows.map((r) => r.verdict), ['right', 'wrong', 'skipped']);
  assert.equal(rows[2].given, null, 'a blank must be null, not an empty string');
  assert.equal(rows[2].given_text, null);

  const sum = sheetSummary({ drawn: QS, answers: { 1: 'b', 2: 'b' } });
  assert.deepEqual([sum.right, sum.wrong, sum.skipped], [1, 1, 1]);
});

test('each option says whether it was chosen and whether it was right, separately', () => {
  const [row] = answerRows({ drawn: [QS[1]], answers: { 2: 'b' } });
  const chosen = row.options.find((o) => o.chosen);
  const correct = row.options.find((o) => o.correct);
  assert.notEqual(chosen.key, correct.key);
  assert.equal(chosen.correct, false, 'the chosen one must not be marked right as well');
});

test('a right answer is marked chosen AND correct, not one or the other', () => {
  const [row] = answerRows({ drawn: [QS[0]], answers: { 1: 'b' } });
  const b = row.options.find((o) => o.key === 'b');
  assert.equal(b.chosen, true);
  assert.equal(b.correct, true);
});

test('the sheet is split by topic', () => {
  const sum = sheetSummary({ drawn: QS, answers: { 1: 'b', 2: 'b', 3: 'b' } });
  const acc = sum.by_category.find((g) => g.category === 'Accounts');
  assert.deepEqual([acc.asked, acc.right, acc.wrong], [2, 1, 1]);
});

test('time taken is not guessed when either end is missing', () => {
  assert.equal(minutesTaken({ started_at: '2026-11-14T10:00:00Z' }), null);
  assert.equal(minutesTaken({ submitted_at: '2026-11-14T10:00:00Z' }), null);
  assert.equal(
    minutesTaken({ started_at: '2026-11-14T10:00:00Z', submitted_at: '2026-11-14T10:08:00Z' }),
    8
  );
});

/* ---------------- the pack ---------------- */

const PACK = {
  candidate: { name: 'Nikhil Joshi', phone: '9876500011', ref_no: 'CAN-001' },
  applications: [{ vacancy_title: 'Accounts Executive', company_name: 'BOOKNFLY', stage: 'Interview' }],
  rounds: [
    {
      interview: { round: 1, interviewer: 'Priya Nair' },
      form: { filled_by: 'Priya Nair', highest_qualification: 'B.Com', answers: {} },
      evaluation: { evaluated_by: 'Priya Nair', recommendation: 'Recommended', ratings: { attitude: 5 } },
    },
  ],
  attempts: [
    {
      attempt: {
        submitted_at: '2026-11-14T10:08:00Z',
        started_at: '2026-11-14T10:00:00Z',
        percentage: 67,
        passed: 1,
        score: 2,
        max_score: 3,
        pass_percent: 50,
        duration_minutes: 10,
        drawn: QS,
        answers: { 1: 'b', 2: 'b', 3: 'b' },
      },
      paper: { name: 'Accounts test' },
    },
  ],
  resume_name: 'Nikhil-Joshi-CV.pdf',
};

test('the pack carries all four things he asked for', () => {
  const html = candidatePackHtml(PACK);
  assert.match(html, /Nikhil-Joshi-CV\.pdf/, 'the CV is named');
  assert.match(html, /Candidate particulars/, 'the interview form');
  assert.match(html, /Evaluation/, "the interviewer's evaluation");
  assert.match(html, /answer sheet/i, 'the test sheet');
});

/*
 * A CV is a PDF or a Word file and cannot be poured into an HTML page.
 * Saying so beats a pack with a blank page where the CV should be.
 */
test('the pack says the CV comes as its own file rather than pretending', () => {
  assert.match(candidatePackHtml(PACK), /comes as its own file/);
});

test('what is missing is named, not silently left out', () => {
  const html = candidatePackHtml({
    ...PACK,
    rounds: [{ interview: { round: 1 }, form: null, evaluation: null }],
  });
  assert.match(html, /not filled in/);
  assert.match(html, /not written up/);
});

test('a candidate with nothing recorded still prints', () => {
  const html = candidatePackHtml({ candidate: { name: 'Asha Patel' } });
  assert.match(html, /Asha Patel/);
  assert.match(html, /Nothing has been recorded/);
});

test('the pack assembles — its figures are the stored ones', () => {
  const html = candidatePackHtml(PACK);
  assert.match(html, /67%/, 'the stored percentage, not one worked out here');
  assert.match(html, /2 of 3/);
});

/* ONE FILE HOLDS ONE PERSON. This is the file most likely to be forwarded. */
test('nobody else appears in one candidate’s file', () => {
  const html = candidatePackHtml(PACK);
  for (const other of ['Asha Patel', 'Riya', 'Amit Shah']) {
    assert.ok(!html.includes(other), `${other} is in somebody else's file`);
  }
});

test('nothing in the pack loads from the internet', () => {
  const html = candidatePackHtml(PACK);
  assert.ok(!/\ssrc=/.test(html), 'it pulls in a resource');
  assert.ok(!/https?:\/\//.test(html), 'it reaches out to a URL');
  const handlers = html.match(/\son\w+="[^"]*"/g) || [];
  assert.deepEqual(handlers, [' onclick="window.print()"'], 'the print button is the only one');
});

test('a <script> in a name cannot get into the pack', () => {
  const html = candidatePackHtml({
    ...PACK,
    candidate: { name: '<script>alert(1)</script>' },
  });
  assert.ok(!html.includes('<script>alert'), 'the name was not escaped');
  assert.match(html, /&lt;script&gt;/);
});

/* ---------------- against a real server ---------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-file-'));
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
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, text, headers: res.headers };
};

const made = {};

test('set up a candidate who was screened, interviewed and tested', async () => {
  await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  const companyId = (await api('GET', '/api/companies')).body.companies[0].id;

  const vac = await api('POST', '/api/hiring/vacancies', {
    company_id: companyId, title: 'Accounts Executive', openings: 1, status: 'published',
  });
  made.vacancy = vac.body.vacancy?.id ?? vac.body.id;

  const cand = await api('POST', '/api/hiring/candidates', {
    name: 'Nikhil Joshi', phone: '9876500011',
  });
  made.candidate = cand.body.candidate?.id ?? cand.body.id;

  const app = await api('POST', '/api/hiring/applications', {
    vacancy_id: made.vacancy, candidate_id: made.candidate,
  });
  made.application = app.body.application?.id ?? app.body.id;

  const iv = await api('POST', '/api/hiring/interviews', {
    application_id: made.application, at: '2026-11-18T11:00', round: 1, interviewer: 'Priya Nair',
  });
  made.interview = iv.body.interview?.id ?? iv.body.id;

  await api('PUT', `/api/hiring/interviews/${made.interview}/form`, {
    highest_qualification: 'B.Com', answers: { why_leaving: 'A bigger accounts role.' },
  });
  await api('PUT', `/api/hiring/interviews/${made.interview}/evaluation`, {
    evaluated_by: 'Priya Nair', ratings: { attitude: 5 }, recommendation: 'Recommended',
  });

  await api('POST', '/api/hiring/bank/starter', { position: 'Accounts' });
  const paper = (await api('GET', '/api/hiring/papers')).body.papers.find(
    (p) => p.name === 'Accounts test'
  );
  const asg = await api('POST', `/api/hiring/papers/${paper.id}/assign`, {
    candidate_id: made.candidate, application_id: made.application,
  });
  made.attempt = asg.body.attempt.id;
  made.token = asg.body.attempt.token;
  made.drawn = asg.body.attempt.drawn;
  assert.equal(asg.status, 201);
});

/*
 * THE LINE THE WHOLE TEST MODULE SITS ON. The office sheet shows the right
 * answers; the candidate's own page must not, however the question is asked.
 */
test('the candidate sitting the test is never sent the answers', async () => {
  const open = await api('POST', `/api/public/sit/${made.token}` + '/start', {});
  assert.equal(open.status, 200);
  assert.equal(open.body.questions.length, 20);
  for (const q of open.body.questions) {
    assert.ok(!('correct' in q), 'the answer key reached the candidate');
    assert.ok(!('marks' in q), 'the marks reached the candidate');
  }
  assert.ok(!/"correct"/.test(open.text), 'an answer key is in the payload somewhere');
});

test('sit it: some right, some wrong, some left blank', async () => {
  const answers = {};
  made.drawn.forEach((q, i) => {
    if (i >= 17) return;
    const other = ['a', 'b', 'c', 'd'].find(
      (k) => k !== q.correct && String(q[`option_${k}`] || '').trim()
    );
    answers[q.id] = i < 14 ? q.correct : other;
  });
  const out = await api('POST', `/api/public/sit/${made.token}`, { answers });
  assert.equal(out.status, 200);
  assert.equal(out.body.percentage, 70);
});

test('the candidate panel gets the result without the answer key', async () => {
  const { body } = await api('GET', `/api/hiring/candidates/${made.candidate}`);
  assert.equal(body.attempts.length, 1);
  const a = body.attempts[0];
  assert.equal(a.percentage, 70);
  assert.equal(a.right_count, 14);
  assert.equal(a.wrong_count, 3);
  assert.equal(a.skipped_count, 3);
  assert.equal(a.asked, 20);
  /* The sheet is a screen of its own; a list of three tests does not need
   * sixty questions and their answers to draw three rows. */
  assert.ok(!('drawn' in a), 'the questions travelled with the list');
  assert.ok(!('answers' in a), 'the answers travelled with the list');
  /* The token IS carried — sending the link again is the common case. */
  assert.ok(a.token, 'the link cannot be sent again');
});

test('the office answer sheet carries every question, with what was chosen', async () => {
  const { body } = await api('GET', `/api/hiring/attempts/${made.attempt}`);
  const rows = answerRows(body.attempt);
  assert.equal(rows.length, 20);
  assert.equal(rows.filter((r) => r.verdict === 'right').length, 14);
  assert.equal(rows.filter((r) => r.verdict === 'wrong').length, 3);
  assert.equal(rows.filter((r) => r.verdict === 'skipped').length, 3);
  /* The category rides on the attempt, so a question reclassified next month
   * cannot re-slice a test already sat. */
  assert.ok(rows.every((r) => r.category), 'the topic breakdown would be blank');
});

test('both documents come down as files, named after the person', async () => {
  const sheet = await api('GET', `/api/hiring/attempts/${made.attempt}/sheet/print`);
  assert.equal(sheet.status, 200);
  assert.match(sheet.headers.get('content-disposition'), /attachment; filename="Nikhil-Joshi-/);
  assert.match(sheet.text, /Nikhil Joshi/);

  const pack = await api('GET', `/api/hiring/candidates/${made.candidate}/pack/print`);
  assert.equal(pack.status, 200);
  assert.match(pack.headers.get('content-disposition'), /filename="Nikhil-Joshi-file\.html"/);
});

test('the pack carries this candidate’s real form, evaluation and answer sheet', async () => {
  const { text } = await api('GET', `/api/hiring/candidates/${made.candidate}/pack/print`);
  assert.match(text, /B\.Com/, 'the particulars form is not in it');
  assert.match(text, /A bigger accounts role/, "the candidate's own answer is not in it");
  assert.match(text, /Priya Nair/, 'the evaluator is not named');
  assert.match(text, /Recommended/, 'the recommendation is not in it');
  assert.match(text, /70%/, 'the test result is not in it');
  assert.match(text, /the right answer/, 'the answer sheet is not in it');
});

test('asking for a candidate who is not there says so', async () => {
  assert.equal((await api('GET', '/api/hiring/candidates/9999/pack/print')).status, 404);
  assert.equal((await api('GET', '/api/hiring/attempts/9999/sheet/print')).status, 404);
});
