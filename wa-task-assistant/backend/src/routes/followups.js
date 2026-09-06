import { Router } from 'express';
import { config } from '../config.js';
import { getTask, listTasks } from '../db.js';
import {
  getSettings, saveSettings,
  listNotifications, unreadNotificationCount, markNotificationRead,
  markAllNotificationsRead, dismissNotification,
} from '../scheduling.js';
import { taskSchedule, taskState, dueMoment } from '../task-lifecycle.js';
import { buildBriefing, maybeSendBriefing, localDay } from '../briefing.js';
import { briefingFor, recentBriefings } from '../scheduling.js';

/**
 * "Follow-ups" here means the user's own tasks that are past their deadline and
 * still not done - the app chasing them, not them chasing a customer.
 */
export const attentionRouter = Router();

attentionRouter.get('/', (req, res) => {
  const settings = getSettings();
  const now = new Date();

  const rows = listTasks({ status: 'pending', limit: 500 })
    .map((task) => ({ ...task, ...taskSchedule(task, settings) }))
    .filter((task) => ['due', 'overdue'].includes(task.state) || task.needs_attention);

  const dueToday = listTasks({ status: 'pending', limit: 500 }).filter((task) => {
    const due = dueMoment(task, settings);
    return due && due.toDateString() === now.toDateString() && taskState(task, now, settings) === task.status;
  }).length;

  res.json({
    tasks: rows.sort((a, b) => (a.due_at || '').localeCompare(b.due_at || '')),
    stats: {
      overdue: rows.filter((t) => t.state === 'overdue').length,
      due: rows.filter((t) => t.state === 'due').length,
      needsAttention: rows.filter((t) => t.needs_attention).length,
      dueToday,
    },
  });
});

/* ---------------- notifications ---------------- */

export const notificationsRouter = Router();

notificationsRouter.get('/', (req, res) => {
  res.json({
    notifications: listNotifications({ limit: req.query.limit }),
    unread: unreadNotificationCount(),
  });
});

notificationsRouter.post('/read-all', (req, res) => {
  res.json({ read: markAllNotificationsRead(), unread: unreadNotificationCount() });
});

notificationsRouter.post('/:id/read', (req, res) => {
  if (!markNotificationRead(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.json({ unread: unreadNotificationCount() });
});

notificationsRouter.delete('/:id', (req, res) => {
  if (!dismissNotification(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.json({ unread: unreadNotificationCount() });
});

/* ---------------- daily briefing ---------------- */

export const briefingRouter = Router();

/** A preview of exactly what would go out, plus whether today's already has. */
briefingRouter.get('/', (req, res) => {
  const day = localDay();
  const preview = buildBriefing();
  res.json({ day, today: briefingFor(day), recent: recentBriefings(14), preview: preview.text, total: preview.total });
});

/** Sends it now, bypassing the schedule. Used to check the wiring works. */
briefingRouter.post('/run', async (req, res, next) => {
  try {
    res.json(await maybeSendBriefing({ force: true }));
  } catch (err) {
    next(err);
  }
});

/* ---------------- settings ---------------- */

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  res.json({ settings: getSettings(), timezone: config.timezone });
});

settingsRouter.patch('/', (req, res) => {
  res.json({ settings: saveSettings(req.body || {}), timezone: config.timezone });
});
