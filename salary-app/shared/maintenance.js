/**
 * Asset maintenance: what was done, what it cost, and what is due.
 *
 * The one module on Dinesh's list that had no code whatsoever — which is also
 * why the three figures his brief asks to be tested (service cost, total cost of
 * ownership, duplicate service entries) had nothing to test.
 *
 * Two rules it is built around.
 *
 * **A duplicate is caught when it is typed, not in a report.** The same service
 * entered twice — same asset, same date, same amount — is the commonest way an
 * asset's running cost comes out wrong, and catching it in a report means
 * somebody has already closed a month on a wrong figure. So `looksDuplicate`
 * runs before the save and asks.
 *
 * **Total cost of ownership keeps its parts.** Purchase and service are added
 * for the total and also reported separately, because "this laptop has cost
 * ₹58,000" and "₹42,000 of that was buying it" are different sentences and both
 * get asked.
 *
 * Dependency-free, like the rest of shared/.
 */

/** The kinds of work, for the picker. Free text still works. */
export const SERVICE_KINDS = [
  'Repair',
  'Service',
  'Parts',
  'Battery',
  'Software',
  'Insurance',
  'AMC',
  'Other',
];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round0 = (n) => Math.round(num(n));

const DAY = 24 * 60 * 60 * 1000;

/** Days from today until a date. Negative is in the past; null for no date. */
export function daysUntil(date, today = new Date().toISOString().slice(0, 10)) {
  if (!date) return null;
  const then = new Date(date);
  const now = new Date(today);
  if (Number.isNaN(then.getTime()) || Number.isNaN(now.getTime())) return null;
  return Math.round((then - now) / DAY);
}

/**
 * Does this look like something already entered?
 *
 * Same asset, same date, same amount is the test — deliberately not the same
 * note, because the note is where somebody types "battery" one time and
 * "Battery replacement" the next for the identical bill.
 *
 * @returns the row it resembles, or null.
 */
export function looksDuplicate(candidate, existing = []) {
  const on = String(candidate?.serviced_on || '').slice(0, 10);
  const cost = round0(candidate?.cost);
  if (!on) return null;
  return (
    existing.find(
      (row) =>
        Number(row.id) !== Number(candidate?.id) &&
        String(row.serviced_on || '').slice(0, 10) === on &&
        round0(row.cost) === cost
    ) || null
  );
}

/**
 * What one asset has cost, and what is due on it.
 *
 * @param asset    the register row (purchase cost, warranty, AMC)
 * @param services its service rows
 */
export function ownership(asset = {}, services = [], today = new Date().toISOString().slice(0, 10)) {
  const purchase = round0(asset.purchase_cost);
  const service = services.reduce((sum, s) => sum + num(s.cost), 0);

  // The next service date is whatever the latest service said, unless something
  // later says otherwise. Nothing is invented: no date means not scheduled.
  const dated = services
    .filter((s) => s.next_service_on)
    .sort((a, b) => String(b.next_service_on).localeCompare(String(a.next_service_on)));
  const nextService = dated[0]?.next_service_on || null;

  const warranty = daysUntil(asset.warranty_until, today);
  const amc = daysUntil(asset.amc_until, today);
  const due = daysUntil(nextService, today);

  return {
    purchase,
    service: round0(service),
    total: round0(purchase + service),
    // Service as a share of what it cost. Null rather than a divide by zero,
    // because plenty of assets cost nothing to acquire - a SIM, a gifted desk.
    service_share: purchase > 0 ? Math.round((service / purchase) * 1000) / 10 : null,
    times: services.length,
    last_service_on: services.length
      ? services.map((s) => s.serviced_on).sort().at(-1)
      : null,
    next_service_on: nextService,
    next_service_in_days: due,
    service_due: due !== null && due <= 0,
    service_soon: due !== null && due > 0 && due <= 30,
    warranty_until: asset.warranty_until || null,
    warranty_in_days: warranty,
    under_warranty: warranty !== null && warranty >= 0,
    amc_until: asset.amc_until || null,
    amc_in_days: amc,
    under_amc: amc !== null && amc >= 0,
  };
}

/**
 * Everything worth a reminder, across the register.
 *
 * Four lists rather than one count, because "the AMC ran out in March" and
 * "a service is due next week" need different things doing about them.
 */
export function maintenanceAlerts(rows = [], today = new Date().toISOString().slice(0, 10)) {
  const overdue = [];
  const soon = [];
  const warrantyGone = [];
  const amcGone = [];

  for (const row of rows) {
    const own = row.ownership || ownership(row, row.services || [], today);
    const entry = { ...row, ownership: own };
    if (own.service_due) overdue.push(entry);
    else if (own.service_soon) soon.push(entry);
    // Only worth saying for something still on the register.
    if (!row.written_off_on) {
      if (own.warranty_in_days !== null && own.warranty_in_days < 0) warrantyGone.push(entry);
      if (own.amc_in_days !== null && own.amc_in_days < 0) amcGone.push(entry);
    }
  }

  const byDate = (a, b) =>
    String(a.ownership.next_service_on || '').localeCompare(String(b.ownership.next_service_on || ''));

  return {
    overdue: overdue.sort(byDate),
    soon: soon.sort(byDate),
    warranty_gone: warrantyGone,
    amc_gone: amcGone,
    count: overdue.length + soon.length,
  };
}

/** The service-cost report, one line per service. */
export const SERVICE_COLUMNS = [
  ['Date', (s) => s.serviced_on || ''],
  ['Code', (s) => s.code || ''],
  // The asset, then what was done to it. Two different "kinds", which is
  // exactly what a `SELECT s.*, a.kind` once conflated.
  ['What', (s) => `${s.asset_kind || ''} ${s.label || ''}`.trim()],
  ['Company', (s) => s.company_name || ''],
  ['Kind of work', (s) => s.kind || ''],
  ['Work', (s) => s.work || ''],
  ['Vendor', (s) => s.vendor || ''],
  ['Invoice', (s) => s.invoice_no || ''],
  ['Cost', (s) => round0(s.cost)],
  ['Under warranty', (s) => (s.under_warranty ? 'yes' : '')],
  ['Next service', (s) => s.next_service_on || ''],
  ['Note', (s) => s.note || ''],
];

/** The cost-of-ownership report, one line per asset. */
export const OWNERSHIP_COLUMNS = [
  ['Code', (a) => a.code || ''],
  ['Kind', (a) => a.kind || ''],
  ['What', (a) => a.label || ''],
  ['Company', (a) => a.company_name || ''],
  ['Bought', (a) => a.purchase_date || ''],
  ['Cost to buy', (a) => a.ownership.purchase],
  ['Services', (a) => a.ownership.times],
  ['Cost to keep', (a) => a.ownership.service],
  ['Total so far', (a) => a.ownership.total],
  ['Service as % of cost', (a) => (a.ownership.service_share === null ? '' : a.ownership.service_share)],
  ['Last serviced', (a) => a.ownership.last_service_on || ''],
  ['Next service', (a) => a.ownership.next_service_on || ''],
  ['Warranty until', (a) => a.ownership.warranty_until || ''],
  ['AMC until', (a) => a.ownership.amc_until || ''],
  ['Written off', (a) => a.written_off_on || ''],
];

const escape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  const lines = [columns.map(([head]) => escape(head)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => escape(get(row))).join(','));
  return `﻿${lines.join('\n')}`;
}

export const servicesCsv = (services = []) => toCsv(SERVICE_COLUMNS, services);
export const ownershipCsv = (assets = []) => toCsv(OWNERSHIP_COLUMNS, assets);

/** What the maintenance side adds up to across whatever was passed in. */
export function maintenanceTotals(assets = []) {
  const live = assets.filter((a) => !a.written_off_on);
  const serviced = live.filter((a) => a.ownership.times > 0);
  return {
    assets: live.length,
    serviced: serviced.length,
    services: live.reduce((n, a) => n + a.ownership.times, 0),
    purchase: live.reduce((n, a) => n + a.ownership.purchase, 0),
    service: live.reduce((n, a) => n + a.ownership.service, 0),
    total: live.reduce((n, a) => n + a.ownership.total, 0),
    // The ones where keeping it has cost more than buying it did. Worth seeing:
    // that is usually the moment to replace rather than repair again.
    costing_more_than_bought: live.filter(
      (a) => a.ownership.purchase > 0 && a.ownership.service > a.ownership.purchase
    ),
  };
}
