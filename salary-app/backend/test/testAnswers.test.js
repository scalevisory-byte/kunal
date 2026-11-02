import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnswers, secondsFor, spell, verdictFor } from '../../shared/testAnswers.js';

/*
 * Question by question, with the time each one took.
 *
 * The two things that must not go wrong: a question with no time recorded must
 * never read as nought seconds, and a test system that does not mark its
 * questions must not have its silence read as "wrong".
 */

test('it reads a plain list and finds the question somebody sat on', () => {
  const read = readAnswers([
    { question: 'What is GST on a domestic air ticket?', answer: '5%', correct: true, seconds: 12 },
    { question: 'Tally shortcut for a payment voucher', answer: 'F4', correct: false, seconds: 240 },
    { question: 'Spell "itinerary"', answer: 'itinerary', correct: true, seconds: 9 },
  ]);
  assert.equal(read.items.length, 3);
  assert.equal(read.total_seconds, 261);
  assert.equal(read.average_seconds, 87);
  assert.equal(read.slowest.n, 2, 'four minutes on one question is the thing to see');
  assert.equal(read.correct, 2);
  assert.equal(read.wrong, 1);
});

test('a question with no time is NOT nought seconds', () => {
  const read = readAnswers([{ question: 'a', seconds: 30 }, { question: 'b' }]);
  assert.equal(read.items[1].seconds, null, 'null is "not known"; 0 would claim it was instant');
  assert.equal(read.total_seconds, 30, 'summed from what carries a time');
  assert.equal(read.untimed, 1, 'and how many did not is said out loud');
  assert.equal(read.average_seconds, 30, 'not 15');
});

test('a question nobody marked is not a wrong answer', () => {
  const read = readAnswers([
    { question: 'Why do you want this job?', answer: 'I like travel' },
    { question: '2 + 2', answer: '4', correct: true },
  ]);
  assert.equal(read.items[0].correct, null);
  assert.equal(read.wrong, 0, 'unmarked is not wrong');
  assert.equal(read.unmarked, 1);
  assert.equal(read.marked, 1);
});

test('it copes with the spellings a test system might use', () => {
  assert.equal(secondsFor({ time_taken: 12 }), 12);
  assert.equal(secondsFor({ duration_ms: 4500 }), 4.5);
  assert.equal(secondsFor({ started_at: '2026-11-02T10:00:00Z', answered_at: '2026-11-02T10:00:21Z' }), 21);
  assert.equal(secondsFor({}), null);
  // A started time with no answered time is not a duration.
  assert.equal(secondsFor({ started_at: '2026-11-02T10:00:00Z' }), null);
  // And time cannot run backwards.
  assert.equal(secondsFor({ started_at: '2026-11-02T10:01:00Z', answered_at: '2026-11-02T10:00:00Z' }), null);
});

test('right and wrong are read however they are written, and "maybe" stays unknown', () => {
  for (const yes of [true, 1, 'true', 'YES', 'correct']) assert.equal(verdictFor({ correct: yes }), true, String(yes));
  for (const no of [false, 0, 'false', 'no', 'WRONG']) assert.equal(verdictFor({ correct: no }), false, String(no));
  assert.equal(verdictFor({ correct: 'partly' }), null, 'not understood is not "wrong"');
  assert.equal(verdictFor({}), null);
});

test('the blob can arrive as a string, an array, or wrapped in an object', () => {
  const rows = [{ q: 'a', secs: 5 }];
  assert.equal(readAnswers(JSON.stringify(rows)).items.length, 1);
  assert.equal(readAnswers(rows).items.length, 1);
  assert.equal(readAnswers({ answers: rows }).items.length, 1);
  assert.equal(readAnswers({ questions: rows }).items.length, 1);
  assert.equal(readAnswers(null).items.length, 0, 'nothing stored is simply nothing');
  assert.equal(readAnswers(null).problem, '', 'and not an error');
});

test('an unreadable blob is reported, never shown as an empty test', () => {
  const read = readAnswers('{not json at all');
  assert.equal(read.items.length, 0);
  assert.notEqual(read.problem, '');
});

test('a numbered list keeps its own numbering', () => {
  const read = readAnswers([{ n: 7, q: 'seven' }, { q: 'next' }]);
  assert.equal(read.items[0].n, 7);
  assert.equal(read.items[1].n, 2, 'and falls back to position where none is given');
});

test('times are spelled so four minutes does not read as 240', () => {
  assert.equal(spell(9), '9s');
  assert.equal(spell(95), '1m 35s');
  assert.equal(spell(120), '2m');
  assert.equal(spell(null), '—', 'not known is never 0s');
});
