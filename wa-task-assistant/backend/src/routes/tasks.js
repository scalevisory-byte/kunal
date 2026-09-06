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
  const { title, description, contact, chat_name, due_date, due_at, priority, remind_at } = req.body || {};
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
      priority,
      source: 'manual',
      origin: 'manual',
      status: 'open',
    });
    planTask(task);
    const fresh = getTask(task.id);
    res.status(201).json({ ...fresh, ...taskSchedule(fresh) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.get('/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({ ...task, ...taskSchedule(task) });
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
  res.json({ ...fresh, ...taskSchedule(fresh) });
});

/* ---------------- acting on a fired reminder ---------------- */

tasksRouter.post('/reminders/:reminderId/snooze', (req, res) => {
  const minutes = Number(req.body?.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: 'minutes must be a positive number' });
  }
  const reminder = snoozeReminder(Number(req.params.reminderId), minutes);
  if (!reminder) return res.status(404).json({ error: 'not found' });
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

tasksRouter.delete('/:id', (req, res) => {
  const removed = deleteTask(Number(req.params.id));
  if (!removed) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
