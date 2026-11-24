import { assetStatus, daysTo, financialYear, overdueBy } from './assetStatus.js';
import { todayIso } from './today.js';

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
  today = todayIso(),
  soon = 30,
} = {}) {
  const withStatus = assets.map((a) => ({ ...a, status: assetStatus(a) }));
  const count = (key) => withStatus.filter((a) => a.status === key).length;
  /* Still on the register: not written off, not disposed of. Declared here
   * because the cards below need it as well as the warnings further down -
   * a const used above its own declaration is a blank page, not an error
   * anybody can read. */
  const live = withStatus.filter((a) => a.status !== 'written_off' && a.status !== 'disposed');
  const liveIds = new Set(live.map((a) => a.id));

  const cards = [
    /*
     * ON the register - so NOT the ones written off or disposed of, which the
     * register itself says are "not on the register any more". This counted
     * every asset ever bought, so the card read 4 beside a list of 3 - the one
     * thing the comment above promises cannot happen. "Bought, in all" below
     * still counts them, because that question is about money spent and a
     * laptop scrapped last year was still bought.
     */
    {
      key: 'all',
      label: 'Registered',
      n: withStatus.filter((a) => a.status !== 'written_off' && a.status !== 'disposed').length,
      /* ...and the filter it hands back selects exactly those, so the card
         and the list it opens still cannot disagree. */
      filter: { live: true },
    },
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
   * Two of the figures Dinesh listed were only ever WARNINGS further down the
   * page. A warning is read once and then stops being read; a figure on the
   * strip is read every time somebody opens the tab, which is what he asked
   * for. The warnings stay as well, because they NAME the assets, and a count
   * on its own cannot tell you which laptop is out of warranty.
   *
   * Both count only what is still on the register. A laptop scrapped last
   * year is out of warranty and will never be serviced again; counting it
   * would make the figure grow for ever and mean nothing.
   */
  const outOfWarranty = live.filter((a) => {
    const left = daysTo(a.warranty_until, today);
    return left !== null && left < 0;
  });
  cards.push({
    key: 'warranty_gone',
    label: 'Warranty expired',
    n: outOfWarranty.length,
    filter: { live: true, warranty: 'expired' },
  });

  /*
   * Bought, in all. Written-off assets are INCLUDED on purpose: the question
   * is what the company has spent on kit, and a laptop that was scrapped last
   * year was still bought. What it is worth today is a different question
   * nobody has asked for.
   */
  const spent = withStatus.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0);

  /*
   * WHAT IS OUT OF THE BUILDING, in money.
   *
   * On Dinesh's mock-up this is "Work in use (at site)" - the figure beside
   * the count of what staff are holding. It answers a different question from
   * "what have we spent": this is what is out of the office's hands right
   * now, which is the number that matters when somebody leaves.
   *
   * What it is NOT is what any of it is worth today. That needs a
   * depreciation rule - a rate and a method - which is a business decision he
   * has not made and which this must not invent: a wrong rate prices every
   * asset wrongly and reads as authoritative.
   */
  const outValue = withStatus
    .filter((a) => assetStatus(a) === 'assigned')
    .reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0);

  const alerts = [];
  const add = (key, label, rows, filter, tone = 'warn') => {
    if (rows.length) alerts.push({ key, label, n: rows.length, rows, filter, tone });
  };

  /* --- warranty --- */
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

  /*
   * The last of the figures he listed. Pushed here rather than written with
   * the others because it needs the service records, and those are worked out
   * above - a card that referred to them earlier would read as undefined.
   *
   * Counts ASSETS, not service records: two overdue services on one printer
   * is one printer to deal with, and counting rows would send somebody
   * looking for a second machine.
   */
  cards.push({
    key: 'service_due',
    label: 'Maintenance due',
    n: new Set(
      [...dueService.values()].map((srv) => srv.asset_id).filter((id) => liveIds.has(id))
    ).size,
    filter: { live: true, service_due: true },
  });

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

  return { cards, spent, out_value: outValue, alerts, counted: withStatus.length };
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
  // Case-insensitively: a department is free text on the asset, so Accounts
  // and ACCOUNTS are the same room and must not read as two.
  if (
    filter.department &&
    String(asset.department || '').trim().toLowerCase() !== String(filter.department).trim().toLowerCase()
  ) {
    return false;
  }
  if (filter.year && financialYear(asset.purchase_date) !== filter.year) return false;
  if (filter.status && assetStatus(asset) !== filter.status) return false;
  /*
   * On the register: not written off, not disposed of. The "Registered" card
   * carries this, because it counted every asset ever bought while the list
   * it opened showed only the live ones - 4 beside a list of 3.
   */
  if (filter.live) {
    const status = assetStatus(asset);
    if (status === 'written_off' || status === 'disposed') return false;
  }
  /*
   * A card that opens a list has to narrow it to what the card counted, or
   * the figure and the rows it opens disagree - which is the fault the
   * Registered card was fixed for once already.
   */
  if (filter.warranty === 'expired') {
    const left = daysTo(asset.warranty_until, filter.today || todayIso());
    if (left === null || left >= 0) return false;
  }
  if (filter.service_due && !(filter.service_due_ids || []).includes(asset.id)) return false;
  return true;
}
