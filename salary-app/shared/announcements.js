/**
 * THE NOTICEBOARD.
 *
 * Dinesh: *"any announcmnet like celbration holiday o bhi"* - on the staff
 * portal, beside the openings. Until now that card on the portal said, in so
 * many words, that there was no noticeboard in the system to read from. It
 * was honest and it was a gap.
 *
 * What this is NOT: a messaging system. Nothing is sent anywhere. It is a
 * board - the office pins something, the staff see it when they sign in, and
 * it comes down when it is over. The digest (`shared/digest.js`) already
 * decides what to SAY and admits it cannot send; this is the other half,
 * which needs no sending at all.
 *
 * Dependency-free, like the rest of shared/.
 */

export const KINDS = [
  { key: 'notice', label: 'Notice', icon: '\u{1F4CC}', why: 'office news — a change of timings, a form to sign' },
  { key: 'celebration', label: 'Celebration', icon: '\u{1F389}', why: 'a picnic, a party, somebody’s wedding' },
  { key: 'holiday', label: 'Holiday', icon: '\u{1F334}', why: 'the office is shut, or a festival is being kept' },
];

export const kindLabel = (key) => KINDS.find((k) => k.key === key)?.label || 'Notice';
export const kindIcon = (key) => KINDS.find((k) => k.key === key)?.icon || '\u{1F4CC}';

const day = (v) => (v ? String(v).slice(0, 10) : '');

/**
 * Is this one on the board today?
 *
 * BLANK DATES MEAN "NOW" AND "UNTIL SOMEBODY TAKES IT DOWN", which is how a
 * cork board works and what somebody typing a notice expects. A start date
 * in the future is a notice written in advance - it is not on the board yet,
 * and showing it early is how staff turn up to a picnic a week early.
 */
export function isLive(a = {}, today = new Date().toISOString().slice(0, 10)) {
  const from = day(a.from_on);
  const until = day(a.until_on);
  if (from && from > today) return false;
  if (until && until < today) return false;
  return true;
}

/** Does it cover this person? A notice with no company is the whole office. */
export const covers = (a = {}, companyId) =>
  !a.company_id || Number(a.company_id) === Number(companyId);

/**
 * What one person sees, newest first with the pinned ones on top.
 *
 * A whitelist, like every other staff payload: `posted_by` is a name typed on
 * a form and travels, because "who put this up" is a fair question; nothing
 * else about the office does.
 */
export function forEmployee(all = [], { companyId, today } = {}) {
  return all
    .filter((a) => isLive(a, today) && covers(a, companyId))
    .sort(
      (x, y) =>
        (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) ||
        String(y.from_on || y.created_at || '').localeCompare(String(x.from_on || x.created_at || ''))
    )
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      body: a.body || '',
      from_on: day(a.from_on),
      until_on: day(a.until_on),
      pinned: !!a.pinned,
      posted_by: a.posted_by || '',
    }));
}

/** What is wrong with one, in words. A title is the only thing required. */
export function validate(a = {}) {
  const problems = [];
  if (!String(a.title || '').trim()) problems.push('say what it is about in a line');
  if (a.from_on && a.until_on && day(a.until_on) < day(a.from_on)) {
    problems.push('it cannot come down before it goes up');
  }
  if (a.kind && !KINDS.some((k) => k.key === a.kind)) problems.push('that is not one of the kinds');
  return { ok: problems.length === 0, problems };
}
