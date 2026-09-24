import { db } from './db.js';

/*
 * Which AI tasks are held in "Is this a task?" instead of going on the list.
 *
 * Two reasons, and nothing else:
 *   - Claude said it was not sure (anything short of "high").
 *   - The chat it came from is one he keeps throwing tasks out of.
 *
 * His own notes-to-self chat is never held: he wrote it there on purpose.
 */

// A chat is held once this many of its tasks were thrown out...
export const REJECTS_TO_HOLD = 3;
// ...and they are at least half of the ones he has decided on.
export const REJECT_SHARE = 0.5;
export const LOOKBACK_DAYS = 60;

const chatKey = (chatId, chatName) => chatId || chatName || null;

/*
 * Per chat: how many AI tasks he threw out and how many he kept.
 *
 * Thrown out = archived and never finished (the ✕, "Not a task", or a bulk
 * delete); an Undo clears archived_at, so an undone delete does not count.
 * Still waiting in the box = not decided yet, so neither.
 */
export function chatVerdicts(days = LOOKBACK_DAYS) {
  const rows = db
    .prepare(
      `SELECT COALESCE(chat_id, chat_name) AS chat,
              SUM(CASE WHEN archived_at IS NOT NULL AND status != 'done' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN archived_at IS NULL AND needs_confirmation = 0 THEN 1 ELSE 0 END) AS kept
         FROM tasks
        WHERE origin = 'ai'
          AND COALESCE(chat_id, chat_name) IS NOT NULL
          AND created_at >= datetime('now', ?)
        GROUP BY chat`
    )
    .all(`-${days} days`);
  return new Map(rows.map((r) => [r.chat, { rejected: r.rejected || 0, kept: r.kept || 0 }]));
}

export function isDoubtfulChat(verdict) {
  if (!verdict) return false;
  const decided = verdict.rejected + verdict.kept;
  return verdict.rejected >= REJECTS_TO_HOLD && verdict.rejected >= decided * REJECT_SHARE;
}

/** Why a new task from this message should be held, or null to put it on the list. */
export function holdReason({ confidence, source }, verdicts = chatVerdicts()) {
  if (source?.is_self) return null;
  if (isDoubtfulChat(verdicts.get(chatKey(source?.chat_id, source?.chat_name)))) return 'chat';
  if (confidence !== 'high') return 'unsure';
  return null;
}

/** The same reason, for a task already held, so the box can say why it is asking. */
export function heldBecause(task, verdicts) {
  const verdict = verdicts.get(chatKey(task.chat_id, task.chat_name));
  if (isDoubtfulChat(verdict)) return { reason: 'chat', ...verdict };
  return { reason: 'unsure' };
}
