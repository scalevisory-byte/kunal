import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

export const config = {
  port: num(process.env.PORT, 3001),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : true,
  serveFrontend: process.env.SERVE_FRONTEND !== 'false',
  dataDir,
  dbPath: path.join(dataDir, 'tasks.db'),
  waSessionDir: path.join(dataDir, 'wa-session'),
  // Chromium's disk cache, deliberately NOT on the data volume: it is rebuilt
  // from the network whenever it is missing, and left on the volume it grows
  // without limit until writes start failing and the app cannot boot.
  browserCacheDir: process.env.BROWSER_CACHE_DIR
    || path.join(os.tmpdir(), 'wa-browser-cache'),

  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',

  // 'ai'     - Claude reads every incoming chat and decides what is a task.
  // 'manual' - no AI and no API key. Tasks come only from messages you write or
  //            forward to yourself, so nobody else's chats are read or stored.
  extractionMode: (process.env.EXTRACTION_MODE || 'ai').toLowerCase() === 'manual' ? 'manual' : 'ai',
  // Prefix that turns a message you send in ANY chat into a task. Empty disables it.
  taskTrigger: process.env.TASK_TRIGGER === undefined ? '#task' : process.env.TASK_TRIGGER.trim(),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  // Per the project spec. Swap to `claude-opus-5` for harder extraction.
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',

  // Claude can read a photo, so an invoice or a screenshot can become a task
  // the same way a sentence does. Off by default: every image is roughly a
  // page of tokens, and a chat full of forwarded good-mornings would spend
  // real money on nothing. Turn it on in Settings.
  readImages: process.env.READ_IMAGES === 'true',
  // A WhatsApp photo above this is downscaled by WhatsApp already; anything
  // larger than this is refused rather than sent, so one huge file cannot
  // quietly cost a fortune.
  maxImageBytes: Number(process.env.MAX_IMAGE_BYTES) || 4_000_000,

  /*
   * Reading what arrived while this was not running.
   *
   * Both caps exist to stop a single boot turning into a bill: without them,
   * "catch up" over a long outage means every unread message in 200 chats going
   * to the API at once. Per-chat first, then a hard total, oldest trimmed away -
   * the messages nearest the gap are the ones most likely still to matter.
   */
  catchUpPerChat: Number(process.env.CATCH_UP_PER_CHAT) || 20,
  catchUpMax: Number(process.env.CATCH_UP_MAX) || 120,

  /*
   * Voice notes. Claude reads text and pictures but not audio, so this is the
   * one step that needs a service outside Anthropic - and which one matters,
   * because these notes move between Gujarati, Hindi and English mid-sentence.
   * With no key the feature is off and voice notes are left alone.
   */
  speechProvider: (process.env.SPEECH_PROVIDER || 'sarvam').toLowerCase(),
  speechApiKey: process.env.SPEECH_API_KEY || '',
  speechModel: process.env.SPEECH_MODEL || '',
  speechLanguage: process.env.SPEECH_LANGUAGE || '',
  speechTimeoutMs: Number(process.env.SPEECH_TIMEOUT_MS) || 30_000,
  maxAudioBytes: Number(process.env.MAX_AUDIO_BYTES) || 8_000_000,

  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  // Only used to show the dollar estimate in rupees as well. The rate is shown
  // alongside the figure so it is never mistaken for a live conversion.
  usdInr: num(process.env.USD_INR, 88),
  reminderTo: (process.env.REMINDER_TO || '').replace(/[^\d]/g, ''),
  reminderCronMorning: process.env.REMINDER_CRON_MORNING || '30 8 * * *',
  reminderCronEvening: process.env.REMINDER_CRON_EVENING || '0 18 * * *',
  // How often to check for tasks with a specific reminder time.
  exactReminderCron: process.env.EXACT_REMINDER_CRON || '*/5 * * * *',
  /*
   * How long a quiet chat waits before its messages are read.
   *
   * Thirty seconds rather than fifteen, because every call carries the same
   * three thousand tokens of instructions whatever it is asked to read: two
   * messages in one call cost half what the same two cost in two calls. The
   * price of waiting is that a task appears half a minute later, which nothing
   * here depends on - the reminders it drives are hours or days away.
   */
  batchQuietMs: num(process.env.BATCH_QUIET_SECONDS, 30) * 1000,
  /*
   * A ceiling on the wait, and on the batch.
   *
   * The quiet window alone is a debounce with no maximum: every arriving
   * message pushed the deadline back another fifteen seconds, so on a busy
   * account - two hundred chats, messages seconds apart all through the
   * working day - it could be reset indefinitely and the batch never sent.
   * Which is exactly what happened: a morning of traffic and one task.
   *
   * So the batch also goes when it has waited long enough, or grown large
   * enough, whichever comes first.
   *
   * Four minutes, raised from ninety seconds for the reason above: on a busy
   * day the ceiling is what decides how many calls there are, and six hundred
   * calls a day was six hundred copies of the same preamble. The same traffic
   * in four-minute batches is a third of the calls and very close to the same
   * tasks - what changes is that a message read at 11:00 becomes a task by
   * 11:04 rather than 11:01.
   *
   * Four rather than five on purpose. A cached prompt lives five minutes from
   * the start of the call that last touched it, so calls spaced four minutes
   * apart keep the cache warm and pay a tenth for the preamble, while calls
   * spaced five apart would miss it every time - and a cache write costs a
   * quarter MORE than a plain call. The ceiling has to sit inside the window
   * it depends on.
   */
  batchMaxWaitMs: num(process.env.BATCH_MAX_WAIT_SECONDS, 240) * 1000,
  batchMaxMessages: num(process.env.BATCH_MAX_MESSAGES, 40),
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
};

export const vapidEnabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);
