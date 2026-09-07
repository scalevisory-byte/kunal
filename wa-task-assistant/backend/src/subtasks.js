import { db } from './db.js';

/**
 * A checklist inside one task.
 *
 * Ticking every box deliberately does NOT finish the parent. Completing a task
 * cancels its entire reminder ladder and writes a completion into the permanent
 * record - too much to happen as a side effect of ticking a box. The progress
 * is shown instead, and finishing the task stays one explicit action.
 */

export function subtasksFor(taskId) {
  return db
    .prepare(`SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, id`)
    .all(taskId);
}

/** Counts for the task row, so a list does not have to fetch every checklist. */
export function subtaskProgress(taskId) {
  const row = db
    .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM subtasks WHERE task_id = ?`)
    .get(taskId);
  return { total: row.total, done: row.done };
}

/** Progress for many tasks at once - one query rather than one per row. */
export function subtaskProgressFor(taskIds) {
  const out = new Map();
  if (!taskIds.length) return out;
  const marks = taskIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT task_id, COUNT(*) AS total, COALESCE(SUM(done), 0) AS done
       FROM subtasks WHERE task_id IN (${marks}) GROUP BY task_id`
    )
    .all(...taskIds);
  for (const row of rows) out.set(row.task_id, { total: row.total, done: row.done });
  return out;
}

export function addSubtask(taskId, title) {
  const clean = String(title || '').trim();
  if (!clean) throw new Error('a checklist item needs a title');
  const next = db
    .prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM subtasks WHERE task_id = ?`)
    .get(taskId).n;
  const info = db
    .prepare(`INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)`)
    .run(taskId, clean.slice(0, 200), next);
  return db.prepare(`SELECT * FROM subtasks WHERE id = ?`).get(info.lastInsertRowid);
}

export function updateSubtask(id, patch) {
  const current = db.prepare(`SELECT * FROM subtasks WHERE id = ?`).get(id);
  if (!current) return null;

  const title = patch.title === undefined ? current.title : String(patch.title).trim().slice(0, 200);
  if (!title) throw new Error('a checklist item needs a title');
  const done = patch.done === undefined ? current.done : (patch.done ? 1 : 0);

  db.prepare(
    `UPDATE subtasks
     SET title = ?, done = ?,
         completed_at = CASE WHEN ? = 1 AND completed_at IS NULL THEN datetime('now')
                             WHEN ? = 0 THEN NULL ELSE completed_at END
     WHERE id = ?`
  ).run(title, done, done, done, id);

  return db.prepare(`SELECT * FROM subtasks WHERE id = ?`).get(id);
}

export function deleteSubtask(id) {
  return db.prepare(`DELETE FROM subtasks WHERE id = ?`).run(id).changes > 0;
}

/** Reorder by listing the ids in the order wanted. Ids not in the list are left alone. */
export function reorderSubtasks(taskId, ids) {
  const move = db.prepare(`UPDATE subtasks SET position = ? WHERE id = ? AND task_id = ?`);
  db.transaction(() => {
    ids.forEach((id, index) => move.run(index + 1, Number(id), taskId));
  })();
  return subtasksFor(taskId);
}

/** Used when a template creates a task with its checklist already in place. */
export function addSubtasks(taskId, titles) {
  const added = [];
  db.transaction(() => {
    for (const title of titles) {
      if (String(title || '').trim()) added.push(addSubtask(taskId, title));
    }
  })();
  return added;
}
