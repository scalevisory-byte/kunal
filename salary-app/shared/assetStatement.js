/**
 * THE WHOLE ASSET REGISTER AS ONE STATEMENT — "total asset ka register".
 *
 * Dinesh asked for the register itself after the per-person ledger: the
 * document you hand to the accountant or the auditor, where every asset is
 * listed under its company and its group, each block adds up, and the page
 * ends with one figure for everything the business owns.
 *
 * The REGISTER SCREEN is for working on: filters, search, cells you type in.
 * This is for reading and printing, which is a different job — so it is laid
 * out by company, subtotalled, and it tells you what it could not tell you.
 *
 * THREE RULES.
 *
 *   **EVERY FIGURE IS WHAT IT COST TO BUY, and the page says so.** There is no
 *   depreciation in this app — Dinesh dropped it deliberately — so this is a
 *   register at cost, not a book value, and it must never be read as one. A
 *   made-up rate would price every line wrongly while looking authoritative.
 *
 *   **WRITTEN-OFF ASSETS ARE SHOWN APART, NEVER MIXED IN.** They are still on
 *   the register and still carry their code, and a total that folded them in
 *   would overstate what the business holds.
 *
 *   **WHAT IS MISSING IS COUNTED, NOT HIDDEN.** Assets with no cost, no code,
 *   no company and no purchase date are each counted at the foot, because a
 *   register that silently drops them is how a total comes out short and
 *   nobody knows why.
 *
 * Dependency-free, like the rest of shared/.
 */

import { groupLabel, groupOf } from './assetGroups.js';
import { isOut } from './assetReport.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const NO_COMPANY = 'Not against a company';

/**
 * The statement.
 *
 * @param assets   the register, written-off ones included
 * @param options  `by` — 'company' (default) or 'group': which way to block it
 */
export function assetStatement(assets = [], { by = 'company' } = {}) {
  const live = assets.filter((a) => !a.written_off_on);
  const gone = assets.filter((a) => a.written_off_on);

  const blockKey = (a) =>
    by === 'group' ? groupLabel(groupOf(a.kind, a.label)) : a.company_name || NO_COMPANY;
  const innerKey = (a) =>
    by === 'group' ? a.company_name || NO_COMPANY : groupLabel(groupOf(a.kind, a.label));

  const blocks = new Map();
  for (const asset of live) {
    const key = blockKey(asset);
    if (!blocks.has(key)) blocks.set(key, { name: key, rows: [], groups: new Map(), count: 0, cost: 0, out: 0, out_cost: 0 });
    const block = blocks.get(key);
    const cost = num(asset.purchase_cost);
    const out = isOut(asset);

    block.rows.push({
      id: asset.id,
      code: asset.code || '',
      old_code: asset.old_code || '',
      kind: asset.kind || '',
      label: asset.label || '',
      identifier: asset.identifier || '',
      group: groupLabel(groupOf(asset.kind, asset.label)),
      company_name: asset.company_name || '',
      department: asset.department || '',
      location: asset.location || '',
      purchase_date: String(asset.purchase_date || '').slice(0, 10),
      vendor: asset.vendor || '',
      invoice_no: asset.invoice_no || '',
      warranty_until: String(asset.warranty_until || '').slice(0, 10),
      // Who has it, or where it is. Nobody against it means the office, which
      // is a place - not a missing asset.
      holder: out ? asset.employee_name || 'somebody' : '',
      where: out ? 'with staff' : 'in the office',
      cost,
    });

    const inner = innerKey(asset);
    if (!block.groups.has(inner)) block.groups.set(inner, { name: inner, count: 0, cost: 0 });
    const g = block.groups.get(inner);
    g.count += 1;
    g.cost += cost;

    block.count += 1;
    block.cost += cost;
    if (out) {
      block.out += 1;
      block.out_cost += cost;
    }
  }

  const ordered = [...blocks.values()]
    .map((b) => ({
      ...b,
      groups: [...b.groups.values()].sort((x, y) => y.cost - x.cost || x.name.localeCompare(y.name)),
      rows: b.rows.sort(
        (x, y) =>
          x.group.localeCompare(y.group) ||
          String(x.code).localeCompare(String(y.code)) ||
          x.label.localeCompare(y.label)
      ),
    }))
    .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));

  const missing = {
    no_cost: live.filter((a) => !num(a.purchase_cost)).length,
    no_code: live.filter((a) => !a.code).length,
    no_company: live.filter((a) => !a.company_name).length,
    no_purchase_date: live.filter((a) => !a.purchase_date).length,
  };

  return {
    by,
    blocks: ordered,
    totals: {
      count: live.length,
      cost: live.reduce((sum, a) => sum + num(a.purchase_cost), 0),
      out: live.filter(isOut).length,
      out_cost: live.filter(isOut).reduce((sum, a) => sum + num(a.purchase_cost), 0),
      in_office: live.filter((a) => !isOut(a)).length,
    },
    // Apart, always: these are not part of what the business holds.
    written_off: {
      count: gone.length,
      cost: gone.reduce((sum, a) => sum + num(a.purchase_cost), 0),
      rows: gone
        .map((a) => ({
          id: a.id,
          code: a.code || '',
          label: `${a.kind || ''} ${a.label || ''}`.trim(),
          written_off_on: String(a.written_off_on).slice(0, 10),
          why: a.written_off_why || '',
          cost: num(a.purchase_cost),
        }))
        .sort((x, y) => String(y.written_off_on).localeCompare(String(x.written_off_on))),
    },
    missing,
  };
}

/** One line per asset, in the order the statement prints them. */
export const STATEMENT_COLUMNS = [
  ['Company', (r) => r.company_name],
  ['Group', (r) => r.group],
  ['Code', (r) => r.code],
  ['Old code', (r) => r.old_code],
  ['Kind', (r) => r.kind],
  ['What', (r) => r.label],
  ['Serial', (r) => r.identifier],
  ['Department', (r) => r.department],
  ['Where it is', (r) => r.where],
  ['With', (r) => r.holder],
  ['Location', (r) => r.location],
  ['Bought', (r) => r.purchase_date],
  ['Vendor', (r) => r.vendor],
  ['Invoice', (r) => r.invoice_no],
  ['Warranty until', (r) => r.warranty_until],
  ['Cost to buy', (r) => r.cost],
];

const escape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The statement as a CSV, subtotals and all.
 *
 * The subtotal rows are deliberately IN the file: this is the register as a
 * document, and somebody opening it in Excel wants the same blocks they saw
 * on screen. The plain row-per-asset export is still Register (CSV).
 */
export function statementCsv(statement) {
  const out = [STATEMENT_COLUMNS.map(([head]) => escape(head)).join(',')];
  for (const block of statement.blocks) {
    for (const row of block.rows) {
      out.push(STATEMENT_COLUMNS.map(([, get]) => escape(get(row))).join(','));
    }
    out.push(
      [escape(`${block.name} — ${block.count} asset${block.count === 1 ? '' : 's'}`), ...Array(STATEMENT_COLUMNS.length - 2).fill(''), escape(block.cost)].join(',')
    );
    out.push('');
  }
  out.push(
    [escape(`TOTAL — ${statement.totals.count} asset${statement.totals.count === 1 ? '' : 's'}`), ...Array(STATEMENT_COLUMNS.length - 2).fill(''), escape(statement.totals.cost)].join(',')
  );
  if (statement.written_off.count) {
    out.push(
      [escape(`Written off — ${statement.written_off.count} asset${statement.written_off.count === 1 ? '' : 's'} (not in the total above)`), ...Array(STATEMENT_COLUMNS.length - 2).fill(''), escape(statement.written_off.cost)].join(',')
    );
  }
  return `﻿${out.join('\n')}`;
}
