import { db, listBlockedChats, blockChat } from './db.js';
import { log } from './logger.js';
import { matchesPattern } from './blocklist.js';

/**
 * Putting the group's real name back, from WhatsApp itself.
 *
 * `getChat()` goes back to the browser and fails often enough - a Meta-hosted
 * business chat, a sync still running - and when it does, the row is stored
 * with the chat's id where its name belongs. The id at least says *which*
 * group, which is why it is kept, but it is not a name: the dashboard cannot
 * show it, so the row falls back to the sender and the group disappears
 * entirely. That is what "Preeti Khandelwal" alone was, five reports running.
 *
 * Nothing in the database can recover the name, because it was never in it.
 * WhatsApp can: the id is exactly what `getChatById` takes. So this asks, once
 * per group, and writes the answer onto the messages and the tasks that were
 * stored without it.
 */

/*
 * A stored name that is really an id, as SQL can test it.
 *
 * SQLite cannot call `looksLikeId`, so the same rule is spelled out once here
 * and used by every query below. Widened past `@g.us` after "still name not
 * coming": a one-to-one chat WhatsApp could not resolve is stored under a
 * `@c.us` or `@lid` id exactly the same way, and `@lid` is the worse case -
 * there is not even a number in it to fall back on, so the row shows nothing
 * at all.
 */
export const NAME_IS_AN_ID = (col) =>
  `(${col} IS NULL OR ${col} = '' OR ${col} = chat_id
    OR ${col} LIKE '%@g.us' OR ${col} LIKE '%@c.us'
    OR ${col} LIKE '%@lid' OR ${col} LIKE '%@broadcast'
    /*
     * A name has letters in it; an id does not.
     *
     * This is the case that made the panel disagree with the list. A linked
     * identity is stored as "202383321759941:33" and a contact as
     * "919825011122" — neither ends in an @domain, so both were counted as
     * named and no repair ever went looking for what they are really called.
     * The row, meanwhile, printed a phone number or nothing. GLOB asks whether
     * a single character outside digits, spaces, + : and - exists; Gujarati and
     * Hindi names have plenty, so they are correctly names.
     */
    OR ${col} NOT GLOB '*[^0-9 +:-]*')`;

/** "120363...@g.us" is an id, not a name - and neither is a bare number. */
export const looksLikeId = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return true;
  if (/@(g\.us|c\.us|lid|broadcast)$/i.test(text)) return true;
  /*
   * Anything with no letter in it at all.
   *
   * The old rule wanted digits, spaces and dashes only, so a linked identity
   * carrying its device number — "202383321759941:33" — slipped through on the
   * colon and was written onto tasks *as their chat name*. It names nobody, and
   * because it then looked like a name, nothing ever went back to ask what the
   * chat was really called. A Gujarati or Hindi name is full of non-digits and
   * is correctly kept.
   */
  return /^[\d\s+:-]+$/.test(text);
};

/*
 * Every chat that has anything stored against it - group or not.
 *
 * This used to be groups only, and that is why "still name not coming": a
 * one-to-one chat whose lookup failed is stored under its id in exactly the
 * same way, and nothing was ever going back to ask what it was called.
 */
const ID_SHAPES = `(chat_id LIKE '%@g.us' OR chat_id LIKE '%@c.us'
                    OR chat_id LIKE '%@lid' OR chat_id LIKE '%@broadcast')`;

export function groupChatIds({ limit = 300 } = {}) {
  return db
    .prepare(
      `SELECT chat_id FROM (
         SELECT chat_id FROM messages WHERE ${ID_SHAPES}
         UNION
         SELECT chat_id FROM tasks    WHERE ${ID_SHAPES}
       )
       WHERE chat_id IS NOT NULL
       LIMIT ?`
    )
    .all(limit)
    .map((row) => row.chat_id);
}

/**
 * Whether this group still needs asking about.
 *
 * A group whose name is already on its messages and on every task from it is
 * left alone - the point is to ask WhatsApp once for what is missing, not to
 * re-read every chat on every boot.
 */
export function needsName(chatId) {
  const bad = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM messages
           WHERE chat_id = ? AND ${NAME_IS_AN_ID('chat_name')}) AS msgs,
         (SELECT COUNT(*) FROM tasks
           WHERE chat_id = ?
             AND (${NAME_IS_AN_ID('chat_name')}
                  -- The other shape it takes, in a GROUP only: the sender's
                  -- name standing in for the group's, which prints as one name
                  -- instead of two. In a one-to-one chat they are meant to be
                  -- the same person, so that is not a fault there.
                  OR (chat_id LIKE '%@g.us' AND chat_name = contact))) AS tasks`
    )
    .get(chatId, chatId);
  return bad.msgs > 0 || bad.tasks > 0;
}

/**
 * The name this group is already stored under somewhere else.
 *
 * A chat is not always read the same way twice: `getChat()` fails on one
 * message and works on the next, so the same group can have twenty rows holding
 * its id and one holding "BNF - GROWTH TEAM". That one row is as good an answer
 * as WhatsApp would give, and it needs no browser, no session and no waiting
 * for a sync to finish - which matters because the session spends its first
 * minutes unable to answer anything.
 *
 * The most-used real name wins, so one row stored under something odd cannot
 * outvote the name the group has carried all along.
 */
export function nameFromSiblings(chatId) {
  const rows = db
    .prepare(
      `SELECT chat_name, COUNT(*) AS n FROM messages
       WHERE chat_id = ? AND chat_name IS NOT NULL AND chat_name != ''
       GROUP BY chat_name ORDER BY n DESC`
    )
    .all(chatId);
  const best = rows.find((row) => !looksLikeId(row.chat_name));
  return best?.chat_name ?? null;
}

/**
 * Repairs every group name that can be settled from what is already stored.
 *
 * No WhatsApp, so it runs at boot whatever the session is doing. It cannot
 * invent a name that was never read even once - that is what asking WhatsApp is
 * for - but where one message got through with the name on it, every task from
 * that chat gets it.
 */
export function repairFromStored({ limit = 300 } = {}) {
  // Free, and it reaches tasks no chat-by-chat pass can: those with no chat id.
  let tasks = nameFromMessages();
  let named = 0;
  for (const chatId of groupChatIds({ limit })) {
    if (!needsName(chatId)) continue;
    const name = nameFromSiblings(chatId);
    if (!name) continue;
    const done = applyGroupName(chatId, name);
    if (done.messages || done.tasks) {
      named += 1;
      tasks += done.tasks;
    }
  }
  if (named) log.info(`Named ${named} chat(s) from messages already stored: ${tasks} task(s) updated.`);
  return { named, tasks };
}

/**
 * Why a task's row cannot say which chat it came from — counted, by cause.
 *
 * "Name abhi nahi aya", twice. The three causes look identical on the row and
 * need completely different answers, so guessing between them from the outside
 * is exactly what kept costing a round trip:
 *
 *   named     - the row has a real name and is fine.
 *   askable   - no name, but the chat's id is on the task, so WhatsApp can be
 *               asked and "Fix chat names" will settle it.
 *   noSource  - neither a name nor any id. Early versions did not put the chat
 *               on the task, and the extractor leaves both empty when it points
 *               at no message. Nothing can recover these: there is no id to ask
 *               about. They are counted so that is a stated fact rather than a
 *               silent row.
 */
export function taskChatState() {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN ${NAME_IS_AN_ID('chat_name')} THEN 0 ELSE 1 END) AS named,
         SUM(CASE WHEN ${NAME_IS_AN_ID('chat_name')}
                       AND (chat_id IS NOT NULL OR message_id IS NOT NULL)
                  THEN 1 ELSE 0 END) AS askable,
         SUM(CASE WHEN ${NAME_IS_AN_ID('chat_name')}
                       AND chat_id IS NULL AND message_id IS NULL
                       -- A task he typed has no chat because it never came from
                       -- one. The row stays quiet about it, so counting it here
                       -- as a blank would make the panel disagree with the list.
                       AND (origin = 'ai' OR source = 'whatsapp')
                  THEN 1 ELSE 0 END) AS noSource
       FROM tasks WHERE archived_at IS NULL`
    )
    .get();
  return { named: row.named || 0, askable: row.askable || 0, noSource: row.noSource || 0 };
}

/**
 * A handful of the rows that cannot name their chat, with what IS stored.
 *
 * Three rounds were spent guessing what the blank rows held, and the guess was
 * wrong each time — the last one ("449 rows showing their chat") was a count
 * that called a phone number a name. Showing the actual value ends that: a
 * stored "202383321759941:33" says linked identity, "919825011122" says the
 * contact never resolved, and an empty one says the chat was never recorded.
 *
 * Only ids and chat names of his own chats, and only eight of them — no message
 * text, nothing anybody else wrote.
 */
export function blankChatExamples(limit = 8) {
  return db
    .prepare(
      `SELECT id, substr(title, 1, 60) AS title, chat_name, chat_id, message_id
       FROM tasks
       WHERE archived_at IS NULL
         AND ${NAME_IS_AN_ID('chat_name')}
         AND (origin = 'ai' OR source = 'whatsapp')
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(Math.min(Number(limit) || 8, 20));
}

/**
 * The name the task's own message is filed under.
 *
 * `applyGroupName` works chat by chat, so a task whose `chat_id` is null was
 * never reached by it even when the message it came from has had its name
 * repaired all along. One join settles those, needs no WhatsApp, and runs at
 * boot with the rest.
 */
export function nameFromMessages() {
  return db
    .prepare(
      `UPDATE tasks
       SET chat_name = (SELECT chat_name FROM messages WHERE id = tasks.message_id),
           updated_at = datetime('now')
       WHERE ${NAME_IS_AN_ID('chat_name')}
         AND message_id IN (
           SELECT id FROM messages
           WHERE chat_name IS NOT NULL AND chat_name != ''
             AND chat_name NOT LIKE '%@g.us' AND chat_name NOT LIKE '%@c.us'
             AND chat_name NOT LIKE '%@lid' AND chat_name NOT LIKE '%@broadcast'
         )`
    )
    .run().changes;
}

/**
 * Tasks that came from a group but carry no chat id of their own.
 *
 * Early versions did not put the chat id on the task, so a repair that works
 * chat by chat cannot see them at all. The message they came from has it, and
 * tasks keep that link, so this is one join rather than a special case
 * everywhere else.
 */
export function linkChatIds() {
  return db
    .prepare(
      `UPDATE tasks
       SET chat_id = (SELECT chat_id FROM messages WHERE id = tasks.message_id)
       WHERE chat_id IS NULL
         AND message_id IN (SELECT id FROM messages WHERE chat_id IS NOT NULL)`
    )
    .run().changes;
}

/**
 * Writes one group's name onto everything stored against it.
 *
 * Messages keep whatever real name they already have - a name that was read
 * successfully at the time is as good as this one. Tasks do not: in a group the
 * chat is the group, always, and the person who wrote the message lives in
 * `contact`. So a task from a group takes the group's name outright, which is
 * what makes "Preeti Khandelwal · Vikas Travel | Pinetree accounting services"
 * come back.
 */
export function applyGroupName(chatId, name) {
  if (!chatId || looksLikeId(name)) return { messages: 0, tasks: 0 };
  const clean = String(name).trim().slice(0, 120);
  /*
   * Only a `@g.us` id is certainly a group, and `is_group` is not decoration:
   * the blocklist's chat-is-not-a-person rule reads it, and so does the row,
   * which prints "sender · group" for one and a single name for the other.
   * Marking a one-to-one chat as a group to give it a name would be fixing the
   * label by corrupting the fact underneath it.
   */
  const isGroup = /@g\.us$/i.test(chatId);
  const setGroup = isGroup ? ', is_group = 1' : '';

  const messages = db
    .prepare(
      `UPDATE messages SET chat_name = ?${setGroup}
       WHERE chat_id = ? AND ${NAME_IS_AN_ID('chat_name')}`
    )
    .run(clean, chatId).changes;

  const tasks = db
    .prepare(
      `UPDATE tasks SET chat_name = ?${setGroup}, updated_at = datetime('now')
       WHERE chat_id = ? AND (chat_name IS NULL OR chat_name != ?)`
    )
    .run(clean, chatId, clean).changes;

  /*
   * A block written against a name it did not have yet.
   *
   * This is the leak the blocklist could not close on its own. A group arrives
   * before WhatsApp will say what it is called, so it is stored under its id;
   * the block is written against the NAME, matches nothing, and every message
   * is read and paid for. Then this function learns the name - and the block
   * that was meant for this chat all along suddenly applies to it.
   *
   * So the id goes on the list too, now. It is not a wider block: an id names
   * exactly the one chat whose name is already blocked, and unlike a name it
   * cannot fail to resolve again.
   */
  const blocked = listBlockedChats();
  const alreadyById = blocked.some((row) => row.pattern === chatId);
  if (!alreadyById && blocked.some((row) => matchesPattern(row.pattern, { chatName: clean }))) {
    blockChat(chatId);
    log.info(`"${clean}" is on the blocked list — blocking its id ${chatId} as well, since the name only just arrived.`);
  }

  return { messages, tasks };
}

/**
 * Asks WhatsApp for the groups whose names are missing, and writes them in.
 *
 * `lookup` is passed in rather than reached for, so this is testable without a
 * browser and so a failure to name one group cannot stop the rest. Runs after
 * the client is ready, once per boot: a few dozen lookups against a session
 * that is already open, and then nothing until something new arrives unnamed.
 */
export async function repairGroupNames(lookup, { limit = 300 } = {}) {
  // Both cheap, and both reduce what has to be asked for over the browser.
  linkChatIds();
  repairFromStored({ limit });

  let asked = 0;
  let named = 0;
  let messages = 0;
  let tasks = 0;

  for (const chatId of groupChatIds({ limit })) {
    if (!needsName(chatId)) continue;
    asked += 1;
    try {
      const name = await lookup(chatId);
      if (looksLikeId(name)) continue;
      const done = applyGroupName(chatId, name);
      named += 1;
      messages += done.messages;
      tasks += done.tasks;
    } catch (err) {
      // One unreachable chat is not a reason to leave the others unnamed.
      log.warn(`Could not read the name of ${chatId}: ${err?.message || err}`);
    }
  }

  if (named) {
    log.info(
      `Named ${named} chat(s) from WhatsApp: ${messages} message(s) and ${tasks} task(s) updated.`
    );
  } else if (asked) {
    log.info(`Asked WhatsApp about ${asked} unnamed chat(s); none could be named.`);
  }
  return { asked, named, messages, tasks };
}
