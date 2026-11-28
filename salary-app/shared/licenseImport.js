/**
 * Bringing a list of licences, rent agreements or insurance policies in from
 * a spreadsheet (v2.47.0).
 *
 * The same two rules as the asset import, for the same reasons:
 *
 *  - **A dry run first, always.** Nothing is written until somebody has seen
 *    what would be.
 *  - **A row it cannot place is NAMED, never dropped.**
 *
 * And one of its own:
 *
 *  - **NO LICENCE KEY IS READ FROM A SHEET.** A key never comes back out of
 *    this app once stored - the register shows its last four characters and
 *    nothing more - and a dry run that echoed a column of keys onto a screen
 *    would undo that. A key column is noticed and reported as ignored; keys
 *    are typed on the record.
 *
 * Dependency-free: the caller reads the workbook and hands over plain rows.
 */
import { amountOf, dateOf } from './assetImport.js';
import { LICENSE_KINDS } from './licenses.js';

/** What a column can be called, best name first. The first one present wins. */
export const LICENSE_IMPORT_COLUMNS = [
  ['name', ['name', 'software', 'product', 'licence', 'license', 'licence name', 'license name', 'item', 'policy name', 'agreement', 'premises', 'description', 'particulars']],
  ['kind', ['kind', 'type', 'category', 'licence type', 'license type']],
  ['publisher', ['publisher landlord insurer', 'publisher', 'brand', 'make', 'landlord', 'owner', 'insurer', 'insurance company', 'company name']],
  ['vendor', ['vendor', 'supplier', 'reseller', 'dealer', 'agent', 'broker', 'partner']],
  ['company', ['company', 'firm', 'entity', 'our company', 'branch']],
  ['version', ['version', 'edition', 'plan']],
  ['seats', ['seats', 'users', 'licences', 'licenses', 'qty', 'quantity', 'no of users']],
  ['cost', ['cost', 'amount', 'price', 'premium', 'rent', 'monthly rent', 'fees', 'value']],
  ['purchased_on', ['purchased on', 'purchase date', 'bought', 'bought on', 'date of purchase', 'invoice date']],
  ['starts_on', ['start', 'start date', 'starts on', 'from', 'valid from', 'commencement', 'policy start']],
  ['expires_on', ['expiry', 'expires', 'expiry date', 'expires on', 'valid till', 'valid upto', 'valid until', 'end date', 'renewal date', 'due date', 'to', 'policy end']],
  ['invoice_no', ['invoice policy no', 'invoice', 'invoice no', 'bill no', 'policy no', 'policy number', 'agreement no', 'reference']],
  ['account_email', ['account', 'email', 'login', 'account email', 'registered email']],
  ['responsible', ['responsible', 'owner person', 'handled by', 'person', 'contact person', 'in charge']],
  ['property_address', ['address', 'property', 'property address', 'premises address']],
  ['security_deposit', ['deposit', 'security deposit']],
  ['notice_days', ['notice', 'notice days', 'notice period']],
  ['policy_type', ['policy type', 'cover type', 'insurance type']],
  ['insured_item', ['insured', 'insured item', 'what is insured', 'vehicle', 'asset insured']],
  ['coverage_amount', ['sum insured', 'cover', 'coverage', 'coverage amount', 'idv']],
  ['note', ['note', 'notes', 'remark', 'remarks']],
  // Read only so it can be REPORTED as ignored - see the rule above.
  ['license_key', ['key', 'licence key', 'license key', 'serial key', 'product key', 'activation key']],
];

const PLACEHOLDERS = new Set(['-', '--', '---', 'n/a', 'na', 'nil', 'none', 'null', '.']);
const clean = (v) => {
  const text = String(v ?? '').trim();
  return PLACEHOLDERS.has(text.toLowerCase()) ? '' : text;
};
const key = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Which row is the header, and which column is which - read off the sheet's own words. */
export function detectLicenseLayout(rows = []) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(key);
    const found = {};
    for (const [field, names] of LICENSE_IMPORT_COLUMNS) {
      for (const name of names) {
        const at = cells.indexOf(name);
        if (at >= 0 && !Object.values(found).includes(at)) {
          found[field] = at;
          break;
        }
      }
    }
    if (found.name !== undefined) return { headerRow: r, columns: found };
  }
  return { headerRow: -1, columns: {} };
}

/**
 * What a row is: a licence kind from the list, or a rent agreement / an
 * insurance policy when the words say so. Unrecognised is "Other", shown.
 */
export function licenseKindOf(stated, name, as) {
  if (as === 'rent') return 'Rent agreement';
  if (as === 'insurance') return 'Insurance policy';
  const said = clean(stated).toLowerCase();
  const exact = LICENSE_KINDS.find((k) => k.toLowerCase() === said);
  if (exact) return exact;
  const words = `${said} ${clean(name).toLowerCase()}`;
  if (/\b(rent|lease|leave and licen[cs]e|tenancy)\b/.test(words)) return 'Rent agreement';
  if (/\b(insurance|policy|mediclaim|insured)\b/.test(words)) return 'Insurance policy';
  if (/\btally\b|\bgst\b/.test(words)) return 'Tally / GST utility';
  if (/\b(windows|os|operating system)\b/.test(words)) return 'Operating system';
  if (/\b(office 365|microsoft 365|ms office|office suite|google workspace)\b/.test(words)) return 'Office suite';
  if (/\b(antivirus|quick heal|kaspersky|norton|eset|mcafee)\b/.test(words)) return 'Antivirus';
  if (/\b(domain)\b/.test(words)) return 'Domain name';
  if (/\b(ssl|certificate)\b/.test(words)) return 'SSL certificate';
  if (/\b(hosting|server|vps)\b/.test(words)) return 'Hosting';
  if (/\b(email|mail)\b/.test(words)) return 'Email';
  return 'Other';
}

const sameText = (a, b) => key(a) === key(b) && key(a) !== '';

/**
 * The plan: what would be created, what is already on the register, and what
 * cannot be placed and why. Never writes.
 *
 * @param as  'software' | 'rent' | 'insurance' | '' - which register the
 *            sheet is FOR, when the office knows; '' reads it off each row.
 */
export function planLicenseImport({ rows = [], existing = [], companies = [], employees = [], as = '' } = {}) {
  const { headerRow, columns } = detectLicenseLayout(rows);
  if (headerRow < 0) {
    return { problem: 'No header row found. One column has to be called Name, Software, Product, Policy or Agreement.', create: [], skipped: [] };
  }
  const create = [];
  const skipped = [];
  const similar = [];
  const notes = new Set();
  const cell = (row, field) => (columns[field] === undefined ? '' : row[columns[field]]);
  if (columns.license_key !== undefined) {
    notes.add('A key column was found and IGNORED: keys are typed on each record, so they are never shown on a preview screen.');
  }
  const companyOf = (name) => companies.find((c) => sameText(c.name, name)) || null;
  const personOf = (name) => employees.find((e) => sameText(e.name, name)) || null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.some((v) => clean(v))) continue;
    const line = r + 1;
    const name = clean(cell(row, 'name'));
    if (!name) {
      skipped.push({ line, why: 'no name on this row' });
      continue;
    }
    const kind = licenseKindOf(cell(row, 'kind'), name, as);
    const companyName = clean(cell(row, 'company'));
    const company = companyName ? companyOf(companyName) : null;
    if (companyName && !company) notes.add(`"${companyName}" is not a company here, so those rows come in with no company — set it after.`);
    const responsibleName = clean(cell(row, 'responsible'));
    const responsible = responsibleName ? personOf(responsibleName) : null;
    if (responsibleName && !responsible) notes.add(`"${responsibleName}" is not on the staff list, so nobody is named responsible on those rows.`);

    const purchased = dateOf(cell(row, 'purchased_on'));
    const expires = dateOf(cell(row, 'expires_on'));
    if (purchased && expires && expires < purchased) {
      skipped.push({ line, name, why: `it expires (${expires}) before it was bought (${purchased})` });
      continue;
    }
    const record = {
      name,
      kind,
      publisher: clean(cell(row, 'publisher')) || null,
      vendor: clean(cell(row, 'vendor')) || null,
      company_id: company?.id || null,
      company_name: company?.name || null,
      version: clean(cell(row, 'version')) || null,
      seats: clean(cell(row, 'seats')) ? Math.max(0, Math.round(amountOf(cell(row, 'seats')))) : null,
      cost: clean(cell(row, 'cost')) ? amountOf(cell(row, 'cost')) : null,
      purchased_on: purchased || null,
      starts_on: dateOf(cell(row, 'starts_on')) || null,
      expires_on: expires || null,
      invoice_no: clean(cell(row, 'invoice_no')) || null,
      account_email: clean(cell(row, 'account_email')) || null,
      responsible_id: responsible?.id || null,
      responsible_name: responsible?.name || null,
      property_address: clean(cell(row, 'property_address')) || null,
      security_deposit: clean(cell(row, 'security_deposit')) ? amountOf(cell(row, 'security_deposit')) : null,
      notice_days: clean(cell(row, 'notice_days')) ? Math.round(amountOf(cell(row, 'notice_days'))) : null,
      policy_type: clean(cell(row, 'policy_type')) || null,
      insured_item: clean(cell(row, 'insured_item')) || null,
      coverage_amount: clean(cell(row, 'coverage_amount')) ? amountOf(cell(row, 'coverage_amount')) : null,
      note: clean(cell(row, 'note')) || null,
      // A dated record renews; an undated one is bought once.
      term: expires ? 'subscription' : 'perpetual',
      line,
    };
    if (record.cost !== null && record.cost < 0) {
      skipped.push({ line, name, why: 'a negative cost' });
      continue;
    }
    // Already here: same name, same company, same end date. Not a second one.
    const twin = [...existing, ...create, ...similar].find(
      (e) =>
        sameText(e.name, name) &&
        String(e.company_id || '') === String(record.company_id || '') &&
        String(e.expires_on || '') === String(record.expires_on || '')
    );
    if (twin) {
      skipped.push({ line, name, why: twin.line ? `the same as row ${twin.line}` : 'already on the register' });
      continue;
    }
    /*
     * SAME NAME, SAME COMPANY, A DIFFERENT END DATE is most likely the same
     * licence a term later - which is a renewal of the record already here,
     * not a second record. Held back and named; added only if asked.
     */
    const near = existing.find(
      (e) => sameText(e.name, name) && String(e.company_id || '') === String(record.company_id || '') && !e.cancelled_on
    );
    if (near) {
      similar.push({ ...record, existing_id: near.id, existing_expires_on: near.expires_on || null });
      continue;
    }
    create.push(record);
  }

  const byKind = {};
  for (const c of create) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  return {
    header_row: headerRow + 1,
    columns: Object.keys(columns).filter((c) => c !== 'license_key'),
    create,
    skipped,
    similar,
    by_kind: byKind,
    notes: [...notes],
  };
}

/** The headings of the blank template, one per field the import reads. */
export const LICENSE_TEMPLATE_HEADINGS = [
  'Name', 'Type', 'Publisher / Landlord / Insurer', 'Vendor', 'Company', 'Version', 'Seats', 'Cost',
  'Purchase date', 'Start date', 'Expiry date', 'Invoice / Policy no', 'Account email', 'Responsible',
  'Property address', 'Security deposit', 'Notice days', 'Policy type', 'Insured item', 'Sum insured', 'Remarks',
];
