import { config } from './config.js';
import { log } from './logger.js';
import { listTasks } from './db.js';
import { dueMoment, taskState } from './task-lifecycle.js';
import {
  getSettings, localParts, claimBriefing, recordBriefingSent, recordBriefingFailed, briefingFor,
} from './scheduling.js';
import { sendMessage, reminderChatId, state } from './whatsapp.js';

const MARK = { high: '🔴', medium: '🟡', low: '🟢' };
const MAX_LISTED = 10;

/** Today's date in the user's timezone, not the server's. */
export function localDay(now = new Date(), timezone = config.timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export const clockOf = (iso) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: config.timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  });

const dayOf = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', {
    timeZone: config.timezone, day: 'numeric', month: 'short',
  });

/**
 * What the day actually holds: what is late, what is due today, and what is
 * outstanding with no date on it. Completed work is never included.
 */
export function collectToday(now = new Date()) {
  const settings = getSettings();
  const today = localDay(now);
  const open = listTasks({ status: 'pending', limit: 500 });

  const overdue = [];
  const dueToday = [];
  const undated = [];

  for (const task of open) {
    const due = dueMoment(task, settings);
    if (!due) {
      undated.push(task);
      continue;
    }
    const state = taskState(task, now, settings);
    if (state === 'overdue' || (state === 'due' && localDay(due) < today)) {
      overdue.push({ ...task, due });
    } else if (localDay(due) === today) {
      dueToday.push({ ...task, due });
    }
  }

  // Most urgent first inside each group: earlier deadline, then priority.
  const rank = { high: 0, medium: 1, low: 2 };
  const order = (a, b) =>
    (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0) || rank[a.priority] - rank[b.priority];

  overdue.sort(order);
  dueToday.sort(order);
  undated.sort((a, b) => rank[a.priority] - rank[b.priority]);

  return { overdue, dueToday, undated, total: overdue.length + dueToday.length + undated.length };
}

const line = (task, index, withDate = false) => {
  const when = task.due
    ? withDate
      ? `   ⏰ Due: ${dayOf(task.due)} · ${clockOf(task.due)}`
      : `   ⏰ Due: ${clockOf(task.due)}`
    : '   ⏰ No fixed time';
  return `${index}. ${MARK[task.priority] || '🟡'} ${task.title}\n${when}`;
};

/**
 * The morning message. Short by design: a long list nobody reads is worse than
 * a summary that points at the app.
 */
export function buildBriefing(now = new Date()) {
  const { overdue, dueToday, undated, total } = collectToday(now);

  if (total === 0) {
    return {
      text: '🌅 *Good morning!*\n\nYou have no pending tasks for today. 🎉',
      total: 0,
    };
  }

  const lines = ['🌅 *Good morning!*', ''];

  if (overdue.length && dueToday.length) {
    lines.push('You have:', `⚠️ ${overdue.length} overdue`, `📋 ${dueToday.length} due today`, '');
  } else if (overdue.length) {
    lines.push(
      `⚠️ You have ${overdue.length} overdue task${overdue.length === 1 ? '' : 's'} needing attention.`,
      ''
    );
  }

  // Everything, in the order it deserves attention, then capped.
  const ordered = [...overdue, ...dueToday, ...undated];
  const listed = ordered.slice(0, MAX_LISTED);
  let position = 0;

  const section = (title, items, withDate = false) => {
    const mine = items.filter((t) => listed.includes(t));
    if (!mine.length) return;
    lines.push(`*${title}*`);
    for (const task of mine) lines.push(line(task, (position += 1), withDate));
    lines.push('');
  };

  section('⚠️ OVERDUE', overdue, true);
  section('📋 TODAY’S TASKS', dueToday);
  section('📝 NO DATE SET', undated);

  if (ordered.length > MAX_LISTED) {
    lines.push(`…and ${ordered.length - MAX_LISTED} more. Open WA Tasks to see them all.`, '');
  }

  lines.push(
    `You have ${total} task${total === 1 ? '' : 's'} to look at today.`,
    '',
    'Reply *done 2* to close one, or *show overdue* for the list.',
    'Have a productive day! 💼'
  );

  return { text: lines.join('\n'), total, listed: listed.length };
}

/** True when the configured briefing hour has arrived in the user's timezone. */
export function briefingDue(now, settings) {
  const [h, m] = String(settings.briefingTime || '09:00').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const local = localParts(now, config.timezone);
  return local.hour * 60 + local.minute >= h * 60 + m;
}

/**
 * Sends the day's briefing at most once. The claim happens before the send, so
 * a restart between the two costs a briefing rather than sending two - the same
 * trade the reminder engine makes, for the same reason.
 */
export async function maybeSendBriefing({ now = new Date(), force = false } = {}) {
  const settings = getSettings();
  if (!force && !settings.dailyBriefing) return { sent: false, reason: 'off' };
  if (!force && !briefingDue(now, settings)) return { sent: false, reason: 'not yet' };

  const day = localDay(now);
  if (!force && briefingFor(day)?.sent_at) return { sent: false, reason: 'already sent' };

  const claim = force ? { day, attempt: 0 } : claimBriefing(day);
  if (!claim) return { sent: false, reason: 'claimed elsewhere' };

  const briefing = buildBriefing(now);

  if (state.status !== 'ready') {
    if (!force) recordBriefingFailed(day, 'WhatsApp not connected');
    return { sent: false, reason: 'whatsapp not connected', text: briefing.text };
  }

  try {
    await sendMessage(reminderChatId(), briefing.text);
  } catch (err) {
    if (!force) recordBriefingFailed(day, err?.message || err);
    log.error('Daily briefing send failed:', err?.message || err);
    return { sent: false, reason: 'send failed', error: err?.message || String(err) };
  }

  // Recorded whether it was scheduled or sent by hand: one message a day is the
  // whole point, and a "send now" at 08:00 must not be followed by the 08:30 one.
  recordBriefingSent(day, briefing.total);
  log.info(`Daily briefing sent for ${day}: ${briefing.total} task(s).`);
  return { sent: true, day, total: briefing.total, text: briefing.text };
}
