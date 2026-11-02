/**
 * What happened question by question, including how long each one took.
 *
 * The test system already posts an `answers` blob with its score. It was being
 * stored and never read, so "84%" was the whole of what anybody could see -
 * not which questions went wrong, and not that somebody sat on question 4 for
 * four minutes and answered the rest in nine seconds each.
 *
 * THE SHAPE IS NOT PINNED DOWN. This reads what a test system plausibly sends
 * rather than one agreed contract, because the real one has not been supplied
 * yet. When a real payload arrives, narrow `pick` to its actual keys - do not
 * leave this guessing forever.
 *
 * Dependency-free: the server and the dashboard read a result identically.
 */

/** The first key present, so one reader copes with several spellings. */
const pick = (row, keys) => {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
};

const QUESTION = ['question', 'q', 'text', 'title', 'prompt', 'question_text'];
const GIVEN = ['answer', 'given', 'response', 'selected', 'chosen', 'given_answer'];
const EXPECTED = ['expected', 'correct_answer', 'right_answer', 'solution'];
const CORRECT = ['correct', 'is_correct', 'right', 'passed'];
const SECONDS = ['seconds', 'time_taken', 'time_taken_seconds', 'duration', 'time', 'secs'];
const MILLIS = ['ms', 'millis', 'milliseconds', 'duration_ms', 'time_ms'];

/**
 * How long one question took, in seconds.
 *
 * Nothing recorded gives **null**, never 0. Zero reads as "answered
 * instantly", which is a claim; null is "not known", which is the truth. A
 * started/answered pair is used only if both are real dates.
 */
export function secondsFor(row) {
  const plain = Number(pick(row, SECONDS));
  if (Number.isFinite(plain) && plain >= 0) return Math.round(plain * 10) / 10;

  const ms = Number(pick(row, MILLIS));
  if (Number.isFinite(ms) && ms >= 0) return Math.round(ms / 100) / 10;

  const from = Date.parse(pick(row, ['started_at', 'shown_at', 'asked_at']) ?? '');
  const to = Date.parse(pick(row, ['answered_at', 'ended_at', 'submitted_at']) ?? '');
  if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
    return Math.round((to - from) / 100) / 10;
  }
  return null;
}

/**
 * Right or wrong, or NOT SAID.
 *
 * A test system that does not mark its questions must not have its silence
 * read as "wrong" - the same rule the match score follows, where something
 * the candidate did not state scores half rather than nought.
 */
export function verdictFor(row) {
  const said = pick(row, CORRECT);
  if (said === undefined) return null;
  if (typeof said === 'string') {
    const text = said.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'correct', 'right', 'pass'].includes(text)) return true;
    if (['false', 'no', 'n', '0', 'incorrect', 'wrong', 'fail'].includes(text)) return false;
    return null;
  }
  return Boolean(said);
}

/** Whatever the blob holds, as a list - a string, an array, or {answers: []}. */
function asList(raw) {
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { list: [], problem: '' };
    try {
      value = JSON.parse(text);
    } catch {
      return { list: [], problem: 'The test system sent something that is not readable.' };
    }
  }
  if (Array.isArray(value)) return { list: value, problem: '' };
  if (value && typeof value === 'object') {
    for (const key of ['answers', 'questions', 'items', 'responses', 'detail']) {
      if (Array.isArray(value[key])) return { list: value[key], problem: '' };
    }
  }
  return { list: [], problem: '' };
}

/**
 * `limitSeconds` is the time a candidate was allowed for one question. Null is
 * NO limit, never a limit of nought, so a test taken without one never reads
 * as every question overrunning.
 */
export function readAnswers(raw, { limitSeconds = null } = {}) {
  const limit = Number(limitSeconds) > 0 ? Number(limitSeconds) : null;
  const { list, problem } = asList(raw);
  const items = list.map((row, i) => {
    const plain = row && typeof row === 'object' ? row : { answer: row };
    return {
      n: Number(pick(plain, ['n', 'number', 'index', 'position'])) || i + 1,
      question: String(pick(plain, QUESTION) ?? '').trim(),
      given: String(pick(plain, GIVEN) ?? '').trim(),
      expected: String(pick(plain, EXPECTED) ?? '').trim(),
      correct: verdictFor(plain),
      seconds: secondsFor(plain),
    };
  });

  /*
   * Over the limit, where there IS a limit and the question carries a time.
   * A question nobody timed cannot have overrun it - "not known" is not
   * "over", the same rule the timings themselves follow.
   */
  for (const q of items) {
    q.over = limit !== null && q.seconds !== null && q.seconds > limit;
  }

  const timed = items.filter((q) => q.seconds !== null);
  const marked = items.filter((q) => q.correct !== null);
  const total = timed.reduce((n, q) => n + q.seconds, 0);

  return {
    items,
    problem,
    // Summed from the questions that CARRY a time, and the count of those that
    // do not is reported beside it - a total that quietly treats a missing
    // time as nought understates how long the test took.
    total_seconds: timed.length ? Math.round(total * 10) / 10 : null,
    timed: timed.length,
    untimed: items.length - timed.length,
    average_seconds: timed.length ? Math.round((total / timed.length) * 10) / 10 : null,
    // The question somebody sat on. What this whole module exists to surface.
    slowest: timed.length
      ? timed.reduce((worst, q) => (q.seconds > worst.seconds ? q : worst))
      : null,
    limit_seconds: limit,
    over_limit: items.filter((q) => q.over).length,
    marked: marked.length,
    correct: marked.filter((q) => q.correct).length,
    wrong: marked.filter((q) => !q.correct).length,
    unmarked: items.length - marked.length,
  };
}

/** 95 -> "1m 35s". Null stays a dash: not known is not nought. */
export function spell(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const whole = Math.round(seconds);
  if (whole < 60) return `${Math.round(seconds * 10) / 10}s`;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}
