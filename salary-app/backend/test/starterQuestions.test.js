/**
 * The bank that ships with the app.
 *
 * Dinesh asked for a twenty-question test - fifteen general, five for the
 * seat - at thirty seconds a question. An empty bank can draw nothing, so
 * these come with the app and arrive through a button.
 *
 * The tests here pin the three things that would quietly ruin it: a wrong
 * answer key, a second press doubling the bank, and the questions reaching a
 * candidate's browser with their answers attached.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  STARTER_BY_POSITION,
  STARTER_GENERAL_COUNT,
  STARTER_POSITION_COUNT,
  STARTER_QUESTIONS,
  STARTER_SECONDS_PER_QUESTION,
  starterPaper,
} from '../../shared/starterQuestions.js';
import { drawPaper, forCandidate, markAttempt, paperSize } from '../../shared/questionBank.js';

const ALL = [...STARTER_QUESTIONS, ...Object.values(STARTER_BY_POSITION).flat()];

/*
 * Rows as the bank actually holds them. The module exports plain questions
 * with no id; marking looks an answer up BY id, so a fixture without one
 * scores nought against perfectly good code.
 */
const ROWS = ALL.map((q, i) => ({ ...q, id: i + 1, active: 1 }));

/* ---------------- the questions themselves ---------------- */

test('every question names a real answer', () => {
  for (const q of ALL) {
    assert.ok(['a', 'b', 'c', 'd'].includes(q.correct), `${q.question}: correct is "${q.correct}"`);
    assert.ok(
      String(q[`option_${q.correct}`] || '').trim(),
      `${q.question}: the right answer points at an empty option`
    );
  }
});

test('every question offers at least three choices', () => {
  for (const q of ALL) {
    const filled = ['a', 'b', 'c', 'd'].filter((k) => String(q[`option_${k}`] || '').trim());
    assert.ok(filled.length >= 3, `${q.question}: only ${filled.length} options`);
  }
});

test('no two options in one question are the same', () => {
  for (const q of ALL) {
    const filled = ['a', 'b', 'c', 'd']
      .map((k) => String(q[`option_${k}`] || '').trim().toLowerCase())
      .filter(Boolean);
    assert.equal(new Set(filled).size, filled.length, `${q.question}: a repeated option`);
  }
});

/*
 * The loader matches on question TEXT so it can be pressed twice without
 * doubling the bank. Two questions sharing a text would mean only one ever
 * loaded, and no later edit could tell them apart.
 */
test('no two questions share their text', () => {
  const seen = new Map();
  for (const q of ALL) {
    const key = q.question.trim().toLowerCase();
    assert.ok(!seen.has(key), `"${q.question}" appears twice`);
    seen.set(key, true);
  }
});

test('nothing carries a negative mark — a blank answer must cost nothing', () => {
  for (const q of ALL) assert.equal(Number(q.negative_marks) || 0, 0, q.question);
});

/* ---------------- the paper he asked for ---------------- */

test('the paper is twenty questions: fifteen general and five for the seat', () => {
  const paper = starterPaper('Accounts');
  assert.equal(paperSize(paper.sections), STARTER_GENERAL_COUNT + STARTER_POSITION_COUNT);
  assert.equal(paperSize(paper.sections), 20);

  const seat = paper.sections.find((s) => s.category === 'Accounts');
  assert.equal(seat.count, STARTER_POSITION_COUNT);

  const general = paper.sections.filter((s) => s.category !== 'Accounts');
  assert.equal(general.reduce((n, s) => n + s.count, 0), STARTER_GENERAL_COUNT);
});

test('thirty seconds a question makes a ten-minute paper', () => {
  const paper = starterPaper('Accounts');
  assert.equal(STARTER_SECONDS_PER_QUESTION, 30);
  assert.equal(paper.duration_minutes, (20 * 30) / 60);
});

test('with no position it is the general fifteen, and does not borrow another seat', () => {
  const paper = starterPaper('');
  assert.equal(paperSize(paper.sections), STARTER_GENERAL_COUNT);
  for (const s of paper.sections) {
    assert.ok(!Object.keys(STARTER_BY_POSITION).includes(s.category), s.category);
  }
});

test('the general sections cover aptitude, computer, email and English', () => {
  const cats = starterPaper('').sections.map((s) => s.category);
  for (const want of ['General Aptitude', 'Computer Knowledge', 'Email and Internet', 'English']) {
    assert.ok(cats.includes(want), `${want} is not in the general paper`);
  }
});

test('the bank holds enough of each category for the paper to rotate', () => {
  const have = {};
  for (const q of ALL) have[q.category] = (have[q.category] || 0) + 1;
  for (const s of starterPaper('Accounts').sections) {
    assert.ok(
      have[s.category] > s.count,
      `${s.category}: ${have[s.category]} in the bank, ${s.count} drawn — nothing left to rotate`
    );
  }
});

test('two candidates do not get the same paper', () => {
  const paper = starterPaper('Travel Consultant');
  const first = drawPaper(ROWS, paper.sections).questions.map((q) => q.id);
  const second = drawPaper(ROWS, paper.sections).questions.map((q) => q.id);
  assert.equal(first.length, 20);
  assert.notDeepEqual(first, second);
});

/* ---------------- against a real server ---------------- */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-starter-'));
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

test('loading fills an empty bank and makes the paper', async () => {
  const before = await api('GET', '/api/hiring/bank/starter');
  assert.equal(before.body.general.missing, STARTER_QUESTIONS.length);

  const out = await api('POST', '/api/hiring/bank/starter', { position: 'Accounts' });
  assert.equal(out.status, 200);
  assert.equal(out.body.added, STARTER_QUESTIONS.length + STARTER_BY_POSITION.Accounts.length);
  assert.equal(out.body.paper_existed, false);
  assert.equal(out.body.paper.name, 'Accounts test');
  assert.equal(paperSize(out.body.paper.sections), 20);
});

test('pressing it again adds nothing and makes no second paper', async () => {
  const again = await api('POST', '/api/hiring/bank/starter', { position: 'Accounts' });
  assert.equal(again.body.added, 0);
  assert.equal(again.body.paper_existed, true);

  const { body } = await api('GET', '/api/hiring/papers');
  const named = body.papers.filter((p) => p.name === 'Accounts test');
  assert.equal(named.length, 1);

  const summary = await api('GET', '/api/hiring/bank/starter');
  assert.equal(summary.body.general.missing, 0);
  assert.equal(summary.body.positions.find((p) => p.name === 'Accounts').missing, 0);
});

test('a question edited in the app is not reverted by loading again', async () => {
  const { body } = await api('GET', '/api/hiring/bank/questions?category=English');
  const one = body.questions[0];
  await api('PUT', '/api/hiring/bank/questions', { ...one, correct: 'a', marks: 3 });

  await api('POST', '/api/hiring/bank/starter', { position: 'Accounts' });

  const after = await api('GET', '/api/hiring/bank/questions?category=English');
  const same = after.body.questions.find((q) => q.id === one.id);
  assert.equal(same.marks, 3, 'the edited marks were overwritten');
  assert.equal(same.correct, 'a', 'the edited answer was overwritten');
});

test('loading a second position leaves the first one alone', async () => {
  const out = await api('POST', '/api/hiring/bank/starter', { position: 'Travel Consultant' });
  assert.equal(out.body.added, STARTER_BY_POSITION['Travel Consultant'].length);

  const summary = await api('GET', '/api/hiring/bank/starter');
  for (const pos of ['Accounts', 'Travel Consultant']) {
    assert.equal(summary.body.positions.find((p) => p.name === pos).missing, 0);
  }
});

/*
 * The summary exists so the dashboard does not have to import the questions.
 * Bundling them would put sixty-four questions AND THEIR ANSWERS into the one
 * JavaScript file a candidate downloads to sit a test.
 */
test('the summary carries counts, never a question or an answer', async () => {
  const { body } = await api('GET', '/api/hiring/bank/starter');
  const text = JSON.stringify(body);
  assert.ok(!text.includes('Passenger Name Record'), 'a question text came back');
  assert.ok(!/"correct"/.test(text), 'an answer key came back');
  assert.ok(!/"option_/.test(text), 'the options came back');
  assert.equal(typeof body.general.total, 'number');
});

test('the candidate copy of a starter question carries no answer', () => {
  const asked = forCandidate(drawPaper(ROWS, starterPaper('Accounts').sections).questions);
  assert.equal(asked.length, 20);
  for (const q of asked) {
    assert.ok(!('correct' in q), `${q.question} still carries the answer`);
    assert.ok(!('marks' in q), `${q.question} still carries its marks`);
  }
});

test('a paper of starter questions marks correctly, and a blank answer costs nothing', () => {
  const questions = drawPaper(ROWS, starterPaper('Accounts').sections).questions;
  const right = {};
  questions.forEach((q) => { right[q.id] = q.correct; });

  const all = markAttempt(questions, right);
  assert.equal(all.score, questions.length);
  assert.equal(all.percentage, 100);
  assert.equal(all.right, questions.length);
  assert.equal(all.skipped, 0);

  const none = markAttempt(questions, {});
  assert.equal(none.score, 0, 'blank answers must not go negative');
  assert.equal(none.skipped, questions.length);
});
