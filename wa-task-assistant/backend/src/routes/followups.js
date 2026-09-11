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
  maybeSendLawDigest, buildDigest, digestFor, recentDigests, feeds, digestKey, messageShape,
} from '../law-digest.js';
import {
  CATEGORY_GROUPS, LEGAL_GROUPS, RULING_TYPES,
  listUpdates, getUpdate, markUpdate, updateCounts, groupCounts, clientMessage,
  addWatch, removeWatch, getWatch, watchCounts,
} from '../law-updates.js';
import {
  maybeSendLegalDigest, buildLegalDigest, legalDigestFor, recentLegalDigests,
  legalFeeds, legalKey, legalShape,
} from '../law-legal.js';

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
    counts: updateCounts('tax'),
    groups: CATEGORY_GROUPS.map((g) => ({ ...g, count: groupCounts('tax')[g.key] || 0 })),
    // The empty lines the model is asked to fill, so the page can show what a
    // digest looks like before one has been paid for.
    shape: messageShape(),
    settings: {
      on: getSettings().lawDigest,
      time: getSettings().lawDigestTime,
    },
  });
});

/* ---------------- watches, on both modules ---------------- */

/**
 * A watch is a standing interest: a saved search with a name.
 *
 * "Section 138 NI Act" is the whole of a recovery practice - the judgment
 * matters in March and in October, and nobody wants to remember to search for
 * it every morning. Mounted on both routers from one function because a watch
 * is the same object in either list; only the module it belongs to differs.
 */
function mountWatches(router, mod) {
  router.get('/watches', (req, res) => {
    res.json({ watches: watchCounts(mod, { when: req.query.when || null }) });
  });

  router.post('/watches', (req, res) => {
    try {
      const watch = addWatch({ module: mod, label: req.body?.label, terms: req.body?.terms });
      res.status(201).json({ watch, watches: watchCounts(mod) });
    } catch (err) {
      // A name with no terms, or a two-letter term, is the user's to correct -
      // not a 500 with the reason hidden in the log.
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  router.delete('/watches/:id', (req, res) => {
    const watch = getWatch(req.params.id);
    if (!watch || watch.module !== mod) return res.status(404).json({ error: 'not found' });
    removeWatch(req.params.id);
    res.json({ watches: watchCounts(mod) });
  });
}

/**
 * `?watch=<id>` scopes the list to one watch.
 *
 * The terms are resolved here rather than sent by the client, so a watch's
 * definition lives in exactly one place and editing it changes every list that
 * reads it.
 */
const watchFilter = (id, mod) => {
  const watch = id ? getWatch(id) : null;
  return watch && watch.module === mod ? watch.termList : null;
};

mountWatches(lawDigestRouter, 'tax');

/**
 * The updates themselves, filtered.
 *
 * Everything is a query parameter and everything is optional, so the page can
 * ask for exactly what is on screen without the server knowing anything about
 * the shape of the page.
 */
lawDigestRouter.get('/updates', (req, res) => {
  const q = req.query;
  const { updates, total } = listUpdates({
    module: 'tax',
    terms: watchFilter(q.watch, 'tax'),
    group: q.group || null,
    category: q.category || null,
    priority: q.priority || null,
    source: q.source || null,
    status: q.status || null,
    important: q.important === '1' || q.important === 'true',
    docType: q.docType || null,
    deadlinesOnly: q.deadlines === '1' || q.deadlines === 'true',
    when: q.when || null,
    from: q.from || null,
    to: q.to || null,
    q: q.q || null,
    limit: q.limit,
    offset: q.offset,
  });
  res.json({
    updates,
    total,
    counts: updateCounts('tax'),
    groups: CATEGORY_GROUPS.map((g) => ({ ...g, count: groupCounts('tax')[g.key] || 0 })),
    watches: watchCounts('tax'),
  });
});

/** Reviewed, starred, archived - the marks a team puts on a list like this. */
lawDigestRouter.patch('/updates/:id', (req, res) => {
  const updated = markUpdate(req.params.id, {
    status: req.body?.status,
    important: req.body?.important,
    reviewedBy: req.body?.reviewedBy,
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ update: updated });
});

/**
 * A message about one update, ready to send on.
 *
 * Assembled from the stored row, not from a second AI call: the facts are
 * already recorded, and asking a model to re-word a legal fact is asking for a
 * chance to get it wrong. It names no client and attaches to none.
 */
lawDigestRouter.get('/updates/:id/message', (req, res) => {
  const update = getUpdate(req.params.id);
  if (!update) return res.status(404).json({ error: 'not found' });
  const channel = req.query.channel === 'email' ? 'email' : 'whatsapp';
  res.json({ channel, text: clientMessage(update, channel) });
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

/* ---------------- legal & court updates ---------------- */

/**
 * The second module, deliberately its own router.
 *
 * It mirrors the tax one rather than sharing its routes: the two lists have
 * different categories, different filters and different digests, and a single
 * endpoint with a `module` switch would have made every future change to one of
 * them a change to both.
 */
export const legalRouter = Router();

const legalGroups = () => LEGAL_GROUPS.map((g) => ({
  ...g,
  count: groupCounts('legal')[g.key] || 0,
}));

mountWatches(legalRouter, 'legal');

legalRouter.get('/', (req, res) => {
  const day = localDay();
  res.json({
    day,
    today: legalDigestFor(day),
    recent: recentLegalDigests(7),
    sent: briefingFor(legalKey()),
    sources: legalFeeds().map((f) => f.name),
    counts: updateCounts('legal'),
    groups: legalGroups(),
    rulingTypes: RULING_TYPES,
    shape: legalShape(),
    settings: {
      on: getSettings().legalDigest,
      time: getSettings().legalDigestTime,
    },
  });
});

legalRouter.get('/updates', (req, res) => {
  const q = req.query;
  const { updates, total } = listUpdates({
    module: 'legal',
    terms: watchFilter(q.watch, 'legal'),
    group: q.group || null,
    category: q.category || null,
    priority: q.priority || null,
    source: q.source || null,
    status: q.status || null,
    important: q.important === '1' || q.important === 'true',
    docType: q.docType || null,
    court: q.court || null,
    legalArea: q.legalArea || null,
    rulingType: q.rulingType || null,
    when: q.when || null,
    from: q.from || null,
    to: q.to || null,
    q: q.q || null,
    limit: q.limit,
    offset: q.offset,
  });
  res.json({
    updates, total, counts: updateCounts('legal'), groups: legalGroups(),
    watches: watchCounts('legal'),
  });
});

legalRouter.patch('/updates/:id', (req, res) => {
  const updated = markUpdate(req.params.id, {
    status: req.body?.status,
    important: req.body?.important,
    reviewedBy: req.body?.reviewedBy,
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ update: updated });
});

legalRouter.get('/updates/:id/message', (req, res) => {
  const update = getUpdate(req.params.id);
  if (!update) return res.status(404).json({ error: 'not found' });
  const channel = req.query.channel === 'email' ? 'email' : 'whatsapp';
  res.json({ channel, text: clientMessage(update, channel) });
});

/** Fetch and read the courts now, without sending. */
legalRouter.post('/preview', async (req, res) => {
  try {
    res.json(await buildLegalDigest());
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
});

/** Build it and send it to the linked account's own chat, now. */
legalRouter.post('/run', async (req, res, next) => {
  try {
    res.json(await maybeSendLegalDigest({ force: true }));
  } catch (err) {
    next(err);
  }
});
