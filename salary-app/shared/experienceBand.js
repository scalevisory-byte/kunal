/**
 * Minimum and maximum experience, against the ONE column that stores them.
 *
 * The form asks for two numbers. The database has had a single `experience_band`
 * text column since the start - "1-3 yrs", "3+ yrs", "Fresher" - and
 * `shared/match.js` scores every candidate by parsing it. Splitting it into two
 * columns would mean rewriting the scorer, re-scoring every application ever
 * made, and leaving a text column nobody writes to any more, which is how two
 * figures end up disagreeing.
 *
 * So the two boxes compose into the same sentence the parser already reads, and
 * read back out of it. Nothing downstream changes, every vacancy already on
 * file still displays, and a band somebody typed by hand ("2 to 4 years") still
 * opens in the boxes.
 *
 * It is deliberately a STRING, not a tidied one: `toYearBand` in match.js is the
 * authority on what a band means, and this only has to write what that reads.
 */

/** Compose two numbers into the band text. Blank both ways means "not asked". */
export function toBand(min, max) {
  const lo = clean(min);
  const hi = clean(max);
  if (lo === null && hi === null) return '';
  /*
   * Always the range, never the WORD "Fresher", however much better it reads.
   *
   * match.js maps "fresher" to `{min: 0, max: toYears(text) ?? 1}`, and
   * `toYears('fresher')` is 0, not null - so the word collapses the ceiling to
   * nought and somebody with a year behind them falls outside a band the form
   * showed as nought-to-one. "0-1 yrs" scores exactly what the two boxes said.
   * The word is still READ, because vacancies already carry it.
   */
  if (lo !== null && hi !== null) return lo === hi ? `${say(lo)} yrs` : `${say(lo)}-${say(hi)} yrs`;
  if (lo !== null) return `${say(lo)}+ yrs`;
  // A ceiling with no floor is still a floor of none.
  return `0-${say(hi)} yrs`;
}

/**
 * Read a stored band back into the two boxes.
 *
 * Mirrors `toYearBand` in match.js rather than re-deriving it, so a band the
 * scorer reads as 1 to 3 never opens in the form as something else.
 */
export function fromBand(band) {
  const text = String(band ?? '').toLowerCase().trim();
  if (!text) return { min: '', max: '' };
  if (text.includes('fresher')) return { min: 0, max: 1 };

  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };

  const plus = text.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus) return { min: Number(plus[1]), max: '' };

  const one = text.match(/(\d+(?:\.\d+)?)/);
  // One number on its own is a floor, which is what match.js makes of it too.
  return one ? { min: Number(one[1]), max: '' } : { min: '', max: '' };
}

/** "3" not "3.0", "1.5" kept. */
const say = (n) => String(Math.round(n * 10) / 10);

function clean(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10) / 10;
}
