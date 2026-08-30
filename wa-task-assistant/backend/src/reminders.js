import cron from 'node-cron';
import { config } from './config.js';
import { log } from './logger.js';
import { dueTasks, markRemindersSent } from './db.js';
import { sendMessage, reminderChatId, state } from './whatsapp.js';
import { sendPush } from './push.js';
import { today, daysUntil } from './dates.js';

const PRIORITY_MARK = { high: '🔴', medium: '🟡', low: '⚪' };

function whenLabel(dueDate) {
  const days = daysUntil(dueDate);
  if (days === null) return dueDate;
  if (days === 0) return 'today';
  if (days < 0) return `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export function buildDigest(tasks) {
  const lines = [`*Task reminder* — ${today()}`, ''];
  for (const task of tasks) {
    lines.push(`${PRIORITY_MARK[task.priority] || '⚪'} ${task.title} _(${whenLabel(task.due_date)})_`);
    const context = [task.contact, task.chat_name].filter(Boolean).join(' · ');
    if (context) lines.push(`   ${context}`);
  }
  lines.push('', `${tasks.length} task${tasks.length === 1 ? '' : 's'} need attention.`);
  return lines.join('\n');
}

/**
 * Find open, un-reminded tasks due today or earlier, send one WhatsApp digest
 * plus a web push, then mark them reminded.
 */
export async function runReminderCheck({ label = 'manual' } = {}) {
  const tasks = dueTasks(today());
  if (!tasks.length) {
    log.info(`Reminder check (${label}): nothing due.`);
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

  const push = await sendPush({
    title: `${tasks.length} task${tasks.length === 1 ? '' : 's'} due`,
    body: tasks
      .slice(0, 3)
      .map((t) => t.title)
      .join(' • '),
    url: '/',
  });

  // Only suppress future reminders for tasks we actually delivered somewhere.
  if (whatsappSent || push.sent > 0) {
    markRemindersSent(tasks.map((t) => t.id));
  }

  log.info(
    `Reminder check (${label}): ${tasks.length} task(s), whatsapp=${whatsappSent}, push=${push.sent}`
  );
  return { tasks: tasks.length, whatsapp: whatsappSent, push };
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
