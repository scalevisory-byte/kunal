import { Router } from 'express';
import { config } from '../config.js';
import { getTask, listTasks } from '../db.js';
import {
  getSettings, saveSettings,
  listNotifications, unreadNotificationCount, markNotificationRead,
  markAllNotificationsRead, dismissNotification,
} from '../scheduling.js';
import { taskSchedule, taskState, dueMoment } from '../task-lifecycle.js';
import {
  buildBriefing, maybeSendBriefing, localDay,
  buildWeeklySummary, maybeSendWeekly, localWeek,
} from '../briefing.js';
import { briefingFor, recentBriefings, engineOverview } from '../scheduling.js';
import {
  maybeSendLawDigest, buildDigest, digestFor, recentDigests, feeds, digestKey,
} from '../law-digest.js';

/**
 * "Follow-ups" here means the user's own tasks that are past their deadline and
 * still not done - the app chasing them, not them chasing a customer.
 */
export const attentionRouter = Router();

/**
 * The engine's live state: what is scheduled, what has fired, what was missed,
 * and what it has given up on. Read-only - acting on a row goes through the
 * task routes that already exist, so there is one path for every change.
 */
attentionRouter.get('/engine', (req, res) => {
  const settings = getSettings();
  res.json({
    ...engineOverview({ upcoming: req.query.upcoming, recent: req.query.recent }),
    settings,
    timezone: config.timezone,
  });
});

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

/** The week's review, same shape: a preview and a way to send it now. */
briefingRouter.get('/weekly', (req, res) => {
  const week = localWeek();
  const preview = buildWeeklySummary();
  res.json({ week, sent: briefingFor(week), preview: preview.text, finished: preview.finished });
});

briefingRouter.post('/weekly/run', async (req, res, next) => {
  try {
    res.json(await maybeSendWeekly({ force: true }));
  } catch (err) {
    next(err);
  }
});

/* ---------------- law digest ---------------- */

export const lawDigestRouter = Router();

/**
 * What is stored, and nothing more.
 *
 * The briefing's preview is free - it reads tasks already in the database - so
 * it is built on every page load. This one costs an API call and five network
 * fetches, so opening Settings must never trigger it: the page shows the digest
 * that was last built, and building a new one is a button.
 */
lawDigestRouter.get('/', (req, res) => {
  const day = localDay();
  res.json({
    day,
    today: digestFor(day),
    recent: recentDigests(7),
    sent: briefingFor(digestKey()),
    sources: feeds().map((f) => f.name),
    settings: {
      on: getSettings().lawDigest,
      time: getSettings().lawDigestTime,
    },
  });
});

/** Fetch and summarise now, without sending: what today's message would say. */
lawDigestRouter.post('/preview', async (req, res, next) => {
  try {
    res.json(await buildDigest());
  } catch (err) {
    // A feed being unreachable is the expected failure here and is the user's
    // to see, not a 500 with the detail hidden in the server log.
    res.status(502).json({ error: String(err?.message || err) });
  }
});

/** Builds it and sends it to the linked account's own chat, now. */
lawDigestRouter.post('/run', async (req, res, next) => {
  try {
    res.json(await maybeSendLawDigest({ force: true }));
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
