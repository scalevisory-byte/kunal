import { groupLabel, groupOf } from './assetGroups.js';
import { assetCounts, onRegister } from './assetStatus.js';
import { todayIso } from './today.js';
/**
 * The asset reports: the register, who holds what, and a slip to sign.
 *
 * Like every other report in this app, these **assemble and do not compute**.
 * The register is the asset rows; the handover report is the handover log. If a
 * figure here disagrees with the screen it came from, this file is wrong.
 *
 * Dependency-free, like the rest of shared/.
 */

const money = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : '');

/** The register, one line per asset. */
export const REGISTER_COLUMNS = [
  ['Code', (a) => a.code || ''],
  // Worked out from the kind, never a stored column - so a spreadsheet
  // sorted by Group cannot disagree with the Kind beside it.
  ['Group', (a) => groupLabel(groupOf(a.kind, a.label))],
  ['Kind', (a) => a.kind || ''],
  ['What', (a) => a.label || ''],
  ['Serial / number', (a) => a.identifier || ''],
  ['Company', (a) => a.company_name || ''],
  ['Branch', (a) => a.branch_name || ''],
  ['Bought', (a) => a.purchase_date || ''],
  ['Vendor', (a) => a.vendor || ''],
  ['Invoice', (a) => a.invoice_no || ''],
  ['Cost', (a) => money(a.purchase_cost)],
  ['Warranty until', (a) => a.warranty_until || ''],
  // Deliberately words rather than a blank: "in the office" is an answer, and a
  // blank cell reads as missing information.
  ['Where it is', (a) => whereItIs(a)],
  ['Since', (a) => (isOut(a) ? a.issued_on || '' : a.returned_on || '')],
  ['Condition', (a) => a.condition || ''],
  ['Written off', (a) => a.written_off_on || ''],
  ['Why', (a) => a.written_off_why || ''],
];

/** Somebody holds it. NOT the same as "with staff" - see registerTotals. */
export const isOut = (a) => Boolean(a.employee_id && !a.returned_on);

export const whereItIs = (a) => {
  if (a.written_off_on) return 'written off';
  if (a.state === 'disposed') return 'disposed';
  if (isOut(a)) return a.employee_name || 'with somebody';
  return 'in the office';
};

/** Who holds what, one line per handover. */
export const HANDOVER_COLUMNS = [
  ['Code', (h) => h.code || ''],
  ['What', (h) => `${h.kind || ''} ${h.label || ''}`.trim()],
  ['Company', (h) => h.company_name || ''],
  ['Who', (h) => h.employee_name || ''],
  ['Issued', (h) => h.issued_on || ''],
  ['By', (h) => h.issued_by || ''],
  ['Condition out', (h) => h.condition_out || ''],
  ['Returned', (h) => h.returned_on || ''],
  ['Taken back by', (h) => h.returned_by || ''],
  ['Condition back', (h) => h.condition_in || ''],
  ['Still out', (h) => (h.returned_on ? 'no' : 'yes')],
  ['Cost', (h) => money(h.purchase_cost)],
];

const escape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a BOM, so Excel opens it with the rupee signs intact. */
export function toCsv(columns, rows) {
  const lines = [columns.map(([head]) => escape(head)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => escape(get(row))).join(','));
  return `﻿${lines.join('\n')}`;
}

export const registerCsv = (assets = []) => toCsv(REGISTER_COLUMNS, assets);
export const handoverCsv = (handovers = []) => toCsv(HANDOVER_COLUMNS, handovers);

/**
 * What the register adds up to.
 *
 * `out_value` is what is **out of the building**, which is the figure worth
 * knowing: an asset in the office is somewhere you can look.
 */
export function registerTotals(assets = []) {
  /*
   * v2.36.0: read off assetCounts, the one count every asset screen uses.
   * `out` used to be "anybody holding it", so a laptop with somebody and away
   * for repair was counted as out here and as under maintenance on the
   * dashboard - 363 here, 359 there. `out` is now status Assigned; `held` is
   * the old "anybody holding it", kept and named for what it is.
   */
  const c = assetCounts(assets);
  const live = assets.filter(onRegister);
  return {
    count: c.live,
    written_off: c.by.written_off,
    disposed: c.by.disposed,
    out: c.by.assigned,
    in_office: c.by.available,
    maintenance: c.by.maintenance,
    damaged: c.by.damaged,
    missing: c.by.missing,
    held: c.held,
    cost: c.cost.live,
    out_value: c.cost.by.assigned,
    check: c.check,
    // Warranties worth a look: expired, or inside a month.
    warranty_soon: live.filter((a) => a.warranty_left_days !== null && a.warranty_left_days >= 0 && a.warranty_left_days <= 30),
    warranty_gone: live.filter((a) => a.warranty_left_days !== null && a.warranty_left_days < 0),
  };
}

/**
 * One person's handover slip, to print and have signed.
 *
 * Returns the lines rather than any markup, so the same text can go on a page,
 * into a PDF or into a message.
 */
export function handoverSlip({ employee, handovers = [], company, dated } = {}) {
  const out = handovers.filter((h) => !h.returned_on);
  return {
    title: 'Asset handover',
    company: company || handovers[0]?.company_name || '',
    employee: employee?.name || handovers[0]?.employee_name || '',
    code: employee?.code || '',
    dated: dated || todayIso(),
    items: out.map((h) => ({
      code: h.code || '',
      what: `${h.kind || ''} ${h.label || ''}`.trim(),
      serial: h.identifier || '',
      issued_on: h.issued_on || '',
      condition: h.condition_out || '',
    })),
    total: out.reduce((sum, h) => sum + (Number(h.purchase_cost) || 0), 0),
    // Said on the slip itself, because the point of signing is agreeing to it.
    undertaking:
      'I have received the items listed above in working order, and I will return them ' +
      'on request or when I leave.',
  };
}
