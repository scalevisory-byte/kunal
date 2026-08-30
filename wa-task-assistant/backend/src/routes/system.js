import { Router } from 'express';
import { config } from '../config.js';
import { listMessages, savePushSubscription, deletePushSubscription, taskStats } from '../db.js';
import { state, flushNow } from '../whatsapp.js';
import { runReminderCheck } from '../reminders.js';
import { vapidEnabled } from '../push.js';
import { authEnabled } from '../auth.js';

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
      lastError: state.lastError,
    },
    tasks: taskStats(),
    config: {
      extractionMode: config.extractionMode,
      taskTrigger: config.taskTrigger,
      model: config.extractionMode === 'ai' ? config.model : null,
      timezone: config.timezone,
      batchQuietSeconds: config.batchQuietMs / 1000,
      reminderCron: [config.reminderCronMorning, config.reminderCronEvening],
      authEnabled,
      pushEnabled: vapidEnabled,
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
