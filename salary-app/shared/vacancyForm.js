import { toMonthlySalary } from './match.js';

/**
 * What the New Vacancy form refuses, and why.
 *
 * Shared on purpose: the form checks it so somebody is told before they press
 * the button, and the server checks the same rules so a bad row cannot be
 * posted around the form. One list, so the two can never disagree about what
 * is allowed.
 *
 * Returned as {field: message} rather than a single sentence, because a form
 * with six boxes has to say WHICH box, next to that box.
 */

/** Required whatever else is filled in. */
export const REQUIRED = {
  company_id: 'Choose the company this seat is for',
  title: 'What is the job called?',
  location: 'Where is the job?',
  positions: 'How many seats?',
};

export function validateVacancy(draft = {}, { assessment = false } = {}) {
  const problems = {};

  if (!Number(draft.company_id)) problems.company_id = REQUIRED.company_id;
  if (!String(draft.title || '').trim()) problems.title = REQUIRED.title;
  if (!String(draft.location || '').trim()) problems.location = REQUIRED.location;

  const seats = Number(draft.positions);
  if (!Number.isFinite(seats) || seats < 1) problems.positions = 'At least one seat';
  else if (seats > 999) problems.positions = 'That many seats is almost certainly a typo';

  /*
   * Salary is a TEXT column and always has been - people type "18000",
   * "15-20k", "3.6 LPA". So the two are compared the way the match score reads
   * them, in rupees a month, and anything unreadable is simply not compared
   * rather than refused: refusing "negotiable" would be worse than allowing it.
   */
  const lo = toMonthlySalary(draft.salary_min);
  const hi = toMonthlySalary(draft.salary_max);
  if (lo !== null && hi !== null && lo > hi) {
    problems.salary_max = 'The top of the range is below the bottom';
  }

  const expMin = numberOrNull(draft.experience_min);
  const expMax = numberOrNull(draft.experience_max);
  if (expMin !== null && expMin < 0) problems.experience_min = 'Years cannot be negative';
  if (expMax !== null && expMax < 0) problems.experience_max = 'Years cannot be negative';
  if (expMin !== null && expMax !== null && expMin > expMax) {
    problems.experience_max = 'The most is below the least';
  }
  if (expMin !== null && expMin > 50) problems.experience_min = 'More than fifty years is a typo';

  const deadline = dateOrNull(draft.apply_by);
  const joining = dateOrNull(draft.needed_by);
  if (draft.apply_by && !deadline) problems.apply_by = 'That is not a date';
  if (draft.needed_by && !joining) problems.needed_by = 'That is not a date';
  /*
   * A deadline AFTER the day they are wanted means applications are still open
   * when the seat should already be filled. Said as a problem on the deadline,
   * which is the one that is usually wrong.
   */
  if (deadline && joining && deadline > joining) {
    problems.apply_by = 'Applications would still be open after they are needed';
  }

  /*
   * The test is only checked when it is switched on. Off means off: a pass
   * mark left over in a box nobody can see must not block a save.
   */
  if (assessment) {
    const url = String(draft.test_url || '').trim();
    if (!url) problems.test_url = 'An assessment needs a link, or switch it off';
    else if (!/^https?:\/\/.+/i.test(url)) problems.test_url = 'That is not a web address';

    const pass = numberOrNull(draft.test_pass_percent);
    if (pass !== null && (pass < 1 || pass > 100)) {
      problems.test_pass_percent = 'A pass mark is between 1 and 100';
    }
    const seconds = numberOrNull(draft.test_seconds_per_question);
    if (seconds !== null && seconds <= 0) {
      problems.test_seconds_per_question = 'Leave it blank for no limit, never nought';
    }
    const minutes = numberOrNull(draft.test_duration_minutes);
    if (minutes !== null && minutes <= 0) {
      problems.test_duration_minutes = 'Leave it blank for no limit, never nought';
    }
  }

  return problems;
}

/** The first problem, in the order the form reads, for a one-line summary. */
export function firstProblem(problems, order = []) {
  for (const key of order) if (problems[key]) return problems[key];
  const [first] = Object.values(problems);
  return first || '';
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : text.slice(0, 10);
}
