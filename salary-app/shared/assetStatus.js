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
export function overdueBy(handover = {}, today = new Date().toISOString().slice(0, 10)) {
  if (!handover.expected_return_on || handover.returned_on) return 0;
  const due = String(handover.expected_return_on).slice(0, 10);
  if (due >= today) return 0;
  return Math.round(
    (new Date(`${today}T00:00:00Z`) - new Date(`${due}T00:00:00Z`)) / 86400000
  );
}

/** Days until a date. Negative means it has passed; null means no date. */
export function daysTo(date, today = new Date().toISOString().slice(0, 10)) {
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
