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

/* ===================================================================== *
 * The company-wide series: BNF-ASSETS-000001
 * ===================================================================== */

/*
 * A SECOND FORMAT, ON PURPOSE - not a replacement.
 *
 * Dinesh asked for BNF-ASSETS-000001: one running series per COMPANY, six
 * digits, the middle word fixed. The older BNF-LAP-014 runs per company AND
 * kind, which keeps each series short and says what the thing is.
 *
 * His register already carries thousands of BNF-Assets-2456 stickers, so the
 * company series is what new assets join. The kind series is kept because
 * codes issued under it are on real labels and must keep meaning what they
 * mean - nothing is renumbered, ever.
 */

export const SERIES_WORD = 'ASSETS';
export const SERIES_DIGITS = 6;

/** `BNF-ASSETS-000001`. */
export const formatSeriesCode = (prefix, n, { word = SERIES_WORD, digits = SERIES_DIGITS } = {}) =>
  `${String(prefix || 'GEN').toUpperCase()}-${word}-${String(Math.max(1, Number(n) || 1)).padStart(digits, '0')}`;

/**
 * The next number in a company's series.
 *
 * READS THE HIGHEST ALREADY USED, never a count. Counting would hand a
 * deleted asset's number to the next one, and an old service bill or a signed
 * handover slip still names it. His own imported codes count towards the
 * highest too - BNF-Assets-2456 is in this series, so the next new asset is
 * 2457 and cannot collide with a sticker already on a desk.
 *
 * Any number of digits is read, not just six: the imported ones are four.
 */
export function nextSeriesNumber(prefix, taken = [], { word = SERIES_WORD } = {}) {
  const head = `${String(prefix || 'GEN').toUpperCase()}-${word}-`;
  let highest = 0;
  for (const code of taken) {
    const text = String(code || '').toUpperCase();
    if (!text.startsWith(head)) continue;
    const tail = text.slice(head.length);
    // Only a plain number counts. BNF-ASSETS-000012-A is somebody's own
    // spelling, not this series, and must not push the counter to 12.
    if (!/^\d+$/.test(tail)) continue;
    const n = Number(tail);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest + 1;
}

/** The next code in a company's series. */
export const nextSeriesCode = (prefix, taken = [], opts = {}) =>
  formatSeriesCode(prefix, nextSeriesNumber(prefix, taken, opts), opts);

/**
 * A company's prefix as the office set it, falling back to initials.
 *
 * Blank is not an error and not a reason to refuse an asset - it means
 * nobody has chosen one, and initials are a better answer than stopping.
 */
export const prefixFor = (company) =>
  tidyPrefix(company?.asset_prefix) || companyPrefix(company?.name);

/**
 * A prefix somebody typed. Letters and digits only, up to six - it is the
 * first thing on a sticker and has to be readable across a desk.
 */
export function tidyPrefix(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/** What is wrong with a typed prefix, if anything. Blank is fine. */
export function prefixProblem(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const clean = tidyPrefix(raw);
  if (!clean) return 'a prefix is letters and numbers';
  if (clean.length < 2) return 'that is too short to tell two companies apart';
  return '';
}

/**
 * A code somebody typed, tidied. Uppercased and trimmed; a code is a label, so
 * spaces inside it are kept out rather than quietly stored.
 *
 * TIDIED, NOT REJECTED - which is this module's whole posture, for an office
 * that already has stickers on its laptops. It was only half true: spaces came
 * out, and anything else was left for codeProblem to refuse. Dinesh's own
 * register carries "BNF-AST-Big Storage (Almari)-0006", and those brackets
 * stopped an import of a thousand assets dead.
 *
 * So every run of characters a code cannot hold becomes ONE DASH, which a
 * code can, and the words survive: BNF-AST-BIG-STORAGE-ALMARI-0006. Doubled
 * dashes collapse and the ends are trimmed, so the result is always a shape
 * codeProblem accepts - it can still be too short or empty, which are real
 * faults rather than punctuation.
 */
export function tidyCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9/-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
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
