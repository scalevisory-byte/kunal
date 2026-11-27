/*
 * A day that came in with no out punch.
 *
 * Dinesh's rule (v2.34.0): a day where the machine has an arrival but no
 * departure is a HALF DAY, automatically. Before this the import wrote P and
 * said "nothing invents a departure" - v2.2.0 had made exactly that choice,
 * because an HF worked out from a departure nobody had punched cost somebody
 * half a day's pay for sitting at their desk. This is different: the rule
 * does not guess the departure, it decides the day's mark from the fact that
 * the departure is missing. That is a policy, so it is a setting, on by
 * default because he asked for it, and it can be switched off.
 *
 * What it must never do, and the reasons are in backend/src/punchApply.js:
 *   - touch a day that has not finished yet (`dayNotFinished` decides that);
 *   - overwrite a mark a person set by hand, or a mark that was there before
 *     this rule existed (those are paid already, and nothing rewrites a stored
 *     value on its own);
 *   - stay stuck: the day remembers that the RULE set it (`attendance.missing_out
 *     = 1`), so a typed out time, or a later complete import, puts it back to P.
 */

export const MISSING_OUT_KEY = 'missing_out_half_day';

/** The mark the rule writes. Kept here so the importer and the server agree. */
export const MISSING_OUT_CODE = 'HF';

/**
 * Whether the rule is on, from the stored setting.
 *
 * Nothing stored means the install has never been told otherwise, and the
 * answer is on - that is what was asked for. Anything stored must say `on`
 * explicitly, so a corrupt value reads as off rather than as a pay cut.
 */
export function missingOutRule(stored) {
  if (stored === null || stored === undefined) return { on: true, by: '', since: '' };
  return {
    on: stored === true || Boolean(stored && stored.on === true),
    by: String((stored && stored.by) || ''),
    since: String((stored && stored.since) || ''),
  };
}

/** Is this mark the one the rule wrote on the day, rather than somebody's own? */
export const wroteByRule = (row) => Number(row?.missing_out) === 1;
