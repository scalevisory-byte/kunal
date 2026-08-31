import { Router } from 'express';
import { config } from '../config.js';
import {
  listMessages, savePushSubscription, deletePushSubscription, taskStats,
  listBlockedChats, blockChat, unblockChat, recentChats,
} from '../db.js';
import { state, flushNow } from '../whatsapp.js';
import { runReminderCheck, runExactReminders } from '../reminders.js';
import { vapidEnabled } from '../push.js';
import { authEnabled, authStats } from '../auth.js';

export const systemRouter = Router();

/** Connection + pipeline status, including the QR code while login is pending. */
systemRouter.get('/status', (req, res) => {
  res.json({
    whatsapp: {
      mode: state.mode,
      status: state.status,
      me: state.me,
      qrDataUrl: state.qrDataUrl,
      lastMessageAt: state.lastMessageAt,
      lastExtractionAt: state.lastExtractionAt,
      bufferedCount: state.bufferedCount,
      blockedCount: state.blockedCount,
      lastCommandAt: state.lastCommandAt,
      lastError: state.lastError,
    },
    tasks: taskStats(),
    security: authStats(),
    config: {
      extractionMode: config.extractionMode,
      taskTrigger: config.taskTrigger,
      model: config.extractionMode === 'ai' ? config.model : null,
      timezone: config.timezone,
      batchQuietSeconds: config.batchQuietMs / 1000,
      reminderCron: [config.reminderCronMorning, config.reminderCronEvening],
      authEnabled,
      pushEnabled: vapidEnabled,
      blockedChats: listBlockedChats().length,
    },
  });
});

systemRouter.get('/messages', (req, res) => {
  res.json({ messages: listMessages({ limit: req.query.limit }) });
});

/** Process whatever is buffered right now instead of waiting for the quiet window. */
systemRouter.post('/extract/flush', async (req, res, next) => {
  try {
    await flushNow();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Run the reminder digest on demand (same code path as the cron job). */
systemRouter.post('/reminders/run', async (req, res, next) => {
  try {
    res.json(await runReminderCheck({ label: 'manual' }));
  } catch (err) {
    next(err);
  }
});

systemRouter.get('/push/public-key', (req, res) => {
  res.json({ enabled: vapidEnabled, publicKey: config.vapid.publicKey || null });
});

systemRouter.post('/push/subscribe', (req, res) => {
  const sub = req.body || {};
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return res.status(400).json({ error: 'invalid subscription' });
  }
  savePushSubscription(sub);
  res.status(201).json({ ok: true });
});

systemRouter.post('/push/unsubscribe', (req, res) => {
  if (!req.body?.endpoint) return res.status(400).json({ error: 'endpoint is required' });
  deletePushSubscription(req.body.endpoint);
  res.json({ ok: true });
});

/* ---------------- blocked chats ---------------- */

systemRouter.get('/blocked-chats', (req, res) => {
  res.json({ blocked: listBlockedChats(), recent: recentChats(req.query.limit) });
});

systemRouter.post('/blocked-chats', (req, res) => {
  try {
    res.status(201).json({ blocked: blockChat(req.body?.pattern) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

systemRouter.delete('/blocked-chats/:id', (req, res) => {
  if (!unblockChat(Number(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.json({ blocked: listBlockedChats() });
});

/** Fire any exact-time reminders that are due right now. */
systemRouter.post('/reminders/exact', async (req, res, next) => {
  try {
    res.json(await runExactReminders());
  } catch (err) {
    next(err);
  }
});
