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

// Asking to see the list, rather than acting on one task. The two halves are
// matched independently because Hindi puts the verb last - "aaj ke task
// dikhao" - while English puts it first.
const ASKING = /\b(show|dikhao|dikha|batao|bata|list|kya)\b/i;
const ABOUT_OVERDUE = /\b(overdue|pending|late|baaki|bache)\b/i;
const ABOUT_TODAY = /\b(today|todays|aaj|aaj\s*ke|task|tasks|kaam)\b/i;

const SHOW_TODAY = (text) => ASKING.test(text) && ABOUT_TODAY.test(text);
const SHOW_OVERDUE = (text) => ASKING.test(text) && ABOUT_OVERDUE.test(text);

// "snooze 2 hours", "snooze 30 min", "GST audit snooze 2 ghante"
const SNOOZE_PATTERN =
  /\bsnooze\b|\b(postpone|tal\s*do)\b.*\b(\d+)\s*(min|minute|minutes|hour|hours|ghante|ghanta)\b/i;
const DURATION = /\b(\d{1,3})\s*(min|minute|minutes|hour|hours|hr|hrs|ghante|ghanta|din|day|days)\b/i;

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

/** "2 hours" -> 120. Null when no duration is stated. */
export function parseDuration(text) {
  const m = DURATION.exec(String(text || ''));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('h') || unit.startsWith('ghant')) return n * 60;
  if (unit.startsWith('d') || unit === 'din') return n * 60 * 24;
  return n;
}

export function parseTaskInstruction(text) {
  const body = String(text || '').trim();
  // Long messages are conversation, not instructions about one task.
  if (!body || body.length > 90) return null;

  // Asking to see the list needs no task match at all.
  if (SHOW_OVERDUE(body)) return { action: 'show', scope: 'overdue' };
  if (SHOW_TODAY(body)) return { action: 'show', scope: 'today' };

  if (SNOOZE_PATTERN.test(body)) {
    const minutes = parseDuration(body);
    if (!minutes) return null; // "snooze" with no duration is not actionable
    const subject = String(body)
      .replace(/\bsnooze\b|\b(postpone|tal\s*do)\b/gi, ' ')
      .replace(DURATION, ' ')
      .trim();
    if (!subject) return null;
    const match = matchOpenTask(subject);
    if (!match) return null;
    return { action: 'snooze', task: match.task, score: match.score, minutes };
  }

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
