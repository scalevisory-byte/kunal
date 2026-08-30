import cron from 'node-cron';
import { config } from './config.js';
import { log } from './logger.js';
import { pendingReminders, recordReminders } from './db.js';
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

function taskLine(task) {
  const lines = [];
  const when = task.due_date ? ` _(${whenLabel(task.due_date)})_` : '';
  lines.push(`${PRIORITY_MARK[task.priority] || '⚪'} ${task.title}${when}`);

  const context = [task.contact, task.chat_name].filter(Boolean);
  // chat_name repeats the contact on one-to-one chats; only show it when it adds something.
  const detail = [...new Set(context)].join(' · ');

  // reminder_count is the number of digests *before* this one.
  const nags = task.reminder_count >= 2 ? `asked ${task.reminder_count + 1}x` : '';
  const trailer = [detail, nags].filter(Boolean).join(' — ');
  if (trailer) lines.push(`   ${trailer}`);

  return lines.join('\n');
}

export function buildDigest(tasks) {
  const dated = tasks.filter((t) => t.due_date);
  const undated = tasks.filter((t) => !t.due_date);

  const lines = [`*Your open tasks* — ${today()}`, ''];

  for (const task of dated) lines.push(taskLine(task));

  if (undated.length) {
    if (dated.length) lines.push('');
    lines.push('*No date set*');
    for (const task of undated) lines.push(taskLine(task));
  }

  lines.push(
    '',
    `${tasks.length} still open. They keep showing up here until you mark them done.`
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
}
