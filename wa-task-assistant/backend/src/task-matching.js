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
  // "File GSTR-1" and "GSTR - 1" are one job; the verb carries no identity.
  'file', 'filing', 'submit', 'upload',
  'task', 'karna', 'karni', 'karo', 'kar', 'karunga', 'karenge', 'hai', 'he',
  'ho', 'hua', 'hui', 'gaya', 'gayi', 'gai', 'diya', 'diyo', 'dena', 'bhej',
  'aaj', 'kal', 'parso', 'today', 'tomorrow', 'ka', 'ki', 'ke', 'me', 'mein',
  'please', 'pls', 'bhai', 'ok', 'okay',
]);

/*
 * A single letter is noise; a single DIGIT is the whole identity.
 *
 * "GSTR-1" and "GSTR-9" both reduced to `gstr` once the lone digit was thrown
 * away, so they scored a perfect match and the annual return was suppressed as
 * a duplicate of the monthly one - a real compliance task silently never
 * created. The digit is the only thing telling them apart, so it stays.
 */
const words = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w) && (w.length > 1 || /\d/.test(w)));

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

/**
 * The better of two readings: against the task's title alone, and against its
 * title and description together.
 *
 * Scoring only against both was the reason two identical "Activate Uttarakhand
 * GST" tasks could exist. The score is the weaker of its two directions, so
 * every word of an existing task's description made that task *harder* to
 * recognise: three title words shared out of thirteen scored 0.23 against a
 * threshold of 0.7, and a perfect copy was created. A description is extra
 * information about the same job - it can only ever help identify it.
 */
const bestScore = (phraseWords, task) => Math.max(
  score(phraseWords, words(task.title)),
  score(phraseWords, words(`${task.title} ${task.description || ''}`))
);

export const MATCH_THRESHOLD = 0.5;

/*
 * How far apart two deadlines can be and still be the same job.
 *
 * Nothing to do with tolerance for error - it is the gap between one occurrence
 * of a recurring job and the next. Monthly deadlines land 28 to 31 days apart,
 * so September's TDS is never mistaken for August's, while a salary run entered
 * on Saturday and mentioned again on Sunday is correctly one job. This app has
 * no weekly rules; if it ever gets them, this number has to come down.
 */
export const SAME_JOB_DAYS = 7;

const DAY = 86_400_000;

/** Whether two deadlines are close enough to belong to the same occurrence. */
export function sameOccurrence(a, b, days = SAME_JOB_DAYS) {
  // An undated task has no occurrence to tell apart, so the words decide alone.
  if (!a || !b) return true;
  const gap = Math.abs(new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`));
  return Number.isFinite(gap) && gap <= days * DAY;
}

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
    .map((task) => ({ task, score: bestScore(phraseWords, task) }))
    .filter((row) => row.score >= threshold)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  // Two plausible tasks means the sentence has not identified one of them.
  if (scored.length > 1 && scored[1].score >= scored[0].score - 0.001) return null;
  return scored[0];
}

/**
 * Whether a task about to be created is really one that already exists.
 *
 * Two rules here differ from `matchOpenTask`, and both come from the fact that
 * this question is the opposite question.
 *
 * **A tie is a duplicate.** When a title scores equally against two open tasks,
 * `matchOpenTask` returns nothing, because acting on the wrong task is worse
 * than acting on none. Here that reasoning inverts: tying against two tasks
 * means it is certainly a copy of one of them, and returning nothing creates a
 * third. That is not a one-off - once two copies exist, every later mention
 * ties and makes another, so the list grows without limit. Measured: with one
 * copy the guard held, with two it stopped working permanently.
 *
 * **Refusing to merge is the safe error.** At 0.7, "Review Santosh Textile
 * ledger scrutiny FY2025-26" and "Review Parth Bajaj ledger scrutiny
 * FY2025-26" scored 0.71 - five shared words out of seven - and one client's
 * work was silently never created. A duplicate is visible and can be removed in
 * two taps; a task suppressed by mistake is invisible for ever. So this bar is
 * higher than the one `duplicateGroups` uses to *offer* copies to the user:
 * strict when deciding alone, loose when asking.
 *
 * **A deadline separates one occurrence from the next.** September's "Pay BNF
 * TDS" is not August's, even though the words are identical, so an unfinished
 * August one must not suppress it. When both carry a deadline, they have to
 * fall on the same day to be the same job; a task with no deadline on either
 * side matches on the words alone, which is the older behaviour and the right
 * one for work that was never dated.
 */
export function findDuplicateTask(title, { threshold = 0.8, dueDate = null } = {}) {
  const phraseWords = words(title);
  if (!phraseWords.length) return null;

  const open = db.prepare(`SELECT * FROM tasks WHERE status != 'done' ORDER BY id DESC`).all();
  const scored = open
    .map((task) => ({ task, score: bestScore(phraseWords, task) }))
    .filter((row) => row.score >= threshold)
    // Same words a month apart is next month's job, not a copy of this one.
    .filter((row) => sameOccurrence(dueDate, row.task.due_date))
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0].task : null;
}

/**
 * Open tasks that are copies of each other, grouped.
 *
 * Only for showing the user: this never decides anything on its own. The fixes
 * above stop new copies being made, but they cannot help the rows already on
 * the list, and those are the ones being chased twice a day.
 *
 * Grouped by a looser rule than the one that stops them being created: this
 * only offers copies to a person, who can see both and decide, so it may show a
 * pair the creator was right to leave alone. The oldest of each group is offered as the one
 * to keep, since it carries the history and whatever reminders have run.
 */
export function duplicateGroups({ threshold = 0.7 } = {}) {
  const open = db
    .prepare(`SELECT * FROM tasks WHERE status != 'done' AND archived_at IS NULL ORDER BY id ASC`)
    .all();

  const seen = new Set();
  const groups = [];

  for (const task of open) {
    if (seen.has(task.id)) continue;
    if (!words(task.title).length) continue;

    const copies = open.filter((other) => {
      if (other.id === task.id || seen.has(other.id)) return false;
      if (!sameOccurrence(task.due_date, other.due_date)) return false;
      /*
       * Read from both sides, and the better reading wins.
       *
       * Probing with the first task's title AND description put its whole
       * description in the numerator's denominator, so the pair was found only
       * on the second pass - from the copy that had no description. The group
       * then offered the newer row as the one to keep, losing the history that
       * "keep the oldest" exists to protect.
       */
      return Math.max(
        bestScore(words(task.title), other),
        bestScore(words(`${task.title} ${task.description || ''}`), other)
      ) >= threshold;
    });
    if (!copies.length) continue;

    for (const t of [task, ...copies]) seen.add(t.id);
    groups.push({ keep: task, drop: copies });
  }
  return groups;
}
