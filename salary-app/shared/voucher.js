import { inWords } from './amountWords.js';

/**
 * The purchase voucher for an asset.
 *
 * Dinesh's rule, and the reason this exists: **accounts does not release money
 * for a thing that is not on the register.** So the voucher is not a form
 * somebody fills in - it is printed FROM the register, and it can only exist
 * because the asset already does. Its number carries the asset's own code, so
 * a voucher cannot be written for something that was never entered.
 *
 * It is deliberately not a new table. A voucher is a view of an asset: the
 * same row, laid out for the person who has to pay for it. Storing it twice is
 * how a voucher and a register come to disagree about an amount.
 */

/** April to March, written the way every Indian invoice writes it. */
export function financialYear(date) {
  const d = new Date(`${String(date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}T00:00:00`);
  const year = Number.isFinite(d.getTime()) ? d.getFullYear() : new Date().getFullYear();
  const month = Number.isFinite(d.getTime()) ? d.getMonth() + 1 : new Date().getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * The voucher's number, worked out rather than stored.
 *
 * Worked out means reprinting gives the same number, which is the whole point:
 * accounts files it once, and a second copy of the same voucher is the same
 * voucher rather than a second claim on the same money.
 */
export function voucherNo(asset = {}) {
  const code = String(asset.code || '').trim().toUpperCase();
  if (!code) return '';
  return `AV/${financialYear(asset.purchase_date || asset.created_at)}/${code}`;
}

/**
 * Everything the voucher prints, and nothing it does not.
 *
 * `payable` is what accounts is being asked for; `missing` is what it will ask
 * about first. Both are stated rather than left for somebody to notice - a
 * voucher that goes back for a missing invoice number costs a week.
 */
export function voucher(asset = {}, { today } = {}) {
  const cost = Math.round(Number(asset.purchase_cost) || 0);
  const date = today || new Date().toISOString().slice(0, 10);

  const missing = [];
  if (!asset.code) missing.push('an asset code');
  if (!cost) missing.push('what it cost');
  if (!asset.vendor) missing.push('the vendor');
  if (!asset.invoice_no) missing.push('the invoice number');
  if (!asset.purchase_date) missing.push('the purchase date');

  return {
    no: voucherNo(asset),
    dated: date,
    company: asset.company_name || '',
    branch: asset.branch_name || '',
    code: asset.code || '',
    what: [asset.kind, asset.label].filter(Boolean).join(' — '),
    identifier: asset.identifier || '',
    vendor: asset.vendor || '',
    invoice_no: asset.invoice_no || '',
    purchase_date: asset.purchase_date || '',
    warranty_until: asset.warranty_until || '',
    amount: cost,
    amount_in_words: inWords(cost),
    // Where it is going, so the voucher says who is accountable for it.
    holder: asset.employee_name || '',
    missing,
    // A voucher with a gap still prints - accounts can chase one field. It
    // simply says so on its face rather than looking complete and not being.
    complete: missing.length === 0,
  };
}
