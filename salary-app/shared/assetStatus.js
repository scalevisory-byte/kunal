import { todayIso } from './today.js';
/**
 * What state an asset is in.
 *
 * The brief asks for seven: Available, Assigned, Under Maintenance, Damaged,
 * Missing, Written Off, Disposed. The obvious implementation is one `status`
 * column somebody sets. That is the wrong one, and the reason is worth
 * writing down: three of those seven are FACTS this database already holds.
 *
 *   Written off  - `written_off_on` is set
 *   Assigned     - somebody has it and has not given it back
 *   Available    - neither of those
 *
 * A column saying "Assigned" beside an `employee_id` of null is not a status,
 * it is a second opinion, and the two drift the first time anybody returns an
 * asset through a different screen. So those three are DERIVED, every time,
 * from the rows that decide them.
 *
 * The other four cannot be derived from anything - nothing in the data says a
 * laptop is in the repair shop or that a SIM was lost - so they are a stored
 * `state`, and that column holds ONLY those four. Null means "nothing special
 * is going on", which is the normal case and is not a status at all.
 *
 * The result: the register cannot show a status that contradicts its own
 * handover log, and nobody has to remember to set one.
 */

/** The four somebody actually sets. Null is the normal case. */
export const ASSET_STATES = [
  ['maintenance', 'Under maintenance', 'Away being repaired or serviced'],
  ['damaged', 'Damaged', 'Here, but not usable as it is'],
  ['missing', 'Missing', 'Nobody can find it'],
  ['disposed', 'Disposed', 'Sold, scrapped or given away'],
];

export const STATE_KEYS = ASSET_STATES.map(([key]) => key);

/** All seven, for a filter or a legend. In the order an office thinks of them. */
export const ASSET_STATUSES = [
  ['available', 'Available'],
  ['assigned', 'Assigned'],
  ['maintenance', 'Under maintenance'],
  ['damaged', 'Damaged'],
  ['missing', 'Missing'],
  ['written_off', 'Written off'],
  ['disposed', 'Disposed'],
];

export const statusLabel = (key) =>
  ASSET_STATUSES.find(([k]) => k === key)?.[1] || key;

/**
 * One asset's status.
 *
 * Order matters and is deliberate: written off beats everything (the thing is
 * off the books), then the stored state, then who is holding it. A laptop
 * that is out with somebody AND away being repaired is "under maintenance" -
 * that is the fact that changes what you can do with it today.
 */
export function assetStatus(asset = {}) {
  if (asset.written_off_on) return 'written_off';
  if (STATE_KEYS.includes(asset.state)) return asset.state;
  if (asset.employee_id && !asset.returned_on) return 'assigned';
  return 'available';
}

/**
 * Can this be given to somebody?
 *
 * Only an asset that is Available. Said as a sentence rather than a boolean,
 * because "no" without a reason sends people hunting.
 */
export function allocationProblem(asset = {}) {
  const status = assetStatus(asset);
  if (status === 'available') return '';
  if (status === 'assigned') {
    return `${asset.code || 'It'} is already out with ${asset.employee_name || 'somebody'}. Take it back first, or pass it on from their row.`;
  }
  if (status === 'written_off') return `${asset.code || 'It'} is written off.`;
  return `${asset.code || 'It'} is ${statusLabel(status).toLowerCase()}.`;
}

/**
 * Is a return overdue?
 *
 * Only when somebody said when it was due back. An allocation with no
 * expected date is not late - it is open-ended, which is how most of them
 * are, and calling those overdue would make the alert useless.
 */
export function overdueBy(handover = {}, today = todayIso()) {
  if (!handover.expected_return_on || handover.returned_on) return 0;
  const due = String(handover.expected_return_on).slice(0, 10);
  if (due >= today) return 0;
  return Math.round(
    (new Date(`${today}T00:00:00Z`) - new Date(`${due}T00:00:00Z`)) / 86400000
  );
}

/** Days until a date. Negative means it has passed; null means no date. */
export function daysTo(date, today = todayIso()) {
  if (!date) return null;
  const then = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const now = new Date(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then.getTime()) || Number.isNaN(now.getTime())) return null;
  return Math.round((then - now) / 86400000);
}

/**
 * The financial year a date falls in, Indian style: April to March.
 *
 * Returned as "2026-27", which is how every purchase register and every
 * auditor in the country writes it.
 */
export function financialYear(date) {
  const text = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}/.test(text)) return '';
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Still on the register: not written off, not disposed of.
 *
 * One answer, because three screens had three. The register counted a
 * disposed laptop as "in the office", the dashboard did not; the register's
 * cost figure included it, the dashboard's did not.
 */
export const onRegister = (asset = {}) => {
  const status = assetStatus(asset);
  return status !== 'written_off' && status !== 'disposed';
};

/**
 * EVERY COUNT ON EVERY ASSET SCREEN COMES FROM HERE.
 *
 * Dinesh's live register read "with staff 359" on one screen and 363 on
 * another, beside 603 available and 2 under maintenance. The cause: the
 * register counted anybody HOLDING something, whatever its state, while the
 * dashboard counted only status Assigned. A laptop out with somebody and away
 * for repair was in both "with staff" and "under maintenance" on one screen,
 * and only in the second on the other.
 *
 * So each asset is in exactly ONE status (assetStatus, above), and:
 *
 *   on the register = assigned + available + maintenance + damaged + missing
 *   off it          = written off + disposed
 *   ever bought     = on the register + off it
 *
 * `check` proves the sums add up; a screen that shows it can never be off by
 * four without saying so. `held` is a separate figure on purpose - somebody
 * holding a damaged laptop is still holding it - and it is named as that, not
 * as "with staff", so the two questions cannot be confused again.
 *
 * Money is "what it cost", never a value: there is no depreciation here.
 */
export function assetCounts(assets = []) {
  const by = Object.fromEntries(ASSET_STATUSES.map(([key]) => [key, 0]));
  const cost = Object.fromEntries(ASSET_STATUSES.map(([key]) => [key, 0]));
  let held = 0;
  let heldCost = 0;
  for (const asset of assets) {
    const status = assetStatus(asset);
    const price = Number(asset.purchase_cost) || 0;
    by[status] += 1;
    cost[status] += price;
    if (asset.employee_id && !asset.returned_on && onRegister(asset)) {
      held += 1;
      heldCost += price;
    }
  }
  const live = by.assigned + by.available + by.maintenance + by.damaged + by.missing;
  const gone = by.written_off + by.disposed;
  const liveCost = cost.assigned + cost.available + cost.maintenance + cost.damaged + cost.missing;
  const allCost = liveCost + cost.written_off + cost.disposed;
  return {
    total: assets.length,
    live,
    gone,
    by,
    held,
    cost: { all: allCost, live: liveCost, gone: allCost - liveCost, by: cost, held: heldCost },
    check: live + gone === assets.length,
  };
}

/**
 * Records worth a person's look because two facts on them pull different ways.
 *
 * NAMED, NEVER CHANGED. The brief is explicit, and so is the rule here: a
 * historical record is not edited to make a figure come out. Each of these is
 * counted in exactly one status already - the list only says why somebody
 * might expect it elsewhere.
 */
export function assetOddities(assets = []) {
  const name = (a) => ({ id: a.id, code: a.code || '', label: a.label || '', employee_name: a.employee_name || '', status: assetStatus(a) });
  const heldWithState = [];
  const heldWhenGone = [];
  const disposedNotWrittenOff = [];
  const stateOnWrittenOff = [];
  const noCost = [];
  for (const a of assets) {
    const status = assetStatus(a);
    const held = Boolean(a.employee_id && !a.returned_on);
    if (held && ['maintenance', 'damaged', 'missing'].includes(status)) heldWithState.push(name(a));
    if (held && (status === 'written_off' || status === 'disposed')) heldWhenGone.push(name(a));
    if (a.state === 'disposed' && !a.written_off_on) disposedNotWrittenOff.push(name(a));
    if (a.written_off_on && STATE_KEYS.includes(a.state) && a.state !== 'disposed') stateOnWrittenOff.push(name(a));
    if (onRegister(a) && !(Number(a.purchase_cost) > 0)) noCost.push(name(a));
  }
  return [
    {
      key: 'held_with_state',
      label: 'Held by somebody AND marked under maintenance, damaged or missing',
      why: 'Counted under that state, not under "with staff". The holder is still named on the row.',
      rows: heldWithState,
    },
    {
      key: 'held_when_gone',
      label: 'Written off or disposed while still in somebody’s name',
      why: 'Off the register, but no return was ever recorded. Record the return if it came back.',
      rows: heldWhenGone,
    },
    {
      key: 'disposed_not_written_off',
      label: 'Marked disposed but not written off',
      why: 'Off the register either way. Writing it off records the date and why.',
      rows: disposedNotWrittenOff,
    },
    {
      key: 'state_on_written_off',
      label: 'Written off and still carrying a repair/damaged/missing mark',
      why: 'Written off wins; the old mark changes nothing.',
      rows: stateOnWrittenOff,
    },
    {
      key: 'no_cost',
      label: 'On the register with no purchase cost',
      why: 'Every money figure leaves these out, so totals read low until a cost is typed in.',
      rows: noCost,
    },
  ].filter((group) => group.rows.length);
}
