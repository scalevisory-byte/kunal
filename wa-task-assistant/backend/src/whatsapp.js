import pkg from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { config } from './config.js';
import { log } from './logger.js';
import { phoneFromWid } from './wid.js';
import {
  insertMessage, markMessagesProcessed, noteMessageMerged, createTask,
  listBlockedChats, taskByDigestPos, tasksInLastDigest, updateTask, getTask,
  getMeta, setMeta, db,
} from './db.js';
import { extractTasks } from './extractor.js';
import { parseQuickTask } from './quickparse.js';
import { parseCommand } from './commands.js';
import { clearStaleBrowserLocks, pruneProfileCaches } from './session-store.js';
import { planTask, completeTask, rescheduleTask } from './task-lifecycle.js';
import { parseTaskInstruction } from './nl-commands.js';
import { buildBriefing, collectToday, clockOf, localDay } from './briefing.js';
import { EVENT, recordEvent } from './task-events.js';
import { findDuplicateTask } from './task-matching.js';
import { addAttachment } from './attachments.js';
import { getSettings } from './scheduling.js';
import { transcribe, transcriptionEnabled } from './transcribe.js';
import { isoAtLocal } from './quickparse.js';
import { createNote } from './notes.js';
import { createLead, leadByWid } from './leads.js';
import { listGroups } from './groups.js';
import { repairGroupNames, looksLikeId } from './group-names.js';

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
  // The linked account's own WhatsApp display name, used to address the user.
  meName: null,
  lastMessageAt: null,
  lastExtractionAt: null,
  bufferedCount: 0,
  blockedCount: 0,
  lastCommandAt: null,
  lastError: null,
  // Pipeline counters since this process started, so a chat that produces no
  // tasks can be told apart from one that is never being read at all.
  // Every message the library hands us, before any filtering. Zero here while
  // chats are clearly arriving means the connection is not delivering at all.
  rawSeen: 0,
  messagesSeen: 0,
  /*
   * The two numbers that answer "why is Task allotted empty?".
   *
   * Delegation has two halves and they fail differently: either his own
   * messages are never read, or they are read and never look like handing work
   * over. Without counting both, the page is empty and the cause is a guess -
   * which it was, three times.
   */
  ownSeen: 0,
  delegatedCreated: 0,
  // Every failed one cost a group name and a sender, silently, until now.
  chatLookupFailures: 0,
  // Kept across restarts too. Since-start alone is misleading: every deploy
  // restarts the container, so the number resets exactly when somebody goes
  // looking at it, and a fresh zero reads the same as a broken pipeline.
  ownSeenEver: 0,
  delegatedEver: 0,
  // Why messages were dropped. Without this a message that never becomes a task
  // looks the same whatever the reason.
  drops: { ignoredChat: 0, status: 0, noText: 0, blocked: 0, duplicate: 0, error: 0 },
  lastDropError: null,
  tasksCreated: 0,
  lastExtraction: null, // { at, messages, tasks, error }
  // A short trail of connection events, newest last. This is what tells you
  // whether a scan was accepted and then lost, or never accepted at all.
  events: [],
};

/** Records one connection event so the dashboard can show what actually happened. */
export function noteEvent(kind, detail = null) {
  state.events.push({ at: new Date().toISOString(), kind, detail: detail ? String(detail).slice(0, 200) : null });
  if (state.events.length > 25) state.events.shift();
}

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
        // The same job mentioned again is the same job. Creating a second copy
        // would double every reminder it goes on to produce. Scoped to the
        // deadline, so a monthly job coming round again is not mistaken for a
        // repeat of the one still open from last month.
        const existing = findDuplicateTask(task.title, { dueDate: task.due_date });
        if (existing) {
          log.info(`Skipped duplicate task: "${task.title}" matches open task ${existing.id}`);
          // Written down, so the message log can say the task was read and
          // merged rather than showing nothing and reading as ignored.
          noteMessageMerged(task.message_id, existing.id);
          continue;
        }
        const { _image, ...fields } = task;
        const created = createTask(fields);
        if (created.assigned_to) {
          state.delegatedCreated += 1;
          state.delegatedEver = bumpCounter('delegated_created');
        }
        recordEvent(created.id, EVENT.created, `AI, from ${task.chat_name || 'WhatsApp'}`);

        /*
         * The photo the task came from goes onto the task, so the invoice is
         * where the work is rather than back in a chat. This is the first point
         * at which any picture reaches the disk, and it goes through the bounded
         * attachment store - a full store refuses, and refusing must cost the
         * photo, never the task.
         */
        if (_image) {
          try {
            addAttachment(created.id, {
              filename: _image.filename || 'whatsapp-photo.jpg',
              mime: _image.mime,
              buffer: Buffer.from(_image.data, 'base64'),
            });
            recordEvent(created.id, EVENT.edited, 'photo from WhatsApp attached');
          } catch (err) {
            log.warn(`Could not attach the photo to task ${created.id}: ${err?.message || err}`);
          }
        }
        if (created.due_at || created.due_date) {
          recordEvent(created.id, EVENT.deadlineSet, created.due_at || created.due_date);
        }
        planTask(created);
        state.tasksCreated += 1;
        log.info(`Task created: "${task.title}"${task.due_date ? ` (due ${task.due_date})` : ''}`);
      } catch (err) {
        log.error('Could not store extracted task:', err?.message || err);
      }
    }

    markMessagesProcessed(batch.map((m) => m.id));
    state.lastExtractionAt = new Date().toISOString();
    state.lastExtraction = { at: state.lastExtractionAt, messages: batch.length, tasks: tasks.length, error: null };
    noteEvent('extraction', `${batch.length} message(s) -> ${tasks.length} task(s)`);
  } catch (err) {
    // Extraction failed (API down, rate limited). Leave the messages unprocessed
    // so they stay visible in /api/messages, but do not retry forever in a loop.
    log.error('Batch extraction failed, messages left unprocessed:', err?.message || err);
    state.lastExtraction = {
      at: new Date().toISOString(),
      messages: batch.length,
      tasks: 0,
      error: err?.message || String(err),
    };
    noteEvent('extraction failed', err?.message || err);
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
    targets = tasksInLastDigest().filter((t) => t.status !== 'done');
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
      if (updated) {
        recordEvent(task.id, EVENT.statusChanged, 'marked done from the digest');
        completeTask(task.id);
        changed.push(updated);
      }
    } else {
      // Anchored on the user's today, not the server's - after 18:30 UTC the two
      // are different days in Kolkata and the snooze would land a day early.
      const base = new Date(`${task.due_date || localDay()}T00:00:00Z`);
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
 * The labels a chat carries in WhatsApp Business.
 *
 * He already files these by hand in the Business app - "Arth Debt Recovery",
 * "AI handoff" - and that filing is worth more than anything this app could
 * infer, because a person did it on purpose. Read only for a chat that has
 * just produced a possible lead, so this is a handful of lookups a day, not
 * one per message.
 */
async function labelsFor(chatId) {
  if (!client || state.status !== 'ready' || !chatId) return [];
  try {
    const labels = await client.getChatLabels(chatId);
    return (labels || []).map((l) => l?.name).filter(Boolean).slice(0, 8);
  } catch (err) {
    // Labels are a WhatsApp Business feature; a personal account has none, and
    // that is not a failure worth reporting.
    return [];
  }
}

/**
 * The ad card WhatsApp shows above a click-to-WhatsApp message.
 *
 * The library has no field for it - I looked - so this reads the raw object
 * WhatsApp Web itself holds, defensively: if the shape is not what we guessed,
 * it returns nothing and the text rule below still catches the lead. Whatever
 * it does find is kept on the lead as where it came from, so a real ad message
 * tells us what is actually in there rather than us assuming.
 */
function adInfoFrom(message) {
  const raw = message?.rawData || message?._data || null;
  if (!raw || typeof raw !== 'object') return null;

  const candidates = [
    raw.externalAdReply, raw.matchedText, raw.ctwaContext,
    raw.contextInfo?.externalAdReply, raw.quotedMsg?.externalAdReply,
  ].filter((v) => v && typeof v === 'object');

  for (const found of candidates) {
    const title = found.title || found.headline || found.sourceUrl || found.body;
    if (title) return { title: String(title).slice(0, 160), id: found.sourceId || null };
  }
  return null;
}

/**
 * Somebody new, asking about something.
 *
 * Two signals, and neither of them files anything: a captured lead is held
 * until it is confirmed, because a courier asking for an address is not a lead
 * and a pipeline full of those is worth less than an empty one.
 *
 *  - the words a click-to-WhatsApp ad opens with, which are the words set in
 *    the ad, so they are the one reliable signal available without the
 *    official API;
 *  - a first-ever message from a number with no history, which is off by
 *    default because it catches everybody, not only buyers.
 */
async function maybeLead(row, message, settings) {
  if (!settings.leadCapture) return null;
  if (row.from_me || row.is_group) return null;
  if (!row.chat_id || row.chat_id === state.me) return null;

  // Already on the board: a second message is not a second person.
  if (leadByWid(row.chat_id)) return null;

  const text = String(row.body || '').toLowerCase();
  const phrases = Array.isArray(settings.leadPhrases) ? settings.leadPhrases : [];
  const matched = phrases.find((phrase) => phrase && text.includes(String(phrase).toLowerCase()));

  const ad = adInfoFrom(message);
  const firstEver = db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?`)
    .get(row.chat_id).n <= 1;

  const isLead = Boolean(ad) || Boolean(matched) || (settings.leadFromUnknown && firstEver);
  if (!isLead) return null;

  /*
   * His own filing, carried over. A chat already labelled "Arth Debt Recovery"
   * belongs to that business, and saying so here saves him choosing it again
   * on a card he has not read yet.
   */
  const labels = await labelsFor(row.chat_id);
  const business = labels.length
    ? listGroups().find((g) =>
        labels.some((label) => label.toLowerCase().includes(g.name.toLowerCase())
          || g.name.toLowerCase().includes(label.toLowerCase())))
    : null;

  try {
    const lead = createLead({
      name: row.contact_name || row.contact_number || row.chat_name || 'Unknown',
      phone: row.contact_number || null,
      wid: row.chat_id,
      group_id: business?.id ?? null,
      labels,
      // An ad card, or the ad's own opening words, both say Facebook; anything
      // else caught here is simply somebody who wrote in.
      source: ad || matched ? 'facebook' : 'whatsapp',
      source_ref: ad?.title || (matched ? `matched “${matched}”` : 'first message from this number'),
      chat_name: row.chat_name || null,
      message_id: row.id,
      needs_confirmation: 1,
    });
    log.info(`Held a possible lead: ${lead.name} (${lead.source_ref}).`);
    return lead;
  } catch (err) {
    log.warn('Could not record a possible lead:', err?.message || err);
    return null;
  }
}

/**
 * A group's name, asked of WhatsApp by its id.
 *
 * `getChat()` on a message is the usual route and the one that fails; the id is
 * on every message regardless, and `getChatById` takes exactly that. Cached for
 * the life of the process because a group's name is asked for once per message
 * otherwise, and it does not change between two of them.
 */
const groupNames = new Map();

export async function groupNameFor(chatId) {
  if (!chatId || !String(chatId).endsWith('@g.us')) return null;
  if (groupNames.has(chatId)) return groupNames.get(chatId);
  if (!client || state.status !== 'ready') return null;

  let name = null;
  try {
    const chat = await client.getChatById(chatId);
    name = looksLikeId(chat?.name) ? null : chat.name;
  } catch (err) {
    noteEvent('group name lookup failed', err?.message || err);
  }
  // Cached either way: a group that cannot be read now will not read differently
  // in thirty seconds, and the boot repair asks again on the next start.
  groupNames.set(chatId, name);
  return name;
}

/**
 * "note: ..." — saving something to remember, on purpose.
 *
 * Only ever a message the user wrote himself, and only when it opens with the
 * word: nothing anybody else sends can become a note, and nothing of his own
 * becomes one unless he says so. That is the whole rule — a notebook that
 * fills itself is not a notebook.
 *
 * Returns true when the message was a note, so the caller stops there and it
 * is not also read as a task.
 */
const NOTE_PREFIX = /^(?:#\s*note|note)\s*[:\-]?\s+/i;

export async function maybeSaveNote(message, chat, chatId) {
  if (!message.fromMe) return false;
  const body = (message.body || '').trim();
  const match = body.match(NOTE_PREFIX);
  if (!match) return false;

  const text = body.slice(match[0].length).trim();
  if (!text) return false;

  // The first line is the title where there is more than one; a one-line note
  // is all body, because half a sentence as a heading reads like a mistake.
  const lines = text.split('\n');
  const multi = lines.length > 1 && lines[0].trim().length <= 80;

  try {
    const note = createNote({
      title: multi ? lines[0].trim() : null,
      body: multi ? lines.slice(1).join('\n').trim() : text,
      source: 'whatsapp',
      source_ref: message.id?._serialized || null,
      chat_name: chatId === state.me ? 'Saved by you' : chat?.name || null,
    });
    log.info(`Saved a note from WhatsApp: ${note.title || note.body.slice(0, 40)}`);
    /*
     * The confirmation goes to his own chat, never to the one he typed in.
     *
     * "note: call Meera Monday" typed inside Meera's chat is a perfectly
     * normal thing to do - and it used to reply "📝 Saved as a note" into
     * Meera's chat, showing a contact the workings of an app she has nothing
     * to do with. Nothing this app does automatically should put a message in
     * somebody else's chat; the note is still saved either way.
     */
    try {
      const where = chatId === reminderChatId() ? '' : ` (from ${chat?.name || 'a chat'})`;
      await sendMessage(
        reminderChatId(),
        `📝 Saved as a note${where}. It is in WA Tasks under Notes — nothing will chase you about it.`
      );
    } catch (err) {
      log.warn('Could not confirm the note:', err?.message || err);
    }
    return true;
  } catch (err) {
    log.error('Saving a note from WhatsApp failed:', err?.message || err);
    return false;
  }
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
    // "note: ..." is something to remember, not something to do.
    if (await maybeSaveNote(message, chat, chatId)) return;

    const inSelfChat = Boolean(state.me) && chatId === state.me;
    const trigger = config.taskTrigger;
    const hasTrigger = trigger && body.toLowerCase().startsWith(trigger.toLowerCase());

    if (!inSelfChat && !hasTrigger) return;

    const parsed = parseQuickTask(body, { trigger: hasTrigger ? trigger : '' });
    if (!parsed) return;

    const { remind_at: parsedTime, ...rest } = parsed;
    const created = createTask({
      ...rest,
      // The clock time in a message is the deadline, not the moment to be nudged.
      due_at: parsedTime,
      // A forward keeps the original text but not its author, so record where it landed.
      chat_name: inSelfChat ? 'Saved by you' : chat.name || null,
      chat_id: chatId,
      source: 'whatsapp',
      origin: 'manual',
      status: 'open',
    });
    recordEvent(created.id, EVENT.created, 'from your own message');
    if (created.due_at || created.due_date) {
      recordEvent(created.id, EVENT.deadlineSet, created.due_at || created.due_date);
    }
    planTask(created);

    state.lastMessageAt = new Date().toISOString();
    state.lastExtractionAt = new Date().toISOString();
    log.info(`Task captured: "${parsed.title}"${parsed.due_date ? ` (due ${parsed.due_date})` : ''}`);
  } catch (err) {
    log.error('handleOwnMessage:', err?.message || err);
  }
}

/** Records why a message was not kept, so a silent drop becomes a visible one. */
function drop(reason, detail = null) {
  state.drops[reason] = (state.drops[reason] || 0) + 1;
  if (detail) state.lastDropError = String(detail).slice(0, 300);
  noteEvent(`dropped: ${reason}`, detail);
}

/**
 * "BNF salary done" and "sunshine audit kal karunga" act on the task the user
 * already has, rather than becoming new ones. Nothing happens unless the
 * sentence identifies exactly one open task - an ambiguous match is left alone
 * and falls through to ordinary handling.
 */
export async function handleTaskInstruction(text) {
  const instruction = parseTaskInstruction(text);
  if (!instruction) return false;

  // Asking to see the list acts on nothing, so it is answered first.
  if (instruction.action === 'show') {
    const { overdue, dueToday, undated } = collectToday();
    const rows = instruction.scope === 'overdue' ? overdue : [...dueToday, ...undated];
    const heading = instruction.scope === 'overdue' ? '⚠️ *Overdue*' : '📋 *Today*';
    const body = rows.length
      ? rows.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
      : instruction.scope === 'overdue'
        ? 'Nothing is overdue. 🎉'
        : 'Nothing due today. 🎉';
    await reply(`${heading}\n\n${body}`);
    state.lastCommandAt = new Date().toISOString();
    return true;
  }

  const { task } = instruction;

  if (instruction.action === 'snooze') {
    const next = new Date(Date.now() + instruction.minutes * 60000).toISOString();
    rescheduleTask(task.id, { due_at: next, due_date: localDay(new Date(next)) });
    state.lastCommandAt = new Date().toISOString();
    noteEvent('task snoozed', `${task.title} +${instruction.minutes}m`);
    // The user's clock, not the server's - a cloud host reads UTC.
    await reply(`😴 Snoozed: *${task.title}*\n_Now due ${clockOf(next)}._`);
    return true;
  }

  if (instruction.action === 'done') {
    updateTask(task.id, { status: 'done' });
    recordEvent(task.id, EVENT.statusChanged, 'marked done from WhatsApp');
    completeTask(task.id);
    state.lastCommandAt = new Date().toISOString();
    noteEvent('task marked done', task.title);
    log.info(`Task ${task.id} marked done from WhatsApp: "${task.title}"`);
    await reply(`✅ Done: *${task.title}*\n_Reminders for it have stopped._`);
    return true;
  }

  if (instruction.action === 'reschedule') {
    const dueAt = instruction.time
      ? isoAtLocal(instruction.due_date, instruction.time.hour, instruction.time.minute, config.timezone)
      : null;
    rescheduleTask(task.id, { due_date: instruction.due_date, due_at: dueAt });
    state.lastCommandAt = new Date().toISOString();
    noteEvent('task rescheduled', `${task.title} -> ${instruction.due_date}`);
    log.info(`Task ${task.id} rescheduled from WhatsApp to ${instruction.due_date}`);
    await reply(
      `🕓 Moved: *${task.title}*\n_Now due ${instruction.due_date}${instruction.time ? ` at ${String(instruction.time.hour).padStart(2, '0')}:${String(instruction.time.minute).padStart(2, '0')}` : ''}._`
    );
    return true;
  }
  return false;
}

/** Confirmations go to the digest chat, which is the user's own. */
async function reply(text) {
  try {
    if (state.status === 'ready') await sendMessage(reminderChatId(), text);
  } catch (err) {
    log.error('instruction reply failed:', err?.message || err);
  }
}

/** Exported so the batching path can be driven directly in tests. */
/**
 * The photo on a message, as base64, or null.
 *
 * Held in memory only. Nothing is written to the data volume unless the picture
 * goes on to produce a task, and then it goes through the attachment store,
 * which is bounded - this is the volume whose filling up once stopped the
 * service from booting.
 */
export async function downloadImage(message) {
  // The env var forces it on; otherwise the saved setting decides, so it can be
  // turned on from Settings without a redeploy.
  if (!config.readImages && !getSettings().readImages) return null;
  if (!message.hasMedia || message.type !== 'image') return null;

  try {
    const media = await message.downloadMedia();
    if (!media?.data) return null;

    const bytes = Buffer.byteLength(media.data, 'base64');
    if (bytes > config.maxImageBytes) {
      log.warn(`Skipped a ${Math.round(bytes / 1e6)} MB image: over the ${Math.round(config.maxImageBytes / 1e6)} MB limit.`);
      return null;
    }
    const mime = String(media.mimetype || 'image/jpeg').split(';')[0].trim();
    // The API takes these four; anything else is not worth guessing at.
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) return null;

    return { data: media.data, mime, bytes, filename: media.filename || null };
  } catch (err) {
    // A photo that will not download must not cost the message its text.
    log.warn('Could not download an image:', err?.message || err);
    return null;
  }
}

/**
 * The words in a voice note, or null.
 *
 * A transcript is treated as though the sentence had been typed: it goes into
 * the same buffer, through the same extractor, under the same rules. There is
 * no separate path for spoken tasks, because there should not be a second kind
 * of task in the system.
 */
async function transcribeVoice(message) {
  if (!transcriptionEnabled()) return null;
  // 'ptt' is a held-to-record voice note; 'audio' is a sent audio file.
  if (!message.hasMedia || !['ptt', 'audio'].includes(message.type)) return null;

  try {
    const media = await message.downloadMedia();
    if (!media?.data) return null;
    const buffer = Buffer.from(media.data, 'base64');
    return await transcribe({ buffer, mime: media.mimetype });
  } catch (err) {
    // A note that will not download or transcribe is simply not heard. It must
    // never cost the message it arrived with.
    log.warn('Could not read a voice note:', err?.message || err);
    return null;
  }
}

/**
 * A message arriving proves the connection, whatever the library said.
 *
 * whatsapp-web.js does not always emit 'ready' - on a busy account the sync can
 * stall at 99% and the event never comes, while messages are delivered
 * perfectly well the whole time. The dashboard then says "still syncing" beside
 * a task list that is visibly growing.
 *
 * That contradiction is not cosmetic. Every path that *sends* is gated on
 * 'ready': the digest, the daily briefing, a follow-up, the nudge button. So a
 * connection stuck here captures everything and can never answer - which is
 * exactly the "no WhatsApp message arrived" that was reported and put down to
 * something else.
 *
 * Delivering a message is a better proof of a working connection than an event
 * that may never fire, so it is treated as one. The account's own id comes from
 * client.info, which is populated by then; without it `reminderChatId()` has
 * nowhere to send, and nothing can tell his own notes chat from any other.
 */
let caughtUp = false;

function promoteToReady() {
  if (state.status === 'ready' || !client) return;
  const me = client.info?.wid?._serialized ?? null;
  if (!me) return; // not far enough along to know who we are

  state.status = 'ready';
  state.me = me;
  state.meName = client.info?.pushname || state.meName;
  state.qrDataUrl = null;
  noteEvent('ready', 'messages are arriving, so the connection is up');
  log.info(`WhatsApp treated as ready as ${state.me}: messages are being delivered.`);
  runCatchUpOnce();
}

export async function handleMessage(message) {
  try {
    promoteToReady();
    if (IGNORED_CHAT_IDS.has(message.from)) return drop('ignoredChat');
    if (message.isStatus) return drop('status');

    const body = (message.body || '').trim();

    /*
     * A photo is worth reading on its own. Invoices, bills, cheques, tickets and
     * bank-transfer screenshots arrive here as pictures, usually with no caption
     * at all, and what has to be done is visible only in the image.
     *
     * It stays opt-in (`readImages`): a picture costs roughly a page of tokens,
     * and a chat full of forwarded good-mornings would spend real money on
     * nothing. With it off, the old rule holds - no text, nothing to extract.
     */
    const image = await downloadImage(message);

    /*
     * A voice note becomes its own words. Written into `body`, so everything
     * downstream - the extractor, the message list, search, the task's source
     * message - sees an ordinary sentence and needs to know nothing about audio.
     */
    const spoken = await transcribeVoice(message);
    const text = spoken ? [body, spoken].filter(Boolean).join(' ') : body;

    if (!text && !image) return drop('noText');

    // Chat and contact lookups go back to WhatsApp and can fail on their own -
    // a Meta-hosted business chat, a contact that will not resolve. The message
    // text is already in hand, so degrade to what is known instead of losing it.
    let chat = null;
    let contact = null;
    try {
      chat = await message.getChat();
    } catch (err) {
      noteEvent('chat lookup failed', err?.message || err);
    }
    if (chat && IGNORED_CHAT_IDS.has(chat.id?._serialized)) return drop('ignoredChat');

    /*
     * Which chat this is, without needing the lookup to have worked.
     *
     * WhatsApp's own ids say it: a group always ends "@g.us" and a one-to-one
     * chat "@c.us". That is on every message, always, and it does not go back
     * to the browser for anything - whereas getChat() can fail, and when it did
     * the row fell back to the *sender's* name as the chat name and recorded
     * is_group as 0. A group message then looked exactly like a private one,
     * which is why "Bhavesh · ACCT - SENA GLOBAL DMC" kept coming out as
     * "Bhavesh" alone: there was no group left in the record to show.
     *
     * The id also has to come from the right end. On a message he sent,
     * `message.from` is his own account and `message.to` is the chat.
     */
    const fallbackChatId = (message.fromMe ? message.to : message.from) || message.from || null;
    const chatId = chat?.id?._serialized ?? fallbackChatId ?? 'unknown';
    const isGroup = String(chatId).endsWith('@g.us') || Boolean(chat?.isGroup);
    if (!chat) state.chatLookupFailures += 1;


    try {
      contact = await message.getContact();
    } catch (err) {
      noteEvent('contact lookup failed', err?.message || err);
    }
    /*
     * A name, a number, or nothing - never a lid.
     *
     * The last fallback used to be the raw author id, which for a sender whose
     * number WhatsApp does not share reads "202383321759941:33". That is not a
     * person; it went onto the row where a name belonged and, once Claude read
     * it back out of the batch, onto a task as the person it had been given to.
     * `phoneFromWid` returns something only for a real `@c.us` wid, so a lid
     * that will not resolve now leaves this null and the row shows the chat.
     */
    const contactName =
      contact?.pushname || contact?.name || contact?.verifiedName || contact?.number
      // In a group the sender is on the message itself, so a failed contact
      // lookup does not have to mean an anonymous row.
      || (isGroup && message.author ? phoneFromWid(message.author) : null)
      || null;

    // Blocked chats are dropped before anything is stored or sent to the API.
    if (
      isBlockedChat({
        chatName: chat?.name,
        chatId: chat?.id?._serialized ?? message.from,
        contactNumber: contact?.number,
      })
    ) {
      state.blockedCount += 1;
      return drop('blocked');
    }

    /*
     * A second try at the group's name, by id.
     *
     * When getChat() fails the row used to keep the id in place of a name, and
     * the id is not something the dashboard can show - so the task fell back to
     * the sender and the group vanished from the row entirely. The id is enough
     * to ask with, and the answer is cached, so this costs one lookup per group
     * and only where the first route already failed.
     */
    const groupName = !chat?.name && isGroup ? await groupNameFor(chatId) : null;

    const row = {
      wa_message_id: message.id?._serialized ?? null,
      chat_id: chatId,
      // With no name to be had at all the id still goes in: it is honest about
      // which group, and better than the sender's name pretending to be one.
      // The boot repair fills these in once WhatsApp will answer.
      chat_name: chat?.name || groupName || (isGroup ? chatId : contactName || chatId) || 'unknown',
      contact_name: contactName,
      contact_number: contact?.number ?? null,
      // A caption-less photo still needs something readable in the message list.
      body: text || (image ? '[photo]' : ''),
      is_group: isGroup ? 1 : 0,
      from_me: message.fromMe ? 1 : 0,
      sent_at: new Date((message.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
    };

    const id = insertMessage(row);
    if (!id) return drop('duplicate'); // already seen this message id

    /*
     * Somebody arriving from an ad is a lead, not a task, and the two are
     * different enough that neither should be filed as the other. Its own
     * try/catch: a lead that cannot be recorded must never cost us the
     * message, which is still going on to be read as work.
     */
    try {
      await maybeLead({ ...row, id }, message, getSettings());
    } catch (err) {
      log.warn('Lead check failed:', err?.message || err);
    }

    state.lastMessageAt = new Date().toISOString();
    noteSeen(row.sent_at);
    state.messagesSeen += 1;
    if (row.from_me) {
      state.ownSeen += 1;
      state.ownSeenEver = bumpCounter('own_messages_seen');
    }
    noteEvent(
      'message',
      `${contactName || row.contact_number || 'unknown'}: ${text.slice(0, 60) || (image ? '[photo]' : '')}`
    );
    // The picture rides on the buffered copy only. The stored row stays text:
    // the database is not where megabytes of photo belong.
    /*
     * Whether this is his own "message yourself" chat. Not a column - it only
     * has to reach the extractor, which uses it to tell a note he made himself
     * from an instruction he gave somebody. Both are messages he wrote.
     */
    /*
     * Who a group message is aimed at.
     *
     * An @mention is the one part of "who is this for" that does not need
     * reading: WhatsApp hands over the ids. In a company group somebody asking
     * "@abdul bhai kiski tkt he?" is asking Abdul, and a task for it on the
     * user's list means he gets chased for Abdul's job. Stated as a fact so the
     * extractor is not left inferring it from the wording, which reads the same
     * whoever it is addressed to.
     */
    let mentions = [];
    try {
      mentions = (message.mentionedIds || []).map((w) => String(w?._serialized ?? w));
    } catch { /* older library shapes, or a message with no mentions */ }

    buffer.push({
      ...row,
      id,
      image,
      is_self: Boolean(state.me) && row.chat_id === state.me ? 1 : 0,
      mentions_someone: mentions.length ? 1 : 0,
      mentions_me: state.me && mentions.includes(state.me) ? 1 : 0,
    });
    state.bufferedCount = buffer.length;
    scheduleFlush();
  } catch (err) {
    drop('error', err?.message || err);
    log.error('handleMessage:', err?.message || err);
  }
}

/**
 * Messages that arrived while this was not running.
 *
 * The client only ever hears messages sent while it is connected - there is no
 * replay. Every restart is therefore a hole: a request sent on Tuesday
 * afternoon, with the service redeployed that evening, is never seen by
 * anything and never becomes a task. Nobody knows it was lost, which is the
 * worst property a capture tool can have.
 *
 * Bounded on every side, because the alternative - reading history - would send
 * thousands of messages to the API on a single boot:
 *
 *   - only chats with unread messages, and only that many messages from each
 *   - only messages newer than the last one already stored
 *   - a hard cap on the total, oldest first, so the ones nearest the gap win
 *   - the same blocklist, the same buffer, the same extractor as live messages
 *
 * The first ever boot reads nothing. With no record of what has been seen, the
 * only honest starting point is now.
 */
/**
 * How far the capture has got, for the next boot's catch-up to resume from.
 *
 * Written per message rather than on shutdown: a container that is killed never
 * runs a shutdown hook, and that is exactly the case this exists for. Only ever
 * moves forward — messages can arrive slightly out of order, and a watermark
 * that goes backwards would re-read what has already been read.
 */
/** A running total that survives a restart. */
function bumpCounter(key) {
  try {
    const next = Number(getMeta(key) || 0) + 1;
    setMeta(key, String(next));
    return next;
  } catch {
    return 0;
  }
}

function noteSeen(sentAt) {
  if (!sentAt) return;
  try {
    const current = getMeta('last_message_at');
    if (!current || sentAt > current) setMeta('last_message_at', sentAt);
  } catch (err) {
    // Losing the watermark costs a re-read, never a message.
    log.warn('Could not record the last message time:', err?.message || err);
  }
}

/** Once per connection, from whichever of the two paths gets there first. */
function runCatchUpOnce() {
  if (caughtUp) return;
  caughtUp = true;
  // Its own catch: missing the catch-up must never cost the connection.
  catchUp().catch((err) => log.error('Catch-up failed:', err?.message || err));
}

export async function catchUp() {
  const since = getMeta('last_message_at');
  if (!since) {
    // Nothing has ever been captured, so there is no gap to fill - only the
    // whole of history, which is not what this is for.
    setMeta('last_message_at', new Date().toISOString());
    log.info('Catch-up skipped: nothing seen before, so now is the starting point.');
    return;
  }

  const after = new Date(since).getTime();
  if (!Number.isFinite(after)) return;

  const gapMinutes = Math.round((Date.now() - after) / 60000);
  if (gapMinutes < 1) return;

  let chats;
  try {
    chats = await client.getChats();
  } catch (err) {
    log.warn('Catch-up could not list chats:', err?.message || err);
    return;
  }

  const unread = chats.filter((c) => (c.unreadCount || 0) > 0);
  const missed = [];

  for (const chat of unread) {
    if (missed.length >= config.catchUpMax) break;
    try {
      const take = Math.min(chat.unreadCount, config.catchUpPerChat);
      const recent = await chat.fetchMessages({ limit: take });
      for (const m of recent) {
        const at = (m.timestamp ?? 0) * 1000;
        if (at > after) missed.push(m);
      }
    } catch (err) {
      // One unreadable chat is not a reason to abandon the rest.
      noteEvent('catch-up chat failed', err?.message || err);
    }
  }

  if (!missed.length) {
    log.info(`Catch-up: nothing missed in the last ${gapMinutes} min.`);
    return;
  }

  // Oldest first, and only as many as the cap allows - the messages nearest the
  // gap are the ones most likely still to matter.
  missed.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const take = missed.slice(-config.catchUpMax);

  log.info(`Catch-up: ${take.length} message(s) missed over ${gapMinutes} min, reading them now.`);
  noteEvent('catching up', `${take.length} message(s) from ${unread.length} chat(s)`);

  for (const message of take) {
    // The ordinary path: same blocklist, same buffer, same extractor. A message
    // that was missed is not a different kind of message.
    try {
      await handleMessage(message);
    } catch (err) {
      noteEvent('catch-up message failed', err?.message || err);
    }
  }
}

/** The stored totals, so the page is right before anything new arrives. */
export function loadCounters() {
  try {
    state.ownSeenEver = Number(getMeta('own_messages_seen') || 0);
    state.delegatedEver = Number(getMeta('delegated_created') || 0);
  } catch { /* a database that is not ready yet */ }
}

export function startWhatsApp() {
  loadCounters();
  clearStaleBrowserLocks();
  // Anything a previous run left cached on the volume goes now; the flags below
  // keep this run's cache off it entirely.
  pruneProfileCaches();
  noteEvent('starting');

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
        // Cache on the container's own disk, not the data volume, and bounded.
        // A full volume stops SQLite writing, which stops the app booting.
        `--disk-cache-dir=${config.browserCacheDir}`,
        '--disk-cache-size=67108864',
        '--media-cache-size=67108864',
      ],
    },
  });

  client.on('loading_screen', (percent, message) => {
    noteEvent('loading', `${percent}% ${message || ''}`.trim());
  });

  client.on('change_state', (waState) => {
    noteEvent('state', waState);
  });

  client.on('qr', async (qr) => {
    state.status = 'qr';
    noteEvent('qr issued');
    state.qrDataUrl = await QRCode.toDataURL(qr).catch(() => null);
    log.info('Scan this QR code in WhatsApp > Linked devices (also available at GET /api/status):');
    qrcodeTerminal.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    state.status = 'authenticated';
    noteEvent('authenticated');
    state.qrDataUrl = null;
    log.info('WhatsApp authenticated.');
  });

  client.on('auth_failure', (msg) => {
    state.status = 'error';
    noteEvent('auth failure', msg);
    state.lastError = String(msg);
    log.error('WhatsApp auth failure:', msg);
  });

  client.on('ready', () => {
    state.status = 'ready';
    noteEvent('ready');
    state.qrDataUrl = null;
    state.me = client.info?.wid?._serialized ?? null;
    state.meName = client.info?.pushname || null;
    log.info(`WhatsApp ready as ${state.me}`);

    runCatchUpOnce();

    /*
     * Name the groups whose names were never stored. Only WhatsApp has them,
     * and only now is it in a position to answer; a failure here must not touch
     * the session, so it runs on its own and reports rather than throwing.
     */
    repairGroupNames(groupNameFor)
      .catch((err) => log.warn('Naming groups:', err?.message || err));
  });

  client.on('disconnected', (reason) => {
    state.status = 'disconnected';
    noteEvent('disconnected', reason);
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
    // message_create covers both directions, so one listener sees everything.
    // Messages you write yourself are read too: notes typed into a chat are
    // tasks as much as anything someone sends you.
    client.on('message_create', async (message) => {
      state.rawSeen += 1;
      // Instructions about an existing task are checked first, in their own try
      // block: a failure here must not cost us the message itself.
      if (message.fromMe && message.body) {
        try {
          const chat = await message.getChat();
          const chatId = chat.id?._serialized ?? message.to;
          if (await handleCommand(message, chatId)) return;
          if (await maybeSaveNote(message, chat, chatId)) return;
          if (await handleTaskInstruction(message.body)) return;
        } catch (err) {
          noteEvent('instruction check failed', err?.message || err);
        }
      }
      await handleMessage(message);
    });
    log.info(`AI mode: chats are read by ${config.model}.`);
  }

  client.initialize().catch((err) => {
    state.status = 'error';
    state.lastError = err?.message || String(err);
    noteEvent('initialize failed', err?.message || err);
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
