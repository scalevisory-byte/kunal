/**
 * The selection pipeline.
 *
 * Seven stages in a fixed order, plus Rejected, which is a decision a recruiter
 * makes at any point rather than a place in the queue. Nothing here moves on
 * its own: every move is somebody choosing it. There is no auto-advance and no
 * auto-reject anywhere in this codebase, by design.
 *
 * Dependency-free, so the server and the dashboard order and label stages
 * identically.
 */

export const STAGES = [
  { key: 'New', label: 'New', hint: 'Applied, nobody has looked yet' },
  { key: 'Under Review', label: 'Under Review', hint: 'A recruiter is reading the profile' },
  { key: 'Shortlisted', label: 'Shortlisted', hint: 'Worth putting in front of the client' },
  { key: 'Interview', label: 'Interview', hint: 'Interviewing, one round or several' },
  { key: 'Offer Sent', label: 'Offer Sent', hint: 'Offer with the candidate' },
  { key: 'Selected', label: 'Selected', hint: 'Offer accepted, not started yet' },
  { key: 'Joined', label: 'Joined', hint: 'Started work - this is where a fee is earned' },
];

/** Not a stage in the queue: a decision, reachable from any of them. */
export const REJECTED = 'Rejected';

export const ALL_STAGES = [...STAGES.map((s) => s.key), REJECTED];

export const isStage = (value) => ALL_STAGES.includes(String(value));

/** Where a stage sits in the queue; Rejected is nowhere, so -1. */
export const stageIndex = (stage) => STAGES.findIndex((s) => s.key === stage);

export const stageMeta = (stage) =>
  stage === REJECTED
    ? { key: REJECTED, label: 'Rejected', hint: 'A recruiter decided no' }
    : STAGES.find((s) => s.key === stage) || null;

/**
 * How long something has sat where it is, and what to call it.
 *
 * Green under three days, amber to a week, red past that. The point is to make
 * a candidate nobody has touched visible, not to score the recruiter.
 */
export function aging(since, now = Date.now()) {
  const at = since ? new Date(since).getTime() : NaN;
  if (!Number.isFinite(at)) return { days: null, tone: 'none', label: '-' };
  const days = Math.floor((now - at) / 86400000);
  const tone = days < 3 ? 'fresh' : days <= 7 ? 'warm' : 'stale';
  const label = days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  return { days, tone, label };
}

/** The bands the dashboard filters match scores by. */
export const MATCH_BANDS = [
  { key: 'strong', label: 'Strong', min: 80 },
  { key: 'good', label: 'Good', min: 60 },
  { key: 'low', label: 'Low', min: 0 },
];

export const matchBand = (score) =>
  Number(score) >= 80 ? 'strong' : Number(score) >= 60 ? 'good' : 'low';
