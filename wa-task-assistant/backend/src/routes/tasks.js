import { Router } from 'express';
import { createTask, getTask, listTasks, updateTask, deleteTask, taskStats } from '../db.js';
import { normalizeDueDate } from '../dates.js';
import {
  remindersForTask, snoozeReminder, acknowledgeReminder, rescheduleReminder,
  cancelReminder, getReminder,
} from '../scheduling.js';
import { addTaskReminder, clearTaskReminders, syncTaskRemindAt } from '../task-reminders.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  // "open" from the dashboard means everything unfinished, in progress included.
  const raw = req.query.status;
  const status = raw === 'all' ? undefined : raw === 'open' ? 'pending' : raw;
  res.json({ tasks: listTasks({ status, limit: req.query.limit }), stats: taskStats() });
});

tasksRouter.post('/', (req, res) => {
  const { title, description, contact, chat_name, due_date, priority, remind_at } = req.body || {};
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
      remind_at: remind_at || null,
      priority,
      source: 'manual',
      origin: 'manual',
      status: 'open',
    });
    if (task.remind_at) addTaskReminder(task.id, task.remind_at);
    res.status(201).json(getTask(task.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.get('/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({ ...task, reminders: remindersForTask(task.id) });
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
    const reminder = addTaskReminder(
      task.id,
      req.body?.fire_at,
      req.body?.offset_minutes ?? null
    );
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
  syncTaskRemindAt(reminder.task_id);
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
    clearTaskReminders(task.id);
  }
  // A reminder time set the old way still has to reach the engine.
  if ('remind_at' in patch && patch.remind_at && task.remind_at) {
    addTaskReminder(task.id, task.remind_at);
  }
  res.json({ ...getTask(task.id), reminders: remindersForTask(task.id) });
});

/* ---------------- acting on a fired reminder ---------------- */

tasksRouter.post('/reminders/:reminderId/snooze', (req, res) => {
  const minutes = Number(req.body?.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: 'minutes must be a positive number' });
  }
  const reminder = snoozeReminder(Number(req.params.reminderId), minutes);
  if (!reminder) return res.status(404).json({ error: 'not found' });
  if (reminder.task_id) syncTaskRemindAt(reminder.task_id);
  res.json({ reminder });
});

tasksRouter.post('/reminders/:reminderId/acknowledge', (req, res) => {
  const reminder = acknowledgeReminder(Number(req.params.reminderId));
  if (!reminder) return res.status(404).json({ error: 'not found' });
  if (reminder.task_id) syncTaskRemindAt(reminder.task_id);
  res.json({ reminder });
});

tasksRouter.post('/reminders/:reminderId/reschedule', (req, res) => {
  try {
    const reminder = rescheduleReminder(Number(req.params.reminderId), req.body?.fire_at);
    if (!reminder) return res.status(404).json({ error: 'not found' });
    if (reminder.task_id) syncTaskRemindAt(reminder.task_id);
    res.json({ reminder });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.delete('/:id', (req, res) => {
  const removed = deleteTask(Number(req.params.id));
  if (!removed) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
