import { Router } from 'express';
import { createTask, getTask, listTasks, updateTask, deleteTask, taskStats } from '../db.js';
import { normalizeDueDate } from '../dates.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  const status = req.query.status === 'all' ? undefined : req.query.status;
  res.json({ tasks: listTasks({ status, limit: req.query.limit }), stats: taskStats() });
});

tasksRouter.post('/', (req, res) => {
  const { title, description, contact, chat_name, due_date, priority } = req.body || {};
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
      priority,
      source: 'manual',
      status: 'open',
    });
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.get('/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json(task);
});

tasksRouter.patch('/:id', (req, res) => {
  const patch = { ...(req.body || {}) };
  if ('due_date' in patch) patch.due_date = normalizeDueDate(patch.due_date);
  const task = updateTask(Number(req.params.id), patch);
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json(task);
});

tasksRouter.delete('/:id', (req, res) => {
  const removed = deleteTask(Number(req.params.id));
  if (!removed) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
