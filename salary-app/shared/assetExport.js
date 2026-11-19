/**
 * THE ASSET EXPORT, WITH THE COLUMNS SOMEBODY CHOSE.
 *
 * Dinesh: *"export data in proper form, with each asset detail — kiske paas
 * he, kahaan he, kya he, purchase date, purchase cost, full report"*, and
 * *"report me option bhi dena, kya-kya chahiye report me"*.
 *
 * The register already exported a FIXED seventeen columns. Every real request
 * for a report is a different set — the accountant wants cost, date, vendor
 * and invoice; the store keeper wants who has it and where; the auditor wants
 * all of it. So the columns are a catalogue somebody ticks.
 *
 * THREE RULES.
 *
 *   **A FIGURE IS A FIGURE, NOT A STRING.** `purchase_cost` goes out as a
 *   number so Excel can sum the column. The old register export formatted it
 *   with commas, which is a sentence as far as a spreadsheet is concerned and
 *   is why a column of costs would not add up.
 *
 *   **A BLANK CELL MEANS "NOT RECORDED", AND WORDS MEAN WHAT THEY SAY.**
 *   "in the office" is an answer and is written out; an empty cell is a thing
 *   nobody filled in. The two must not look alike.
 *
 *   **NOTHING IS COMPUTED THAT THE APP DOES NOT ALREADY KNOW.** The group
 *   comes from shared/assetGroups.js, where it is worked out from the kind;
 *   the warranty days come from the same arithmetic the register's alerts
 *   use. No second opinion gets invented for an export.
 *
 * Dependency-free, like the rest of shared/.
 */

import { groupLabel, groupOf } from './assetGroups.js';
import { isOut, whereItIs } from './assetReport.js';
import { daysUntil } from './assetAlerts.js';

const text = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const day = (v) => text(v).slice(0, 10);

/**
 * Every column that can be asked for.
 *
 * `[key, label, get, type, group]` — the group is only so the picker can show
 * them in blocks rather than as a list of forty tick boxes.
 */
export const ASSET_FIELDS = [
  /* what it is */
  ['code', 'Code', (a) => text(a.code), 'text', 'What it is'],
  ['old_code', 'Old code', (a) => text(a.old_code), 'text', 'What it is'],
  ['kind', 'Kind', (a) => text(a.kind), 'text', 'What it is'],
  ['group', 'Group', (a) => groupLabel(groupOf(a.kind, a.label)), 'text', 'What it is'],
  ['label', 'What', (a) => text(a.label), 'text', 'What it is'],
  ['brand', 'Brand', (a) => text(a.brand), 'text', 'What it is'],
  ['model', 'Model', (a) => text(a.model), 'text', 'What it is'],
  ['identifier', 'Serial / number', (a) => text(a.identifier), 'text', 'What it is'],
  ['description', 'Description', (a) => text(a.description), 'text', 'What it is'],

  /* whose, and where */
  ['company_name', 'Company', (a) => text(a.company_name), 'text', 'Whose, and where'],
  ['branch_name', 'Branch', (a) => text(a.branch_name), 'text', 'Whose, and where'],
  ['department', 'Department', (a) => text(a.department), 'text', 'Whose, and where'],
  ['location', 'Location', (a) => text(a.location), 'text', 'Whose, and where'],
  ['floor_room', 'Floor / room', (a) => text(a.floor_room), 'text', 'Whose, and where'],
  // Words, not a blank: "in the office" is an answer.
  ['where', 'Where it is', (a) => whereItIs(a), 'text', 'Whose, and where'],
  ['holder', 'With whom', (a) => (isOut(a) ? text(a.employee_name) : ''), 'text', 'Whose, and where'],
  ['issued_on', 'Issued on', (a) => (isOut(a) ? day(a.issued_on) : ''), 'date', 'Whose, and where'],
  ['returned_on', 'Returned on', (a) => day(a.returned_on), 'date', 'Whose, and where'],
  ['condition', 'Condition', (a) => text(a.condition), 'text', 'Whose, and where'],
  ['handovers', 'Times handed over', (a) => num(a.handovers) ?? 0, 'number', 'Whose, and where'],

  /* what it cost */
  ['purchase_date', 'Bought on', (a) => day(a.purchase_date), 'date', 'What it cost'],
  // A NUMBER, so the column adds up in Excel.
  ['purchase_cost', 'Cost to buy', (a) => num(a.purchase_cost) ?? 0, 'money', 'What it cost'],
  ['vendor', 'Vendor', (a) => text(a.vendor), 'text', 'What it cost'],
  ['invoice_no', 'Invoice', (a) => text(a.invoice_no), 'text', 'What it cost'],
  ['purchase_remarks', 'Purchase remarks', (a) => text(a.purchase_remarks), 'text', 'What it cost'],
  ['documents', 'Papers attached', (a) => num(a.documents) ?? 0, 'number', 'What it cost'],

  /* cover */
  ['warranty_from', 'Warranty from', (a) => day(a.warranty_from), 'date', 'Warranty and AMC'],
  ['warranty_until', 'Warranty until', (a) => day(a.warranty_until), 'date', 'Warranty and AMC'],
  [
    'warranty_days',
    'Warranty days left',
    (a, { today } = {}) => (a.warranty_until ? daysUntil(a.warranty_until, today) : null),
    'number',
    'Warranty and AMC',
  ],
  ['warranty_provider', 'Warranty by', (a) => text(a.warranty_provider), 'text', 'Warranty and AMC'],
  ['amc_until', 'AMC until', (a) => day(a.amc_until), 'date', 'Warranty and AMC'],
  ['amc_vendor', 'AMC by', (a) => text(a.amc_vendor), 'text', 'Warranty and AMC'],
  ['amc_cost', 'AMC cost', (a) => num(a.amc_cost) ?? 0, 'money', 'Warranty and AMC'],

  /* what has happened to it */
  ['state', 'Marked as', (a) => text(a.state), 'text', 'What has happened'],
  ['state_since', 'Marked since', (a) => day(a.state_since), 'date', 'What has happened'],
  ['written_off_on', 'Written off on', (a) => day(a.written_off_on), 'date', 'What has happened'],
  ['written_off_why', 'Written off why', (a) => text(a.written_off_why), 'text', 'What has happened'],
  ['note', 'Note', (a) => text(a.note), 'text', 'What has happened'],
];

export const FIELD_KEYS = ASSET_FIELDS.map(([key]) => key);
export const fieldLabel = (key) => ASSET_FIELDS.find(([k]) => k === key)?.[1] || key;
export const fieldType = (key) => ASSET_FIELDS.find(([k]) => k === key)?.[3] || 'text';

/** The picker shows them in blocks, in the order above. */
export function fieldGroups() {
  const out = [];
  for (const [key, label, , type, group] of ASSET_FIELDS) {
    let block = out.find((b) => b.name === group);
    if (!block) {
      block = { name: group, fields: [] };
      out.push(block);
    }
    block.fields.push({ key, label, type });
  }
  return out;
}

/**
 * What a report starts with: what it is, whose it is, where it is, and what
 * it cost — the four things Dinesh named.
 */
export const DEFAULT_FIELDS = [
  'code', 'kind', 'group', 'label', 'identifier',
  'company_name', 'department', 'where', 'holder',
  'purchase_date', 'purchase_cost', 'vendor', 'invoice_no',
  'warranty_until',
];

/** Only the known ones, in the catalogue's own order, never the caller's. */
export function cleanFields(fields) {
  const want = new Set((Array.isArray(fields) ? fields : []).filter((f) => FIELD_KEYS.includes(f)));
  const kept = FIELD_KEYS.filter((key) => want.has(key));
  return kept.length ? kept : [...DEFAULT_FIELDS];
}

/**
 * The rows, as values — not as text.
 *
 * Numbers stay numbers and dates stay ISO strings, so whatever writes the
 * file (a CSV, a spreadsheet) decides how they look. Formatting here is how a
 * column of costs stops adding up.
 */
export function buildAssetExport(assets = [], { fields, today } = {}) {
  const keys = cleanFields(fields);
  const columns = keys.map((key) => {
    const found = ASSET_FIELDS.find(([k]) => k === key);
    return { key, label: found[1], get: found[2], type: found[3] };
  });

  const rows = assets.map((asset) => columns.map((c) => c.get(asset, { today })));

  /* A total under each money column, and nothing under the rest. */
  const totals = columns.map((c, at) =>
    c.type === 'money' ? rows.reduce((sum, row) => sum + (Number(row[at]) || 0), 0) : null
  );

  return {
    columns,
    headers: columns.map((c) => c.label),
    rows,
    totals,
    count: rows.length,
    // True where there is anything worth totalling, so the writer knows
    // whether to put a footer on at all.
    has_totals: totals.some((t) => t !== null),
  };
}

/** "1 asset", not "1 assets" — it is on a page somebody hands to an auditor. */
const assets = (n) => `${n} asset${n === 1 ? '' : 's'}`;

const escape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a BOM, so Excel opens it with the rupee signs intact. */
export function assetExportCsv(built) {
  const lines = [built.headers.map(escape).join(',')];
  for (const row of built.rows) lines.push(row.map(escape).join(','));
  if (built.has_totals) {
    lines.push(
      built.totals
        .map((t, at) => (t === null ? (at === 0 ? escape(`TOTAL — ${assets(built.count)}`) : '') : escape(t)))
        .join(',')
    );
  }
  return `﻿${lines.join('\n')}`;
}
