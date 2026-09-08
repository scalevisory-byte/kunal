import { db } from './db.js';
import { log } from './logger.js';

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

/** "120363...@g.us" is an id, not a name - and neither is a bare number. */
export const looksLikeId = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return true;
  return /@(g\.us|c\.us|lid|broadcast)$/i.test(text) || /^\+?\d[\d\s-]{5,}$/.test(text);
};

/** Every group chat that has anything stored against it. */
export function groupChatIds({ limit = 300 } = {}) {
  return db
    .prepare(
      `SELECT chat_id FROM (
         SELECT chat_id FROM messages WHERE chat_id LIKE '%@g.us'
         UNION
         SELECT chat_id FROM tasks    WHERE chat_id LIKE '%@g.us'
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
           WHERE chat_id = ?
             AND (chat_name IS NULL OR chat_name = '' OR chat_name = chat_id
                  OR chat_name LIKE '%@g.us')) AS msgs,
         (SELECT COUNT(*) FROM tasks
           WHERE chat_id = ?
             AND (chat_name IS NULL OR chat_name = '' OR chat_name = chat_id
                  OR chat_name LIKE '%@g.us'
                  -- The other shape it takes: the sender's name standing in for
                  -- the group's, which prints as one name instead of two.
                  OR chat_name = contact)) AS tasks`
    )
    .get(chatId, chatId);
  return bad.msgs > 0 || bad.tasks > 0;
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

  const messages = db
    .prepare(
      `UPDATE messages SET chat_name = ?, is_group = 1
       WHERE chat_id = ?
         AND (chat_name IS NULL OR chat_name = '' OR chat_name = chat_id
              OR chat_name LIKE '%@g.us')`
    )
    .run(clean, chatId).changes;

  const tasks = db
    .prepare(
      `UPDATE tasks SET chat_name = ?, is_group = 1, updated_at = datetime('now')
       WHERE chat_id = ? AND (chat_name IS NULL OR chat_name != ?)`
    )
    .run(clean, chatId, clean).changes;

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
      `Named ${named} group(s) from WhatsApp: ${messages} message(s) and ${tasks} task(s) updated.`
    );
  } else if (asked) {
    log.info(`Asked WhatsApp about ${asked} unnamed group(s); none could be named.`);
  }
  return { asked, named, messages, tasks };
}
