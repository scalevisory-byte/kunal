import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * EVERY RESULT, IN ONE PLACE - the question Dinesh asked while looking
 * straight at one: "result kahan dikhayega bhai".
 *
 * The screening queue carries a person's LATEST attempt and only while they
 * are still being hired. That is the right answer to "where has this one got
 * to" and the wrong answer to "show me the results": an older paper is
 * missing from it, and somebody rejected or taken on takes their score off
 * the screen with them.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'test-results-'));
process.env.LINK_SECRET = 'test-secret';

const hiring = await import('../src/hiring.js');

for (let i = 0; i < 8; i += 1) {
  hiring.saveQuestion({
    category: 'General Aptitude',
    question: `Results fixture question ${i}`,
    option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D',
    correct: 'a',
  });
}
const paper = hiring.savePaper({
  name: 'Accounts test',
  pass_percent: 50,
  duration_minutes: 10,
  one_at_a_time: 1,
  seconds_per_question: 30,
  sections: [{ category: 'General Aptitude', count: 4 }],
});
const other = hiring.savePaper({
  name: 'Travel test',
  pass_percent: 50,
  duration_minutes: 10,
  one_at_a_time: 1,
  seconds_per_question: 30,
  sections: [{ category: 'General Aptitude', count: 4 }],
});

/** Sit a paper and get a given number of answers right. */
const sit = (paperId, candidate, right, opts = {}) => {
  const attempt = hiring.assignTest(paperId, candidate.id, {});
  const started = hiring.startAttempt(attempt.token);
  const answers = {};
  started.questions.forEach((q, i) => {
    answers[q.id] = i < right ? 'a' : 'b';
  });
  return hiring.submitAttempt(attempt.token, answers, opts);
};

const amit = hiring.createCandidate({ name: 'Amit Shah', phone: '9000001111' });
const priya = hiring.createCandidate({ name: 'Priya Nair', phone: '9000002222' });
sit(paper.id, amit, 4);
sit(other.id, amit, 1);
sit(paper.id, priya, 2, { left_count: 2, away_seconds: 35, paste_tries: 1 });

test('every submitted paper is there, newest first, whoever they are', () => {
  const { results, counts } = hiring.listTestResults();
  assert.equal(counts.total, 3, 'both of Amit’s papers, not just his latest');
  assert.equal(results[0].candidate_name, 'Priya Nair', 'newest first');
  assert.deepEqual(
    results.map((r) => r.paper_name).sort(),
    ['Accounts test', 'Accounts test', 'Travel test']
  );
});

test('the answer key never travels', () => {
  const { results } = hiring.listTestResults();
  const body = JSON.stringify(results);
  for (const leak of ['drawn', '"correct"', 'option_a', 'token']) {
    assert.ok(!body.includes(leak), `${leak} has no business on a list of scores`);
  }
  assert.ok(results[0].right_count !== undefined, 'the score itself is there');
});

test('the flags are worked out here, and clean is a verdict', () => {
  const { results } = hiring.listTestResults({ q: 'priya' });
  assert.equal(results.length, 1);
  assert.ok(
    results[0].flags.some((f) => f.includes('left the test')),
    `expected a left-the-test flag, got ${JSON.stringify(results[0].flags)}`
  );
  assert.equal(results[0].clean, false);

  const amitRow = hiring.listTestResults({ q: 'amit accounts' }).results[0];
  assert.equal(amitRow.clean, true, 'nothing recorded against him is not "unknown"');
  assert.deepEqual(amitRow.flags, []);
});

test('every word of the search has to land, so two words narrow', () => {
  assert.equal(hiring.listTestResults({ q: 'amit' }).counts.total, 2);
  assert.equal(
    hiring.listTestResults({ q: 'amit travel' }).counts.total,
    1,
    'that person on that paper'
  );
  assert.equal(hiring.listTestResults({ q: 'amit nair' }).counts.total, 0);
});

test('one test can be picked out on its own', () => {
  const { results } = hiring.listTestResults({ paper_id: other.id });
  assert.equal(results.length, 1);
  assert.equal(results[0].paper_name, 'Travel test');
});

test('the counts are taken BEFORE the pass/flag filter', () => {
  const all = hiring.listTestResults();
  const onlyPassed = hiring.listTestResults({ verdict: 'passed' });
  assert.equal(onlyPassed.results.length, all.counts.passed);
  assert.deepEqual(
    onlyPassed.counts,
    all.counts,
    'the buttons have to keep saying how many are in each pile, or pressing one makes the rest read as empty'
  );
  assert.equal(
    hiring.listTestResults({ verdict: 'flagged' }).results.length,
    all.counts.flagged
  );
  assert.equal(
    hiring.listTestResults({ verdict: 'clean' }).results.every((r) => r.clean),
    true
  );
});

test('a score survives the person moving on', () => {
  // Rejected, joined, screened out since - none of it is the score's business.
  const gone = hiring.createCandidate({ name: 'Left Already', phone: '9000003333' });
  sit(paper.id, gone, 3);
  hiring.deleteCandidate(gone.id);
  // Deleting the person does take their papers (the row is theirs), which is
  // right - what must NOT happen is a result vanishing because they reached
  // the end of the pipeline. Stage is nowhere in this query.
  assert.equal(hiring.listTestResults({ q: 'left already' }).counts.total, 0);
  assert.equal(hiring.listTestResults().counts.total, 3, 'everybody else is untouched');
});
