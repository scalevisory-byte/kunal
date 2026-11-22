/**
 * Is the attendance still arriving?
 *
 * Dinesh: *"abhi pura kam live log k upar depend he kyu ki usi se staff ki
 * attendance aayegi and usi attendance k hisab se salary gini jayegi"* —
 * the whole payroll now hangs off a chain that runs
 *
 *     reader → punch → attendance mark → salary
 *
 * and every link of it is silent when it breaks. The Sync Tool dies on a
 * Tuesday, or a reader is unplugged, or somebody's punch ID is never filled
 * in, and nothing says so. It is found at month end, by which time the grid
 * is half empty and nobody remembers which days were real.
 *
 * THE RULE THIS MODULE IS BUILT ON, and it is the same one the importers
 * follow: **a feed that was never set up is not a feed that has broken.**
 * Those read completely differently — one is a job nobody has done yet, the
 * other is something that was working this morning and is not now. Reporting
 * both as a fault is how an alert gets ignored, and an ignored alert is worse
 * than none, because it is believed to be watching.
 *
 * It computes and does not send. Nothing here writes, collects, or decides.
 */

/** A quiet weekend is not a broken feed. */
export const QUIET_DAYS_BEFORE_WORRY = 2;

const asDate = (value) => {
  if (!value) return null;
  const text = String(value).trim().replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Whole days between two instants, or null when either is unknown. */
export function daysSince(when, now = new Date()) {
  const then = asDate(when);
  if (!then) return null;
  const ms = now.getTime() - then.getTime();
  if (ms < 0) return 0;          // a clock ahead of ours is not "in the future"
  return Math.floor(ms / 86400000);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `sources` is what each feed knows about itself. Every field may be null,
 * which means **not known**, never zero and never "broken".
 *
 *   { key, name, configured, lastAt, lastError, auto }
 *
 * `people` is { total, withoutId } off the staff list.
 */
export function feedHealth({ sources = [], people = {}, now = new Date() } = {}) {
  const concerns = [];
  const live = sources.filter((s) => s.configured);

  /* ---------------- nothing is set up at all ---------------- */

  if (!live.length) {
    concerns.push({
      key: 'no-feed',
      tone: 'info',
      /*
       * `info`, not a warning. An office that marks the grid by hand is not
       * broken, and telling them every morning that something failed would
       * teach them to ignore this whole list.
       */
      text:
        'No punch feed is set up, so attendance is whatever somebody marks by hand. ' +
        'Add a reader or point the app at the Bizcompass folder to have it arrive by itself.',
      go: 'reports',
    });
    return { concerns, ok: true, feeds: [] };
  }

  /* ---------------- each feed, in turn ---------------- */

  const feeds = live.map((s) => {
    const days = daysSince(s.lastAt, now);
    return {
      key: s.key,
      name: s.name,
      lastAt: s.lastAt || null,
      days,
      lastError: s.lastError || '',
      auto: !!s.auto,
      // `null` is "it has never brought anything", which is not the same as
      // "it brought something and has gone quiet".
      everWorked: days !== null,
    };
  });

  const working = feeds.filter((f) => f.everWorked && f.days <= QUIET_DAYS_BEFORE_WORRY);
  const quiet = feeds.filter((f) => f.everWorked && f.days > QUIET_DAYS_BEFORE_WORRY);
  const never = feeds.filter((f) => !f.everWorked);

  for (const f of quiet) {
    concerns.push({
      key: `quiet:${f.key}`,
      // Nothing arriving while a month is being counted is the bad one.
      tone: working.length ? 'warn' : 'bad',
      text:
        `${f.name}: nothing collected for ${plural(f.days, 'day')}. ` +
        (working.length
          ? 'Another feed is still arriving, so attendance is not stopped.'
          : 'NOTHING is reaching the attendance grid — the salary will be counted off whatever is already marked.'),
      go: 'reports',
    });
  }

  for (const f of never) {
    concerns.push({
      key: `never:${f.key}`,
      tone: 'warn',
      text: `${f.name} is set up but has never brought anything in. Press Collect once and see what it says.`,
      go: 'reports',
    });
  }

  for (const f of feeds) {
    if (!f.lastError) continue;
    concerns.push({
      key: `error:${f.key}`,
      tone: 'warn',
      text: `${f.name}: ${f.lastError}`,
      go: 'reports',
    });
  }

  /* ---------------- the people the punches cannot reach ---------------- */

  /*
   * This is the link that breaks most quietly. The readers hold a number and
   * no name at all, so somebody with no punch ID on their record simply never
   * appears — the feed looks perfectly healthy and their attendance is not
   * arriving.
   */
  const total = Number(people.total) || 0;
  const withoutId = Number(people.withoutId) || 0;
  if (withoutId > 0 && total > 0) {
    const everybody = withoutId === total;
    concerns.push({
      key: 'no-punch-id',
      tone: everybody ? 'bad' : 'warn',
      text: everybody
        ? `Nobody on the staff list has a punch ID, so no punch can reach anybody. ` +
          `The machine knows people by a number and holds no names at all — fill them in from ` +
          `the machine's own report.`
        : `${plural(withoutId, 'person', 'people')} have no punch ID, so their attendance cannot arrive however well the readers run.`,
      go: 'employees',
    });
  }

  if (people.unknownIds > 0) {
    concerns.push({
      key: 'unknown-ids',
      tone: 'warn',
      text:
        `${plural(people.unknownIds, 'punch ID')} on the readers belong to nobody on the staff list. ` +
        'Those punches are being collected and cannot be given to anybody.',
      go: 'employees',
    });
  }

  return {
    concerns,
    ok: concerns.every((c) => c.tone === 'info'),
    feeds,
  };
}
