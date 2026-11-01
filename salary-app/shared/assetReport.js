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

export const isOut = (a) => Boolean(a.employee_id && !a.returned_on);

export const whereItIs = (a) => {
  if (a.written_off_on) return 'written off';
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
  const live = assets.filter((a) => !a.written_off_on);
  const out = live.filter(isOut);
  return {
    count: live.length,
    written_off: assets.length - live.length,
    out: out.length,
    in_office: live.length - out.length,
    cost: live.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0),
    out_value: out.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0),
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
    dated: dated || new Date().toISOString().slice(0, 10),
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
