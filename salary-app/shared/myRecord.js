/**
 * WHAT IS ON MY RECORD - the employee's own copy.
 *
 * Dinesh: *"emp[loyee me unke achvemnet and penlatlites bhi dikhe esa karo"*.
 *
 * The office already keeps both: `employee_notes` holds warnings and
 * appreciations on one list, and `penalties` holds fines, losses and damage
 * with the note saying what for. Neither had ever been shown to the person
 * they are about. An appreciation nobody reads is a filing exercise, and a
 * deduction somebody only discovers on a payslip is an argument.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS MODULE HOLDS: THE PORTAL SHOWS WHAT WAS ISSUED TO THEM.
 *
 * It is their copy of their record, not the office's file, and the two are
 * not the same document. So:
 *
 *   a WARNING or an APPRECIATION is shown. Both are issued to the person by
 *       definition - a warning carries the date they acknowledged it, which
 *       only means something if they have seen it.
 *
 *   a plain NOTE is NOT shown. `kind: 'note'` is the office's own jotting
 *       ("spoke to him about the Tuesday run"). It was never handed to
 *       anybody. Publishing it would turn a jotting into a document, and the
 *       office would simply stop writing them - which costs the record more
 *       than it gains the employee.
 *
 *   a PENALTY is shown once it has been TOLD or once MONEY HAS COME OUT.
 *       Recording one deducts nothing (that is the penalty module's own
 *       rule), and a fine still under consideration can be waived. Telling
 *       somebody by screen before their manager has spoken to them is not
 *       the office doing its job. But nothing that reaches their salary can
 *       be hidden: the first rupee recovered makes it visible whether it was
 *       told or not.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free: the route, the page and the tests all read the same rule.
 */

/** Kinds of note that were issued to the person, so are theirs to see. */
export const SHOWN_NOTE_KINDS = ['warning', 'appreciation'];

const day = (v) => (v ? String(v).slice(0, 10) : null);

/** Was this penalty ever put to them, or has money already come out of it? */
export const penaltyReached = (penalty = {}) =>
  Boolean(penalty.told_on) || (Number(penalty.recovered) || 0) > 0;

/**
 * One note, as the employee may see it.
 *
 * A whitelist and not a strip, the same discipline as `forTeam` and
 * `forOffice`: a column added to the table later must be let through on
 * purpose, not travel because nobody remembered to remove it.
 */
export const theirNote = (note = {}) => ({
  id: note.id,
  kind: note.kind,
  severity: note.severity || null,
  category: note.category || null,
  dated: day(note.dated),
  subject: note.subject,
  detail: note.detail || null,
  /* Who issued it. A name typed on a form, like every other `by` in this
     app - not an authenticated identity. */
  issued_by: note.issued_by || null,
  acknowledged_on: day(note.acknowledged_on),
});

/**
 * One penalty, as the employee may see it - with the months it came out of.
 *
 * `recoveries` is the half that answers "where did my ₹500 go": each row is a
 * month and an amount, which is what the payslip shows under the remark.
 */
export const theirPenalty = (penalty = {}, recoveries = []) => ({
  id: penalty.id,
  kind: penalty.kind,
  kind_label: penalty.kind_label || null,
  amount: Number(penalty.amount) || 0,
  what: penalty.what || null,
  asset_code: penalty.asset_code || null,
  /* REQUIRED when the penalty was recorded - it is the whole reason the
     module exists, and it is what prints on the payslip. */
  note: penalty.note,
  happened_on: day(penalty.happened_on),
  told_on: day(penalty.told_on),
  acknowledged_on: day(penalty.acknowledged_on),
  months: Number(penalty.months) || 1,
  status: penalty.status,
  instalment: penalty.instalment ?? null,
  recovered: Number(penalty.recovered) || 0,
  outstanding: Number(penalty.outstanding) || 0,
  waived_note: penalty.waived_note || null,
  raised_by: penalty.raised_by || null,
  recoveries: recoveries.map((r) => ({
    period_label: r.period_label || null,
    year: r.year ?? null,
    month: r.month ?? null,
    amount: Number(r.amount) || 0,
  })),
});

export const visibleNotes = (notes = []) =>
  notes.filter((n) => SHOWN_NOTE_KINDS.includes(n.kind)).map(theirNote);

export const visiblePenalties = (penalties = [], recoveriesOf = () => []) =>
  penalties.filter(penaltyReached).map((p) => theirPenalty(p, recoveriesOf(p.id) || []));

/**
 * The headline, for the dashboard card.
 *
 * Counts only. `outstanding` is what is still to come out of their salary,
 * which is the figure somebody actually wants; `recovered` is what already
 * has. A warning they have not acknowledged is counted separately, because
 * that is the one thing on this page they can do something about.
 */
export function recordSummary({ notes = [], penalties = [] } = {}) {
  const appreciations = notes.filter((n) => n.kind === 'appreciation');
  const warnings = notes.filter((n) => n.kind === 'warning');
  const open = penalties.filter((p) => p.status === 'open' || p.status === 'held');
  const money = (v) => Math.round(v * 100) / 100;
  return {
    appreciations: appreciations.length,
    warnings: warnings.length,
    /* Not "unseen" - a warning read on paper and never ticked here is not
       unseen. It is simply not acknowledged on the record. */
    warnings_unacknowledged: warnings.filter((n) => !n.acknowledged_on).length,
    penalties: penalties.length,
    penalties_open: open.length,
    outstanding: money(open.reduce((s, p) => s + (Number(p.outstanding) || 0), 0)),
    recovered: money(penalties.reduce((s, p) => s + (Number(p.recovered) || 0), 0)),
    latest: [...notes, ...penalties]
      .map((r) => day(r.dated) || day(r.told_on) || day(r.happened_on))
      .filter(Boolean)
      .sort()
      .reverse()[0] || null,
    /* Nothing at all on either list. Said once, here, so the page does not
       have to work it out from two empty arrays. */
    empty: notes.length === 0 && penalties.length === 0,
  };
}
