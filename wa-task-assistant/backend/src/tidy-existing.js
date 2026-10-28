/**
 * The tasks already on the list, tidied once.
 *
 * New names, notes and steps are tidied as they are written (tidy-text.js).
 * "Sare task name and details" includes the three hundred written before
 * that, so on the first boot of this version every task still on the list -
 * open and finished, not archived - has its name, details, notes and steps
 * put through the same rule, once. A marker in `meta` stops it running again,
 * so a name he puts back by hand afterwards stays the way he put it.
 *
 * A changed name is written to the task's history as "renamed from …", the
 * same line a rename by hand leaves, so the old spelling is never lost.
 */
import { db } from './db.js';
import { EVENT, recordEvent } from './task-events.js';
import { tidyText } from './tidy-text.js';

const MARKER = 'tidy_text_v1';

export function tidyExistingOnce() {
  if (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(MARKER)) {
    return { ran: false, tasks: 0, notes: 0, steps: 0 };
  }
  let tasks = 0;
  let notes = 0;
  let steps = 0;
  const renamed = [];

  db.transaction(() => {
    const setTask = db.prepare(
      `UPDATE tasks SET title = ?, description = ?, updated_at = datetime('now') WHERE id = ?`
    );
    for (const t of db.prepare(`SELECT id, title, description FROM tasks WHERE archived_at IS NULL`).all()) {
      const title = tidyText(t.title);
      const description = tidyText(t.description) ?? null;
      if (title === t.title && description === t.description) continue;
      setTask.run(title || t.title, description, t.id);
      tasks += 1;
      if (title && title !== t.title) renamed.push([t.id, t.title]);
    }

    const setNote = db.prepare(`UPDATE task_updates SET body = ? WHERE id = ?`);
    for (const u of db.prepare(`SELECT id, body FROM task_updates WHERE body IS NOT NULL AND body != ''`).all()) {
      const body = tidyText(u.body);
      if (body && body !== u.body) { setNote.run(body.slice(0, 1000), u.id); notes += 1; }
    }

    const setStep = db.prepare(`UPDATE subtasks SET title = ? WHERE id = ?`);
    for (const s of db.prepare(`SELECT id, title FROM subtasks`).all()) {
      const title = tidyText(s.title);
      if (title && title !== s.title) { setStep.run(title.slice(0, 200), s.id); steps += 1; }
    }

    db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(MARKER, new Date().toISOString());
  })();

  for (const [id, before] of renamed) {
    recordEvent(id, EVENT.edited, `renamed from "${String(before).slice(0, 120)}" (spelling and case tidied)`);
  }
  return { ran: true, tasks, notes, steps };
}
