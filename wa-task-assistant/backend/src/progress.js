import { db } from './db.js';
import { tidyText } from './tidy-text.js';

/**
 * What is actually happening on a task.
 *
 * Three questions get confused into one field everywhere else. `status` is the
 * engine's: is this owed, is it running, is it finished. `stage` is his: where
 * the work has got to - "sent to CA", "waiting for signature", "quote given".
 * And the update itself is what was last said about it, which is the part he
 * cannot reconstruct a week later from either of the other two.
 *
 * Updates are a stream, not a field. A field would show the latest state and
 * lose how it got there, and "kya baat chal rahi hai" is a conversation, not a
 * value: the useful thing is that the last three updates read as an account of
 * what happened. Correcting one means writing the next.
 */

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

export const updatesFor = (taskId) =>
  db.prepare(`SELECT * FROM task_updates WHERE task_id = ? ORDER BY id DESC`).all(taskId);

/**
 * The latest update for each of many tasks, for the list.
 *
 * One query rather than one per row - the board loads every task at once, and
 * a per-row fetch would be a hundred round trips to render one screen.
 */
export function latestUpdateFor(taskIds) {
  const out = new Map();
  if (!taskIds.length) return out;
  const marks = taskIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT u.task_id, u.body, u.stage, u.created_at
       FROM task_updates u
       JOIN (SELECT task_id, MAX(id) AS id FROM task_updates
             WHERE task_id IN (${marks}) GROUP BY task_id) latest
         ON latest.id = u.id`
    )
    .all(...taskIds);
  for (const row of rows) out.set(row.task_id, row);
  return out;
}

/** How many updates each task carries, so a row can say there is more to read. */
export function updateCountFor(taskIds) {
  const out = new Map();
  if (!taskIds.length) return out;
  const marks = taskIds.map(() => '?').join(',');
  for (const row of db
    .prepare(
      `SELECT task_id, COUNT(*) AS n FROM task_updates
       WHERE task_id IN (${marks}) GROUP BY task_id`
    )
    .all(...taskIds)) {
    out.set(row.task_id, row.n);
  }
  return out;
}

/**
 * Add an update, and move the stage if this one names a new stage.
 *
 * The stage lives on the task as well as on the update: on the task so a list
 * can be filtered and read without loading every stream, on the update so the
 * stream still shows when it changed. Leaving the stage out is the ordinary
 * case - most updates are news, not progress - and it keeps the current one.
 */
export function addUpdate(taskId, { body, stage } = {}) {
  const text = clean(tidyText(body), 1000);
  const nextStage = stage === undefined || stage === null ? null : clean(stage, 40);
  if (!text && !nextStage) throw new Error('an update needs something in it');

  return db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO task_updates (task_id, body, stage) VALUES (?, ?, ?)`)
      .run(taskId, text, nextStage || null);
    if (nextStage !== null) {
      db.prepare(`UPDATE tasks SET stage = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(nextStage || null, taskId);
    }
    return db.prepare(`SELECT * FROM task_updates WHERE id = ?`).get(info.lastInsertRowid);
  })();
}

export function deleteUpdate(id) {
  return db.prepare(`DELETE FROM task_updates WHERE id = ?`).run(id).changes > 0;
}

/**
 * The stages already in use, most-used first.
 *
 * Offered as suggestions rather than a fixed list: the stages of a recruitment
 * mandate and of a GST filing have nothing in common, and a menu written here
 * would be wrong for at least four of the five businesses. What he types once
 * is what he is offered next time, so the vocabulary is his.
 */
export const knownStages = (limit = 12) =>
  db
    .prepare(
      `SELECT stage AS name, COUNT(*) AS uses FROM task_updates
       WHERE stage IS NOT NULL AND stage != ''
       GROUP BY LOWER(stage) ORDER BY uses DESC, MAX(id) DESC LIMIT ?`
    )
    .all(limit)
    .map((r) => r.name);

/**
 * Tasks with notes written before the first note started the work, started.
 *
 * Since v1.36 a note on an open task moves it to in progress (routes/extras.js).
 * Every note written before that left its task open, so the In progress tab
 * opened empty over a list full of tasks he was plainly working on - reported
 * as "in progress me kuch nahi aa raha". Once, the same rule is applied to
 * what is already there: an open, unarchived task with at least one note is
 * started, and its history says why. A marker in `meta` keeps it to once, so
 * a task he moves back to Open afterwards stays there.
 */
const STARTED_MARKER = 'started_from_notes_v1';

export function startNotedOnce() {
  if (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(STARTED_MARKER)) return { ran: false, started: [] };
  const started = db.transaction(() => {
    const ids = db.prepare(
      `SELECT t.id FROM tasks t
        WHERE t.status = 'open' AND t.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM task_updates u WHERE u.task_id = t.id)`
    ).all().map((r) => r.id);
    const move = db.prepare(`UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`);
    for (const id of ids) move.run(id);
    db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(STARTED_MARKER, new Date().toISOString());
    return ids;
  })();
  return { ran: true, started };
}
