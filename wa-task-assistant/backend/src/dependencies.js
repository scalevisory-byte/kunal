import { db, getTask } from './db.js';

/**
 * "This cannot start until that is finished."
 *
 * A task is *blocked* while any task it depends on is not done. Blocking
 * deliberately does not silence reminders: a deadline is still a deadline, and
 * quietly going quiet on a task is how things get forgotten. What it does is
 * make the reminder say what is in the way, so the nudge is actionable rather
 * than nagging about something that cannot be started.
 */

export function blockersOf(taskId) {
  return db
    .prepare(
      `SELECT t.id, t.title, t.status, t.due_at, t.due_date
       FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id
       WHERE d.task_id = ? ORDER BY t.id`
    )
    .all(taskId);
}

/** The tasks waiting on this one. */
export function blockedBy(taskId) {
  return db
    .prepare(
      `SELECT t.id, t.title, t.status
       FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
       WHERE d.depends_on_id = ? AND t.status != 'done' AND t.archived_at IS NULL
       ORDER BY t.id`
    )
    .all(taskId);
}

/** Everything a task needs that is not finished yet. Empty means it can start. */
export function openBlockers(taskId) {
  return blockersOf(taskId).filter((t) => t.status !== 'done');
}

export const isBlocked = (taskId) => openBlockers(taskId).length > 0;

/** Blocked-ness for many tasks at once, so a list costs one query rather than N. */
export function blockedMap(taskIds) {
  const out = new Map();
  if (!taskIds.length) return out;
  const marks = taskIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT d.task_id, t.id AS blocker_id, t.title AS blocker_title
       FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id
       WHERE d.task_id IN (${marks}) AND t.status != 'done'`
    )
    .all(...taskIds);
  for (const row of rows) {
    if (!out.has(row.task_id)) out.set(row.task_id, []);
    out.get(row.task_id).push({ id: row.blocker_id, title: row.blocker_title });
  }
  return out;
}

/**
 * Would adding this edge let a task end up waiting on itself? Walks the chain
 * from the proposed blocker; if it comes back round to the task, the answer is
 * yes. A cycle is not a slow bug - nothing in it could ever be startable - so
 * it is refused at the point of writing rather than detected later.
 */
export function wouldCycle(taskId, dependsOnId) {
  if (taskId === dependsOnId) return true;
  const seen = new Set();
  const stack = [dependsOnId];
  while (stack.length) {
    const current = stack.pop();
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const row of db.prepare(`SELECT depends_on_id FROM task_dependencies WHERE task_id = ?`).all(current)) {
      stack.push(row.depends_on_id);
    }
  }
  return false;
}

export function addDependency(taskId, dependsOnId) {
  const task = getTask(taskId);
  const blocker = getTask(dependsOnId);
  if (!task) throw new Error('task not found');
  if (!blocker) throw new Error('the task it depends on was not found');
  if (taskId === dependsOnId) throw new Error('a task cannot depend on itself');
  if (wouldCycle(taskId, dependsOnId)) {
    throw new Error(`that would make a loop — "${blocker.title}" already waits on this one`);
  }
  db.prepare(
    `INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)`
  ).run(taskId, dependsOnId);
  return blockersOf(taskId);
}

export function removeDependency(taskId, dependsOnId) {
  return db
    .prepare(`DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?`)
    .run(taskId, dependsOnId).changes > 0;
}

/**
 * Tasks that became startable because this one just finished - i.e. they
 * depended on it and now have nothing else in the way. Used to say so rather
 * than leaving the unblocking invisible.
 */
export function unblockedBy(taskId) {
  const waiting = db
    .prepare(
      `SELECT t.id, t.title FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
       WHERE d.depends_on_id = ? AND t.status != 'done'`
    )
    .all(taskId);
  return waiting.filter((t) => openBlockers(t.id).length === 0);
}
