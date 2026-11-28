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

/**
 * Days already on the grid that the rule WOULD mark today, but never did.
 *
 * Dinesh, on v2.36 with AJEETKUMAR's 27th still reading P, in 10:29 and no
 * out: *"what u done for missing punch"*. The rule only acts on what the
 * import writes FROM NOW ON, and it never overwrites a mark already stored -
 * a day imported before the update came in as P and stays P. That is
 * deliberate (a month already paid must not move by itself), so the days are
 * offered here instead, named, for the office to press.
 *
 * A candidate is a day that has FINISHED (`lastDay` - before today in the
 * current month, the whole month for a past one), carries an arrival and no
 * departure, reads P or nothing, was not written by the rule already, and
 * that no person has decided: not marked by hand since the column existed,
 * and with no allowed/refused decision on it.
 */
export function missingOutCandidates(rows = [], { entryOf, lastDay }) {
  const out = [];
  for (const row of rows) {
    for (let day = 1; day <= lastDay; day += 1) {
      const e = entryOf(row, day) || {};
      if (!e.in_time || e.out_time) continue;
      if (!['', 'P'].includes(String(e.code || ''))) continue;
      if (Number(e.missing_out) === 1 || e.marked_by_hand) continue;
      if (e.approved === true || e.approved === false) continue;
      out.push({
        employee_id: row.employee_id,
        name: row.employee_name || row.name || '',
        day,
        in_time: e.in_time,
      });
    }
  }
  return out;
}
