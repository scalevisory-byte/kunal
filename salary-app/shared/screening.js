/**
 * Initial screening: is this person worth interviewing?
 *
 * The step between an application landing and somebody being called in. Until
 * now the only record of it was the stage moving from "New" to "Shortlisted" -
 * which says what was decided and nothing about WHY, so a candidate put on
 * hold in March was indistinguishable in June from one nobody had looked at.
 *
 * TWO RULES, and the second one is the whole reason this file is careful:
 *
 *   1. Nothing here decides anything. `eligibility` REPORTS how the candidate
 *      measures against what the opening asked for. It cannot reject anybody,
 *      it is not consulted when a verdict is saved, and a screener is free to
 *      take somebody who fails every line of it. People are hired against the
 *      criteria every day and they are usually right to be.
 *
 *   2. "Not said" is never "fails". A candidate who did not state their date
 *      of birth has not failed the age criterion - nobody asked. That reads as
 *      `null`, which is a third state and NOT false. The same rule the match
 *      score already follows, where something unstated scores half rather than
 *      nought.
 *
 * Dependency-free: the server stores a verdict and the browser shows the same
 * report, from one piece of code.
 */

import { toSkills, toYearBand, toYears, toMonthlySalary } from './match.js';

/* ---------------- the verdict ---------------- */

export const VERDICTS = [
  {
    key: 'Eligible',
    label: 'Eligible',
    hint: 'Worth interviewing — moves them to Shortlisted',
    moves: 'Shortlisted',
    needs: [],
  },
  {
    /*
     * On hold moves NOBODY, deliberately.
     *
     * "Retain the candidate in the pipeline" is what a hold is for - somebody
     * worth keeping for the next opening, or waiting on one more piece of
     * information. Shunting them to a different stage would lose them from the
     * list the office actually works through.
     */
    key: 'On Hold',
    label: 'On hold',
    hint: 'Keep them — nothing moves, and the reason is on the record',
    moves: null,
    needs: ['hold_reason'],
  },
  {
    key: 'Rejected',
    label: 'Not eligible',
    hint: 'Out of this opening — say why',
    moves: 'Rejected',
    needs: ['rejection_reason'],
  },
];

export const VERDICT_KEYS = VERDICTS.map((v) => v.key);
export const verdictMeta = (key) => VERDICTS.find((v) => v.key === key) || null;

/** The stage a verdict moves the application to, or null. */
export const stageForVerdict = (key) => verdictMeta(key)?.moves || null;

/**
 * The reasons the office reaches for most often.
 *
 * A list, not a fixed set: the box takes anything typed into it. The point is
 * that six people writing "exp less" and "not enough experience" and "under
 * qualified" cannot be counted, and counting them is what makes a rejection
 * report worth reading.
 */
export const REJECTION_REASONS = [
  'Not enough experience',
  'Over-qualified for this seat',
  'Salary expectation too high',
  'Location — too far to travel daily',
  'Qualification does not match',
  'Skills do not match',
  'Notice period too long',
  'Did not respond',
  'Withdrew',
  'Position filled',
];

export const HOLD_REASONS = [
  'Waiting for their CV',
  'Waiting for a decision on the opening',
  'Keep for a future opening',
  'Wants to join later',
  'Second opinion needed',
];

/* ---------------- the report ---------------- */

/** Somebody's age today, from a date of birth. Null when it is not known. */
export function ageFrom(dob, today = new Date()) {
  const born = new Date(String(dob || ''));
  if (Number.isNaN(born.getTime())) return null;
  let age = today.getFullYear() - born.getFullYear();
  const m = today.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

const line = (label, ok, said, wanted) => ({ label, ok, said, wanted });

/**
 * How this candidate measures against what the opening asked for.
 *
 * Every line is `true`, `false` or **`null`** — and null covers two different
 * innocent cases that must never read as a failure: the opening did not ask
 * (no age range set, no experience band), or the candidate did not say.
 *
 * Free text is NOT judged. Education and skills are reported side by side -
 * "they have: Tally, GST · asked for: B.Com, Tally" - because "B.Com" against
 * "Bachelor of Commerce" is a string comparison that would be wrong often
 * enough to be worse than useless, and a screener reading both lines settles
 * it in a second.
 */
export function eligibility(candidate = {}, vacancy = {}, today = new Date()) {
  const lines = [];

  /* age */
  const age = ageFrom(candidate.dob, today);
  const min = Number(vacancy.age_min) || null;
  const max = Number(vacancy.age_max) || null;
  if (min || max) {
    const wanted = min && max ? `${min}–${max}` : min ? `${min}+` : `up to ${max}`;
    lines.push(
      line(
        'Age',
        age === null ? null : (!min || age >= min) && (!max || age <= max),
        age === null ? 'not given' : `${age}`,
        wanted
      )
    );
  }

  /* experience */
  const band = toYearBand(vacancy.experience_band);
  const years = toYears(candidate.experience);
  if (band.min !== null || band.max !== null) {
    const wanted =
      band.min !== null && band.max !== null
        ? `${band.min}–${band.max} yrs`
        : band.min !== null
          ? `${band.min}+ yrs`
          : `up to ${band.max} yrs`;
    lines.push(
      line(
        'Experience',
        years === null
          ? null
          : (band.min === null || years >= band.min) && (band.max === null || years <= band.max),
        years === null ? 'not given' : years === 0 ? 'fresher' : `${years} yrs`,
        wanted
      )
    );
  }

  /* what they want paid */
  const asking = toMonthlySalary(candidate.expected_salary);
  const budget = toMonthlySalary(vacancy.salary_max);
  if (budget) {
    lines.push(
      line(
        'Expected salary',
        asking === null ? null : asking <= budget,
        asking === null ? 'not given' : `₹${asking.toLocaleString('en-IN')}`,
        `up to ₹${budget.toLocaleString('en-IN')}`
      )
    );
  }

  /* where they are - reported, never a verdict: people move for a job */
  if (String(vacancy.location || '').trim()) {
    const theirs = String(candidate.preferred_location || candidate.location || '').trim();
    lines.push(line('Location', null, theirs || 'not given', vacancy.location));
  }

  /* skills and education, side by side and unjudged */
  if (String(vacancy.skills || '').trim()) {
    const theirs = toSkills(candidate.skills);
    lines.push(
      line('Skills', null, theirs.length ? theirs.join(', ') : 'not given', toSkills(vacancy.skills).join(', '))
    );
  }
  if (String(vacancy.education || '').trim()) {
    lines.push(
      line('Qualification', null, String(candidate.education || '').trim() || 'not given', vacancy.education)
    );
  }

  const fails = lines.filter((l) => l.ok === false);
  const unknown = lines.filter((l) => l.ok === null);
  return {
    lines,
    /*
     * A one-line summary for a list, and it says "check" rather than "fails"
     * on purpose. The report is advice; a screener is free to take somebody
     * who misses every line of it, and often should.
     */
    meets: fails.length === 0,
    misses: fails.map((l) => l.label),
    not_known: unknown.map((l) => l.label),
  };
}

/* ---------------- validation ---------------- */

/**
 * Fit to save?
 *
 * A verdict is required, and so is the reason behind the two verdicts that
 * are useless without one. A rejection with no reason tells the next person
 * nothing and cannot be counted in a report; a hold with no reason is
 * indistinguishable in three months from a candidate nobody looked at, which
 * is the exact problem this record exists to fix.
 *
 * Remarks are never required. A screener with nothing to add should not be
 * made to type something.
 */
export function checkScreening(screening = {}) {
  const problems = [];
  const verdict = String(screening.verdict || '').trim();
  if (!verdict) {
    problems.push('Say whether they are eligible before saving.');
    return problems;
  }
  const meta = verdictMeta(verdict);
  if (!meta) {
    problems.push(`“${verdict}” is not one of the verdicts.`);
    return problems;
  }
  for (const need of meta.needs) {
    if (!String(screening[need] || '').trim()) {
      problems.push(
        need === 'rejection_reason'
          ? 'A rejection has to say why — it is what the rejection report counts.'
          : 'A hold has to say what it is waiting for.'
      );
    }
  }
  return problems;
}
