/**
 * The code that goes on the label.
 *
 * A database id is not an asset ID: `47` means nothing written on a laptop, two
 * companies both have a 47, and nobody can read it back to you over the phone.
 * What goes on the sticker is `BNF-LAP-014` — whose it is, what it is, and which
 * one.
 *
 * Three parts, each doing a job:
 *
 *   BNF   the company, so a label found in a drawer says who owns it
 *   LAP   the kind, so "the 014 laptop" is a sentence somebody can say
 *   014   a running number, per company and kind, so the series stays short
 *
 * The number is **never reused.** An asset that was written off keeps its code,
 * because an old service bill or a handover slip still refers to it, and
 * handing `BNF-LAP-014` to a second laptop makes both histories wrong.
 *
 * Dependency-free, like the rest of shared/.
 */

/** Short prefixes for the kinds the pickers offer. */
export const KIND_PREFIX = {
  Laptop: 'LAP',
  Desktop: 'PC',
  Mobile: 'MOB',
  'SIM card': 'SIM',
  'ID card': 'IDC',
  'Access card': 'ACC',
  Vehicle: 'VEH',
  Tools: 'TLS',
  Furniture: 'FUR',
  Other: 'GEN',
};

const LETTERS = /[^A-Z0-9]/g;

/**
 * A company's prefix: the initials of a multi-word name, else its first three
 * letters. BOOKNFLY PRIVATE LIMITED -> BPL; BOOKNFLY -> BOO; SCALE -> SCA.
 */
export function companyPrefix(name) {
  const words = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'GEN';
  if (words.length > 1) return words.map((w) => w[0]).join('').slice(0, 4);
  return words[0].slice(0, 3);
}

/** A kind's prefix: the table above, else the first three letters of whatever was typed. */
export function kindPrefix(kind) {
  if (KIND_PREFIX[kind]) return KIND_PREFIX[kind];
  const letters = String(kind || '').toUpperCase().replace(LETTERS, '');
  return letters.slice(0, 3) || 'GEN';
}

/** `BNF-LAP-014`. The number is padded to three so a list sorts by eye. */
export const formatCode = (company, kind, n) =>
  `${companyPrefix(company)}-${kindPrefix(kind)}-${String(Math.max(1, Number(n) || 1)).padStart(3, '0')}`;

/**
 * The next code in a series.
 *
 * @param taken  every code already used anywhere, however it was spelled
 * @returns the next unused code for this company and kind
 *
 * It reads the highest number already in THIS series rather than counting how
 * many there are, so deleting an asset never hands its number to the next one.
 */
export function nextCode(company, kind, taken = []) {
  const prefix = `${companyPrefix(company)}-${kindPrefix(kind)}-`;
  let highest = 0;
  for (const code of taken) {
    const text = String(code || '').toUpperCase();
    if (!text.startsWith(prefix)) continue;
    const n = Number(text.slice(prefix.length).replace(/\D/g, ''));
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

/**
 * A code somebody typed, tidied. Uppercased and trimmed; a code is a label, so
 * spaces inside it are kept out rather than quietly stored.
 */
export function tidyCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 40);
}

/** What is wrong with a typed code, if anything. Shape only. */
export function codeProblem(value) {
  const code = tidyCode(value);
  if (!code) return 'a code is needed';
  if (code.length < 3) return 'that is too short to read off a label';
  if (!/^[A-Z0-9][A-Z0-9/-]*[A-Z0-9]$/.test(code)) {
    return 'a code is letters, numbers, dashes and slashes';
  }
  return '';
}
