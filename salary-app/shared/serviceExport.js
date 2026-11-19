/**
 * THE MAINTENANCE REPORT, WITH THE COLUMNS SOMEBODY CHOSE.
 *
 * Dinesh: *"maintenance aur service ka bhi aisa hi report option do"* — the
 * same treatment the asset register got.
 *
 * Two reports, because two different questions get asked and one table
 * cannot answer both:
 *
 *   **Every service** — one line per repair: what was done, to what, by whom,
 *   what it cost, when it is due again. This is the bill-by-bill record.
 *
 *   **Every asset** — one line per thing: what it cost to buy, what it has
 *   cost to keep, how many times, when it was last touched, whether it is
 *   under warranty or an AMC. This is the one that answers "is this printer
 *   worth repairing again".
 *
 * The same three rules the asset export follows:
 *
 *   **A FIGURE IS A FIGURE**, so Excel can sum the column.
 *   **A BLANK MEANS "NOT RECORDED"**, and words mean what they say.
 *   **NOTHING NEW IS COMPUTED** — the running cost comes from
 *   shared/maintenance.js, which is what the Maintenance screen itself shows.
 *
 * Dependency-free, like the rest of shared/.
 */

import { groupLabel, groupOf } from './assetGroups.js';

const text = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const day = (v) => text(v).slice(0, 10);

/** One line per service. `[key, label, get, type, group]` */
export const SERVICE_FIELDS = [
  ['serviced_on', 'Date', (s) => day(s.serviced_on), 'date', 'The work'],
  ['kind', 'Kind of work', (s) => text(s.kind), 'text', 'The work'],
  ['work', 'What was done', (s) => text(s.work), 'text', 'The work'],
  ['vendor', 'Who did it', (s) => text(s.vendor), 'text', 'The work'],
  ['invoice_no', 'Invoice', (s) => text(s.invoice_no), 'text', 'The work'],
  ['cost', 'Cost', (s) => num(s.cost) ?? 0, 'money', 'The work'],
  // Words, not a blank: free work under warranty is still work, at zero.
  ['under_warranty', 'Under warranty', (s) => (s.under_warranty ? 'yes' : ''), 'text', 'The work'],
  ['next_service_on', 'Next service', (s) => day(s.next_service_on), 'date', 'The work'],
  ['note', 'Note', (s) => text(s.note), 'text', 'The work'],
  ['logged_by', 'Recorded by', (s) => text(s.logged_by), 'text', 'The work'],

  ['code', 'Asset code', (s) => text(s.code), 'text', 'The asset'],
  ['asset_kind', 'Asset kind', (s) => text(s.asset_kind), 'text', 'The asset'],
  ['group', 'Group', (s) => groupLabel(groupOf(s.asset_kind, s.label)), 'text', 'The asset'],
  ['label', 'Asset', (s) => text(s.label), 'text', 'The asset'],
  ['company_name', 'Company', (s) => text(s.company_name), 'text', 'The asset'],
];

/** One line per asset: what it has cost to own. */
export const OWNERSHIP_FIELDS = [
  ['code', 'Code', (a) => text(a.code), 'text', 'The asset'],
  ['kind', 'Kind', (a) => text(a.kind), 'text', 'The asset'],
  ['group', 'Group', (a) => groupLabel(groupOf(a.kind, a.label)), 'text', 'The asset'],
  ['label', 'What', (a) => text(a.label), 'text', 'The asset'],
  ['identifier', 'Serial / number', (a) => text(a.identifier), 'text', 'The asset'],
  ['company_name', 'Company', (a) => text(a.company_name), 'text', 'The asset'],
  ['department', 'Department', (a) => text(a.department), 'text', 'The asset'],
  ['holder', 'With whom', (a) => (a.employee_id && !a.returned_on ? text(a.employee_name) : ''), 'text', 'The asset'],

  ['purchase_date', 'Bought on', (a) => day(a.purchase_date), 'date', 'What it cost'],
  ['purchase', 'Cost to buy', (a) => num(a.ownership?.purchase) ?? 0, 'money', 'What it cost'],
  ['service', 'Cost to keep', (a) => num(a.ownership?.service) ?? 0, 'money', 'What it cost'],
  ['total', 'Total so far', (a) => num(a.ownership?.total) ?? 0, 'money', 'What it cost'],
  ['times', 'Times serviced', (a) => num(a.ownership?.times) ?? 0, 'number', 'What it cost'],
  [
    'share',
    'Keeping as % of buying',
    (a) => (a.ownership?.service_share === null || a.ownership?.service_share === undefined ? null : a.ownership.service_share),
    'number',
    'What it cost',
  ],
  ['amc_cost', 'AMC cost', (a) => num(a.amc_cost) ?? 0, 'money', 'What it cost'],

  ['last_service_on', 'Last serviced', (a) => day(a.ownership?.last_service_on), 'date', 'When'],
  ['next_service_on', 'Next service', (a) => day(a.ownership?.next_service_on), 'date', 'When'],
  ['warranty_until', 'Warranty until', (a) => day(a.warranty_until), 'date', 'When'],
  ['amc_until', 'AMC until', (a) => day(a.amc_until), 'date', 'When'],
  ['written_off_on', 'Written off', (a) => day(a.written_off_on), 'date', 'When'],
];

export const REPORTS = {
  services: {
    key: 'services',
    label: 'Every service — one line per repair',
    fields: SERVICE_FIELDS,
    defaults: ['serviced_on', 'code', 'label', 'kind', 'work', 'vendor', 'invoice_no', 'cost', 'under_warranty', 'next_service_on'],
    file: 'asset-services',
    sheet: 'Services',
  },
  ownership: {
    key: 'ownership',
    label: 'Every asset — what it has cost to own',
    fields: OWNERSHIP_FIELDS,
    defaults: ['code', 'kind', 'label', 'company_name', 'holder', 'purchase_date', 'purchase', 'service', 'total', 'times', 'last_service_on', 'next_service_on'],
    file: 'asset-ownership',
    sheet: 'Cost of ownership',
  },
};

export const reportFor = (key) => REPORTS[key] || REPORTS.services;

/** The picker's blocks, for whichever report is chosen. */
export function serviceFieldGroups(reportKey = 'services') {
  const out = [];
  for (const [key, label, , type, group] of reportFor(reportKey).fields) {
    let block = out.find((b) => b.name === group);
    if (!block) {
      block = { name: group, fields: [] };
      out.push(block);
    }
    block.fields.push({ key, label, type });
  }
  return out;
}

/** Only known columns, in the catalogue's order; none asked for gives the default. */
export function cleanServiceFields(reportKey, fields) {
  const report = reportFor(reportKey);
  const keys = report.fields.map(([key]) => key);
  const want = new Set((Array.isArray(fields) ? fields : []).filter((f) => keys.includes(f)));
  const kept = keys.filter((key) => want.has(key));
  return kept.length ? kept : [...report.defaults];
}

/** Values, not text: numbers stay numbers so the column adds up. */
export function buildServiceExport(rows = [], { report = 'services', fields } = {}) {
  const spec = reportFor(report);
  const keys = cleanServiceFields(report, fields);
  const columns = keys.map((key) => {
    const found = spec.fields.find(([k]) => k === key);
    return { key, label: found[1], get: found[2], type: found[3] };
  });

  const built = rows.map((row) => columns.map((c) => c.get(row)));
  const totals = columns.map((c, at) =>
    c.type === 'money' ? built.reduce((sum, row) => sum + (Number(row[at]) || 0), 0) : null
  );

  return {
    report: spec.key,
    sheet: spec.sheet,
    file: spec.file,
    columns,
    headers: columns.map((c) => c.label),
    rows: built,
    totals,
    count: built.length,
    has_totals: totals.some((t) => t !== null),
  };
}

const escape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Where the "TOTAL - 12 services" label goes: THE FIRST COLUMN THAT IS NOT
 * ITSELF A TOTAL.
 *
 * It was hard-coded to column one, so a report whose first column is money -
 * which it is the moment somebody ticks Cost, because the columns come out in
 * the catalogue's order - printed the figure and lost the label entirely. The
 * footer read "2400" with no word anywhere saying what it was.
 *
 * Every column a total gives -1, and then there is nowhere to put it.
 */
export const labelColumn = (built) => built.totals.findIndex((t) => t === null);

export function serviceExportCsv(built) {
  const lines = [built.headers.map(escape).join(',')];
  for (const row of built.rows) lines.push(row.map(escape).join(','));
  if (built.has_totals) {
    const what = built.report === 'services' ? 'service' : 'asset';
    const at = labelColumn(built);
    lines.push(
      built.totals
        .map((t, i) =>
          t === null
            ? i === at
              ? escape(`TOTAL — ${built.count} ${what}${built.count === 1 ? '' : 's'}`)
              : ''
            : escape(t)
        )
        .join(',')
    );
  }
  return `﻿${lines.join('\n')}`;
}
