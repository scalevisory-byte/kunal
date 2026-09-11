import { Router } from 'express';
import { config } from '../config.js';
import {
  listMessages, listMessagesWithOutcome, savePushSubscription, deletePushSubscription, taskStats,
  listBlockedChats, blockChat, unblockChat, recentChats,
} from '../db.js';
import { state, flushNow, groupNameFor, reprocessStored } from '../whatsapp.js';
import { repairGroupNames, groupChatIds, needsName, nameFromSiblings } from '../group-names.js';
import { runReminderCheck, runExactReminders } from '../reminders.js';
import { transcriptionState } from '../transcribe.js';
import { vapidEnabled } from '../push.js';
import { authEnabled, authStats } from '../auth.js';
import { diagnostics } from '../diagnostics.js';
import { extractTasks } from '../extractor.js';
import {
  usageByDay, usageTotals, unprocessedCount, usageByKind, messageVolumeByChat, blockEffect,
  messagesWithoutTasks, quietSenders,
} from '../db.js';
import { PRICES, PRICES_UPDATED, CACHE_MINIMUM, costOf } from '../pricing.js';

export const systemRouter = Router();

/** Connection + pipeline status, including the QR code while login is pending. */
systemRouter.get('/status', (req, res) => {
  res.json({
    whatsapp: {
      mode: state.mode,
      status: state.status,
      // How long the sync has been running, so the dashboard can tell "be
      // patient" from "this has been three hours and something is wrong".
      authenticatedAt: state.authenticatedAt,
      /*
       * Messages taken in but never put through the extractor. Normally zero.
       * A number here is the answer to "why did nothing become a task?" - and
       * it is recoverable, because the messages themselves are on disk.
       */
      waitingToExtract: unprocessedCount(),
      me: state.me,
      meName: state.meName,
      qrDataUrl: state.qrDataUrl,
      lastMessageAt: state.lastMessageAt,
      lastExtractionAt: state.lastExtractionAt,
      bufferedCount: state.bufferedCount,
      blockedCount: state.blockedCount,
      lastCommandAt: state.lastCommandAt,
      lastError: state.lastError,
      events: state.events,
      rawSeen: state.rawSeen,
      drops: state.drops,
      lastDropError: state.lastDropError,
      messagesSeen: state.messagesSeen,
      // So an empty "Task allotted" can say which half is not working.
      ownSeen: state.ownSeen,
      delegatedCreated: state.delegatedCreated,
      // Totals that survive a restart; the since-start pair above resets on
      // every deploy, which is exactly when somebody comes looking.
      ownSeenEver: state.ownSeenEver,
      // Each one silently cost a group name and a sender.
      chatLookupFailures: state.chatLookupFailures,
      delegatedEver: state.delegatedEver,
      tasksCreated: state.tasksCreated,
      lastExtraction: state.lastExtraction,
    },
    tasks: taskStats(),
    security: authStats(),
    diagnostics: diagnostics(),
    config: {
      extractionMode: config.extractionMode,
      taskTrigger: config.taskTrigger,
      model: config.extractionMode === 'ai' ? config.model : null,
      timezone: config.timezone,
      batchQuietSeconds: config.batchQuietMs / 1000,
      reminderCron: [config.reminderCronMorning, config.reminderCronEvening],
      authEnabled,
      // Presence only. The key itself never leaves the server.
      apiKeySet: Boolean(config.anthropicApiKey),
      pushEnabled: vapidEnabled,
      // Whether voice notes can be read, and by whom. Never the key itself.
      speech: transcriptionState(),
      blockedChats: listBlockedChats().length,
    },
  });
});

/**
 * Runs one synthetic message through the extractor. This is the quickest way to
 * tell a missing or wrong ANTHROPIC_API_KEY apart from chats that simply have
 * nothing actionable in them.
 */
/**
 * What the app knows about the groups it has seen, and what it cannot name.
 *
 * Here because "the group name is missing" is answered three different ways -
 * the name was never stored, it was stored as an id, or the task never carried
 * the chat - and from the outside they look identical. This says which.
 */
systemRouter.get('/group-names', (req, res) => {
  const chats = groupChatIds().map((chatId) => ({
    chat_id: chatId,
    stored_name: nameFromSiblings(chatId),
    needs_name: needsName(chatId),
  }));
  res.json({
    groups: chats.length,
    unnamed: chats.filter((c) => c.needs_name && !c.stored_name).length,
    fixable_now: chats.filter((c) => c.needs_name && c.stored_name).length,
    // Only ids and names of the user's own groups - no message content.
    chats: chats.slice(0, 100),
    whatsapp: state.status,
  });
});

/**
 * Ask WhatsApp for the names it has and write them in, on demand.
 *
 * The same repair the session runs when it becomes ready, reachable from the
 * dashboard so it does not have to wait for a restart - and so it can report a
 * number rather than leaving the question open.
 */
systemRouter.post('/group-names/repair', async (req, res) => {
  try {
    const result = await repairGroupNames(groupNameFor);
    res.json({ ...result, whatsapp: state.status });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'could not read the group names' });
  }
});

systemRouter.post('/selftest', async (req, res) => {
  if (config.extractionMode !== 'ai') {
    return res.json({ ok: false, error: 'Extraction mode is manual, so no AI is used.' });
  }
  const sample = [{
    id: null,
    chat_name: 'Self test',
    contact_name: 'Self test',
    contact_number: null,
    is_group: 0,
    sent_at: new Date().toISOString(),
    body: 'Bhai kal 5 baje tak GST invoice bhej dena, urgent hai.',
  }];
  try {
    const tasks = await extractTasks(sample);
    res.json({
      ok: true,
      model: config.model,
      tasks: tasks.map((t) => ({ title: t.title, due_date: t.due_date, priority: t.priority })),
    });
  } catch (err) {
    res.json({ ok: false, model: config.model, error: err?.message || String(err) });
  }
});

/**
 * What the AI has cost. Token counts are what the API actually reported on each
 * call; the money is those counts at Anthropic's published list prices. It is an
 * estimate - the real bill lives in the Anthropic Console, which this app has no
 * access to - so the response says as much.
 */
systemRouter.get('/usage', (req, res) => {
  const days = usageByDay(req.query.days);
  const totals = usageTotals();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';

  const withCost = days.map((d) => ({ ...d, ...costOf(d) }));
  const sum = (rows) => rows.reduce((n, d) => n + d.usd, 0);

  res.json({
    model: config.model,
    mode: config.extractionMode,
    prices: PRICES[config.model] || null,
    pricesUpdated: PRICES_UPDATED,
    usdInr: config.usdInr,
    days: withCost,
    today: {
      ...(withCost.find((d) => d.day === today) || { input_tokens: 0, output_tokens: 0, calls: 0, tasks: 0 }),
      usd: sum(withCost.filter((d) => d.day === today)),
    },
    month: {
      usd: sum(withCost.filter((d) => d.day >= monthStart)),
      calls: withCost.filter((d) => d.day >= monthStart).reduce((n, d) => n + d.calls, 0),
      tasks: withCost.filter((d) => d.day >= monthStart).reduce((n, d) => n + d.tasks, 0),
    },
    total: { ...totals, ...costOf({ ...totals, model: config.model }) },

    /* Where it went, and what it was spent on. */
    byKind: usageByKind(req.query.days).map((row) => ({ ...row, ...costOf(row) })),
    chats: messageVolumeByChat(req.query.days),
    /*
     * What each block has actually stopped. The busiest-chats list covers
     * thirty days, so a chat blocked yesterday still shows what it cost before
     * that - which is indistinguishable from a block that is not working.
     */
    blocking: blockEffect({ days: req.query.days }),
    /* Who is sending the messages that cost money and produce nothing. */
    quiet: quietSenders(req.query.days),

    /*
     * Whether the repeated instructions are actually being cached.
     *
     * Measured, not assumed: the request asks for caching every time, but a
     * model only caches a prefix above its own minimum and says nothing when it
     * declines. So this reports what the API reported back - if `read` is zero
     * after a day of calls, caching is not happening, and the minimum below is
     * almost always why.
     */
    caching: {
      minimum: CACHE_MINIMUM[config.model] ?? null,
      read: totals.cache_read || 0,
      written: totals.cache_write || 0,
      working: (totals.cache_read || 0) > 0,
      /*
       * No model is suggested here, deliberately.
       *
       * The obvious move looks like a model with a lower cache minimum, and it
       * was suggested for a while - wrongly. Switching model changes the price
       * of every token too: claude-sonnet-5 is twice the input rate and ten
       * times the output rate of haiku, and a cache WRITE costs a quarter more
       * than a plain call. Worked through on this workload it comes out level
       * or worse unless nine calls in ten hit a warm cache. What is true is
       * only the fact below; a saving would have to be measured, not promised.
       */
    },
  });
});

/**
 * The messages behind a figure, so it can be checked rather than believed.
 *
 * A chat is only worth blocking once you have read what is actually in it -
 * a group that produced no tasks might be forwards all day, or might be the
 * one place a client asks for things in a way the extractor keeps missing.
 * Those need opposite decisions, and only the messages tell them apart.
 */
systemRouter.get('/usage/quiet-messages', (req, res) => {
  const chat = typeof req.query.chat === 'string' && req.query.chat ? req.query.chat : null;
  res.json({
    chat,
    messages: messagesWithoutTasks({ chat, days: req.query.days, limit: req.query.limit }),
  });
});

systemRouter.get('/messages', (req, res) => {
  res.json({ messages: listMessagesWithOutcome({ limit: req.query.limit }) });
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

/**
 * Messages that were taken in but never extracted, and a way to run them.
 *
 * Every message is stored the moment it arrives, before any of the pipeline
 * runs, so a batch that was never sent - an API failure, or a scheduler that
 * kept deferring it - is still on disk in full. This says how many are
 * waiting; the POST puts them through the same path a live batch takes.
 */
systemRouter.get('/extract/pending', (req, res) => {
  res.json({ waiting: unprocessedCount() });
});

systemRouter.post('/extract/rerun', async (req, res, next) => {
  try {
    res.json(await reprocessStored({ limit: Number(req.body?.limit) || 200 }));
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
