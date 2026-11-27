import { todayIso } from './today.js';
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

/*
 * A TIME OF DAY, when one was given.
 *
 * Dinesh, at the noticeboard: *"yaha pe time nahi mention kiya he"*. A notice
 * goes up on a date and, now, optionally at a time - "games at 5 pm" is a
 * notice with a time, and one that comes down at 6 should not still be on the
 * board at 7. Stored in the same column as `2026-11-27T17:00`; a bare date is
 * exactly what it always was, so no notice already up changes.
 */
const timeOf = (v) => {
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/.exec(String(v || ''));
  return m ? m[1] : '';
};
const pad = (n) => String(n).padStart(2, '0');
const nowStamp = (now = new Date()) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** "27 Nov 2026", or "27 Nov 2026, 5:00 pm" when a time was given. */
export function whenLabel(v) {
  const d = day(v);
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  const date = new Date(y, m - 1, dd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const t = timeOf(v);
  if (!t) return date;
  const [h, min] = t.split(':').map(Number);
  return `${date}, ${((h + 11) % 12) + 1}:${pad(min)} ${h < 12 ? 'am' : 'pm'}`;
}

/** Split a stored value back into its date and its time, for a form. */
export const splitWhen = (v) => ({ date: day(v), time: timeOf(v) });

/** A date and an optional time, as they are stored. */
export const joinWhen = (date, time) => (date ? (time ? `${date}T${time}` : date) : '');

/**
 * Is this one on the board today?
 *
 * BLANK DATES MEAN "NOW" AND "UNTIL SOMEBODY TAKES IT DOWN", which is how a
 * cork board works and what somebody typing a notice expects. A start date
 * in the future is a notice written in advance - it is not on the board yet,
 * and showing it early is how staff turn up to a picnic a week early.
 */
export function isLive(a = {}, today = todayIso(), now = new Date()) {
  const from = day(a.from_on);
  const until = day(a.until_on);
  if (from && from > today) return false;
  if (until && until < today) return false;
  /* On the day itself, a time is honoured: up at 17:00 is not up at 16:00,
     down at 18:00 is not up at 19:00. Only when the date is today, so a
     caller asking about another day by date alone gets the date answer. */
  if (today === todayIso(now)) {
    const stamp = nowStamp(now);
    if (from === today && timeOf(a.from_on) && `${from}T${timeOf(a.from_on)}` > stamp) return false;
    if (until === today && timeOf(a.until_on) && `${until}T${timeOf(a.until_on)}` < stamp) return false;
  }
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
      // The same moments in words, with the time when one was given.
      from_label: whenLabel(a.from_on),
      until_label: whenLabel(a.until_on),
      pinned: !!a.pinned,
      posted_by: a.posted_by || '',
    }));
}

/** What is wrong with one, in words. A title is the only thing required. */
export function validate(a = {}) {
  const problems = [];
  if (!String(a.title || '').trim()) problems.push('say what it is about in a line');
  const fromAt = a.from_on ? `${day(a.from_on)}T${timeOf(a.from_on) || '00:00'}` : '';
  const untilAt = a.until_on ? `${day(a.until_on)}T${timeOf(a.until_on) || '23:59'}` : '';
  if (fromAt && untilAt && untilAt < fromAt) {
    problems.push('it cannot come down before it goes up');
  }
  if (a.kind && !KINDS.some((k) => k.key === a.kind)) problems.push('that is not one of the kinds');
  return { ok: problems.length === 0, problems };
}
