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

  // Exact-time reminders need a finer tick than twice a day.
  cron.schedule(
    config.exactReminderCron,
    () => {
      runExactReminders().catch((err) => log.error('Exact reminder job:', err?.message || err));
    },
    options
  );
  log.info(`Exact-time reminder job scheduled: "${config.exactReminderCron}"`);
}

/* ---------------- exact-time reminders ---------------- */

/**
 * Tasks can carry a specific time ("remind me at 10 AM"). This runs often and
 * sends each one individually the first time its moment has passed - separate
 * from the twice-daily digest, which keeps nagging until the task is done.
 */
export async function runExactReminders() {
  const due = dueExactReminders(new Date().toISOString());
  if (!due.length) return { sent: 0 };

  const delivered = [];
  for (const task of due) {
    const when = task.remind_at.slice(11, 16);
    const body = [
      `⏰ *${task.title}*`,
      task.contact ? `   ${task.contact}` : null,
      `   reminder set for ${when}`,
    ]
      .filter(Boolean)
      .join('\n');

    let ok = false;
    try {
      if (state.status === 'ready') {
        await sendMessage(reminderChatId(), body);
        ok = true;
      }
    } catch (err) {
      log.error('Exact reminder send failed:', err?.message || err);
    }

    const push = await sendPush({ title: task.title, body: `Reminder — ${when}`, url: '/' });
    if (ok || push.sent > 0) delivered.push(task.id);
  }

  markExactRemindersSent(delivered);
  if (delivered.length) log.info(`Exact reminders sent: ${delivered.length}`);
  return { sent: delivered.length };
}
