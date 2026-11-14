/**
 * The question bank, and the papers drawn from it.
 *
 * Dinesh: "test k question rotatable and position k hisab se hone chahiye /
 * chahe to usme test k liye position k hisab se question alag se add karne ka
 * option de dena." So three things: questions belong to a POSITION, two
 * candidates must not get the same paper, and the office can type its own
 * questions in.
 *
 * This does not replace the ZYNTA test. A vacancy either points at an external
 * test with its own URL - which is what is set up and working today - or draws
 * a paper from this bank. Whichever it carries is what a candidate sits, and
 * an opening with neither simply has no test, as now.
 *
 * THE RULE THIS MODULE EXISTS TO HOLD:
 *
 *   The right answer never leaves the server.
 *
 * `forCandidate` is the only shape ever sent to somebody sitting a test, and
 * it has no `correct` on it anywhere. A test whose answers are in the page
 * source is not a test, and it would be found within a week of the first
 * candidate opening the developer tools.
 *
 * Dependency-free: the server draws and marks a paper, and the office preview
 * shows what a paper would look like, from one piece of code.
 */

/* ---------------- a question ---------------- */

export const OPTION_KEYS = ['a', 'b', 'c', 'd'];
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

/**
 * Is this question fit to be asked?
 *
 * Checked when it is SAVED rather than when it is drawn - a broken question
 * discovered mid-test cannot be fixed, and the candidate has already lost the
 * minutes. Two options is the floor: one option is not a question.
 */
export function checkQuestion(q = {}) {
  const problems = [];
  if (!String(q.question || '').trim()) problems.push('The question itself is missing.');
  if (!String(q.category || '').trim()) problems.push('Say which position or topic this is for.');

  const filled = OPTION_KEYS.filter((k) => String(q[`option_${k}`] || '').trim());
  if (filled.length < 2) problems.push('A question needs at least two options.');

  const correct = String(q.correct || '').trim().toLowerCase();
  if (!correct) problems.push('Mark which option is right.');
  else if (!filled.includes(correct)) {
    problems.push(`Option ${correct.toUpperCase()} is marked right but has nothing in it.`);
  }

  const marks = Number(q.marks ?? 1);
  if (!Number.isFinite(marks) || marks <= 0) problems.push('Marks have to be more than nought.');

  const negative = Number(q.negative_marks ?? 0);
  if (!Number.isFinite(negative) || negative < 0) {
    // Held as a positive number and SUBTRACTED when marking. A negative
    // negative would add marks for a wrong answer, which is how a bank ends up
    // rewarding guesses.
    problems.push('Negative marks are typed as a positive number, or left at nought.');
  }
  return problems;
}

/* ---------------- drawing a paper ---------------- */

/**
 * Fisher-Yates, on a copy.
 *
 * `rand` is injectable so a test can pin the order; left alone it is
 * Math.random. Nothing here needs to be cryptographically unguessable - the
 * secrecy lives in not sending the answers, not in the shuffle.
 */
export function shuffle(list, rand = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Draw one candidate's paper from the bank.
 *
 * `sections` is what the paper asks for: so many questions from each category.
 * Each section is drawn WITHOUT repetition, the whole paper is then shuffled
 * so the topics interleave, and every question's options are shuffled too.
 *
 * That last part is the one people forget. Leave the options alone and the
 * answer is in the same position for every candidate, so "it was B" travels
 * round the waiting room and the test measures nothing.
 *
 * A section the bank cannot fill is REPORTED, not quietly shortened: a paper
 * that was supposed to ask ten questions and asked four would be marked out of
 * four, and nobody would know why one candidate scored out of a different
 * total from the next.
 */
export function drawPaper(pool = [], sections = [], rand = Math.random) {
  const short = [];
  const picked = [];

  for (const section of sections) {
    const category = String(section.category || '').trim();
    const want = Number(section.count) || 0;
    if (!want) continue;
    const available = pool.filter((q) => q.category === category && q.active !== 0);
    if (available.length < want) {
      short.push({ category, want, have: available.length });
    }
    picked.push(...shuffle(available, rand).slice(0, want));
  }

  const questions = shuffle(picked, rand).map((q) => {
    const keys = OPTION_KEYS.filter((k) => String(q[`option_${k}`] || '').trim());
    const order = shuffle(keys, rand);
    return { ...q, order };
  });

  return { questions, short };
}

/**
 * What a candidate is allowed to see.
 *
 * No `correct`, no `marks` breakdown that would betray which questions carry
 * the weight, nothing from the bank beyond the words and the choices. The
 * options come back in this attempt's own order, labelled 1..n rather than
 * a..d, so the stored order and what is on screen cannot drift.
 */
export function forCandidate(questions = []) {
  return questions.map((q, i) => ({
    n: i + 1,
    id: q.id,
    question: q.question,
    options: (q.order || OPTION_KEYS)
      .filter((k) => String(q[`option_${k}`] || '').trim())
      .map((k) => ({ key: k, text: q[`option_${k}`] })),
  }));
}

/* ---------------- marking ---------------- */

/**
 * Mark an attempt.
 *
 * `answers` is { questionId: optionKey }. The rules, and why each one:
 *
 *   - An unanswered question scores NOUGHT, never the negative. Negative
 *     marking is there to discourage guessing; docking somebody for a question
 *     they honestly left alone punishes the exact behaviour it is meant to
 *     encourage.
 *   - A wrong answer costs the question's own negative marks, which is
 *     usually nought unless the paper turned it on.
 *   - The total is out of the marks ACTUALLY ASKED, so a short paper is marked
 *     out of what it contained.
 *   - The score floors at nought. A candidate who guessed everything wrong
 *     scores 0, not minus 9: a negative percentage is a number nobody can read
 *     and it makes the pass bar meaningless.
 */
export function markAttempt(questions = [], answers = {}, { passPercent = 0 } = {}) {
  let earned = 0;
  let outOf = 0;
  let right = 0;
  let wrong = 0;
  let skipped = 0;
  const detail = [];

  for (const q of questions) {
    const marks = Number(q.marks ?? 1) || 1;
    outOf += marks;
    const given = answers[q.id] ?? answers[String(q.id)] ?? '';
    const chosen = String(given || '').trim().toLowerCase();

    if (!chosen) {
      skipped += 1;
      detail.push({ id: q.id, question: q.question, given: null, correct: q.correct, scored: 0 });
      continue;
    }
    if (chosen === String(q.correct || '').toLowerCase()) {
      earned += marks;
      right += 1;
      detail.push({ id: q.id, question: q.question, given: chosen, correct: q.correct, scored: marks });
    } else {
      const penalty = Number(q.negative_marks ?? 0) || 0;
      earned -= penalty;
      wrong += 1;
      detail.push({
        id: q.id, question: q.question, given: chosen, correct: q.correct, scored: -penalty,
      });
    }
  }

  const score = Math.max(0, Math.round(earned * 100) / 100);
  const percentage = outOf > 0 ? Math.round((score / outOf) * 1000) / 10 : null;
  return {
    score,
    max_score: outOf,
    percentage,
    passed: percentage === null ? null : percentage >= Number(passPercent || 0),
    right,
    wrong,
    skipped,
    asked: questions.length,
    detail,
  };
}

/* ---------------- the paper ---------------- */

export const DEFAULT_DURATION = 20;

/**
 * Is this paper fit to send somebody?
 *
 * A paper with no sections asks nothing, and a pass mark over 100 can never be
 * reached - both are mistakes that only show up when a candidate is sitting
 * there, so they are caught here.
 */
export function checkPaper(paper = {}, sections = []) {
  const problems = [];
  if (!String(paper.name || '').trim()) problems.push('Give the paper a name — usually the position.');

  const asking = sections.filter((s) => Number(s.count) > 0);
  if (!asking.length) problems.push('A paper has to ask for at least one question.');

  const pass = Number(paper.pass_percent ?? 0);
  if (!Number.isFinite(pass) || pass < 0 || pass > 100) {
    problems.push('The pass mark is a percentage between 0 and 100.');
  }
  const minutes = Number(paper.duration_minutes ?? DEFAULT_DURATION);
  if (!Number.isFinite(minutes) || minutes <= 0) problems.push('How long is the test, in minutes?');
  return problems;
}

/** How many questions a paper asks for in total. */
export const paperSize = (sections = []) =>
  sections.reduce((n, s) => n + (Number(s.count) || 0), 0);

/* ---------------- the clock ---------------- */

/**
 * How long is left, in seconds, from the server's own start time.
 *
 * The browser counts down for the person watching, but THIS is what decides
 * whether a submission is in time - a clock on the candidate's machine is a
 * clock the candidate can change. A grace of a few seconds covers the time a
 * submission spends on the wire, so an answer sent at the last moment is not
 * thrown away for arriving a second late.
 */
export const LATE_GRACE_SECONDS = 20;

export function secondsLeft(startedAt, minutes, now = Date.now()) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const ends = start + Number(minutes || DEFAULT_DURATION) * 60000;
  return Math.round((ends - now) / 1000);
}

export const isOverdue = (startedAt, minutes, now = Date.now()) => {
  const left = secondsLeft(startedAt, minutes, now);
  return left === null ? false : left < -LATE_GRACE_SECONDS;
};
