import { Router } from 'express';
import { config } from '../config.js';
import {
  createFollowUp, updateFollowUp, deleteFollowUp, getFollowUp, listFollowUps,
  followUpStats, refreshFollowUpStatuses, logFollowUpEvent,
  scheduleReminder, remindersForFollowUp, cancelRemindersForFollowUp,
  getSettings, saveSettings, applyQuietHours,
  listNotifications, unreadNotificationCount, markNotificationRead,
  markAllNotificationsRead, dismissNotification,
} from '../scheduling.js';

export const followUpsRouter = Router();

/** Statuses are derived on read, so the list never shows a stale one. */
const fresh = () => {
  refreshFollowUpStatuses();
};

followUpsRouter.get('/', (req, res) => {
  fresh();
  res.json({ followUps: listFollowUps({ status: req.query.status }), stats: followUpStats() });
});

followUpsRouter.post('/', (req, res) => {
  try {
    const followUp = createFollowUp({ ...(req.body || {}), origin: 'manual' });
    if (req.body?.remind_at) {
      const at = applyQuietHours(new Date(req.body.remind_at), getSettings(), config.timezone);
      scheduleReminder({ followUpId: followUp.id, fireAt: at.toISOString() });
      logFollowUpEvent(followUp.id, 'reminder set', at.toISOString());
    }
    res.status(201).json(getFollowUp(followUp.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

followUpsRouter.get('/:id', (req, res) => {
  const followUp = getFollowUp(Number(req.params.id));
  if (!followUp) return res.status(404).json({ error: 'not found' });
  res.json(followUp);
});

followUpsRouter.patch('/:id', (req, res) => {
  try {
    const followUp = updateFollowUp(Number(req.params.id), req.body || {});
    if (!followUp) return res.status(404).json({ error: 'not found' });
    res.json(followUp);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Snooze moves the follow-up itself; its reminders are re-armed from the new date. */
followUpsRouter.post('/:id/snooze', (req, res) => {
  const days = Number(req.body?.days);
  const minutes = Number(req.body?.minutes);
  const followUp = getFollowUp(Number(req.params.id));
  if (!followUp) return res.status(404).json({ error: 'not found' });

  const shift = Number.isFinite(minutes) && minutes > 0
    ? minutes * 60000
    : Number.isFinite(days) && days > 0 ? days * 86400000 : null;
  if (!shift) return res.status(400).json({ error: 'days or minutes is required' });

  const nextAt = new Date(Date.now() + shift).toISOString();
  cancelRemindersForFollowUp(followUp.id);
  const updated = updateFollowUp(followUp.id, { due_at: nextAt, status: 'snoozed' });
  scheduleReminder({ followUpId: followUp.id, fireAt: nextAt });
  logFollowUpEvent(followUp.id, 'snoozed', nextAt);
  res.json(getFollowUp(updated.id));
});

followUpsRouter.post('/:id/reminders', (req, res) => {
  const followUp = getFollowUp(Number(req.params.id));
  if (!followUp) return res.status(404).json({ error: 'not found' });
  try {
    const at = applyQuietHours(new Date(req.body?.fire_at), getSettings(), config.timezone);
    scheduleReminder({ followUpId: followUp.id, fireAt: at.toISOString() });
    logFollowUpEvent(followUp.id, 'reminder set', at.toISOString());
    res.status(201).json({ reminders: remindersForFollowUp(followUp.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

followUpsRouter.delete('/:id', (req, res) => {
  if (!deleteFollowUp(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/* ---------------- notifications ---------------- */

export const notificationsRouter = Router();

notificationsRouter.get('/', (req, res) => {
  res.json({ notifications: listNotifications({ limit: req.query.limit }), unread: unreadNotificationCount() });
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

/* ---------------- reminder & follow-up settings ---------------- */

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  res.json({ settings: getSettings(), timezone: config.timezone });
});

settingsRouter.patch('/', (req, res) => {
  res.json({ settings: saveSettings(req.body || {}), timezone: config.timezone });
});
