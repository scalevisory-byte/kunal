import { db } from './db.js';

/**
 * Matching a phrase to a task the user already has. Everything here is
 * deliberately conservative: acting on the wrong task is worse than not acting,
 * so a weak match resolves to nothing and the message is treated as new.
 */

// Words that carry no identity - they appear in half the tasks and in most of
// the sentences people write about them.
const NOISE = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'for', 'on', 'in', 'at', 'by', 'is', 'it',
  'do', 'done', 'complete', 'completed', 'process', 'send', 'make', 'check',
  'task', 'karna', 'karni', 'karo', 'kar', 'karunga', 'karenge', 'hai', 'he',
  'ho', 'hua', 'hui', 'gaya', 'gayi', 'gai', 'diya', 'diyo', 'dena', 'bhej',
  'aaj', 'kal', 'parso', 'today', 'tomorrow', 'ka', 'ki', 'ke', 'me', 'mein',
  'please', 'pls', 'bhai', 'ok', 'okay',
]);

const words = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w));

/**
 * How much of the phrase's meaning the task accounts for, and vice versa.
 * Both directions matter: "salary" alone should not match a long task, and a
 * long sentence should not match a two-word task on one shared word.
 */
function score(phraseWords, taskWords) {
  if (!phraseWords.length || !taskWords.length) return 0;
  const inTask = new Set(taskWords);
  let shared = 0;
  for (const w of new Set(phraseWords)) if (inTask.has(w)) shared += 1;
  if (!shared) return 0;

  const coverPhrase = shared / new Set(phraseWords).size;
  const coverTask = shared / inTask.size;
  // The weaker of the two directions, so one-sided overlap cannot carry a match.
  return Math.min(coverPhrase, coverTask);
}

export const MATCH_THRESHOLD = 0.5;

/**
 * The one open task a phrase is about, or null. Null is returned both when
 * nothing is close enough and when two tasks are equally close - an ambiguous
 * match must never be resolved by guessing.
 */
export function matchOpenTask(phrase, { threshold = MATCH_THRESHOLD } = {}) {
  const phraseWords = words(phrase);
  if (phraseWords.length < 1) return null;

  const open = db.prepare(`SELECT * FROM tasks WHERE status != 'done' ORDER BY id DESC`).all();
  const scored = open
    .map((task) => ({ task, score: score(phraseWords, words(`${task.title} ${task.description || ''}`)) }))
    .filter((row) => row.score >= threshold)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  // Two plausible tasks means the sentence has not identified one of them.
  if (scored.length > 1 && scored[1].score >= scored[0].score - 0.001) return null;
  return scored[0];
}

/**
 * Whether a task about to be created is really one that already exists. Used to
 * stop a second "BNF salary" appearing every time it is mentioned again.
 */
export function findDuplicateTask(title, { threshold = 0.7 } = {}) {
  const match = matchOpenTask(title, { threshold });
  return match ? match.task : null;
}
