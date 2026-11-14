/**
 * The interviewer's evaluation.
 *
 * The second of the two forms Dinesh asked for, and deliberately a SEPARATE
 * record from the information form: "keep candidate information and
 * interviewer evaluation as two separate forms", linked by candidate and
 * interview. The information form says what the candidate said. This says what
 * the interviewer made of it - and two interviewers in two rounds are allowed
 * to disagree, which is only possible if each has a record of their own.
 *
 * THE RULE THIS MODULE EXISTS TO HOLD:
 *
 *   A recommendation is not a selection. The interviewer recommends; an
 *   APPROVAL moves the candidate.
 *
 * It is the same rule the attendance queue has run on since the first leave
 * application - a request never writes attendance, an approval does - and it
 * is here for the same reason. Dinesh said it twice in his own words:
 * "Interviewer recommendation must not automatically mean final selection" and
 * "Final selection should follow the existing approval workflow". So
 * `nextAction` records what the interviewer wants to happen and moves nobody;
 * only `stageOnApproval` is ever read, and only once somebody authorised has
 * approved.
 *
 * Dependency-free, so the server and the browser score, summarise and gate a
 * transition from one piece of code.
 */

/* ---------------- the scale ---------------- */

export const RATINGS = [
  { value: 1, label: 'Poor' },
  { value: 2, label: 'Below average' },
  { value: 3, label: 'Average' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Excellent' },
];

export const MAX_RATING = 5;
export const ratingLabel = (n) => RATINGS.find((r) => r.value === Number(n))?.label || '';

/** The ten things an interviewer is asked to rate, in Dinesh's order. */
export const PARAMETERS = [
  { key: 'communication', label: 'Communication skills' },
  { key: 'confidence', label: 'Confidence and personality' },
  { key: 'job_knowledge', label: 'Job knowledge' },
  { key: 'technical', label: 'Technical / computer knowledge' },
  { key: 'experience', label: 'Relevant work experience' },
  { key: 'problem_solving', label: 'Problem-solving ability' },
  { key: 'learning', label: 'Learning ability' },
  { key: 'attitude', label: 'Attitude and behaviour' },
  { key: 'teamwork', label: 'Teamwork and co-ordination' },
  { key: 'professionalism', label: 'Professionalism' },
];

export const PARAMETER_KEYS = PARAMETERS.map((p) => p.key);

/* ---------------- the summary ---------------- */

export const PRACTICAL = ['Poor', 'Average', 'Good', 'Excellent'];
export const YES_NO = ['Yes', 'No'];

/**
 * The totals, and what they are allowed to mean.
 *
 * `out_of` counts only the parameters that were actually rated, never all ten.
 * An interviewer who rated six of them scored 24 out of 30, not 24 out of 50 -
 * reading it the second way turns four unanswered questions into four zeros
 * and makes a good candidate look middling.
 *
 * Nothing rated at all gives nulls, NOT noughts. "No score" and "scored zero"
 * are different facts and only one of them is true.
 *
 * And the number decides nothing. Dinesh: "Do not use the score alone to make
 * the selection decision. The final recommendation must remain a human
 * decision." Nothing in this file reads `average` to choose anything; it is
 * printed beside the recommendation, not instead of it.
 */
export function summarise(ratings = {}) {
  const given = PARAMETERS.map((p) => ({ ...p, score: Number(ratings[p.key]) })).filter(
    (p) => Number.isFinite(p.score) && p.score >= 1 && p.score <= MAX_RATING
  );

  if (!given.length) {
    return {
      total: null,
      out_of: null,
      average: null,
      rated: 0,
      of: PARAMETERS.length,
      strongest: [],
      weakest: [],
    };
  }

  const total = given.reduce((sum, p) => sum + p.score, 0);
  const average = Math.round((total / given.length) * 10) / 10;

  return {
    total,
    out_of: given.length * MAX_RATING,
    average,
    rated: given.length,
    of: PARAMETERS.length,
    // Good and better is a strength; average and worse is worth naming. The
    // bands are fixed rather than relative: on a weak day the best of a bad
    // lot is not a strength.
    strongest: given.filter((p) => p.score >= 4).map((p) => p.label),
    weakest: given.filter((p) => p.score <= 2).map((p) => p.label),
  };
}

/* ---------------- what the interviewer says ---------------- */

export const RECOMMENDATIONS = [
  { key: 'Strongly Recommended', label: 'Strongly recommended' },
  { key: 'Recommended', label: 'Recommended' },
  { key: 'Recommended with Training', label: 'Recommended, with training' },
  { key: 'Keep on Hold', label: 'Keep on hold' },
  { key: 'Not Recommended', label: 'Not recommended' },
];

export const RECOMMENDATION_KEYS = RECOMMENDATIONS.map((r) => r.key);

/**
 * What the interviewer wants to happen next.
 *
 * `onApproval` is the stage the application moves to WHEN SOMEBODY APPROVES
 * it - never when the evaluation is submitted. Read it nowhere else.
 *
 * `review` is where the paperwork goes next, which is a different question
 * from where the candidate goes: "send for management approval" moves nobody
 * at all, it only decides who looks at it.
 */
export const NEXT_ACTIONS = [
  {
    key: 'Next Round',
    label: 'Proceed to the next interview round',
    review: 'pending_hr',
    onApproval: null,
    needs: ['next_round'],
  },
  {
    key: 'Management Approval',
    label: 'Send for management approval',
    review: 'pending_management',
    onApproval: null,
  },
  {
    /*
     * Approving this does not move the card either, for the same reason the
     * information form's "Selected" does not: "Selected" in this pipeline
     * means the offer was ACCEPTED. An approval says the office may now make
     * an offer; making it is a separate, deliberate act on the Offer card, and
     * that is what moves the stage.
     */
    key: 'Final Selection',
    label: 'Proceed for final selection',
    review: 'pending_management',
    onApproval: null,
  },
  { key: 'Hold', label: 'Keep on hold', review: 'pending_hr', onApproval: null },
  {
    key: 'Reject',
    label: 'Reject the candidate',
    review: 'pending_hr',
    onApproval: 'Rejected',
    needs: ['recommendation_reason'],
  },
];

export const NEXT_ACTION_KEYS = NEXT_ACTIONS.map((a) => a.key);
export const actionMeta = (key) => NEXT_ACTIONS.find((a) => a.key === key) || null;

/**
 * The stage an approved evaluation moves the application to, or null.
 *
 * The ONLY function in this module that names a stage, so there is one place
 * to look when asking what can move a candidate. It takes the whole decision,
 * not just the action, and answers null unless that decision was an approval.
 */
export function stageOnApproval({ status, next_action } = {}) {
  if (status !== 'approved') return null;
  return actionMeta(next_action)?.onApproval || null;
}

/* ---------------- the review workflow ---------------- */

export const STATUSES = [
  { key: 'draft', label: 'Draft', hint: 'Only the person filling it in sees this' },
  { key: 'submitted', label: 'Submitted by interviewer', hint: 'Waiting for HR to look at it' },
  { key: 'pending_hr', label: 'Pending HR review', hint: 'With HR' },
  { key: 'pending_management', label: 'Pending management approval', hint: 'With management' },
  { key: 'approved', label: 'Approved', hint: 'Decided — the next action has been applied' },
  { key: 'rejected', label: 'Rejected', hint: 'The evaluation was turned down' },
  { key: 'on_hold', label: 'On hold', hint: 'Parked, nobody has moved' },
];

export const STATUS_KEYS = STATUSES.map((s) => s.key);
export const statusMeta = (key) => STATUSES.find((s) => s.key === key) || null;

/** Still moving, as opposed to decided. */
export const OPEN_STATUSES = ['draft', 'submitted', 'pending_hr', 'pending_management'];
export const isOpen = (evaluation) => OPEN_STATUSES.includes(String(evaluation?.status || ''));

/**
 * Who may move it where.
 *
 * `needs` is an ABILITY this app already has, not a new role - Dinesh said not
 * to touch authentication or roles. So: filling in and reviewing is `write`,
 * which HR and Admin have; **approving is `admin`**, which only Admin has.
 * That is the honest reading of "only authorised users can approve or reject
 * candidates" against the four roles that exist.
 *
 * A viewer has neither and can read the whole thing and change none of it,
 * which is what a viewer is for.
 */
export const TRANSITIONS = {
  draft: [
    { to: 'submitted', label: 'Submit evaluation', needs: 'write' },
  ],
  submitted: [
    { to: 'pending_hr', label: 'Take it for HR review', needs: 'write' },
    { to: 'pending_management', label: 'Send for management approval', needs: 'write' },
    { to: 'on_hold', label: 'Put on hold', needs: 'write' },
  ],
  pending_hr: [
    { to: 'pending_management', label: 'Send for management approval', needs: 'write' },
    { to: 'approved', label: 'Approve', needs: 'admin' },
    { to: 'rejected', label: 'Reject', needs: 'admin' },
    { to: 'on_hold', label: 'Put on hold', needs: 'write' },
  ],
  pending_management: [
    { to: 'approved', label: 'Approve', needs: 'admin' },
    { to: 'rejected', label: 'Reject', needs: 'admin' },
    { to: 'on_hold', label: 'Put on hold', needs: 'write' },
  ],
  on_hold: [
    { to: 'pending_hr', label: 'Pick it up again', needs: 'write' },
    { to: 'approved', label: 'Approve', needs: 'admin' },
    { to: 'rejected', label: 'Reject', needs: 'admin' },
  ],
  // Decided is decided. Nothing leads out of approved or rejected: a second
  // decision on one evaluation would leave the trail unable to say which one
  // the candidate was moved on.
  approved: [],
  rejected: [],
};

export const movesFrom = (status, abilities = []) =>
  (TRANSITIONS[status] || []).filter((t) => abilities.includes(t.needs));

/**
 * May this person make this move?
 *
 * Answers a REASON rather than false, because "you cannot do that" with no
 * reason is how somebody concludes the screen is broken.
 */
export function canMove(evaluation, to, abilities = []) {
  /*
   * `code` matters as much as `why`.
   *
   * "You may not do that" and "that is not a move this form has" are different
   * refusals and the caller has to tell them apart - one is a permission
   * problem the person can fix by asking somebody else, the other is a bug in
   * whatever sent it. Answering 403 for both told an admin they lacked the
   * rights for a step that simply does not exist, which sends them looking for
   * a password that was never the problem.
   */
  const from = String(evaluation?.status || '');
  const allowed = TRANSITIONS[from];
  if (!allowed) return { ok: false, code: 'unknown', why: `“${from}” is not a status this form knows.` };
  if (!allowed.length) {
    return {
      ok: false,
      code: 'decided',
      why: `This evaluation is already ${statusMeta(from)?.label.toLowerCase()}.`,
    };
  }
  const move = allowed.find((t) => t.to === to);
  if (!move) {
    return {
      ok: false,
      code: 'bad-step',
      why: `An evaluation cannot go straight from ${statusMeta(from)?.label.toLowerCase()} to ${statusMeta(to)?.label?.toLowerCase() || to}.`,
    };
  }
  if (!abilities.includes(move.needs)) {
    return {
      ok: false,
      code: 'forbidden',
      why:
        move.needs === 'admin'
          ? 'Only an Admin login can approve or reject an evaluation.'
          : 'This login can look but not change.',
    };
  }
  return { ok: true, move };
}

/* ---------------- validation ---------------- */

/**
 * Fit to submit?
 *
 * As with the information form, almost nothing is required - a half-filled
 * evaluation that can be saved beats a complete one typed from memory a week
 * later. What IS required is the part somebody else has to act on: a
 * recommendation, a next action, and whatever that action cannot be carried
 * out without.
 *
 * Ratings are NOT required, any of them. An interviewer who did not test
 * somebody's Excel must be able to leave it blank rather than guess, which is
 * why `summarise` counts what was rated and not all ten.
 */
export function checkEvaluation(form = {}, { submitting = false } = {}) {
  const problems = [];
  if (!submitting) return problems;

  if (!String(form.recommendation || '').trim()) {
    problems.push('Say what you recommend before submitting.');
  } else if (!RECOMMENDATION_KEYS.includes(form.recommendation)) {
    problems.push(`“${form.recommendation}” is not one of the recommendations.`);
  }

  const action = String(form.next_action || '').trim();
  if (!action) {
    problems.push('Say what should happen next.');
  } else {
    const meta = actionMeta(action);
    if (!meta) problems.push(`“${action}” is not one of the next actions.`);
    else {
      for (const need of meta.needs || []) {
        if (!String(form[need] || '').trim()) {
          problems.push(
            need === 'next_round'
              ? 'Name the next round.'
              : 'A rejection has to say why.'
          );
        }
      }
    }
  }

  for (const key of PARAMETER_KEYS) {
    const value = form.ratings?.[key];
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_RATING) {
      problems.push(`${PARAMETERS.find((p) => p.key === key).label} has to be 1 to ${MAX_RATING}.`);
    }
  }
  return problems;
}
