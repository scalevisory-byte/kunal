import { config } from './config.js';
import { log } from './logger.js';
import { listTasks, db, NOT_SET_ASIDE_BARE } from './db.js';
import { dueMoment, taskState, onTimeLabel } from './task-lifecycle.js';
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
  // Unconfirmed extractions are not part of the day's work yet.
  const open = listTasks({ status: 'pending', limit: 500 }).filter((t) => !t.needs_confirmation);

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
  // The stage sits on the same line as the deadline: it is the other half of
  // "what is this", and a third line per task turns the briefing into a wall.
  const stage = task.stage ? ` · 📍 ${task.stage}` : '';
  return `${index}. ${MARK[task.priority] || '🟡'} ${task.title}\n${when}${stage}`;
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


/* ---------------- weekly summary ---------------- */

/**
 * A key for the week a moment falls in, on the user's calendar: the Monday that
 * starts it. It goes into the same `briefings` table as a daily briefing, so the
 * "one per day" guarantee becomes "one per week" with no new schema and no
 * second implementation of the thing that must not go wrong twice.
 */
export function localWeek(now = new Date(), timezone = config.timezone) {
  const day = localDay(now, timezone);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short' })
    .format(now);
  const index = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[parts] ?? 0;
  const monday = new Date(`${day}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - index);
  return `week:${monday.toISOString().slice(0, 10)}`;
}

/** Everything finished, and everything still owed, over the seven days ending now. */
export function collectWeek(now = new Date()) {
  const settings = getSettings();
  const since = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  const finished = db
    .prepare(
      `SELECT * FROM tasks
       WHERE status = 'done' AND completed_at IS NOT NULL AND completed_at >= ?
         AND ${NOT_SET_ASIDE_BARE}
       ORDER BY completed_at DESC`
    )
    .all(since)
    .map((task) => ({ ...task, on_time: onTimeLabel(task) }));

  const open = listTasks({ status: 'pending', limit: 500 }).filter((t) => !t.needs_confirmation);
  const overdue = open.filter((t) => taskState(t, now, settings) === 'overdue');

  // Which chats the week's work actually came from, busiest first.
  const byChat = new Map();
  for (const task of finished) {
    const name = task.chat_name || 'No chat';
    byChat.set(name, (byChat.get(name) || 0) + 1);
  }
  const chats = [...byChat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  return {
    finished,
    open,
    overdue,
    chats,
    onTime: finished.filter((t) => t.on_time === 'on time').length,
    late: finished.filter((t) => t.on_time === 'late').length,
  };
}

/** The message itself. Every figure is counted from real rows; none are invented. */
export function buildWeeklySummary(now = new Date()) {
  const week = collectWeek(now);
  const lines = ['📊 *Your week*', ''];

  if (!week.finished.length && !week.open.length) {
    lines.push('Nothing recorded this week — no tasks completed and none outstanding.');
    return { text: lines.join('\n'), finished: 0, open: 0 };
  }

  lines.push(`✅ Completed: *${week.finished.length}*`);
  // Only claimed where a deadline existed to judge against - and the tasks that
  // had none are counted too, so the parts add up to the total above them.
  if (week.onTime || week.late) {
    const noDeadline = week.finished.length - week.onTime - week.late;
    const parts = [`${week.onTime} on time`, `${week.late} late`];
    if (noDeadline > 0) parts.push(`${noDeadline} without a deadline`);
    lines.push(`   ${parts.join(' · ')}`);
  }
  lines.push(`📋 Still open: *${week.open.length}*`);
  if (week.overdue.length) lines.push(`⚠️ Overdue: *${week.overdue.length}*`);

  if (week.chats.length) {
    lines.push('', '*Where the work came from*');
    for (const [name, count] of week.chats) {
      lines.push(`• ${name} — ${count}`);
    }
  }

  if (week.finished.length) {
    lines.push('', '*Finished this week*');
    for (const task of week.finished.slice(0, MAX_LISTED)) {
      lines.push(`• ${task.title}`);
    }
    if (week.finished.length > MAX_LISTED) {
      lines.push(`_…and ${week.finished.length - MAX_LISTED} more._`);
    }
  }

  return { text: lines.join('\n'), finished: week.finished.length, open: week.open.length };
}

/** True when the configured weekday and hour have both arrived, on the user's clock. */
export function weeklyDue(now, settings) {
  const local = localParts(now, config.timezone);
  if (local.weekday !== Number(settings.weeklyDay ?? 0)) return false;
  const [h, m] = String(settings.weeklyTime || '20:00').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  return local.hour * 60 + local.minute >= h * 60 + m;
}

/** Sent at most once a week, by exactly the mechanism the daily briefing uses. */
export async function maybeSendWeekly({ now = new Date(), force = false } = {}) {
  const settings = getSettings();
  if (!force && !settings.weeklySummary) return { sent: false, reason: 'off' };
  if (!force && !weeklyDue(now, settings)) return { sent: false, reason: 'not yet' };

  const key = localWeek(now);
  if (!force && briefingFor(key)?.sent_at) return { sent: false, reason: 'already sent' };

  const claim = force ? { day: key } : claimBriefing(key);
  if (!claim) return { sent: false, reason: 'claimed elsewhere' };

  const summary = buildWeeklySummary(now);

  if (state.status !== 'ready') {
    if (!force) recordBriefingFailed(key, 'WhatsApp not connected');
    return { sent: false, reason: 'whatsapp not connected', text: summary.text };
  }

  try {
    await sendMessage(reminderChatId(), summary.text);
  } catch (err) {
    if (!force) recordBriefingFailed(key, err?.message || err);
    log.error('Weekly summary send failed:', err?.message || err);
    return { sent: false, reason: 'send failed', error: err?.message || String(err) };
  }

  recordBriefingSent(key, summary.finished);
  log.info(`Weekly summary sent for ${key}: ${summary.finished} completed.`);
  return { sent: true, week: key, finished: summary.finished, text: summary.text };
}
