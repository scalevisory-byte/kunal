/**
 * Bringing an existing asset list in from a spreadsheet.
 *
 * Every office that has been running a while already has this list in Excel.
 * Typing a hundred and twenty laptops in by hand is how it never gets done at
 * all, so this reads the sheet the office already keeps.
 *
 * Dependency-free: the caller reads the workbook (ExcelJS on the server,
 * SheetJS for an older .xls) and hands over plain rows, exactly as the punch
 * importer does.
 *
 * Two rules it is built around:
 *
 *  - **A dry run first, always.** Nothing is written until somebody has seen
 *    what would be. An import that silently creates two hundred duplicates is
 *    worse than no import.
 *  - **A row it cannot place is NAMED, never dropped.** Skipping the four
 *    rows with no label leaves somebody believing a hundred and twenty came
 *    in when a hundred and sixteen did.
 */

/** What a column can be called. The first one found wins. */
export const ASSET_COLUMNS = [
  ['label', ['asset', 'asset name', 'name', 'item', 'description', 'particulars', 'label']],
  ['kind', ['kind', 'type', 'category', 'asset type']],
  /*
   * NOT 'sr no'. In an Indian office's spreadsheet that is the row number in
   * column A, not the asset's serial - and reading it as one matched every
   * asset to the wrong thing. 'Serial No' is a different column entirely.
   */
  ['identifier', ['serial', 'serial no', 'serial number', 'imei', 'identifier', 'sim', 'sim no']],
  ['code', ['code', 'asset code', 'tag', 'asset id', 'asset no']],
  ['company', ['company', 'firm', 'entity', 'branch']],
  ['purchase_cost', ['cost', 'value', 'amount', 'purchase cost', 'price', 'rate']],
  ['purchase_date', ['purchase date', 'bought', 'date of purchase', 'bill date', 'date']],
  ['vendor', ['vendor', 'supplier', 'seller', 'party', 'shop']],
  ['invoice_no', ['invoice', 'invoice no', 'bill no', 'bill number']],
  ['warranty_until', ['warranty', 'warranty until', 'warranty upto', 'guarantee']],
  ['holder', ['holder', 'issued to', 'given to', 'employee', 'staff', 'user', 'with']],
  ['note', ['note', 'notes', 'remark', 'remarks']],
];

const clean = (v) => String(v ?? '').trim();
const key = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Which row is the header, and which column is which.
 *
 * Read off the sheet's own words rather than assumed, because every office
 * lays this out differently - and the header is rarely row 1, since these
 * files start with a title and a blank line.
 */
export function detectLayout(rows = []) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(key);
    const found = {};
    for (const [field, names] of ASSET_COLUMNS) {
      const at = cells.findIndex((c) => c && names.includes(c));
      if (at >= 0 && found[field] === undefined) found[field] = at;
    }
    // A label column is the one thing an asset cannot do without.
    if (found.label !== undefined) return { headerRow: r, columns: found };
  }
  return { headerRow: -1, columns: {} };
}

const KINDS = {
  laptop: ['laptop', 'notebook', 'macbook'],
  desktop: ['desktop', 'pc', 'computer', 'cpu'],
  phone: ['phone', 'mobile', 'handset', 'smartphone'],
  sim: ['sim', 'sim card'],
  printer: ['printer', 'scanner', 'mfp'],
  furniture: ['chair', 'table', 'desk', 'cabinet', 'almirah', 'furniture'],
  vehicle: ['bike', 'scooter', 'car', 'vehicle'],
  monitor: ['monitor', 'screen', 'display'],
};

/** A kind from what the sheet says, or from the item's own name. */
export function kindOf(stated, label) {
  const said = key(stated);
  if (said) {
    for (const [kind, words] of Object.entries(KINDS)) {
      if (words.some((w) => said.includes(w))) return kind;
    }
    return said.replace(/\s+/g, '-');
  }
  const name = key(label);
  for (const [kind, words] of Object.entries(KINDS)) {
    if (words.some((w) => name.includes(w))) return kind;
  }
  return 'other';
}

/** "₹ 42,000.00" -> 42000. Anything unreadable is nothing, never a guess. */
export function amountOf(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const digits = String(value).replace(/[^0-9.-]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** A date the sheet can state several ways; unreadable is blank, not today. */
export function dateOf(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = clean(value);
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    // Day first: this is an Indian office's spreadsheet, not an American one.
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
}

const sameName = (a, b) => key(a) === key(b) && key(a) !== '';

/**
 * What the file would do, before it does anything.
 *
 * `existing` is the register as it stands, `employees` the staff list, so a
 * row can be matched to an asset already on file and a holder to a real
 * person. Matching is on the CODE first and the serial second - two laptops
 * can share a model name, they cannot share a serial.
 */
export function planAssetImport({ rows = [], existing = [], employees = [], companies = [] } = {}) {
  const { headerRow, columns } = detectLayout(rows);
  if (headerRow < 0) {
    return {
      headerRow: -1,
      columns: {},
      create: [],
      update: [],
      skipped: [],
      problem:
        'No header row found. The sheet needs a column called Asset, Item, Name or Description.',
    };
  }

  const byCode = new Map(existing.filter((a) => a.code).map((a) => [key(a.code), a]));
  const bySerial = new Map(existing.filter((a) => a.identifier).map((a) => [key(a.identifier), a]));

  const create = [];
  const update = [];
  const skipped = [];
  const seen = new Set();

  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r] || [];
    const at = (field) => (columns[field] === undefined ? '' : cells[columns[field]]);
    const label = clean(at('label'));
    const code = clean(at('code'));
    const identifier = clean(at('identifier'));

    // A blank line in the middle of a sheet is normal and is not a problem.
    if (!label && !code && !identifier && !clean(at('purchase_cost'))) continue;

    /*
     * A total row, wherever it says so. Real sheets put TOTAL in column A, not
     * in the asset column, so checking only the label read it as "no asset
     * name" - true, but it told nobody that the line they were missing is the
     * one that was supposed to be missing.
     *
     * Its SUM carries a cached result, so importing one gives an asset worth
     * the whole register. The same trap the salary sheet importer hit.
     */
    if (cells.slice(0, 3).some((c) => /^(total|grand total|sub ?total)$/i.test(clean(c)))) {
      skipped.push({ row: r + 1, why: 'a total row', code, identifier });
      continue;
    }
    if (!label) {
      skipped.push({ row: r + 1, why: 'no asset name', code, identifier });
      continue;
    }

    /*
     * The same asset twice IN THE FILE must not quietly become two assets.
     *
     * Both the code AND the serial are tracked, not whichever the row happens
     * to carry: one line with a code and another with the same serial and no
     * code are the same laptop, and keying on "code or serial" let that pair
     * straight through.
     */
    const marks = [key(code), key(identifier)].filter(Boolean);
    if (marks.some((m) => seen.has(m))) {
      skipped.push({ row: r + 1, why: 'the same code or serial appears earlier in this file', code, identifier });
      continue;
    }
    for (const m of marks) seen.add(m);

    const holderName = clean(at('holder'));
    const holder = holderName
      ? employees.find((e) => sameName(e.name, holderName)) || null
      : null;
    const companyName = clean(at('company'));
    const company = companyName
      ? companies.find((c) => sameName(c.name, companyName)) || null
      : null;

    const asset = {
      row: r + 1,
      label,
      code,
      kind: kindOf(at('kind'), label),
      identifier,
      purchase_cost: amountOf(at('purchase_cost')),
      purchase_date: dateOf(at('purchase_date')),
      vendor: clean(at('vendor')),
      invoice_no: clean(at('invoice_no')),
      warranty_until: dateOf(at('warranty_until')),
      note: clean(at('note')),
      company_id: company?.id ?? null,
      company_name: company?.name || companyName,
      employee_id: holder?.id ?? null,
      holder_name: holderName,
      // A name the staff list does not have is reported, not invented and not
      // silently dropped - somebody is holding that laptop.
      holder_unknown: Boolean(holderName && !holder),
      company_unknown: Boolean(companyName && !company),
    };

    /*
     * Matched on the CODE first and the serial second. Two laptops can share a
     * model name; they cannot share a serial.
     *
     * A row with NEITHER cannot be matched at all, so importing the same file
     * twice would make a second one. It is still created - it is a real chair -
     * but it is named in `unmatchable` so that is a known fact rather than a
     * surprise next month. Guessing on the name instead would be worse: an
     * office with four "Office chair" rows really does have four chairs.
     */
    asset.unmatchable = !code && !identifier;
    const already = byCode.get(key(code)) || bySerial.get(key(identifier));
    if (already) update.push({ ...asset, id: already.id, was: already });
    else create.push(asset);
  }

  return {
    headerRow,
    columns,
    create,
    update,
    skipped,
    problem: '',
    holders_unknown: [...create, ...update].filter((a) => a.holder_unknown),
    // No code and no serial: nothing to recognise it by on a second import.
    unmatchable: create.filter((a) => a.unmatchable),
    companies_unknown: [...create, ...update].filter((a) => a.company_unknown),
  };
}
