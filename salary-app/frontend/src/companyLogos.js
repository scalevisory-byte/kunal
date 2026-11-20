import { STANDALONE, api } from './api.js';

/**
 * The company logos, for the documents this browser builds.
 *
 * The offer letter is written on the server, which reads the file itself. The
 * payslips are not — the slip on screen, the stack printed off the salary
 * sheet and the small file forwarded on WhatsApp are all assembled here, so
 * the picture has to come over first.
 *
 * Fetched ONCE, when something is about to be printed or sent, and kept. It is
 * not on the companies list that every screen loads: a few kilobytes each is
 * nothing once and a great deal on every page.
 *
 * NOTHING WAITS ON IT. Every caller treats a missing logo as "none", which is
 * what a company without one has anyway — so a slow or failed fetch costs a
 * letterhead, never a payslip.
 */
let byId = new Map();
let byName = new Map();
let pending = null;

export async function loadCompanyLogos() {
  // The single file has no server to ask. Its slips carry the name in type.
  if (STANDALONE) return;
  if (pending) return pending;
  const keep = ({ logos = [] }) => {
    byId = new Map(logos.map((c) => [String(c.id), c.logo]));
    byName = new Map(logos.map((c) => [String(c.name).trim().toLowerCase(), c.logo]));
  };

  pending = api
    .get('/companies/logos')
    .then(keep)
    /*
     * A STAFF LOGIN HAS NO `read`, so that route refuses it - rightly: an
     * employee has no business with a list of the companies. They get their
     * own company's logo from their own door instead, so the payslip they
     * print carries the same letterhead as the office's copy.
     */
    .catch(() => api.get('/me/logos').then(keep))
    .catch(() => {
      // A payslip is not worth failing over a picture.
      byId = new Map();
      byName = new Map();
    });
  return pending;
}

/**
 * One company's logo, by id or by name.
 *
 * Both, because a payroll row carries `company_id` and a slip carries only the
 * company's NAME — and looking the wrong one up would silently print nothing.
 */
export function logoFor(company) {
  if (company === null || company === undefined || company === '') return '';
  const byTheId = byId.get(String(company));
  if (byTheId) return byTheId;
  return byName.get(String(company).trim().toLowerCase()) || '';
}

/** After an upload or a removal, so the next slip carries the new one. */
export function forgetCompanyLogos() {
  pending = null;
  byId = new Map();
  byName = new Map();
}
