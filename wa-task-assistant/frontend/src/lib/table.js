/*
 * The All Tasks table: its order and its pages.
 *
 * Kept apart from the component so the two rules that can quietly lie - what
 * "sorted" means for a row with nothing in that column, and what "Showing
 * 1-20 of 439" counts - are plain functions a test can hold to account.
 */

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = { open: 0, in_progress: 1, waiting: 2, done: 3 };

/** The deadline as one comparable string; a time sorts inside its day. */
const deadline = (task) => task.due_at || (task.due_date ? `${task.due_date}T23:59` : null);

/**
 * What each column sorts by. `null` means the cell is empty.
 *
 * Folder is resolved by the caller, because the task carries an id and only
 * the page knows the names.
 */
const COLUMNS = {
  task: (t) => (t.title || '').toLowerCase() || null,
  folder: (t, ctx) => (ctx.folderOf?.(t) || '').toLowerCase() || null,
  assignee: (t) => (t.assigned_to || '').toLowerCase() || null,
  due: (t) => deadline(t),
  priority: (t) => (t.priority in PRIORITY_RANK ? PRIORITY_RANK[t.priority] : null),
  status: (t) => (t.status in STATUS_RANK ? STATUS_RANK[t.status] : null),
  added: (t) => t.created_at || null,
};

export const SORTABLE = Object.keys(COLUMNS);

/**
 * Sort by a column, EMPTIES LAST IN BOTH DIRECTIONS.
 *
 * A blank is not the smallest value or the largest: it is no value. Flipping
 * "Due" to newest-first must not put two hundred undated rows at the top of
 * the page ahead of the one due next week - the arrow would then mean
 * "hide the dated work", which is not what anybody pressed it for.
 *
 * With no column the rows keep the order they arrived in, which is the
 * board's own; and because Array#sort is stable, that order also breaks
 * every tie, so two tasks due the same day stay the way the board has them.
 */
export function sortRows(rows, key, dir = 'asc', ctx = {}) {
  const read = COLUMNS[key];
  if (!read) return rows.slice();
  const sign = dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = read(a, ctx);
    const y = read(b, ctx);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (x < y) return -sign;
    if (x > y) return sign;
    return 0;
  });
}

export const PAGE_SIZES = [20, 50, 100];

/**
 * One page of the rows, and the sentence that describes it.
 *
 * `total` is the number of rows handed in - every filter on the screen has
 * already been applied - so "of 439" is the list the page is showing a slice
 * of, never the whole database. A page past the end (the list shrank under a
 * filter while you were on page 9) is pulled back to the last one that exists
 * rather than drawn empty with "Showing 161-180 of 12" above it.
 */
export function pageOf(rows, page, size) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, page), pages);
  const start = (at - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: at,
    pages,
    total,
    from: total ? start + 1 : 0,
    to: start + slice.length,
  };
}

/**
 * The page numbers to draw: the first, the last, and two either side of the
 * current one, with a gap marker where numbers are left out. Twenty-two
 * buttons in a row is a ruler, not a control.
 */
export function pageList(page, pages) {
  const keep = new Set([1, pages]);
  for (let p = page - 1; p <= page + 1; p += 1) if (p >= 1 && p <= pages) keep.add(p);
  const sorted = [...keep].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}
