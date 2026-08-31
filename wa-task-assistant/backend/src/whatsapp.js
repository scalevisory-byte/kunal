import pkg from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { config } from './config.js';
import { log } from './logger.js';
import {
  insertMessage, markMessagesProcessed, createTask,
  listBlockedChats, taskByDigestPos, tasksInLastDigest, updateTask, getTask,
} from './db.js';
import { extractTasks } from './extractor.js';
import { parseQuickTask } from './quickparse.js';
import { parseCommand } from './commands.js';

const { Client, LocalAuth } = pkg;

/** Chats we never scan: status broadcasts and WhatsApp's own service messages. */
const IGNORED_CHAT_IDS = new Set(['status@broadcast', '0@c.us']);

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

/**
 * Names and numbers need different matching. A name is matched loosely, because
 * "Mummy" should also catch "Mummy ❤️ Home". A number is matched on its ending,
 * so the same person matches with or without a country code — but never as a
 * loose substring, which would let a short pattern block half your contacts.
 */
export function isBlockedChat({ chatName, chatId, contactNumber }) {
  const rows = listBlockedChats();
  if (!rows.length) return false;

  const name = String(chatName || '').toLowerCase();
  const numbers = [digitsOnly(contactNumber), digitsOnly(chatId)].filter(Boolean);

  return rows.some((row) => {
    const pattern = row.pattern.trim();
    if (!pattern) return false;

    const asDigits = digitsOnly(pattern);
    const isNumeric = asDigits.length > 0 && asDigits.length === pattern.replace(/[\s+()-]/g, '').length;

    if (isNumeric) {
      // Too short to identify anyone; refuse rather than block everything.
      if (asDigits.length < 6) return false;
      return numbers.some((n) => n === asDigits || n.endsWith(asDigits));
    }

    return name.includes(pattern.toLowerCase());
  });
}

/**
 * Test hook: lets a suite observe the confirmations the command handler sends
 * without standing up a real WhatsApp session.
 */
export function setClientForTests(stub) {
  client = stub;
}

export const state = {
  mode: config.extractionMode, // 'ai' | 'manual'
  status: 'starting', // starting | qr | authenticated | ready | disconnected | error
  qrDataUrl: null,
  me: null,
  lastMessageAt: null,
  lastExtractionAt: null,
  bufferedCount: 0,
  blockedCount: 0,
  lastCommandAt: null,
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

/**
 * Reply commands, available in BOTH modes: the digest numbers its lines, and
 * "done 2" / "snooze 2" refer to those numbers. Returns true when the message
 * was a command, so manual mode does not also turn it into a task.
 */
export async function handleCommand(message, chatId) {
  const command = parseCommand(message.body);
  if (!command) return false;

  // Only act on commands sent in the chat the digest goes to.
  if (chatId !== reminderChatId()) return false;

  let targets = [];
  if (command.action === 'done' && command.all) {
    targets = tasksInLastDigest().filter((t) => t.status === 'open');
  } else {
    targets = command.positions.map((pos) => taskByDigestPos(pos)).filter(Boolean);
  }

  const unknown = command.all
    ? []
    : command.positions.filter((pos) => !taskByDigestPos(pos));

  const changed = [];
  for (const task of targets) {
    if (command.action === 'done') {
      const updated = updateTask(task.id, { status: 'done' });
      if (updated) changed.push(updated);
    } else {
      const base = task.due_date ? new Date(`${task.due_date}T00:00:00Z`) : new Date();
      base.setUTCDate(base.getUTCDate() + command.days);
      const updated = updateTask(task.id, { due_date: base.toISOString().slice(0, 10) });
      if (updated) changed.push(updated);
    }
  }

  state.lastCommandAt = new Date().toISOString();

  const lines = [];
  if (changed.length) {
    const verb = command.action === 'done' ? '✅ Done' : '🕓 Pushed back';
    lines.push(`${verb}:`);
    changed.forEach((t) => lines.push(`• ${t.title}${command.action === 'snooze' && t.due_date ? ` → ${t.due_date}` : ''}`));
  }
  if (unknown.length) {
    lines.push(`Couldn't find ${unknown.length === 1 ? 'number' : 'numbers'} ${unknown.join(', ')} in the last reminder.`);
  }
  if (!lines.length) lines.push('Nothing to update — that task may already be done.');

  try {
    await sendMessage(chatId, lines.join('\n'));
  } catch (err) {
    log.warn('Could not confirm the command:', err?.message || err);
  }

  log.info(`Command "${message.body.trim()}" → ${command.action}, ${changed.length} task(s) updated`);
  return true;
}

/**
 * Manual mode: no AI, no API key, and nothing anyone else sends is stored.
 * A task is created only when YOU write it - either in your own "message
 * yourself" chat, or anywhere with the trigger prefix.
 */
export async function handleOwnMessage(message) {
  try {
    if (!message.fromMe) return;

    const body = (message.body || '').trim();
    if (!body) return;

    const chat = await message.getChat();
    const chatId = chat.id?._serialized ?? message.to;

    // "done 2" must close a task, not become a new one.
    if (await handleCommand(message, chatId)) return;

    const inSelfChat = Boolean(state.me) && chatId === state.me;
    const trigger = config.taskTrigger;
    const hasTrigger = trigger && body.toLowerCase().startsWith(trigger.toLowerCase());

    if (!inSelfChat && !hasTrigger) return;

    const parsed = parseQuickTask(body, { trigger: hasTrigger ? trigger : '' });
    if (!parsed) return;

    createTask({
      ...parsed,
      // A forward keeps the original text but not its author, so record where it landed.
      chat_name: inSelfChat ? 'Saved by you' : chat.name || null,
      chat_id: chatId,
      source: 'whatsapp',
      status: 'open',
    });

    state.lastMessageAt = new Date().toISOString();
    state.lastExtractionAt = new Date().toISOString();
    log.info(`Task captured: "${parsed.title}"${parsed.due_date ? ` (due ${parsed.due_date})` : ''}`);
  } catch (err) {
    log.error('handleOwnMessage:', err?.message || err);
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

    // Blocked chats are dropped before anything is stored or sent to the API.
    if (
      isBlockedChat({
        chatName: chat.name,
        chatId: chat.id?._serialized,
        contactNumber: contact?.number,
      })
    ) {
      state.blockedCount += 1;
      return;
    }

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

  if (config.extractionMode === 'manual') {
    // message_create also fires for messages you send, which is the whole input here.
    client.on('message_create', handleOwnMessage);
    log.info(
      `Manual mode: no AI. Tasks come from your own "message yourself" chat` +
        (config.taskTrigger ? ` or any message starting with "${config.taskTrigger}".` : '.')
    );
  } else {
    client.on('message', handleMessage);
    // Your own replies are not scanned for tasks in this mode, but "done 2"
    // still has to work, so listen for commands only.
    client.on('message_create', async (message) => {
      try {
        if (!message.fromMe || !message.body) return;
        const chat = await message.getChat();
        await handleCommand(message, chat.id?._serialized ?? message.to);
      } catch (err) {
        log.error('command listener:', err?.message || err);
      }
    });
    log.info(`AI mode: incoming chats are read by ${config.model}.`);
  }

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
