import { db } from './db.js';
import { config } from './config.js';

/**
 * Work given to somebody else.
 *
 * A delegated task is an ordinary task with `assigned_to` set - the same row,
 * the same lifecycle, the same reminder ladder. NULL means the user, which is
 * what every existing row already says, so nothing had to be back-filled and no
 * existing query changed meaning.
 *
 * The rule that shapes everything here: **the app never messages anybody but
 * the user on its own.** A follow-up for a delegated task notifies the user,
 * who can then choose to send a nudge. Nothing reaches the assignee without an
 * explicit press.
 */

export const isDelegated = (task) => Boolean(task?.assigned_to);
export const wasRequested = (task) => Boolean(task?.requested_by);

/*
 * Three kinds of task, told apart by two columns rather than by guesswork:
 *
 *   allotted  - he gave it to somebody. `assigned_to` names them.
 *   received  - somebody asked him for it. `requested_by` names them.
 *   own       - neither; a note he made himself.
 *
 * A task can be both: a request that came in and was then passed on. It shows
 * in both lists, which is correct - he is answerable for it and somebody else
 * is doing it.
 */
export function directionOf(task) {
  if (task?.assigned_to) return 'allotted';
  if (task?.requested_by) return 'received';
  return 'own';
}

/* ---------------- the staff list ---------------- */

/**
 * The people work can be handed to, whether or not they hold any yet.
 *
 * A name typed on a row is remembered here too (`rememberStaff` below), so the
 * list builds itself out of ordinary use and the one place he has to maintain
 * by hand is the one he chooses to.
 */
export const listStaff = () =>
  db.prepare(`SELECT id, name, wid, number, created_at FROM staff ORDER BY name COLLATE NOCASE`).all();

/**
 * Add somebody. Returns the row, existing or new.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` rather than a read-then-write: two presses
 * of the button, or a name typed on a row at the same moment, must not be able
 * to make two people out of one.
 */
export function addStaff(name, { wid = null, number = null } = {}) {
  const clean = String(name ?? '').trim().slice(0, 80);
  if (!clean) return null;
  db.prepare(
    `INSERT INTO staff (name, wid, number) VALUES (?, ?, ?)
     ON CONFLICT(LOWER(name)) DO UPDATE SET
       wid    = COALESCE(excluded.wid, staff.wid),
       number = COALESCE(excluded.number, staff.number)`
  ).run(clean, wid || null, number || null);
  return db.prepare(`SELECT id, name, wid, number, created_at FROM staff WHERE LOWER(name) = LOWER(?)`)
    .get(clean);
}

/**
 * Take somebody off the list.
 *
 * Their tasks are untouched - the work is real whether or not the name is on a
 * list, and a delete that silently un-assigned six tasks would be a very
 * expensive way to tidy up. They simply stop being offered; if they still hold
 * work, the page goes on showing them because the tasks say so.
 */
export const removeStaff = (id) =>
  db.prepare(`DELETE FROM staff WHERE id = ?`).run(Number(id)).changes > 0;

/** Quietly remember a name that was typed on a row, so it is there next time. */
export const rememberStaff = (name, wid = null) => addStaff(name, { wid });

/**
 * Everyone the user has given work to, with what is still outstanding — plus
 * everyone on the staff list who has not been given anything yet.
 *
 * Both in one list because the question the Staff menu asks is "who could this
 * go to", and the answer has never been "only people who already have
 * something". Someone with nothing open sorts to the end and carries zeros,
 * which is true.
 */
export function delegates() {
  const held = db
    .prepare(
      `SELECT assigned_to AS name,
              MAX(assigned_to_wid) AS wid,
              SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open,
              COUNT(*) AS total,
              MAX(assigned_at) AS last_at
       FROM tasks
       WHERE assigned_to IS NOT NULL AND archived_at IS NULL
       GROUP BY assigned_to
       ORDER BY open DESC, assigned_to`
    )
    .all();

  /*
   * A person holding work still takes their chat from the staff list when the
   * tasks do not carry one.
   *
   * `MAX(assigned_to_wid)` is null for every task handed over by typing a
   * name, so somebody with a number on the staff list and one task in flight
   * was reported as having no chat at all - the same mistake the Nudge button
   * made, in a second place. Anyone who has ever been given anything is in the
   * `held` half, which is to say: nearly everybody.
   */
  const stored = new Map(
    listStaff().map((person) => [person.name.trim().toLowerCase(), person.wid])
  );
  for (const row of held) {
    if (!row.wid) row.wid = stored.get(String(row.name || '').trim().toLowerCase()) || null;
  }

  const seen = new Set(held.map((row) => String(row.name || '').toLowerCase()));
  const idle = listStaff()
    .filter((person) => !seen.has(person.name.toLowerCase()))
    .map((person) => ({
      name: person.name,
      wid: person.wid,
      open: 0,
      total: 0,
      last_at: null,
      // Says which half of the list this came from: a person with no work is on
      // the page because he is staff, not because a task put him there.
      on_list: true,
    }));

  return [...held, ...idle];
}

/** Everyone who has given the user work, with what is still outstanding. */
export function requesters() {
  return db
    .prepare(
      `SELECT requested_by AS name,
              MAX(requested_by_wid) AS wid,
              SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open,
              COUNT(*) AS total,
              MAX(created_at) AS last_at
       FROM tasks
       WHERE requested_by IS NOT NULL AND archived_at IS NULL
       GROUP BY requested_by
       ORDER BY open DESC, requested_by`
    )
    .all();
}

/**
 * The two counts the sidebar shows. Open only: a delegation everybody has
 * finished with is history, not something to badge.
 */
export function delegationCounts() {
  const one = (column) =>
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
         WHERE ${column} IS NOT NULL AND status != 'done' AND archived_at IS NULL`
      )
      .get().n;
  return { allotted: one('assigned_to'), received: one('requested_by') };
}

/**
 * Assign or unassign. Passing nothing for `name` gives the task back to the
 * user, which is the same thing as never having delegated it.
 */
export function assignTask(taskId, name, wid = null) {
  const clean = String(name ?? '').trim().slice(0, 80);
  if (!clean) {
    db.prepare(
      `UPDATE tasks SET assigned_to = NULL, assigned_to_wid = NULL, assigned_at = NULL,
                        updated_at = datetime('now')
       WHERE id = ?`
    ).run(taskId);
    return null;
  }
  db.prepare(
    `UPDATE tasks SET assigned_to = ?, assigned_to_wid = ?, assigned_at = datetime('now'),
                      updated_at = datetime('now')
     WHERE id = ?`
  ).run(clean, wid || null, taskId);
  /*
   * A name typed once is on the list from then on.
   *
   * Without this the staff list is a second thing to maintain, and a list you
   * have to remember to update is a list that goes stale - then the menu stops
   * offering the person you actually give work to, and the typing (and the
   * typos) start again.
   */
  rememberStaff(clean, wid);
  return clean;
}

/**
 * The open task most likely to be the one an assignee's reply is about.
 *
 * Deliberately narrow: only tasks assigned to that person, and only when there
 * is exactly one still open. Two candidates means no answer - marking the wrong
 * person's work done is worse than asking.
 */
export function openTaskFor(name) {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE assigned_to IS NOT NULL AND LOWER(assigned_to) = LOWER(?)
         AND status != 'done' AND archived_at IS NULL
       ORDER BY id DESC`
    )
    .all(String(name || '').trim());
  return rows.length === 1 ? rows[0] : null;
}

/** Every task given to one person, newest first. */
export const tasksFor = (name) =>
  db
    .prepare(
      `SELECT * FROM tasks
       WHERE assigned_to IS NOT NULL AND LOWER(assigned_to) = LOWER(?) AND archived_at IS NULL
       ORDER BY id DESC`
    )
    .all(String(name || '').trim());

/**
 * The message a nudge would say, built but never sent from here.
 *
 * Composed in one place so the text the user is shown before sending is exactly
 * the text that goes out - a preview that differs from the message is a lie.
 */
/**
 * The message that hands a job over, sent once when it is handed over.
 *
 * Asked as *"muje koi task dena he to direct app se de sakta hu - task me bhi
 * add ho jayega and msg bhi chala jayega"*. Before this, giving somebody work
 * in the app told them nothing: the task existed, the deadline was set, and
 * the first they heard of it was the reminder on the day it was due.
 *
 * It is a different message from `followUpText`, not a reuse of it. That one
 * chases ("a quick update please"), which read as a reproach for work nobody
 * had been told about yet.
 */
export function handoverText(task) {
  const who = task.assigned_to || 'there';
  const lines = [`${who}, this one is with you: *${task.title}*`];
  if (task.description && task.description.trim()) lines.push('', task.description.trim());

  const iso = task.due_at || task.due_date;
  if (iso) {
    const at = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (!Number.isNaN(at.getTime())) {
      lines.push('', `_Due ${new Intl.DateTimeFormat('en-IN', {
        timeZone: config.timezone,
        day: 'numeric',
        month: 'short',
        ...(task.due_at ? { hour: 'numeric', minute: '2-digit' } : {}),
      }).format(at)}._`);
    }
  }
  return lines.join('\n');
}

export function followUpText(task) {
  const who = task.assigned_to || 'there';
  const lines = [`${who}, a quick update on *${task.title}* please.`];

  const iso = task.due_at || task.due_date;
  if (iso) {
    const at = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (!Number.isNaN(at.getTime())) {
      const when = new Intl.DateTimeFormat('en-IN', {
        timeZone: config.timezone,
        day: 'numeric',
        month: 'short',
        ...(task.due_at ? { hour: 'numeric', minute: '2-digit' } : {}),
      }).format(at);
      // Past or future, said correctly. "It was due next Thursday" reads as a
      // reproach for something that has not happened yet.
      lines.push('', at.getTime() < Date.now() ? `_It was due ${when}._` : `_It is due ${when}._`);
    }
  }
  return lines.join('\n');
}
