/**
 * Commands you can reply with on WhatsApp, so a task can be closed without
 * opening the dashboard. The digest numbers its lines, and these refer to
 * those numbers.
 *
 *   done 2          2 ho gaya          done 1,3
 *   done all        snooze 2           snooze 2 3
 */

const DONE_WORDS = 'done|complete|completed|finish|finished|ho gaya|hogaya|ho gya|kar diya|kardiya|thik hai';
const SNOOZE_WORDS = 'snooze|later|baad|postpone|tal do|kal karo';

const NUMBERS = /\d{1,3}/g;

function parseNumbers(text) {
  const found = text.match(NUMBERS) || [];
  return [...new Set(found.map(Number).filter((n) => n >= 1 && n <= 999))];
}

/**
 * @returns {null | {action:'done', all:true} | {action:'done', positions:number[]}
 *          | {action:'snooze', positions:number[], days:number}}
 */
export function parseCommand(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text.length > 60) return null; // long text is a message, not a command

  const doneRe = new RegExp(`(^|\\s)(${DONE_WORDS})(\\s|$)`, 'i');
  const snoozeRe = new RegExp(`(^|\\s)(${SNOOZE_WORDS})(\\s|$)`, 'i');

  const isSnooze = snoozeRe.test(text);
  const isDone = !isSnooze && doneRe.test(text);
  if (!isDone && !isSnooze) return null;

  // Guard against sentences that merely contain the word, e.g.
  // "invoice ka kaam done karna hai" - a command is short and mostly numbers.
  const withoutWords = text
    .replace(new RegExp(DONE_WORDS, 'gi'), '')
    .replace(new RegExp(SNOOZE_WORDS, 'gi'), '')
    .replace(/[\d\s,.\-and]+/gi, '')
    .trim();
  const isAll = /\ball\b|\bsab\b|\bsabhi\b/i.test(text);
  if (withoutWords.length > 3 && !isAll) return null;

  if (isDone && isAll) return { action: 'done', all: true };

  const numbers = parseNumbers(text);

  if (isSnooze) {
    // "snooze 2 3" -> task 2 by 3 days. A single number means one day.
    if (!numbers.length) return null;
    const days = numbers.length > 1 ? numbers[numbers.length - 1] : 1;
    const positions = numbers.length > 1 ? numbers.slice(0, -1) : numbers;
    return { action: 'snooze', positions, days: Math.min(days, 60) };
  }

  if (!numbers.length) return null;
  return { action: 'done', positions: numbers };
}
