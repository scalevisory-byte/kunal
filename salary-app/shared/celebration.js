/*
 * A raise, said out loud to the person who got it.
 *
 * Dinesh (v2.35.0): *"appraisal raise kare to employee k dashboard me
 * celebration hona chahiye, party jesa popup ke saath"*.
 *
 * The rules, and why:
 *   - ONLY AN APPLIED ONE. An appraisal is a proposal until somebody applies
 *     it (people.js); celebrating a proposal that is then changed or dropped
 *     is worse than celebrating nothing.
 *   - ONLY A RISE. A revision that leaves the salary where it was, or lowers
 *     it, is not a party.
 *   - ONLY RECENT (60 days). Somebody signing in for the first time should
 *     not be thrown a party for an increment from two years ago.
 *   - THE FEWEST FIELDS. What they get is their own new salary and the rise,
 *     which their payslip shows them anyway. Not the reviewer's summary, not
 *     the rating - those are the office's words, and the record page is where
 *     anything of that kind is shown.
 */

export const CELEBRATE_WITHIN_DAYS = 60;

export const CELEBRATION_FIELDS = [
  'id',
  'cycle',
  'kind',
  'from_salary',
  'to_salary',
  'increment',
  'increment_pct',
  'effective_from',
  'applied_on',
];

const dayOf = (v) => String(v || '').slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function celebrationFor(appraisals = [], { today, within = CELEBRATE_WITHIN_DAYS } = {}) {
  const now = dayOf(today);
  const candidates = appraisals
    .filter((a) => a && a.applied_at)
    .map((a) => {
      const from = Number(a.from_salary) || 0;
      const to = Number(a.to_salary) || 0;
      return { ...a, from, to, rise: to - from, applied_on: dayOf(a.applied_at) };
    })
    .filter((a) => a.rise > 0)
    .filter((a) => {
      if (!now) return true;
      const age = daysBetween(a.applied_on, now);
      return Number.isFinite(age) && age >= 0 && age <= within;
    })
    .sort((x, y) => (x.applied_on === y.applied_on ? y.id - x.id : x.applied_on < y.applied_on ? 1 : -1));
  const best = candidates[0];
  if (!best) return null;
  const out = {
    id: best.id,
    cycle: best.cycle || '',
    kind: best.kind || '',
    from_salary: best.from,
    to_salary: best.to,
    increment: best.rise,
    increment_pct: best.from > 0 ? Math.round((best.rise / best.from) * 1000) / 10 : null,
    effective_from: best.effective_from || '',
    applied_on: best.applied_on,
  };
  return Object.fromEntries(CELEBRATION_FIELDS.map((k) => [k, out[k]]));
}
