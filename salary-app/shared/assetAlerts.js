/**
 * WARRANTIES AND AMCs RUNNING OUT.
 *
 * Dinesh, after the licence register went in: *"asset me bhi warranty expire
 * ka alert aise hi do"*. The register already carried two grey lines about
 * warranties; this is the same treatment the licences got — named, coloured
 * by how bad it is, and reaching the dashboard.
 *
 * FOUR RULES, three of them the licence module's, because they are the same
 * problem:
 *
 *   **NO WARRANTY DATE IS NOT AN EXPIRED WARRANTY.** Most of a thousand
 *   imported rows carry no date at all. Reading a blank as "lapsed" would put
 *   the whole register on a reminder list every morning, which is how a
 *   reminder list stops being read. They are counted separately as *not
 *   recorded*, which is a job for somebody with the invoices, not a deadline.
 *
 *   **A WARRANTY THAT RAN OUT YEARS AGO IS NOT NEWS.** This is the one rule
 *   the licence module did not need, and the register does: a laptop bought in
 *   2019 is out of warranty and will be out of warranty tomorrow as well.
 *   What can still be acted on is one that has **just** lapsed — there is
 *   usually a window to extend cover or to put it on an AMC — so recent and
 *   long-gone are separate, and only the recent ones are named.
 *
 *   **AN AMC IS ITS OWN CONTRACT**, with its own date, counted beside the
 *   warranty and never folded into it: the warranty came with the thing, the
 *   AMC is money committed every year.
 *
 *   **A WRITTEN-OFF ASSET IS OUT OF ALL OF IT.** Nobody is renewing cover on
 *   a laptop that has been scrapped.
 *
 * One module, so the register's strip, the maintenance panel and the
 * dashboard's digest cannot come to three different answers about the same
 * laptop. Dependency-free, like the rest of shared/.
 */

const DAY = 24 * 60 * 60 * 1000;
const day = (v) => String(v ?? '').slice(0, 10);

/** Days until a date. Negative is the past; null for no date at all. */
export function daysUntil(date, today = new Date().toISOString().slice(0, 10)) {
  if (!date) return null;
  const then = new Date(`${day(date)}T00:00:00Z`);
  const now = new Date(`${day(today)}T00:00:00Z`);
  if (Number.isNaN(then.getTime()) || Number.isNaN(now.getTime())) return null;
  return Math.round((then - now) / DAY);
}

/**
 * How long after a date has passed it is still worth saying something.
 *
 * Three months: long enough to catch a warranty that lapsed while somebody
 * was away, short enough that a 2019 laptop is not on the list for ever.
 */
export const RECENT_DAYS = 90;

const live = (assets) => assets.filter((a) => !a.written_off_on);

/**
 * Split one date column into the four answers it can give.
 *
 * `soon` / `just_gone` are the two somebody can act on. `long_gone` is a
 * count. `not_recorded` is the honest fourth: nobody has said.
 */
function split(assets, field, today, { soon = 30, recent = RECENT_DAYS } = {}) {
  const out = { soon: [], just_gone: [], long_gone: [], not_recorded: [] };
  for (const asset of assets) {
    const days = daysUntil(asset[field], today);
    if (days === null) {
      out.not_recorded.push(asset);
      continue;
    }
    const row = { ...asset, days_left: days };
    if (days >= 0 && days <= soon) out.soon.push(row);
    else if (days < 0 && days >= -recent) out.just_gone.push(row);
    else if (days < 0) out.long_gone.push(row);
  }
  const byDate = (a, b) => String(a[field] || '').localeCompare(String(b[field] || ''));
  out.soon.sort(byDate);
  out.just_gone.sort(byDate);
  return out;
}

/**
 * What is running out across the register.
 *
 * @param assets the register rows, as they come back from the API
 * @param today  ISO date
 * @param soon   how many days ahead counts as "coming up" (30)
 */
export function assetAlerts(assets = [], today = new Date().toISOString().slice(0, 10), { soon = 30 } = {}) {
  const rows = live(assets);
  const warranty = split(rows, 'warranty_until', today, { soon });
  const amc = split(rows, 'amc_until', today, { soon });

  return {
    warranty_soon: warranty.soon,
    warranty_just_gone: warranty.just_gone,
    warranty_long_gone: warranty.long_gone,
    no_warranty_date: warranty.not_recorded,
    amc_soon: amc.soon,
    amc_just_gone: amc.just_gone,
    amc_long_gone: amc.long_gone,

    /*
     * What there is to DO something about, today. A warranty that lapsed two
     * years ago and a row with no date are both reported and neither is
     * counted: one is history, the other is filing.
     */
    count:
      warranty.soon.length +
      warranty.just_gone.length +
      amc.soon.length +
      amc.just_gone.length,
    /** Everything out of warranty, however long ago — what the old line said. */
    warranty_gone: [...warranty.just_gone, ...warranty.long_gone],
    amc_gone: [...amc.just_gone, ...amc.long_gone],
    recent_days: RECENT_DAYS,
    soon,
  };
}

/** `BPL-LAP-014 (2026-12-01)`, for naming a few of them in a line. */
export const nameWithDate = (asset, field = 'warranty_until') =>
  `${asset.code || asset.label || 'one'}${asset[field] ? ` (${day(asset[field])})` : ''}`;

/**
 * The first few, then "and N more".
 *
 * Named rather than counted, because "6 out of warranty" sends somebody to
 * find which six and a list of codes does not.
 */
export function nameSome(assets = [], limit = 5, field = 'warranty_until') {
  const shown = assets.slice(0, limit).map((a) => nameWithDate(a, field)).join(', ');
  const rest = assets.length - limit;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}
