import { matchOpenTask } from './task-matching.js';
import { findDate, findTime } from './quickparse.js';

/**
 * Plain-language control of an existing task from WhatsApp: "BNF salary done",
 * "sunshine audit kal karunga". Only two intents are recognised, because those
 * are the two that are safe to act on without a conversation.
 *
 * Nothing here acts on a guess. If the sentence does not clearly name one open
 * task, the result is null and the message goes on to be treated as new.
 */

// "complete" on its own is almost always an instruction - "complete kar dena"
// asks for the work, it does not report it - so only the past forms count.
const DONE_PATTERNS = [
  /\b(done|completed|finished)\b/i,
  /\b(ho\s*gay[ai]|ho\s*gy[ai]|kar\s*diy[aeo]|kar\s*di|hgya|hogaya)\b/i,
];

const LATER_PATTERNS = [
  /\b(karunga|karenge|karungi|kar\s*lung[ao])\b/i,
  /\b(postpone|reschedule|push|shift|move)\b/i,
  /\b(baad\s*me[in]?|later)\b/i,
];

/** Strips the instruction words so what is left is the task's name. */
function subjectOf(text) {
  return String(text)
    .replace(/\b(done|complete|completed|finished|postpone|reschedule|push|shift|move|later)\b/gi, ' ')
    .replace(/\b(ho\s*gay[ai]|ho\s*gy[ai]|kar\s*diy[aeo]|kar\s*di|hgya|hogaya)\b/gi, ' ')
    .replace(/\b(karunga|karenge|karungi|kar\s*lung[ao]|baad\s*me[in]?)\b/gi, ' ')
    .trim();
}

export function parseTaskInstruction(text) {
  const body = String(text || '').trim();
  // Long messages are conversation, not instructions about one task.
  if (!body || body.length > 90) return null;

  const isDone = DONE_PATTERNS.some((re) => re.test(body));
  const isLater = LATER_PATTERNS.some((re) => re.test(body));
  if (!isDone && !isLater) return null;
  // "done kal karunga" says two contradictory things; act on neither.
  if (isDone && isLater) return null;

  const subject = subjectOf(body);
  if (!subject) return null;

  const match = matchOpenTask(subject);
  if (!match) return null;

  if (isDone) return { action: 'done', task: match.task, score: match.score };

  const date = findDate(body);
  const time = findTime(body);
  // "later" with no date at all is not something to act on silently.
  if (!date) return null;

  return {
    action: 'reschedule',
    task: match.task,
    score: match.score,
    due_date: date.date,
    time: time ? { hour: time.hour, minute: time.minute } : null,
  };
}
