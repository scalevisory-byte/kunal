import { db } from './db.js';
import { config } from './config.js';
import { isoAtLocal } from './quickparse.js';
import { today } from './dates.js';

/**
 * A shape of work that recurs - "Monthly GST filing", "New candidate
 * onboarding" - kept as a title, the usual priority and offsets, and the
 * checklist that goes with it. Using one builds an ordinary task, so everything
 * downstream (the reminder ladder, history, the briefing) treats it as one.
 */

const parseSubtasks = (raw) => {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((t) => String(t || '').trim()) : [];
  } catch {
    return [];
  }
};

const shape = (row) => (row ? { ...row, subtasks: parseSubtasks(row.subtasks) } : null);

export function listTemplates() {
  return db.prepare(`SELECT * FROM task_templates ORDER BY used_count DESC, name`).all().map(shape);
}

export function getTemplate(id) {
  return shape(db.prepare(`SELECT * FROM task_templates WHERE id = ?`).get(id));
}

const PRIORITIES = new Set(['high', 'medium', 'low']);

export function createTemplate(input) {
  const name = String(input.name || '').trim();
  const title = String(input.title || '').trim();
  if (!name) throw new Error('a template needs a name');
  if (!title) throw new Error('a template needs a task title');

  const info = db
    .prepare(
      `INSERT INTO task_templates
         (name, title, description, priority, reminder_offset, follow_up_offset,
          due_in_days, due_time, subtasks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name.slice(0, 80),
      title.slice(0, 300),
      input.description ? String(input.description).slice(0, 1000) : null,
      PRIORITIES.has(input.priority) ? input.priority : 'medium',
      Number.isFinite(Number(input.reminder_offset)) ? Number(input.reminder_offset) : null,
      Number.isFinite(Number(input.follow_up_offset)) ? Number(input.follow_up_offset) : null,
      Number.isFinite(Number(input.due_in_days)) ? Number(input.due_in_days) : null,
      /^\d{2}:\d{2}$/.test(input.due_time || '') ? input.due_time : null,
      JSON.stringify(Array.isArray(input.subtasks) ? input.subtasks.map((t) => String(t).slice(0, 200)) : [])
    );
  return getTemplate(info.lastInsertRowid);
}

export function updateTemplate(id, patch) {
  const current = getTemplate(id);
  if (!current) return null;
  const merged = { ...current, ...patch };
  db.prepare(
    `UPDATE task_templates
     SET name = ?, title = ?, description = ?, priority = ?, reminder_offset = ?,
         follow_up_offset = ?, due_in_days = ?, due_time = ?, subtasks = ?
     WHERE id = ?`
  ).run(
    String(merged.name || '').trim().slice(0, 80) || current.name,
    String(merged.title || '').trim().slice(0, 300) || current.title,
    merged.description ? String(merged.description).slice(0, 1000) : null,
    PRIORITIES.has(merged.priority) ? merged.priority : 'medium',
    Number.isFinite(Number(merged.reminder_offset)) ? Number(merged.reminder_offset) : null,
    Number.isFinite(Number(merged.follow_up_offset)) ? Number(merged.follow_up_offset) : null,
    Number.isFinite(Number(merged.due_in_days)) ? Number(merged.due_in_days) : null,
    /^\d{2}:\d{2}$/.test(merged.due_time || '') ? merged.due_time : null,
    JSON.stringify(Array.isArray(merged.subtasks) ? merged.subtasks.map((t) => String(t).slice(0, 200)) : []),
    id
  );
  return getTemplate(id);
}

export function deleteTemplate(id) {
  return db.prepare(`DELETE FROM task_templates WHERE id = ?`).run(id).changes > 0;
}

export const noteTemplateUsed = (id) =>
  db.prepare(`UPDATE task_templates SET used_count = used_count + 1 WHERE id = ?`).run(id);

/**
 * What a template turns into. The deadline is worked out from `due_in_days` on
 * the user's calendar, not the server's - a template that says "due in 2 days
 * at 6pm" must mean 6pm where the user is.
 */
export function taskFromTemplate(template, overrides = {}) {
  let due_date = null;
  let due_at = null;

  if (Number.isFinite(template.due_in_days)) {
    const base = new Date(`${today(config.timezone)}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + template.due_in_days);
    due_date = base.toISOString().slice(0, 10);
    const [h, m] = String(template.due_time || '18:00').split(':').map(Number);
    due_at = isoAtLocal(due_date, h, m, config.timezone);
  }

  return {
    title: template.title,
    description: template.description,
    priority: template.priority,
    due_date,
    due_at,
    reminder_offset: template.reminder_offset,
    follow_up_offset: template.follow_up_offset,
    ...overrides,
  };
}
