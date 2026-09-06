import { Router } from 'express';
import { createTask, getTask, listTasks, updateTask, deleteTask, taskStats } from '../db.js';
import { normalizeDueDate } from '../dates.js';
import {
  remindersForTask, snoozeReminder, acknowledgeReminder, cancelReminder, getReminder,
  scheduleCustomReminder, getSettings,
} from '../scheduling.js';
import {
  planTask, completeTask, rescheduleTask, syncNextReminder, taskSchedule,
} from '../task-lifecycle.js';
import { EVENT, recordEvent, eventsForTask } from '../task-events.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  // "open" from the dashboard means everything unfinished, in progress included.
  const raw = req.query.status;
  const status = raw === 'all' ? undefined : raw === 'open' ? 'pending' : raw;
  const settings = getSettings();
  const tasks = listTasks({ status, limit: req.query.limit })
    .map((task) => ({ ...task, ...taskSchedule(task, settings) }));
  res.json({ tasks, stats: taskStats() });
});

tasksRouter.post('/', (req, res) => {
  const {
    title, description, notes, contact, chat_name, due_date, due_at, priority, remind_at,
    reminder_offset, follow_up_offset,
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
      due_at: due_at || remind_at || null,
      remind_at: null,
      notes: notes || null,
      priority,
      source: 'manual',
      origin: 'manual',
      status: 'open',
    });
    recordEvent(task.id, EVENT.created, 'added by hand');
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

tasksRouter.get('/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({ ...task, ...taskSchedule(task), events: eventsForTask(task.id) });
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
      req.body?.fire_at,
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
  if (task.status === 'done' && before?.status !== 'done') {
    completeTask(task.id);
  } else if ('due_date' in patch || 'due_at' in patch) {
    // A new deadline restarts the whole cycle from that moment.
    rescheduleTask(task.id, { due_date: task.due_date, due_at: task.due_at });
  } else if (task.status !== 'done') {
    planTask(task);
  }
  const fresh = getTask(task.id);
  res.json({ ...fresh, ...taskSchedule(fresh), events: eventsForTask(fresh.id) });
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
      due_at: req.body?.due_at || null,
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
