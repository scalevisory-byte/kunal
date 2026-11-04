import { assetStatus, daysTo, financialYear, overdueBy } from './assetStatus.js';

/**
 * The asset dashboard: six figures, six alerts.
 *
 * It COUNTS, it does not decide. Every figure here is the same register the
 * Asset Register screen shows, filtered the same way, so a card that says 14
 * and a list that shows 13 cannot happen - clicking a card hands back the
 * exact filter that produced it.
 *
 * `soon` is the window for "expiring", in days. Thirty, because a warranty
 * you are told about on the morning it runs out is a warranty you have lost.
 */
export function assetDashboard({
  assets = [],
  handovers = [],
  services = [],
  verifications = [],
  round = null,
  today = new Date().toISOString().slice(0, 10),
  soon = 30,
} = {}) {
  const withStatus = assets.map((a) => ({ ...a, status: assetStatus(a) }));
  const count = (key) => withStatus.filter((a) => a.status === key).length;

  const cards = [
    { key: 'all', label: 'Registered', n: withStatus.length, filter: {} },
    { key: 'assigned', label: 'With staff', n: count('assigned'), filter: { status: 'assigned' } },
    { key: 'available', label: 'Available', n: count('available'), filter: { status: 'available' } },
    {
      key: 'maintenance',
      label: 'Under maintenance',
      n: count('maintenance'),
      filter: { status: 'maintenance' },
    },
    {
      key: 'written_off',
      label: 'Written off',
      n: count('written_off') + count('disposed'),
      filter: { status: 'written_off' },
    },
  ];

  /*
   * Bought, in all. Written-off assets are INCLUDED on purpose: the question
   * is what the company has spent on kit, and a laptop that was scrapped last
   * year was still bought. What it is worth today is a different question
   * nobody has asked for.
   */
  const spent = withStatus.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0);

  const alerts = [];
  const add = (key, label, rows, filter, tone = 'warn') => {
    if (rows.length) alerts.push({ key, label, n: rows.length, rows, filter, tone });
  };

  /* --- warranty --- */
  const live = withStatus.filter((a) => a.status !== 'written_off' && a.status !== 'disposed');
  add(
    'warranty_soon',
    `Warranty running out within ${soon} days`,
    live.filter((a) => {
      const left = daysTo(a.warranty_until, today);
      return left !== null && left >= 0 && left <= soon;
    }),
    { warranty: 'soon' }
  );
  add(
    'warranty_gone',
    'Warranty already expired',
    live.filter((a) => {
      const left = daysTo(a.warranty_until, today);
      return left !== null && left < 0;
    }),
    { warranty: 'expired' },
    'muted'
  );

  /* --- returns --- */
  const open = handovers.filter((h) => !h.returned_on);
  const late = open
    .map((h) => ({ ...h, overdue_days: overdueBy(h, today) }))
    .filter((h) => h.overdue_days > 0)
    .sort((a, b) => b.overdue_days - a.overdue_days);
  add('overdue_returns', 'Overdue returns', late, { status: 'assigned' }, 'bad');

  /* --- maintenance --- */
  /*
   * Due only when the person who did the work said so. A date this app worked
   * out would produce reminders nobody asked for and nobody trusts, and the
   * service record has said that from the start.
   */
  const dueService = services
    .filter((s) => s.next_service_on)
    .filter((s) => {
      const left = daysTo(s.next_service_on, today);
      return left !== null && left <= soon;
    })
    // Only the latest "next" per asset, or an old superseded one reads as a
    // second service falling due.
    .reduce((best, s) => {
      const seen = best.get(s.asset_id);
      if (!seen || String(s.serviced_on) > String(seen.serviced_on)) best.set(s.asset_id, s);
      return best;
    }, new Map());
  add('service_due', 'Service due', [...dueService.values()], { status: '' });

  /* --- the stock take --- */
  if (round) {
    const seen = new Map(verifications.filter((v) => v.round === round).map((v) => [v.asset_id, v]));
    const checkable = live;
    add(
      'verify_pending',
      `Not checked yet in ${round}`,
      checkable.filter((a) => !seen.has(a.id)),
      { round, verified: 'pending' },
      'muted'
    );
    add(
      'verify_missing',
      `Not found in ${round}`,
      checkable.filter((a) => seen.get(a.id) && !seen.get(a.id).found),
      { round, verified: 'missing' },
      'bad'
    );
  }

  /*
   * Said missing by somebody, which is a different thing from not having been
   * found in a round - one is a verdict about the asset, the other about the
   * round. Both are shown, and they are not added together.
   */
  add(
    'missing',
    'Marked missing',
    withStatus.filter((a) => a.status === 'missing'),
    { status: 'missing' },
    'bad'
  );

  return { cards, spent, alerts, counted: withStatus.length };
}

/** The financial years anything was bought in, newest first. */
export function purchaseYears(assets = []) {
  const years = new Set();
  for (const a of assets) {
    const fy = financialYear(a.purchase_date);
    if (fy) years.add(fy);
  }
  return [...years].sort().reverse();
}

/** Does this asset pass the dashboard's filters? One place, so a card and the list agree. */
export function matchesFilter(asset, filter = {}) {
  if (!asset) return false;
  if (filter.company_id && Number(asset.company_id) !== Number(filter.company_id)) return false;
  if (filter.branch_id && Number(asset.branch_id) !== Number(filter.branch_id)) return false;
  if (filter.category && asset.kind !== filter.category) return false;
  if (filter.year && financialYear(asset.purchase_date) !== filter.year) return false;
  if (filter.status && assetStatus(asset) !== filter.status) return false;
  return true;
}
