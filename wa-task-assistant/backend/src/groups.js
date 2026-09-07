import { db } from './db.js';

/**
 * One group per business.
 *
 * Tasks for the same company arrive from several different chats, and some are
 * typed by hand with no chat at all, so which company a task belongs to cannot
 * be read off the chat it came from. It is its own thing, and a task may have
 * none.
 *
 * A group carries keywords, and those decide routing before anything else does:
 * a rule the user wrote is predictable, repeatable and free, which is worth
 * more than a cleverer guess that changes from one day to the next. Claude's
 * suggestion is the fallback for what the keywords do not catch.
 */

export const COLOURS = ['teal', 'blue', 'violet', 'amber', 'rose', 'green', 'slate'];

const parseKeywords = (raw) => {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((k) => String(k || '').trim()) : [];
  } catch {
    return [];
  }
};

const shape = (row) => (row ? { ...row, keywords: parseKeywords(row.keywords) } : null);

export const listGroups = () =>
  db.prepare(`SELECT * FROM task_groups ORDER BY position, name`).all().map(shape);

export const getGroup = (id) =>
  shape(db.prepare(`SELECT * FROM task_groups WHERE id = ?`).get(id));

export const groupByName = (name) =>
  shape(
    db.prepare(`SELECT * FROM task_groups WHERE LOWER(name) = LOWER(?)`).get(String(name || '').trim())
  );

/** How many open and finished tasks each group holds, for the sidebar. */
export function groupCounts() {
  const rows = db
    .prepare(
      `SELECT group_id,
              SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open,
              COUNT(*) AS total
       FROM tasks WHERE archived_at IS NULL AND group_id IS NOT NULL
       GROUP BY group_id`
    )
    .all();
  const out = new Map();
  for (const row of rows) out.set(row.group_id, { open: row.open, total: row.total });
  return out;
}

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

export function createGroup(input) {
  const name = clean(input.name, 40);
  if (!name) throw new Error('a group needs a name');
  // Checked here as well as in the index, so the message says what is wrong.
  if (groupByName(name)) throw new Error(`a group called "${groupByName(name).name}" already exists`);

  const next = db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM task_groups`).get().n;
  const info = db
    .prepare(`INSERT INTO task_groups (name, colour, keywords, position) VALUES (?, ?, ?, ?)`)
    .run(
      name,
      COLOURS.includes(input.colour) ? input.colour : COLOURS[(next - 1) % COLOURS.length],
      JSON.stringify(normaliseKeywords(input.keywords, name)),
      next
    );
  return getGroup(info.lastInsertRowid);
}

/**
 * The group's own name is always a keyword: nobody should have to be told to
 * type "BNF" twice to make a group called BNF match a task that says BNF.
 */
function normaliseKeywords(raw, name) {
  const given = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[,\n]/);
  const list = given.map((k) => clean(k, 40).toLowerCase()).filter(Boolean);
  const withName = [clean(name, 40).toLowerCase(), ...list];
  return [...new Set(withName)].filter(Boolean).slice(0, 25);
}

export function updateGroup(id, patch) {
  const current = getGroup(id);
  if (!current) return null;
  const name = patch.name === undefined ? current.name : clean(patch.name, 40);
  if (!name) throw new Error('a group needs a name');
  const clash = groupByName(name);
  if (clash && clash.id !== current.id) throw new Error(`a group called "${clash.name}" already exists`);

  db.prepare(`UPDATE task_groups SET name = ?, colour = ?, keywords = ? WHERE id = ?`).run(
    name,
    COLOURS.includes(patch.colour) ? patch.colour : current.colour,
    JSON.stringify(
      patch.keywords === undefined
        ? normaliseKeywords(current.keywords, name)
        : normaliseKeywords(patch.keywords, name)
    ),
    id
  );
  return getGroup(id);
}

/**
 * Removing a group does not remove its work. `ON DELETE SET NULL` leaves every
 * task where it is, ungrouped - deleting a label should never delete the things
 * it was on.
 */
export function deleteGroup(id) {
  return db.prepare(`DELETE FROM task_groups WHERE id = ?`).run(id).changes > 0;
}

export function reorderGroups(ids) {
  const move = db.prepare(`UPDATE task_groups SET position = ? WHERE id = ?`);
  db.transaction(() => ids.forEach((id, index) => move.run(index + 1, Number(id))))();
  return listGroups();
}

/**
 * The group a piece of text belongs to, by keyword.
 *
 * Matched on word boundaries so "TCS" does not match "Watch", and the longest
 * keyword wins so a group keyed on "book n fly" beats one keyed on "book".
 * Returns null when nothing matches or when two different groups tie - putting
 * a task in the wrong company's list is worse than leaving it in none.
 */
export function matchGroup(text, groups = listGroups()) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack.trim()) return null;

  let best = null;
  let bestLength = 0;
  let tied = false;

  for (const group of groups) {
    for (const keyword of group.keywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // \b does not fire next to a non-word character, so guard on either side.
      if (!new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack)) continue;
      if (keyword.length > bestLength) {
        best = group;
        bestLength = keyword.length;
        tied = false;
      } else if (keyword.length === bestLength && best && best.id !== group.id) {
        tied = true;
      }
    }
  }

  return tied ? null : best;
}

/**
 * Which group a task belongs to: a keyword rule first, then the name Claude
 * suggested, then nothing. Everything the task says is searched, because
 * "Pay Sunshine TDS" and a message from the Sunshine chat are both signals.
 */
export function routeTask(task, suggestion = null, groups = listGroups()) {
  if (!groups.length) return null;

  const haystack = [task.title, task.description, task.chat_name, task.contact]
    .filter(Boolean)
    .join(' ');
  const byKeyword = matchGroup(haystack, groups);
  if (byKeyword) return byKeyword.id;

  if (suggestion) {
    const named = groups.find((g) => g.name.toLowerCase() === String(suggestion).trim().toLowerCase());
    if (named) return named.id;
  }
  return null;
}


/**
 * Apply one group's keywords to work that already exists.
 *
 * Making a group on Tuesday should not mean re-filing Monday's hundred tasks by
 * hand. Only tasks with no group are considered: a choice already made - by a
 * person or by an earlier rule - is never overwritten.
 */
export function applyGroupToExisting(groupId) {
  const group = getGroup(groupId);
  if (!group) return { moved: 0 };

  const candidates = db
    .prepare(
      `SELECT id, title, description, chat_name, contact FROM tasks
       WHERE group_id IS NULL AND archived_at IS NULL`
    )
    .all();

  const assign = db.prepare(`UPDATE tasks SET group_id = ? WHERE id = ?`);
  const moved = [];
  db.transaction(() => {
    for (const task of candidates) {
      const haystack = [task.title, task.description, task.chat_name, task.contact]
        .filter(Boolean)
        .join(' ');
      // Matched against this group alone, so another group's keyword cannot
      // steal a task the user is explicitly filing here.
      if (!matchGroup(haystack, [group])) continue;
      assign.run(group.id, task.id);
      moved.push(task.id);
    }
  })();

  return { moved: moved.length, ids: moved, group };
}
