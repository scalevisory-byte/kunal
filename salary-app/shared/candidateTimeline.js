/**
 * A CANDIDATE'S WHOLE STORY, IN ORDER.
 *
 * Dinesh: *"need candidate all history recorded here, from starting to end -
 * physical form, documents, evaluated form, test paper and answer sheet, A to
 * Z"*. Every piece existed in its own place; what did not exist was the one
 * page that says what happened to this person.
 *
 * It ASSEMBLES AND NOTHING ELSE. Every date and every word here was written
 * by the screen that owns it - the screening, the test, the evaluation, the
 * offer. Nothing is derived, nothing is guessed, and a step with no date
 * recorded is left out rather than given a plausible one.
 *
 * Dependency-free, so the server, the dashboard and the printed file cannot
 * tell three different versions of the same story.
 */

/**
 * Everything that happened, oldest first.
 *
 * Oldest first on purpose, unlike every list beside it: this one is read as a
 * story, and a story told backwards is the hardest way to answer "what has
 * happened to this person".
 */
/*
 * TWO DATE FORMATS MEET HERE, and sorting them as strings is wrong twice.
 *
 * SQLite's own `datetime('now')` writes "2026-11-15 17:40:31" and the
 * JavaScript side writes "2026-11-15T17:40:31.857Z". As text, a space sorts
 * before a T, so a day's events come out shuffled. Worse, `Date.parse` reads
 * the first as LOCAL time and the second as UTC - on a server in India that
 * is a five-and-a-half hour lie, and the story comes out in the wrong order
 * by half a day.
 *
 * SQLite's datetime IS UTC, so it is spelled as UTC before parsing.
 */
export function toTime(at) {
  if (!at) return NaN;
  const text = String(at).trim();
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text);
  const ms = Date.parse(sqlite ? `${text.replace(' ', 'T')}Z` : text);
  // A bare date ("2026-12-01") parses as UTC midnight, which is what we want.
  return Number.isFinite(ms) ? ms : NaN;
}

export function buildTimeline({
  candidate, applications = [], attempts = [], offers = [], screenings = [], history = [],
}) {
  const events = [];
  const add = (at, what, detail, extra = {}) => {
    if (!at) return;
    events.push({ at: String(at), what, detail, ...extra });
  };

  add(candidate?.created_at, 'Added to the list', candidate?.source ? `from ${candidate.source}` : '');

  for (const a of applications) {
    add(a.created_at, 'Applied', [a.job_title, a.company_name].filter(Boolean).join(' · '));
  }

  for (const sc of screenings) {
    add(
      sc.screened_on || sc.created_at,
      `Screening: ${sc.verdict}`,
      [sc.rejection_reason, sc.hold_reason, sc.remarks].filter(Boolean).join(' · ')
    );
  }

  for (const t of attempts) {
    add(t.assigned_at, 'Test paper drawn', t.paper_name);
    if (t.submitted_at) {
      add(
        t.submitted_at,
        `Test sat — ${t.percentage}%`,
        `${t.paper_name} · ${t.right_count} right, ${t.wrong_count} wrong`,
        { attemptId: t.id }
      );
    }
  }

  for (const h of history) {
    add(h.at, h.round_name ? `Interview — ${h.round_name}` : `Interview round ${h.round}`,
      [h.interviewer, h.mode].filter(Boolean).join(' · '));
    if (h.form_submitted) add(h.form_submitted, 'Particulars form filled in', h.decision || '');
    if (h.approved_at) {
      add(h.approved_at, `Evaluation approved — ${h.recommendation || 'no recommendation'}`,
        h.approved_by ? `by ${h.approved_by}` : '');
    }
  }

  for (const o of offers) {
    add(o.created_at, 'Offer drafted', [o.designation, o.salary ? `₹${o.salary}` : ''].filter(Boolean).join(' · '));
    if (o.approved_at) add(o.approved_at, 'Offer approved', o.approved_by ? `by ${o.approved_by}` : '');
    if (o.sent_at) add(o.sent_at, 'Offer sent', '');
    if (o.accepted_at) add(o.accepted_at, 'Offer accepted', '');
    if (o.declined_at) add(o.declined_at, 'Offer declined', o.decline_reason || '');
  }

  for (const a of applications) {
    if (a.employee_id) add(a.joining_date || a.stage_changed_at, 'Put on the payroll', a.company_name);
  }

  /*
   * Stable on purpose: several things can carry the same timestamp (a paper
   * drawn and the application it was drawn for, in one request), and the
   * order they were added in is the order they happened in.
   */
  return events
    .map((e, i) => ({ e, i, t: toTime(e.at) }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map((x) => x.e);
}
