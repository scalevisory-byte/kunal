/**
 * The employee code.
 *
 * Dinesh's joining step asks for "employee code generation", and until now the
 * code was whatever somebody typed - usually nothing, because the field is
 * optional and a person being added in a hurry has a salary to get right.
 *
 * Same shape and the same rule as the asset code, deliberately: a running
 * number per company, read off the HIGHEST ONE ALREADY USED rather than a
 * count. Counting would hand a leaver's number to the next joiner, and then a
 * two-year-old salary slip, a PF record and an attendance sheet all point at
 * the wrong person. The series only ever goes up.
 *
 *   BPL-001   BOOKNFLY PRIVATE LIMITED, the first
 *   SCA-014   SCALE, the fourteenth
 *
 * It SUGGESTS, it does not impose. An office that already writes codes its own
 * way keeps them: a code in another shape simply is not in this series, so it
 * is left alone and never renumbered. The suggestion is prefilled and editable.
 */

import { companyPrefix } from './assetCode.js';

export { companyPrefix };

/** `BPL-001`. Padded to three so a list sorts by eye. */
export const formatEmployeeCode = (company, n) =>
  `${companyPrefix(company)}-${String(Math.max(1, Number(n) || 1)).padStart(3, '0')}`;

/**
 * The next code for this company.
 *
 * @param company  the company's name
 * @param taken    every code already in use, in any company and any spelling
 *
 * A number already taken in ANY spelling is skipped, not just one matching
 * this prefix: somebody who typed `bpl-007` by hand owns 007, and handing it
 * out again is exactly the collision this function exists to prevent.
 */
export function nextEmployeeCode(company, taken = []) {
  const prefix = `${companyPrefix(company)}-`;
  const used = new Set(
    (taken || []).map((c) => String(c || '').toUpperCase().replace(/\s+/g, '')).filter(Boolean)
  );

  let highest = 0;
  for (const code of used) {
    if (!code.startsWith(prefix)) continue;
    const rest = code.slice(prefix.length);
    /* Only a plain number continues this series. `BPL-LAP-014` is an asset and
     * `BPL-2024-07` is somebody's own scheme; neither sets our next number. */
    if (!/^\d+$/.test(rest)) continue;
    const n = Number(rest);
    if (Number.isFinite(n) && n > highest) highest = n;
  }

  let n = highest + 1;
  while (used.has(formatEmployeeCode(company, n))) n += 1;
  return formatEmployeeCode(company, n);
}

/** A typed code, tidied. A code is a label, so spaces are kept out of it. */
export const tidyEmployeeCode = (value) =>
  String(value || '').toUpperCase().replace(/\s+/g, '').slice(0, 40);

/**
 * What is wrong with a typed code, if anything.
 *
 * Shape only, and BLANK IS NOT WRONG: a code is useful, not required, and
 * refusing to save somebody for want of one would stop a salary going out.
 */
export function employeeCodeProblem(value, { taken = [], mine = '' } = {}) {
  const code = tidyEmployeeCode(value);
  if (!code) return '';
  if (code.length < 2) return 'that is too short to be a code';
  if (!/^[A-Z0-9][A-Z0-9/-]*[A-Z0-9]$/.test(code)) {
    return 'a code is letters, numbers, dashes and slashes';
  }
  const others = (taken || [])
    .map((c) => tidyEmployeeCode(c))
    .filter((c) => c && c !== tidyEmployeeCode(mine));
  if (others.includes(code)) return 'somebody already has that code';
  return '';
}
