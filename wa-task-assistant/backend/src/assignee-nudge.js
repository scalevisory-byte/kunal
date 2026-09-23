import { db } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';
import { listStaff, followUpText } from './assignment.js';
import { EVENT, recordEvent } from './task-events.js';
import { localParts } from './scheduling.js';
import { sendMessage, reminderChatId, state } from './whatsapp.js';

/**
 * Reminding the person a task was given to, without a press.
 *
 * Asked for as "jisko task allot kiya he usko whatsapp pe auto reminder jaye
 * esa kuch ho sakta he kya", and then "karna to he hi" - which overrules the
 * rule this app was built on, that it never messages anybody but its owner on
 * its own. So the rule is replaced rather than removed: it still never messages
 * anybody it was not told about, never a group, never at night, and never more
 * than twice about one job.
 *
 * Those limits are not timidity. This runs on a personal WhatsApp number
 * through an unofficial library, and automated repeated messages to other
 * people is precisely the pattern that gets a number banned - the number five
 * businesses answer on. Two polite messages inside working hours is a
 * colleague; six at midnight is a robot, and it is reported as one.
 */

/* The whole of it: at the deadline, and once more if it is still not done. */
const SENDABLE = new Set(['due', 'follow_up']);
const MAX_PER_TASK = 2;
const DAY_START = 8;   // nothing before 8am,
const DAY_END = 21;    // nothing after 9pm, whatever the ladder says.

/*
 * And no more than this to one person in a day, whatever the ladder wants.
 *
 * The per-task limit alone does not bound what one person receives: eight jobs
 * falling due together is eight messages to the same colleague, each of them
 * inside its own limit. Four is a busy morning; nine is a machine.
 */
const MAX_PER_PERSON_PER_DAY = 4;

/*
 * A pause between one message and the next.
 *
 * This is the rail that matters most and it is the one I had missed. The
 * reminder pass is a loop, so eight deadlines at 9:00 went out as eight
 * messages in under a second - to one person, from a personal number, through
 * an unofficial library. Nothing else in this file would have read as
 * automated; that would have, instantly. A few seconds apart, and jittered so
 * the gaps are not identical either, is a person working through a list.
 */
const GAP_MS = 4000;
const JITTER_MS = 6000;
let lastSentAt = 0;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The chat to reach somebody on, or null.
 *
 * The task's own `assigned_to_wid` first - it was captured when the work was
 * handed over. Otherwise the Staff list, which is the only other place a
 * number was ever deliberately given. A name that appears in neither is not
 * messaged: guessing a chat from a name is how a message reaches a stranger.
 */
export function chatForAssignee(task) {
  if (task.assigned_to_wid) return task.assigned_to_wid;
  const name = String(task.assigned_to || '').trim().toLowerCase();
  if (!name) return null;
  const person = listStaff().find((p) => p.name.trim().toLowerCase() === name);
  return person?.wid || null;
}

/** How many times this task has already been chased, by press or by engine. */
export const nudgesSoFar = (taskId) =>
  db.prepare(`SELECT COUNT(*) AS n FROM task_events WHERE task_id = ? AND kind = ?`)
    .get(taskId, EVENT.nudgeSent).n;

/**
 * How many messages one person has had today, across every task.
 *
 * The day is his, not the server's: `at` is stored in UTC, and the boundary
 * that matters is midnight in Vadodara. Counted from the same events the
 * per-task limit reads, so a pressed nudge spends this allowance too.
 */
export function nudgesToPersonToday(name, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(now);
  const midnight = new Date(`${today}T00:00:00`);
  const offsetMin = (new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
    - new Date(now.toLocaleString('en-US', { timeZone: config.timezone }))) / 60000;
  const fromUtc = new Date(midnight.getTime() + offsetMin * 60000)
    .toISOString().slice(0, 19).replace('T', ' ');
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM task_events
        WHERE kind = ? AND LOWER(detail) = LOWER(?) AND at >= ?`
    )
    .get(EVENT.nudgeSent, String(name || ''), fromUtc).n;
}

/**
 * Why this task will not be chased automatically right now - or null to send.
 *
 * Every refusal is a sentence rather than a boolean, because "it did not send"
 * with no reason is the thing that wastes an evening. The settings page reads
 * the same function to explain itself before anything is ever sent.
 */
export function whyNot(task, kind, settings, now = new Date()) {
  if (!settings.nudgeAssignee) return 'automatic reminders to staff are switched off';
  if (!task.assigned_to) return 'this task is not given to anybody';
  if (!SENDABLE.has(kind)) return 'only the deadline and the first follow-up are sent on';

  const chat = chatForAssignee(task);
  if (!chat) return `no WhatsApp number is stored for ${task.assigned_to}`;
  /*
   * Never a group. A reminder about one person's work, dropped into a room of
   * twenty, is a telling-off in public - and it is also the single fastest way
   * to have this number reported.
   */
  if (String(chat).endsWith('@g.us')) return 'that is a group, and a group is never messaged';
  if (chat === reminderChatId()) return 'that is your own chat, which already gets the reminder';

  if (nudgesSoFar(task.id) >= MAX_PER_TASK) {
    return `already chased ${MAX_PER_TASK} times — after that it is for you to do, not the app`;
  }
  if (nudgesToPersonToday(task.assigned_to, now) >= MAX_PER_PERSON_PER_DAY) {
    return `${task.assigned_to} has already had ${MAX_PER_PERSON_PER_DAY} today — the rest can wait`;
  }

  const { hour } = localParts(now, config.timezone);
  if (hour < DAY_START || hour >= DAY_END) {
    return `it is outside ${DAY_START}:00–${DAY_END}:00, and nobody is messaged at night`;
  }
  if (state.status !== 'ready') return 'WhatsApp is not connected';
  return null;
}

/**
 * Chase the assignee, if every rail allows it.
 *
 * Returns what happened either way, so the caller can log a refusal instead of
 * silence. The text is `followUpText` - the very text the Nudge button shows
 * and sends, because a person should never be able to discover that the app
 * says something different when it speaks by itself.
 */
export async function nudgeAssignee(task, kind, settings, now = new Date()) {
  const refused = whyNot(task, kind, settings, now);
  if (refused) return { sent: false, reason: refused };

  const chat = chatForAssignee(task);
  const text = followUpText(task);

  /* Paced, so a morning's worth of deadlines does not leave in one burst. */
  const since = Date.now() - lastSentAt;
  const gap = GAP_MS + Math.floor(Math.random() * JITTER_MS);
  if (lastSentAt && since < gap) await wait(gap - since);
  lastSentAt = Date.now();

  try {
    await sendMessage(chat, text);
  } catch (err) {
    log.error('Assignee reminder failed:', err?.message || err);
    return { sent: false, reason: 'WhatsApp could not send it' };
  }
  /* On the task's permanent record, the same event a pressed nudge writes -
     so the count above is true however the message went out. */
  recordEvent(task.id, EVENT.nudgeSent, task.assigned_to, { text, automatic: true });
  return { sent: true, to: task.assigned_to, text };
}
