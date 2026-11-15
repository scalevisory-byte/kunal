import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * ONE QUESTION AT A TIME REACHES A PAPER THAT WAS MADE BEFORE THE MODE
 * EXISTED - without anybody having to find a button and press it.
 *
 * Dinesh asked for one question at a time three separate times and installed
 * four updates, and every link he drew was still the old all-on-one-page
 * test. Nothing was broken: adding the column defaulted his existing paper to
 * 0, and the only way out was a control in the question bank that he had no
 * reason to look for. A fix somebody has to find is not a fix.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-layout-'));
process.env.LINK_SECRET = 'test-secret';

const hiring = await import('../src/hiring.js');
const { db } = await import('../src/db.js');

const clearMarker = () =>
  db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(hiring.ONE_AT_A_TIME_MIGRATION);

const stalePaper = (name) =>
  hiring.savePaper({
    name,
    pass_percent: 50,
    duration_minutes: 10,
    one_at_a_time: 0,
    seconds_per_question: null,
    sections: [{ category: 'General Aptitude', count: 2 }],
  });

const someQuestions = () => {
  for (let i = 0; i < 6; i += 1) {
    hiring.saveQuestion({
      category: 'General Aptitude',
      question: `Layout fixture question ${i}`,
      option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd',
      correct: 'a',
    });
  }
};
someQuestions();

test('a paper made before the mode existed is brought across, once', () => {
  const paper = stalePaper('Stale paper');
  assert.equal(hiring.getPaper(paper.id).one_at_a_time, 0, 'starts the old way');

  clearMarker();
  const moved = hiring.bringPapersToOneAtATime();
  assert.ok(moved >= 1, 'it moved at least the stale one');

  const after = hiring.getPaper(paper.id);
  assert.equal(after.one_at_a_time, 1, 'one question at a time, with nobody pressing anything');
  assert.equal(after.seconds_per_question, 30, 'and a per-question clock it did not have');
});

test('a deliberate switch back survives every later upgrade', () => {
  const paper = stalePaper('Chosen all on one page');
  // The marker is already set by the run above, so this is the upgrade case:
  // somebody has chosen this shape since, and the migration must not undo it.
  assert.equal(hiring.bringPapersToOneAtATime(), 0, 'it does not run a second time');
  assert.equal(
    hiring.getPaper(paper.id).one_at_a_time,
    0,
    'a paper somebody chose to keep on one page stays on one page'
  );
});

test('a paper somebody is sitting right now is left alone', () => {
  const paper = stalePaper('Being sat');
  const candidate = hiring.createCandidate({ name: 'Mid Test', phone: '9000000001' });
  const attempt = hiring.assignTest(paper.id, candidate.id, {});
  hiring.startAttempt(attempt.token);

  clearMarker();
  hiring.bringPapersToOneAtATime();
  assert.equal(
    hiring.getPaper(paper.id).one_at_a_time,
    0,
    'reshaping the page under somebody halfway through is worse than the old shape'
  );
});

test('a link drawn before the paper was corrected is still sat the new way', () => {
  const paper = stalePaper('Corrected after the link went out');
  const candidate = hiring.createCandidate({ name: 'Drew Early', phone: '9000000002' });
  const attempt = hiring.assignTest(paper.id, candidate.id, {});

  // The office corrects the paper AFTER the link has been sent.
  hiring.savePaper({ ...hiring.getPaper(paper.id), one_at_a_time: 1, seconds_per_question: 30 });

  const started = hiring.startAttempt(attempt.token);
  assert.equal(started.one_at_a_time, true, 'the layout is fixed when they START');
  assert.equal(started.seconds_per_question, 30);

  const stamped = hiring
    .listAttempts(candidate.id)
    .find((a) => a.token === attempt.token);
  assert.equal(
    stamped.seconds_per_question,
    30,
    'and it is stamped on the attempt, so the integrity flags judge it by the rules it was sat under'
  );
});

test('a test already under way keeps the shape it began in', () => {
  const paper = stalePaper('Switched mid-sitting');
  const candidate = hiring.createCandidate({ name: 'Already Going', phone: '9000000003' });
  const attempt = hiring.assignTest(paper.id, candidate.id, {});
  hiring.startAttempt(attempt.token);

  hiring.savePaper({ ...hiring.getPaper(paper.id), one_at_a_time: 1, seconds_per_question: 30 });
  const open = hiring.openAttempt(attempt.token);
  assert.equal(open.started, true);
  assert.equal(
    hiring.listAttempts(candidate.id).find((a) => a.token === attempt.token).seconds_per_question,
    null,
    'the stamp is not re-taken on a refresh - a second press is not a second start'
  );
});

test('an abandoned attempt does not block the migration for ever', () => {
  const paper = stalePaper('Opened once, never finished');
  const candidate = hiring.createCandidate({ name: 'Walked Away', phone: '9000000004' });
  const attempt = hiring.assignTest(paper.id, candidate.id, {});
  hiring.startAttempt(attempt.token);
  // Two hours ago on a ten-minute paper: the clock ran out long since. This
  // is the state Dinesh's own trial runs were left in, and treating it as
  // "being sat" would have protected the very paper that needed correcting.
  db.prepare(`UPDATE test_attempts SET started_at = ? WHERE token = ?`).run(
    new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    attempt.token
  );

  clearMarker();
  hiring.bringPapersToOneAtATime();
  assert.equal(hiring.getPaper(paper.id).one_at_a_time, 1, 'a dead clock is not a sitting');
});
