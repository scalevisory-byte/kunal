import cron from 'node-cron';
import { config } from './config.js';
import { log } from './logger.js';
import {
  pendingReminders, recordReminders, setDigestPositions,
  dueExactReminders, markExactRemindersSent,
} from './db.js';
import { sendMessage, reminderChatId, state } from './whatsapp.js';
import { sendPush } from './push.js';
import { today, daysUntil } from './dates.js';
import {
  getSettings, dueReminders, claimReminder, markMissed, addNotification,
  refreshFollowUpStatuses, listFollowUps, advanceFollowUp, getFollowUp,
} from './scheduling.js';
import { getTask } from './db.js';

const PRIORITY_MARK = { high: '🔴', medium: '🟡', low: '⚪' };

function whenLabel(dueDate) {
  const days = daysUntil(dueDate);
  if (days === null) return dueDate;
  if (days === 0) return 'due today';
  if (days === -1) return 'overdue since yesterday';
  if (days < 0) return `overdue by ${Math.abs(days)} days`;
  return `due in ${days} day${days === 1 ? '' : 's'}`;
}

function taskLine(task, position) {
  const lines = [];
  const when = task.due_date ? ` _(${whenLabel(task.due_date)})_` : '';
  const at = task.remind_at ? ` ⏰ ${task.remind_at.slice(11, 16)}` : '';
  lines.push(`*${position}.* ${PRIORITY_MARK[task.priority] || '⚪'} ${task.title}${when}${at}`);

  const context = [task.contact, task.chat_name].filter(Boolean);
  // chat_name repeats the contact on one-to-one chats; only show it when it adds something.
  const detail = [...new Set(context)].join(' · ');

  // reminder_count is the number of digests *before* this one.
  const nags = task.reminder_count >= 2 ? `asked ${task.reminder_count + 1}x` : '';
  const trailer = [detail, nags].filter(Boolean).join(' — ');
  if (trailer) lines.push(`   ${trailer}`);

  return lines.join('\n');
}

/**
 * `tasks` must already be in the order they will be numbered - the caller
 * records that same order so a "done 2" reply resolves to the right task.
 */
export function buildDigest(tasks) {
  const position = new Map(tasks.map((t, i) => [t.id, i + 1]));
  const dated = tasks.filter((t) => t.due_date);
  const undated = tasks.filter((t) => !t.due_date);

  const lines = [`*Your open tasks* — ${today()}`, ''];

  for (const task of dated) lines.push(taskLine(task, position.get(task.id)));

  if (undated.length) {
    if (dated.length) lines.push('');
    lines.push('*No date set*');
    for (const task of undated) lines.push(taskLine(task, position.get(task.id)));
  }

  lines.push(
    '',
    `${tasks.length} still open.`,
    `Reply *done 2* to close one, *done all*, or *snooze 2* to push it a day.`
  );
  return lines.join('\n');
}

/**
 * Send one digest of everything still open, then bump each task's reminder count.
 * Nothing is retired here - a task leaves the digest only by being marked done.
 */
export async function runReminderCheck({ label = 'manual' } = {}) {
  const tasks = pendingReminders(today());
  if (!tasks.length) {
    log.info(`Reminder check (${label}): nothing open.`);
    return { tasks: 0, whatsapp: false, push: null };
  }

  const digest = buildDigest(tasks);
  let whatsappSent = false;

  try {
    if (state.status === 'ready') {
      await sendMessage(reminderChatId(), digest);
      whatsappSent = true;
    } else {
      log.warn(`Reminder check (${label}): WhatsApp not ready (${state.status}), skipping the digest.`);
    }
  } catch (err) {
    log.error(`Reminder check (${label}): WhatsApp send failed:`, err?.message || err);
  }

  const overdue = tasks.filter((t) => t.due_date && daysUntil(t.due_date) < 0).length;
  const push = await sendPush({
    title: overdue
      ? `${overdue} overdue, ${tasks.length} open`
      : `${tasks.length} task${tasks.length === 1 ? '' : 's'} open`,
    body: tasks
      .slice(0, 3)
      .map((t) => t.title)
      .join(' • '),
    url: '/',
  });

  // Only count a reminder that actually reached a channel, so a disconnected
  // session does not inflate the "asked Nx" counter with digests nobody saw.
  if (whatsappSent || push.sent > 0) {
    recordReminders(tasks.map((t) => t.id));
    // Same order as the digest, so "done 2" means the second line of it.
    setDigestPositions(tasks.map((t) => t.id));
  }

  log.info(
    `Reminder check (${label}): ${tasks.length} open (${overdue} overdue), whatsapp=${whatsappSent}, push=${push.sent}`
  );
  return { tasks: tasks.length, overdue, whatsapp: whatsappSent, push };
}

export function startReminderJobs() {
  const options = { timezone: config.timezone };
  const schedules = [
    ['morning', config.reminderCronMorning],
    ['evening', config.reminderCronEvening],
  ];

  for (const [label, expression] of schedules) {
    if (!cron.validate(expression)) {
      log.error(`Invalid ${label} reminder cron "${expression}" — job not scheduled.`);
      continue;
    }
    cron.schedule(
      expression,
      () => {
        runReminderCheck({ label }).catch((err) => log.error('Reminder job:', err?.message || err));
      },
      options
    );
    log.info(`Reminder job scheduled: ${label} "${expression}" (${config.timezone})`);
  }

  // The reminder engine needs a finer tick than twice a day. This is the only
  // scheduler in the application - everything timed hangs off these three jobs.
  cron.schedule(
    config.exactReminderCron,
    () => {
      runReminderEngine().catch((err) => log.error('Reminder engine:', err?.message || err));
    },
    options
  );
  log.info(`Reminder engine scheduled: "${config.exactReminderCron}" (${config.timezone})`);
}

/* ---------------- the reminder engine ---------------- */

/**
 * One pass over everything whose moment has arrived. Each reminder is claimed
 * before anything is sent: the claim is a conditional UPDATE, so a second tick,
 * a restart mid-send, or a retry finds the row already out of the active states
 * and moves on. That is the whole duplicate-protection story, and it is why
 * delivery happens after the claim rather than before it.
 *
 * A claim that is never delivered is a reminder lost rather than a reminder
 * repeated, which is the trade this makes deliberately: the notification row
 * is written in the same pass, so the user still sees it in the app.
 */
export async function runReminderEngine({ now = new Date() } = {}) {
  const settings = getSettings();
  const nowIso = now.toISOString();
  const missedBefore = new Date(now.getTime() - settings.missedAfterHours * 3600_000).toISOString();

  const due = dueReminders(nowIso);
  let sent = 0;
  let missed = 0;

  for (const row of due) {
    // Too old to be useful; the user reschedules it instead of being shouted at.
    if (row.fire_at < missedBefore) {
      if (markMissed(row.id)) {
        missed += 1;
        const subject = subjectOf(row);
        if (subject) {
          addNotification({
            kind: 'missed',
            title: `Missed reminder — ${subject.title}`,
            body: 'The server was not running when this was due. Reschedule it if it still matters.',
            task_id: row.task_id,
            follow_up_id: row.follow_up_id,
            reminder_id: row.id,
          });
        }
      }
      continue;
    }

    const claimed = claimReminder(row.id);
    if (!claimed) continue; // something else took it; never send twice

    const subject = subjectOf(row);
    if (!subject) continue; // task or follow-up deleted underneath us

    await deliver(subject, claimed, settings);
    sent += 1;
  }

  const moved = refreshFollowUpStatuses(nowIso);
  const chased = await chaseFollowUps(settings, now);

  if (sent || missed || chased) {
    log.info(
      `Reminder engine: ${sent} sent, ${missed} missed, ${chased} follow-up(s) advanced` +
        `, ${moved.toDue} due, ${moved.toOverdue} overdue`
    );
  }
  return { sent, missed, chased, ...moved };
}

/** What a reminder is about: a task, or a follow-up. */
function subjectOf(reminder) {
  if (reminder.task_id) {
    const task = getTask(reminder.task_id);
    if (!task || task.status === 'done') return null;
    return { kind: 'task', id: task.id, title: task.title, context: task.contact || task.chat_name };
  }
  if (reminder.follow_up_id) {
    const followUp = getFollowUp(reminder.follow_up_id);
    if (!followUp || ['completed', 'cancelled'].includes(followUp.status)) return null;
    return {
      kind: 'follow_up',
      id: followUp.id,
      title: followUp.title,
      context: followUp.contact || followUp.chat_name,
      reason: followUp.reason,
    };
  }
  return null;
}

/** In-app always, browser and WhatsApp only where the settings allow it. */
async function deliver(subject, reminder, settings) {
  const at = reminder.fire_at.slice(11, 16);
  const label = subject.kind === 'follow_up' ? 'Follow-up due' : 'Reminder';

  addNotification({
    kind: subject.kind === 'follow_up' ? 'follow_up' : 'reminder',
    title: `${label} — ${subject.title}`,
    body: [subject.context, subject.reason, `set for ${at}`].filter(Boolean).join(' · '),
    task_id: subject.kind === 'task' ? subject.id : null,
    follow_up_id: subject.kind === 'follow_up' ? subject.id : null,
    reminder_id: reminder.id,
  });

  if (settings.notifyBrowser) {
    await sendPush({ title: subject.title, body: `${label} — ${at}`, url: '/' });
  }

  // Outbound WhatsApp stays off unless it has been turned on deliberately, and
  // even then it only ever messages the user's own chat - never a contact.
  if (settings.notifyWhatsApp && state.status === 'ready') {
    const body = [
      `⏰ *${subject.title}*`,
      subject.context ? `   ${subject.context}` : null,
      subject.reason ? `   ${subject.reason}` : null,
      `   ${label.toLowerCase()} — ${at}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await sendMessage(reminderChatId(), body);
    } catch (err) {
      log.error('Reminder WhatsApp send failed:', err?.message || err);
    }
  }
}

/**
 * A follow-up whose date has passed and that has had no reply either repeats on
 * its interval or stops and asks for attention. Nothing is sent to the contact.
 */
async function chaseFollowUps(settings, now) {
  const open = listFollowUps({ status: 'open' }).filter(
    (f) => !f.responded_at && f.due_at <= now.toISOString() && (f.status === 'due' || f.status === 'overdue')
  );

  let advanced = 0;
  for (const followUp of open) {
    // Only chase again once the current round has actually been notified about.
    const notified = followUp.reminders.some((r) => r.status === 'triggered' || r.status === 'acknowledged');
    if (!notified && followUp.reminders.length) continue;

    const outcome = advanceFollowUp(followUp, settings);
    if (outcome.repeated || outcome.reason === 'maximum reached') advanced += 1;
  }
  return advanced;
}

/* ---------------- backwards compatibility ---------------- */

/**
 * Kept so the existing POST /api/reminders/exact route and anything calling it
 * keep working; the engine is where the logic lives now.
 */
export const runExactReminders = () => runReminderEngine();
