/*
 * WARRANTY AND AMC, IN THE BUCKETS THE OFFICE ASKS ABOUT (v2.39.0).
 *
 * Off the dates already on the asset - `warranty_until`, `amc_until` - so
 * this screen and the register cannot disagree. Every asset on the register
 * lands in exactly one warranty bucket, and "no date" is its own bucket:
 * an asset nobody has typed a warranty for is not one whose warranty is fine.
 */

const DAY = 24 * 60 * 60 * 1000;

const daysUntil = (iso, today) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return null;
  const a = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(today).slice(0, 10)}T00:00:00Z`);
  return Math.round((a - b) / DAY);
};

export const WARRANTY_BUCKETS = [
  { key: 'expired', label: 'Expired', tone: 'bad' },
  { key: 'd30', label: 'Expiring in 30 days', tone: 'warn' },
  { key: 'd60', label: 'In 31–60 days', tone: 'warn' },
  { key: 'd90', label: 'In 61–90 days', tone: 'info' },
  { key: 'active', label: 'Active, beyond 90 days', tone: 'good' },
  { key: 'none', label: 'No warranty date', tone: 'muted' },
];

/** Which bucket a warranty end date falls in. */
export function warrantyBucket(until, today) {
  const left = daysUntil(until, today);
  if (left === null) return 'none';
  if (left < 0) return 'expired';
  if (left <= 30) return 'd30';
  if (left <= 60) return 'd60';
  if (left <= 90) return 'd90';
  return 'active';
}

/** The alert step an expiry has reached: 90, 30, 7 days before, the day, after. */
export function alertStep(until, today) {
  const left = daysUntil(until, today);
  if (left === null) return null;
  if (left < 0) return 'expired';
  if (left === 0) return 'today';
  if (left <= 7) return '7';
  if (left <= 30) return '30';
  if (left <= 90) return '90';
  return null;
}

export function warrantySummary(assets = [], today) {
  const counts = Object.fromEntries(WARRANTY_BUCKETS.map((b) => [b.key, 0]));
  let amc = 0;
  let amcExpired = 0;
  const rows = assets.map((a) => {
    const bucket = warrantyBucket(a.warranty_until, today);
    counts[bucket] += 1;
    const amcLeft = daysUntil(a.amc_until, today);
    const hasAmc = Boolean(a.amc_until || a.amc_vendor);
    if (hasAmc) {
      amc += 1;
      if (amcLeft !== null && amcLeft < 0) amcExpired += 1;
    }
    return {
      ...a,
      warranty_bucket: bucket,
      warranty_days_left: daysUntil(a.warranty_until, today),
      warranty_alert: alertStep(a.warranty_until, today),
      has_amc: hasAmc,
      amc_days_left: amcLeft,
    };
  });
  return { counts, amc, amcExpired, rows, total: assets.length };
}
