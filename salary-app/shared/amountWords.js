/**
 * An amount in words, the Indian way: lakh and crore, not million.
 *
 * A voucher that goes to accounts needs the figure spelled out - that is what
 * stops 42,000 becoming 4,20,000 between the office and the bank, and it is
 * the one line every accountant checks first.
 *
 * Paise are included only when there are any. "Forty Two Thousand Rupees and
 * Fifty Paise Only" is right; "...and Zero Paise Only" is somebody who has not
 * thought about it.
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0-99. Everything above is built out of this and a place name. */
const under100 = (n) => (n < 20 ? ONES[n] : [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(' '));

/** 0-999, which is the size of every group except the first. */
const under1000 = (n) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', under100(n % 100)].filter(Boolean).join(' ');

/**
 * A whole number in the Indian grouping: crore, lakh, thousand, hundred.
 *
 * Past ninety-nine crore it keeps counting in crore rather than inventing a
 * bigger word, because there is no agreed one and a payroll will never need it.
 */
export function wholeInWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return 'Zero';

  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  if (crore) parts.push(`${wholeInWords(crore)} Crore`);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}

/**
 * The full line for a voucher.
 *
 * @example inWords(42000)    -> 'Rupees Forty Two Thousand Only'
 * @example inWords(1234.50)  -> 'Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only'
 */
export function inWords(value, { currency = 'Rupees' } = {}) {
  const amount = Number(value) || 0;
  const negative = amount < 0;
  /*
   * To paise first, so a fraction of one does not become its own line.
   *
   * A binary float cannot hold every two-decimal amount exactly - 1.005 is
   * stored a hair UNDER and rounds down. Nothing in this app reaches here with
   * one: an asset's cost is whole rupees by the time a voucher asks, and a
   * salary is rounded long before. Said out loud rather than papered over with
   * an epsilon that would be wrong in the other direction.
   */
  const total = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(total / 100);
  const paise = total % 100;

  const words = [currency, wholeInWords(rupees)];
  if (paise) words.push('and', under100(paise), 'Paise');
  words.push('Only');
  return `${negative ? 'Minus ' : ''}${words.join(' ')}`;
}
