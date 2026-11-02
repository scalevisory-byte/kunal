/**
 * Which test a candidate sits, and what counts as a pass.
 *
 * It used to be one `TEST_EMBED_URL` for the whole app, which only works if
 * every job is tested the same way. A travel consultant and an accounts
 * executive are not: Dinesh asked for the test to follow the vacancy.
 *
 * So an opening carries its own `test_url` and `test_pass_percent`, and the
 * environment's values stay as the fallback - nothing already set up stops
 * working, and an office that uses one test for everything still only types
 * it once.
 *
 * Dependency-free: the server resolves this to build the candidate's link, and
 * the dashboard resolves it to say what an opening is set up with, from the
 * same code.
 */

/**
 * A link that is safe to put a candidate in front of.
 *
 * Only http and https. The URL is typed by the office and ends up as the src
 * of an iframe on a public page with a callback token on it, so `javascript:`
 * or `data:` must never get through. A bad one is REPORTED rather than quietly
 * dropped - a typed URL that silently does nothing is how somebody concludes
 * the test is broken.
 */
export function checkTestUrl(value) {
  const text = String(value || '').trim();
  if (!text) return { url: '', problem: '' };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { url: '', problem: 'That does not look like a web address. It should start with https://' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { url: '', problem: `A test link has to be http or https, not ${parsed.protocol}` };
  }
  return { url: parsed.toString(), problem: '' };
}

/*
 * A pass mark, or the fallback.
 *
 * null and '' have to be ruled out BEFORE Number(), because Number(null) is 0
 * and Number('') is 0 - both finite. A column that is simply not set comes
 * back as null from the database, so this read a bar of 0 and everybody
 * passed. `undefined` alone is not what a database hands over.
 */
const percent = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
};

/**
 * The test for one opening.
 *
 * `source` says WHERE it came from, because "this opening has its own test"
 * and "it is falling back to the app-wide one" look identical on screen
 * otherwise, and the difference is the whole point of this change.
 */
/**
 * How long a candidate gets for one question, in seconds.
 *
 * **Nothing is a limit of nought.** No limit set means NO limit - a question
 * nobody put a clock on must not become one every candidate fails. So this
 * returns null rather than a number, and everything downstream treats null as
 * "no limit" rather than as zero.
 *
 * This app does not ENFORCE it - the clock runs inside the test system, which
 * is the only thing watching the candidate type. What this app does is decide
 * the rule, hand it over with the test, and afterwards say who went past it.
 */
export function secondsPerQuestion(vacancy, defaults = {}) {
  for (const value of [vacancy?.test_seconds_per_question, defaults.secondsPerQuestion]) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    // A sane ceiling: an hour on one question is not a limit, it is a typo.
    return Math.min(3600, Math.round(n));
  }
  return null;
}

export function testFor(vacancy, defaults = {}) {
  const fallbackPass = percent(defaults.passPercent, 50);
  const perQuestion = secondsPerQuestion(vacancy, defaults);
  const own = checkTestUrl(vacancy?.test_url);
  if (own.url) {
    return {
      url: own.url,
      passPercent: percent(vacancy?.test_pass_percent, fallbackPass),
      secondsPerQuestion: perQuestion,
      source: 'opening',
      problem: '',
    };
  }

  const shared = checkTestUrl(defaults.url);
  if (shared.url) {
    return {
      url: shared.url,
      // An opening may set its own pass mark even while using the shared test:
      // the same questions can be a higher bar for a senior seat.
      passPercent: percent(vacancy?.test_pass_percent, fallbackPass),
      secondsPerQuestion: perQuestion,
      source: 'default',
      problem: own.problem,
    };
  }

  return {
    url: '',
    passPercent: percent(vacancy?.test_pass_percent, fallbackPass),
    secondsPerQuestion: perQuestion,
    source: null,
    problem: own.problem || shared.problem,
  };
}
