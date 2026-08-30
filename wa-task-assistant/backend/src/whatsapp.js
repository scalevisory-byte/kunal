import pkg from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { config } from './config.js';
import { log } from './logger.js';
import { insertMessage, markMessagesProcessed, createTask } from './db.js';
import { extractTasks } from './extractor.js';

const { Client, LocalAuth } = pkg;

/** Chats we never scan: status broadcasts and WhatsApp's own service messages. */
const IGNORED_CHAT_IDS = new Set(['status@broadcast', '0@c.us']);

export const state = {
  status: 'starting', // starting | qr | authenticated | ready | disconnected | error
  qrDataUrl: null,
  me: null,
  lastMessageAt: null,
  lastExtractionAt: null,
  bufferedCount: 0,
  lastError: null,
};

let client = null;
let buffer = [];
let flushTimer = null;
let flushing = false;

export function getClient() {
  return client;
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushBuffer().catch((err) => log.error('flushBuffer:', err?.message || err));
  }, config.batchQuietMs);
}

/**
 * Send everything buffered since the last quiet period to Claude in one batch,
 * then persist whatever tasks come back.
 */
async function flushBuffer() {
  if (flushing) {
    scheduleFlush(); // something arrived mid-flight; try again after the next quiet window
    return;
  }
  const batch = buffer;
  buffer = [];
  state.bufferedCount = 0;
  if (!batch.length) return;

  flushing = true;
  try {
    const tasks = await extractTasks(batch);
    for (const task of tasks) {
      try {
        createTask(task);
        log.info(`Task created: "${task.title}"${task.due_date ? ` (due ${task.due_date})` : ''}`);
      } catch (err) {
        log.error('Could not store extracted task:', err?.message || err);
      }
    }
    markMessagesProcessed(batch.map((m) => m.id));
    state.lastExtractionAt = new Date().toISOString();
  } catch (err) {
    // Extraction failed (API down, rate limited). Leave the messages unprocessed
    // so they stay visible in /api/messages, but do not retry forever in a loop.
    log.error('Batch extraction failed, messages left unprocessed:', err?.message || err);
  } finally {
    flushing = false;
  }
}

/** Exported so the batching path can be driven directly in tests. */
export async function handleMessage(message) {
  try {
    if (IGNORED_CHAT_IDS.has(message.from)) return;
    if (message.isStatus) return;

    const body = (message.body || '').trim();
    if (!body) return; // media with no caption: nothing to extract from

    const chat = await message.getChat();
    if (IGNORED_CHAT_IDS.has(chat.id?._serialized)) return;

    const contact = await message.getContact();
    const contactName =
      contact?.pushname || contact?.name || contact?.verifiedName || contact?.number || null;

    const row = {
      wa_message_id: message.id?._serialized ?? null,
      chat_id: chat.id?._serialized ?? message.from,
      chat_name: chat.name || contactName || message.from,
      contact_name: contactName,
      contact_number: contact?.number ?? null,
      body,
      is_group: chat.isGroup ? 1 : 0,
      from_me: message.fromMe ? 1 : 0,
      sent_at: new Date((message.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
    };

    const id = insertMessage(row);
    if (!id) return; // already seen this message id

    state.lastMessageAt = new Date().toISOString();
    buffer.push({ ...row, id });
    state.bufferedCount = buffer.length;
    scheduleFlush();
  } catch (err) {
    log.error('handleMessage:', err?.message || err);
  }
}

export function startWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.waSessionDir }),
    puppeteer: {
      headless: true,
      executablePath: config.puppeteerExecutablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });

  client.on('qr', async (qr) => {
    state.status = 'qr';
    state.qrDataUrl = await QRCode.toDataURL(qr).catch(() => null);
    log.info('Scan this QR code in WhatsApp > Linked devices (also available at GET /api/status):');
    qrcodeTerminal.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    state.status = 'authenticated';
    state.qrDataUrl = null;
    log.info('WhatsApp authenticated.');
  });

  client.on('auth_failure', (msg) => {
    state.status = 'error';
    state.lastError = String(msg);
    log.error('WhatsApp auth failure:', msg);
  });

  client.on('ready', () => {
    state.status = 'ready';
    state.qrDataUrl = null;
    state.me = client.info?.wid?._serialized ?? null;
    log.info(`WhatsApp ready as ${state.me}`);
  });

  client.on('disconnected', (reason) => {
    state.status = 'disconnected';
    state.lastError = String(reason);
    log.warn('WhatsApp disconnected:', reason);
  });

  client.on('message', handleMessage);

  client.initialize().catch((err) => {
    state.status = 'error';
    state.lastError = err?.message || String(err);
    log.error('WhatsApp initialize failed:', err);
  });

  return client;
}

/** Chat id that reminders go to: REMINDER_TO if set, otherwise the linked account itself. */
export function reminderChatId() {
  if (config.reminderTo) return `${config.reminderTo}@c.us`;
  return state.me;
}

export async function sendMessage(chatId, text) {
  if (!client || state.status !== 'ready') throw new Error('WhatsApp client is not ready');
  if (!chatId) throw new Error('No reminder recipient resolved');
  return client.sendMessage(chatId, text);
}

/** Force-process anything currently buffered (used by POST /api/extract/flush). */
export async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
}

export async function shutdown() {
  if (flushTimer) clearTimeout(flushTimer);
  if (client) await client.destroy().catch(() => {});
}
