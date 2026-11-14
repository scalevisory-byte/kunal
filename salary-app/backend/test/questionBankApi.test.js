import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-qbank-'));
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

/** A bank with enough questions for a paper to be drawn several ways. */
async function bank(prefix, n = 14) {
  for (let i = 1; i <= n; i += 1) {
    await api('PUT', '/api/hiring/bank/questions', {
      category: prefix,
      question: `${prefix} question ${i}?`,
      option_a: 'first', option_b: 'second', option_c: 'third', option_d: 'fourth',
      correct: 'b', marks: 1, negative_marks: 0.25,
    });
  }
}

async function paperFor(name, sections, extra = {}) {
  const res = await api('PUT', '/api/hiring/papers', {
    name, pass_percent: 50, duration_minutes: 20, sections, ...extra,
  });
  return res.body;
}

async function candidate(name) {
  return (await api('POST', '/api/hiring/candidates', {
    name, phone: String(9100000000 + Math.floor(Math.random() * 899999999)),
  })).body;
}

/* ---------------- the bank ---------------- */

test('a question nobody could answer is refused', async () => {
  const noAnswer = await api('PUT', '/api/hiring/bank/questions', {
    category: 'Travel', question: 'What is a PNR?', option_a: 'one', option_b: 'two',
  });
  assert.equal(noAnswer.status, 400);
  assert.match(noAnswer.body.error, /Mark which option is right/);

  // Marked right, but that option is empty - the commonest typo, and it would
  // make the question unanswerable for everybody.
  const empty = await api('PUT', '/api/hiring/bank/questions', {
    category: 'Travel', question: 'What is a PNR?', option_a: 'one', option_b: 'two', correct: 'd',
  });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /Option D is marked right but has nothing in it/);

  const oneOption = await api('PUT', '/api/hiring/bank/questions', {
    category: 'Travel', question: 'Yes?', option_a: 'yes', correct: 'a',
  });
  assert.equal(oneOption.status, 400);
  assert.match(oneOption.body.error, /at least two options/);
});

test('a paper cannot be set from a bank that cannot fill it', async () => {
  await bank('Thin', 3);
  const paper = await paperFor('Thin paper', [{ category: 'Thin', count: 10 }]);
  const who = await candidate('Riya Pal');
  const res = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });
  assert.equal(res.status, 400);
  // Named with both numbers, so the office knows how many more to type in.
  assert.match(res.body.error, /only 3 usable Thin questions and this paper asks for 10/);

  // ...and the office is told BEFORE anybody is sent a link.
  const ready = await api('GET', `/api/hiring/papers/${paper.id}`);
  assert.equal(ready.body.ready, false);
  assert.deepEqual(ready.body.short, [{ category: 'Thin', want: 10, have: 3 }]);
});

/* ---------------- what the candidate gets ---------------- */

test('THE ANSWER NEVER REACHES THE CANDIDATE', async () => {
  await bank('Secrets');
  const paper = await paperFor('Secrets paper', [{ category: 'Secrets', count: 6 }]);
  const who = await candidate('Amit Shah');
  const { body } = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });
  const token = body.attempt.token;

  const sat = await api('GET', `/api/public/sit/${token}`);
  assert.equal(sat.status, 200);
  const wire = JSON.stringify(sat.body);

  /*
   * The whole module exists for this line. A test whose answers are in the
   * page source is not a test, and it would be found within a week of the
   * first candidate opening the developer tools.
   */
  assert.ok(!/"correct"/.test(wire), 'the right answer was sent to the candidate');
  assert.ok(!/"marks"/.test(wire), 'which questions carry the weight was sent to the candidate');
  assert.ok(!/negative_marks/.test(wire));
  assert.equal(sat.body.questions.length, 6);
  assert.ok(sat.body.questions.every((q) => q.options.length === 4));
});

test('two candidates do not get the same paper', async () => {
  await bank('Rotate');
  const paper = await paperFor('Rotating paper', [{ category: 'Rotate', count: 8 }]);
  const papers = [];
  for (const name of ['One', 'Two', 'Three', 'Four']) {
    const who = await candidate(`Rotate ${name}`);
    const { body } = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });
    const sat = await api('GET', `/api/public/sit/${body.attempt.token}`);
    papers.push(sat.body.questions.map((q) => q.id).join(','));
  }
  assert.equal(new Set(papers).size, papers.length, 'four candidates got a repeated paper');
});

test('the options are shuffled too, so "it was B" is worth nothing', async () => {
  await bank('Options');
  const paper = await paperFor('Options paper', [{ category: 'Options', count: 10 }]);
  const seen = new Set();
  for (const name of ['A', 'B', 'C']) {
    const who = await candidate(`Options ${name}`);
    const { body } = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });
    const sat = await api('GET', `/api/public/sit/${body.attempt.token}`);
    for (const q of sat.body.questions) seen.add(`${q.id}:${q.options.map((o) => o.key).join('')}`);
  }
  // Every question in this bank has the same four options, so if the order
  // were fixed there would be exactly one arrangement per question.
  const arrangements = new Set([...seen].map((s) => s.split(':')[1]));
  assert.ok(arrangements.size > 1, 'every candidate saw the options in the same order');
});

test('a refresh is not a second chance', async () => {
  await bank('Clock');
  const paper = await paperFor('Clock paper', [{ category: 'Clock', count: 5 }]);
  const who = await candidate('Clock Watcher');
  const { body } = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });

  const first = await api('GET', `/api/public/sit/${body.attempt.token}`);
  await new Promise((r) => setTimeout(r, 1100));
  const second = await api('GET', `/api/public/sit/${body.attempt.token}`);

  // Same paper, same start, and the clock has gone DOWN.
  assert.equal(second.body.started_at, first.body.started_at);
  assert.deepEqual(
    second.body.questions.map((q) => q.id),
    first.body.questions.map((q) => q.id)
  );
  assert.ok(second.body.seconds_left < first.body.seconds_left);
});

test('a made-up token is a 404, never somebody else’s test', async () => {
  const res = await api('GET', '/api/public/sit/TST-not-a-real-token');
  assert.equal(res.status, 404);
});

/* ---------------- marking ---------------- */

test('it marks itself, and an unanswered question is never a penalty', async () => {
  await bank('Marking');
  const paper = await paperFor('Marking paper', [{ category: 'Marking', count: 8 }]);
  const who = await candidate('Marked Person');
  const { body } = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });
  const token = body.attempt.token;
  const sat = await api('GET', `/api/public/sit/${token}`);

  /*
   * Answer four right and leave four alone. Every question in this bank
   * carries 0.25 negative marks, so if a skipped question were penalised the
   * score would be 3, not 4.
   */
  const answers = {};
  for (const q of sat.body.questions.slice(0, 4)) {
    answers[q.id] = q.options.find((o) => o.text === 'second').key;
  }
  const out = await api('POST', `/api/public/sit/${token}`, { answers });
  assert.equal(out.status, 200);
  assert.equal(out.body.percentage, 50);
  assert.equal(out.body.passed, true);

  const review = await api('GET', `/api/hiring/candidates/${who.id}/attempts`);
  const attempt = review.body.attempts[0];
  assert.equal(attempt.score, 4, 'a skipped question was penalised');
  assert.equal(attempt.right_count, 4);
  assert.equal(attempt.skipped_count, 4);
  assert.equal(attempt.wrong_count, 0);
});

test('guessing everything wrong floors at nought, never a negative score', async () => {
  await bank('Wrong');
  const paper = await paperFor('Wrong paper', [{ category: 'Wrong', count: 6 }]);
  const who = await candidate('Wrong Person');
  const { body } = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });
  const sat = await api('GET', `/api/public/sit/${body.attempt.token}`);

  const answers = {};
  for (const q of sat.body.questions) {
    answers[q.id] = q.options.find((o) => o.text !== 'second').key;
  }
  const out = await api('POST', `/api/public/sit/${body.attempt.token}`, { answers });
  assert.equal(out.body.percentage, 0, 'a negative percentage is a number nobody can read');
  assert.equal(out.body.passed, false);
});

test('a test cannot be submitted twice', async () => {
  await bank('Once');
  const paper = await paperFor('Once paper', [{ category: 'Once', count: 4 }]);
  const who = await candidate('Once Only');
  const { body } = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });
  await api('GET', `/api/public/sit/${body.attempt.token}`);
  await api('POST', `/api/public/sit/${body.attempt.token}`, { answers: {} });
  const again = await api('POST', `/api/public/sit/${body.attempt.token}`, { answers: {} });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already been submitted/);

  // And reopening it shows the result rather than the paper.
  const after = await api('GET', `/api/public/sit/${body.attempt.token}`);
  assert.equal(after.body.done, true);
  assert.equal(after.body.questions, undefined);
});

test('the result lands where every existing screen already looks', async () => {
  await bank('Feeds');
  const paper = await paperFor('Feeds paper', [{ category: 'Feeds', count: 4 }]);
  const who = await candidate('Feeds Through');
  const { body } = await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });
  const sat = await api('GET', `/api/public/sit/${body.attempt.token}`);
  const answers = {};
  for (const q of sat.body.questions) answers[q.id] = q.options.find((o) => o.text === 'second').key;
  await api('POST', `/api/public/sit/${body.attempt.token}`, { answers });

  // The `tests` table the candidate card already reads from.
  const card = await api('GET', `/api/hiring/candidates/${who.id}`);
  const recorded = card.body.tests.find((t) => t.source === 'question-bank');
  assert.ok(recorded, 'an in-house paper did not reach the tests the card shows');
  assert.equal(recorded.percentage, 100);
  assert.equal(recorded.type, 'In-house test');
});

test('a question that has been asked is retired, not deleted', async () => {
  await bank('Retire', 4);
  const paper = await paperFor('Retire paper', [{ category: 'Retire', count: 4 }]);
  const who = await candidate('Retire Person');
  await api('POST', `/api/hiring/papers/${paper.id}/assign`, { candidate_id: who.id });

  const asked = (await api('GET', '/api/hiring/bank/questions?category=Retire')).body.questions[0];
  const gone = await api('DELETE', `/api/hiring/bank/questions/${asked.id}`);
  assert.deepEqual(gone.body, { retired: true });

  /*
   * An attempt stores the ids it drew, so deleting the row would leave a
   * finished paper unable to say what question three was - and a result
   * nobody can explain is a result nobody can defend.
   */
  const still = (await api('GET', '/api/hiring/bank/questions?category=Retire')).body.questions
    .find((q) => q.id === asked.id);
  assert.ok(still, 'a question that had been asked was deleted');
  assert.equal(still.active, 0);
});
