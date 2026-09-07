import { Router } from 'express';
import { createTask, getTask, listTasks, updateTask, deleteTask, taskStats } from '../db.js';
import { normalizeDueDate, normalizeInstant } from '../dates.js';
import {
  remindersForTask, snoozeReminder, acknowledgeReminder, cancelReminder, getReminder,
  scheduleCustomReminder, getSettings, nextRemindersFor,
} from '../scheduling.js';
import {
  planTask, completeTask, rescheduleTask, syncNextReminder, taskSchedule,
} from '../task-lifecycle.js';
import { EVENT, recordEvent, eventsForTask } from '../task-events.js';
import { subtaskProgressFor, subtasksFor } from '../subtasks.js';
import { blockedMap, blockersOf, blockedBy, unblockedBy } from '../dependencies.js';
import { attachmentCounts, attachmentsFor } from '../attachments.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  // "open" from the dashboard means everything unfinished, in progress included.
  const raw = req.query.status;
  const status = raw === 'all' ? undefined : raw === 'open' ? 'pending' : raw;
  const settings = getSettings();
  const rows = listTasks({ status, limit: req.query.limit });
  // One query each for the whole page rather than three per row.
  const ids = rows.map((t) => t.id);
  const progress = subtaskProgressFor(ids);
  const blocked = blockedMap(ids);
  const files = attachmentCounts(ids);
  const nextReminders = nextRemindersFor(ids);

  const tasks = rows.map((task) => ({
    ...task,
    ...taskSchedule(task, settings, { next: nextReminders.get(task.id) || {} }),
    subtask_progress: progress.get(task.id) || null,
    blocked_by: blocked.get(task.id) || [],
    attachment_count: files.get(task.id) || 0,
  }));
  res.json({ tasks, stats: taskStats() });
});

tasksRouter.post('/', (req, res) => {
  const {
    title, description, notes, contact, chat_name, due_date, due_at, priority, remind_at,
    reminder_offset, follow_up_offset, assigned_to, assigned_to_wid, requested_by,
  } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const task = createTask({
      title,
      description,
      contact,
      chat_name,
      due_date: normalizeDueDate(due_date),
      // The deadline itself, when a time was given rather than only a date.
      due_at: normalizeInstant(due_at || remind_at),
      remind_at: null,
      notes: notes || null,
      priority,
      source: 'manual',
      origin: 'manual',
      status: 'open',
      // A task typed by hand can be somebody else's from the start, and can
      // record who asked for it - the same two columns the extractor fills, so
      // a hand-written delegation is indistinguishable from a captured one.
      assigned_to,
      assigned_to_wid,
      requested_by,
    });
    recordEvent(task.id, EVENT.created, 'added by hand');
    if (task.assigned_to) recordEvent(task.id, EVENT.assigned, task.assigned_to);
    if (task.due_at || task.due_date) {
      recordEvent(task.id, EVENT.deadlineSet, task.due_at || task.due_date);
    }
    // Per-task overrides of the defaults, applied only when one was given.
    planTask(task, {
      reminderOffset: Number.isFinite(Number(reminder_offset)) ? Number(reminder_offset) : undefined,
      followUpOffset: Number.isFinite(Number(follow_up_offset)) ? Number(follow_up_offset) : undefined,
    });
    const fresh = getTask(task.id);
    res.status(201).json({ ...fresh, ...taskSchedule(fresh) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Everything the extractor was unsure about. Declared before '/:id' - Express
 * matches in order, and '/:id' would otherwise take "pending" for an id.
 */
tasksRouter.get('/pending/confirmation', (req, res) => {
  const tasks = listTasks({ status: 'all', limit: 500 })
    .filter((t) => t.needs_confirmation)
    .map((task) => ({ ...task, ...taskSchedule(task) }));
  res.json({ tasks });
});

tasksRouter.get('/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({
    ...task,
    ...taskSchedule(task),
    events: eventsForTask(task.id),
    subtasks: subtasksFor(task.id),
    blockers: blockersOf(task.id),
    blocking: blockedBy(task.id),
    attachments: attachmentsFor(task.id),
  });
});

/* ---------------- a task's reminders ---------------- */

tasksRouter.get('/:id/reminders', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({ reminders: remindersForTask(task.id) });
});

tasksRouter.post('/:id/reminders', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  try {
    const reminder = scheduleCustomReminder(
      task.id,
      normalizeInstant(req.body?.fire_at),
      req.body?.offset_minutes ?? null
    );
    syncNextReminder(task.id);
    res.status(201).json({ reminder, reminders: remindersForTask(task.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.delete('/:id/reminders/:reminderId', (req, res) => {
  const reminder = getReminder(Number(req.params.reminderId));
  if (!reminder || reminder.task_id !== Number(req.params.id)) {
    return res.status(404).json({ error: 'not found' });
  }
  cancelReminder(reminder.id);
  syncNextReminder(reminder.task_id);
  res.json({ reminders: remindersForTask(reminder.task_id) });
});

tasksRouter.patch('/:id', (req, res) => {
  const patch = { ...(req.body || {}) };
  if ('due_date' in patch) patch.due_date = normalizeDueDate(patch.due_date);
  if ('due_at' in patch) patch.due_at = normalizeInstant(patch.due_at);
  if ('remind_at' in patch) patch.remind_at = normalizeInstant(patch.remind_at);

  const before = getTask(Number(req.params.id));
  const task = updateTask(Number(req.params.id), patch);
  if (!task) return res.status(404).json({ error: 'not found' });

  // Every change worth looking back at is recorded before anything is rescheduled.
  if (patch.status && before && patch.status !== before.status) {
    recordEvent(task.id, EVENT.statusChanged, `${before.status} → ${patch.status}`,
      patch.status === 'waiting' && task.waiting_for ? { waiting_for: task.waiting_for } : null);
  }
  if ('notes' in patch && (patch.notes || '') !== (before?.notes || '')) {
    recordEvent(task.id, EVENT.noteAdded, patch.notes ? String(patch.notes).slice(0, 120) : 'cleared');
  }
  if (('title' in patch || 'description' in patch || 'priority' in patch) && before) {
    recordEvent(task.id, EVENT.edited, Object.keys(patch).join(', '));
  }
  if (task.status !== 'done' && before?.status === 'done') {
    recordEvent(task.id, EVENT.reopened);
  }

  // Finishing a task retires everything still scheduled for it.
  let unblocked = [];
  if (task.status === 'done' && before?.status !== 'done') {
    // Read before completing: once this one is done it is no longer a blocker,
    // so afterwards there would be nothing left to attribute the change to.
    unblocked = unblockedBy(task.id);
    completeTask(task.id);
    for (const freed of unblocked) {
      recordEvent(freed.id, EVENT.edited, `unblocked — "${task.title}" is done`);
    }
  } else if ('due_date' in patch || 'due_at' in patch) {
    // A new deadline restarts the whole cycle from that moment.
    rescheduleTask(task.id, { due_date: task.due_date, due_at: task.due_at });
  } else if (task.status !== 'done') {
    planTask(task);
  }
  const fresh = getTask(task.id);
  res.json({
    ...fresh,
    ...taskSchedule(fresh),
    events: eventsForTask(fresh.id),
    // So the dashboard can say "that freed up two other tasks" rather than
    // leaving the effect of finishing this one invisible.
    unblocked,
  });
});

/* ---------------- tasks the extractor was unsure about ---------------- */

/** "Yes, this is real." It becomes an ordinary task and enters the ladder. */
tasksRouter.post('/:id/confirm', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.needs_confirmation) {
    return res.json({ ...task, ...taskSchedule(task) });
  }
  updateTask(task.id, { needs_confirmation: 0 });
  const fresh = getTask(task.id);
  recordEvent(fresh.id, EVENT.edited, 'confirmed as a real task');
  planTask(fresh);
  const planned = getTask(fresh.id);
  res.json({ ...planned, ...taskSchedule(planned) });
});

/**
 * "No, that was not a task." Archived rather than deleted: what the extractor
 * got wrong is worth being able to look back at, and archiving already removes
 * it from every active view.
 */
tasksRouter.post('/:id/reject', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  updateTask(task.id, { archived_at: new Date().toISOString(), needs_confirmation: 0 });
  recordEvent(task.id, EVENT.archived, 'rejected — not a real task');
  res.json({ ok: true });
});

/* ---------------- acting on a fired reminder ---------------- */

tasksRouter.post('/reminders/:reminderId/snooze', (req, res) => {
  const minutes = Number(req.body?.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: 'minutes must be a positive number' });
  }
  const reminder = snoozeReminder(Number(req.params.reminderId), minutes);
  if (!reminder) return res.status(404).json({ error: 'not found' });
  recordEvent(reminder.task_id, EVENT.reminderSnoozed, `until ${reminder.fire_at}`);
  syncNextReminder(reminder.task_id);
  res.json({ reminder });
});

tasksRouter.post('/reminders/:reminderId/acknowledge', (req, res) => {
  const reminder = acknowledgeReminder(Number(req.params.reminderId));
  if (!reminder) return res.status(404).json({ error: 'not found' });
  syncNextReminder(reminder.task_id);
  res.json({ reminder });
});

/** Moving a task's deadline, which restarts its reminder and follow-up cycle. */
tasksRouter.post('/:id/reschedule', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  try {
    const updated = rescheduleTask(task.id, {
      due_date: normalizeDueDate(req.body?.due_date),
      due_at: normalizeInstant(req.body?.due_at),
    });
    res.json({ ...updated, ...taskSchedule(updated) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Archive rather than delete. A completed task is a record of work done, and
 * losing it to a stray tap is not recoverable - `?hard=1` still does the old
 * thing for anyone who genuinely wants the row gone.
 */
tasksRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = getTask(id);
  if (!task) return res.status(404).json({ error: 'not found' });

  if (req.query.hard === '1') {
    deleteTask(id);
    return res.status(204).end();
  }

  completeTask(id);
  updateTask(id, { archived_at: new Date().toISOString() });
  recordEvent(id, EVENT.archived);
  res.json({ archived: true, id });
});

tasksRouter.post('/:id/restore', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  updateTask(task.id, { archived_at: '' });
  recordEvent(task.id, EVENT.statusChanged, 'restored from archive');
  const fresh = getTask(task.id);
  res.json({ ...fresh, ...taskSchedule(fresh) });
});
