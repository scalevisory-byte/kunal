/**
 * A stock-take round, counted - over the whole register or one part of it.
 *
 * A round is one name ("2026-11 stock take") and every verdict in it stands
 * whoever is looking. What v2.45.0 added is the SCOPE: somebody walking the
 * Surat office does not want the Vadodara laptops in their "not checked"
 * column, because those were never theirs to find. Narrowing changes which
 * assets are COUNTED, never a verdict.
 *
 * The three columns are the module's whole reason for existing and hold here
 * too: found, not found, and not checked - and "not checked" is never
 * "missing".
 *
 * An asset with nothing recorded for the field being narrowed by is in NO
 * scope of it - it is counted apart (`unplaced`) and named, never quietly
 * dropped, or a stock take by location would lose exactly the assets nobody
 * placed. Dependency-free, like the rest of shared/.
 */
export const SCOPE_FIELDS = [
  ['location', 'Location'],
  ['department', 'Department'],
  ['company_id', 'Company'],
];

const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Is this asset inside the scope? Every field set on the scope has to match. */
export function inScope(asset, scope = {}) {
  return SCOPE_FIELDS.every(([key]) => blank(scope[key]) || (!blank(asset[key]) && same(asset[key], scope[key])));
}

/** Assets with nothing recorded for a field the scope narrows by. */
export function unplaced(assets = [], scope = {}) {
  const keys = SCOPE_FIELDS.map(([k]) => k).filter((k) => !blank(scope[k]));
  if (!keys.length) return [];
  return assets.filter((a) => keys.some((k) => blank(a[k])));
}

/** The three columns, and what the not-found ones cost to buy. */
export function roundFigures(assets = []) {
  const found = assets.filter((a) => a.verified_found === true);
  const missing = assets.filter((a) => a.verified_found === false);
  const todo = assets.filter((a) => a.verified_found !== true && a.verified_found !== false);
  return {
    total: assets.length,
    found: found.length,
    missing: missing.length,
    not_checked: todo.length,
    missing_value: missing.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0),
    missing_assets: missing,
    not_checked_assets: todo,
  };
}

/** What can be picked for each field, from the register as it stands. */
export function scopeChoices(assets = []) {
  // One entry per place however it is cased, spelt the way it was FIRST typed.
  const distinct = (key) => {
    const seen = new Map();
    for (const a of assets) {
      if (blank(a[key])) continue;
      const k = String(a[key]).trim().toLowerCase();
      if (!seen.has(k)) seen.set(k, String(a[key]).trim());
    }
    return [...seen.values()].sort((x, y) => x.localeCompare(y));
  };
  const companies = new Map();
  for (const a of assets) if (!blank(a.company_id)) companies.set(String(a.company_id), a.company_name || `Company ${a.company_id}`);
  return {
    location: distinct('location'),
    department: distinct('department'),
    company_id: [...companies].sort((x, y) => x[1].localeCompare(y[1])),
  };
}
