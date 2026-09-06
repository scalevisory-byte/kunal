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
import { db } from './db.js';

const dbUpdateCount = db.prepare(
  `UPDATE tasks SET follow_up_count = ?, updated_at = datetime('now') WHERE id = ?`
);
import {
  getSettings, dueReminders, claimReminder, markMissed, addNotification,
} from './scheduling.js';
import { getTask } from './db.js';
import {
  dueMoment, planTask, scheduleNextFollowUp, syncNextReminder, tasksWithDeadlines,
  activeRemindersForTask,
} from './task-lifecycle.js';
import { EVENT, recordEvent } from './task-events.js';
import { maybeSendBriefing } from './briefing.js';

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
        // The daily briefing is the morning message when it is switched on;
        // running the digest as well would be two lists before breakfast.
        if (label === 'morning' && getSettings().dailyBriefing) {
          log.info('Morning digest skipped: the daily briefing covers it.');
          return;
        }
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

const LABEL = {
  pre_due: 'Reminder',
  due: 'Task due',
  follow_up: 'Follow-up',
  custom: 'Reminder',
};

/**
 * One pass. Two halves, in this order:
 *
 *   1. Deliver anything whose moment has arrived. Each row is claimed with a
 *      conditional UPDATE before a single notification is written, so a second
 *      tick, a restart mid-send, or a retry finds nothing left to claim.
 *   2. Walk open tasks with a deadline and make sure the next rung of their
 *      ladder exists. Only ever the next one: a task that gets finished never
 *      has a queue of future nagging waiting behind it.
 *
 * A task marked done is skipped in both halves, and its rows are cancelled the
 * moment it is completed - so nothing is ever sent about finished work.
 */
export async function runReminderEngine({ now = new Date() } = {}) {
  const settings = getSettings();

  // The briefing rides the same tick as everything else: one scheduler, and a
  // claim that survives restarts, rather than a second cron to keep in step.
  const briefing = await maybeSendBriefing({ now }).catch((err) => {
    log.error('Daily briefing:', err?.message || err);
    return { sent: false };
  });
  const nowIso = now.toISOString();
  const missedBefore = new Date(now.getTime() - settings.missedAfterHours * 3600_000).toISOString();

  let sent = 0;
  let missed = 0;

  for (const row of dueReminders(nowIso)) {
    const task = getTask(row.task_id);
    if (!task || task.status === 'done') continue; // finished work is never chased

    if (row.fire_at < missedBefore) {
      if (markMissed(row.id)) {
        missed += 1;
        addNotification({
          kind: 'missed',
          title: `Missed reminder — ${task.title}`,
          body: 'The server was not running when this was due. Reschedule it if it still matters.',
          task_id: task.id,
          reminder_id: row.id,
        });
      }
      continue;
    }

    const claimed = claimReminder(row.id);
    if (!claimed) continue;

    await deliver(task, claimed, settings);
    recordEvent(
      task.id,
      claimed.kind === 'follow_up' ? EVENT.followUpTriggered : EVENT.reminderTriggered,
      claimed.kind === 'follow_up' ? `round ${claimed.round}` : claimed.kind
    );
    sent += 1;

    // A follow-up that has just gone out is the trigger for arranging the next
    // rung, and only then - so the ladder advances one step per notification.
    if (claimed.kind === 'follow_up') {
      const after = getTask(task.id);
      if (after && after.status !== 'done') {
        const count = (after.follow_up_count || 0) + 1;
        updateTaskCount(after.id, count);
        scheduleNextFollowUp({ ...after, follow_up_count: count }, settings);
      }
    }
    syncNextReminder(task.id);
  }

  const planned = planOpenTasks(settings, now);

  if (sent || missed || planned) {
    log.info(`Reminder engine: ${sent} sent, ${missed} missed, ${planned} newly scheduled`);
  }
  return { sent, missed, planned, briefing: Boolean(briefing?.sent) };
}

function updateTaskCount(taskId, count) {
  dbUpdateCount.run(count, taskId);
}

/**
 * Makes sure every open task with a deadline has its schedule laid out. Tasks
 * created before the engine existed, or whose deadline was set elsewhere, are
 * picked up here rather than needing a special path.
 */
function planOpenTasks(settings, now) {
  let planned = 0;
  for (const task of tasksWithDeadlines()) {
    const due = dueMoment(task, settings);
    if (!due) continue;

    const active = activeRemindersForTask(task.id);
    if (active.length) continue; // already has something waiting

    if (due > now) {
      planned += planTask(task).planned;
    } else if (settings.followUpEnabled && !task.needs_attention) {
      // Past its deadline with nothing pending: put the next rung in place.
      planned += scheduleNextFollowUp(task, settings, due);
      syncNextReminder(task.id);
    }
  }
  return planned;
}

/** In-app always; browser and WhatsApp only where the settings allow it. */
async function deliver(task, reminder, settings) {
  const label = LABEL[reminder.kind] || 'Reminder';
  const due = dueMoment(task, settings);
  const dueLabel = due
    ? due.toLocaleString('en-GB', {
        timeZone: config.timezone, day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit',
      })
    : null;

  const body =
    reminder.kind === 'follow_up'
      ? `Still not done — was due ${dueLabel}. Follow-up ${reminder.round} of ${settings.followUpMax}.`
      : reminder.kind === 'due'
        ? `Due now (${dueLabel}).`
        : dueLabel
          ? `Due ${dueLabel}.`
          : null;

  addNotification({
    kind: reminder.kind === 'follow_up' ? 'follow_up' : 'reminder',
    title: `${label} — ${task.title}`,
    body,
    task_id: task.id,
    reminder_id: reminder.id,
  });

  if (settings.notifyBrowser) {
    await sendPush({ title: `${label}: ${task.title}`, body: body || '', url: '/' });
  }

  // WhatsApp is opt-in, per kind, and reminderChatId() is always the linked
  // account's own chat - there is no path here that can message a contact.
  const wantsWhatsApp = reminder.kind === 'follow_up'
    ? settings.whatsappFollowUps
    : settings.notifyWhatsApp;

  if (wantsWhatsApp && state.status === 'ready') {
    const heading = reminder.kind === 'follow_up' ? '🔔 *FOLLOW-UP*' : '⏰ *TASK REMINDER*';
    const text = [
      heading,
      '',
      `*${task.title}*`,
      dueLabel ? `Deadline: ${dueLabel}` : null,
      reminder.kind === 'follow_up' ? 'Status: still not completed' : 'Status: not completed',
      '',
      `Reply *done ${task.id}* to close it, *snooze ${task.id} 2 hours*,`,
      'or open WA Tasks to reschedule.',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await sendMessage(reminderChatId(), text);
    } catch (err) {
      log.error('Reminder WhatsApp send failed:', err?.message || err);
    }
  }
}

/** Kept so the existing POST /api/reminders/exact route keeps working. */
export const runExactReminders = () => runReminderEngine();
