import { db, getTask, updateTask } from './db.js';
import { log } from './logger.js';
import { config } from './config.js';
import {
  getSettings, applyQuietHours, scheduleReminder, cancelRemindersForTask,
  resetSchedule, nextReminderFor, remindersForTask, activeRemindersForTask,
} from './scheduling.js';
import { EVENT, recordEvent, eventCounts, eventsForTask } from './task-events.js';

const MIN = 60_000;

/**
 * The deadline a task is actually measured against. `due_at` is the exact
 * moment when one was given; otherwise the date at the configured default time,
 * read in the user's timezone rather than the server's.
 */
export function dueMoment(task, settings = getSettings()) {
  if (task.due_at) return new Date(task.due_at);
  if (!task.due_date) return null;

  const [h, m] = String(settings.defaultDueTime || '18:00').split(':').map(Number);
  // Build the instant that reads as this wall-clock time in the configured zone.
  const guess = new Date(`${task.due_date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const shown = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(guess);
  const parts = Object.fromEntries(shown.map((p) => [p.type, p.value]));
  const drift = (Number(parts.hour) * 60 + Number(parts.minute)) - (h * 60 + m);
  return new Date(guess.getTime() - drift * MIN);
}

/**
 * The state the user sees. Stored status stays open / in_progress / done - due
 * and overdue are a function of the deadline and the clock, so deriving them
 * keeps one source of truth rather than a column a job has to maintain.
 */
export function taskState(task, now = new Date(), settings = getSettings()) {
  if (task.status === 'done') return 'done';
  const due = dueMoment(task, settings);
  if (!due) return task.status; // open | in_progress
  const diff = due.getTime() - now.getTime();
  if (diff > 0) return task.status;
  // Past the deadline: due for the first hour, overdue after that.
  return diff > -60 * MIN ? 'due' : 'overdue';
}

/** Everything the drawer and the widget need, computed from real rows. */
export function taskSchedule(task, settings = getSettings()) {
  const due = dueMoment(task, settings);
  const reminders = remindersForTask(task.id);
  const active = reminders.filter((r) => ['scheduled', 'snoozed'].includes(r.status));
  const nextFollowUp = active.find((r) => r.kind === 'follow_up');

  return {
    state: taskState(task, new Date(), settings),
    due_at: due ? due.toISOString() : null,
    next_reminder_at: active.length ? active[0].fire_at : null,
    next_follow_up_at: nextFollowUp ? nextFollowUp.fire_at : null,
    follow_up_count: task.follow_up_count || 0,
    follow_up_max: settings.followUpMax,
    needs_attention: Boolean(task.needs_attention),
    reminders,
  };
}

/**
 * Lays out a task's schedule from its deadline: the pre-due reminder, the one
 * at the deadline itself, and the first follow-up. Later follow-ups are added
 * one at a time by the engine, so a task that gets done never has a queue of
 * future nagging waiting behind it.
 */
export function planTask(task, { reset = false, reminderOffset, followUpOffset } = {}) {
  // A per-task choice overrides the default for this task only; the saved
  // settings are never written to from here.
  const saved = getSettings();
  const settings = {
    ...saved,
    ...(reminderOffset !== undefined ? { defaultReminderOffset: reminderOffset } : {}),
    ...(followUpOffset !== undefined
      ? { followUpOffsets: [followUpOffset, ...saved.followUpOffsets.slice(1)] }
      : {}),
  };
  if (task.status === 'done') {
    cancelRemindersForTask(task.id);
    return { planned: 0 };
  }

  const due = dueMoment(task, settings);
  if (!due) return { planned: 0, reason: 'no deadline' };

  if (reset) resetSchedule(task.id);

  const at = (date) => applyQuietHours(date, settings, config.timezone).toISOString();
  let planned = 0;

  const offset = settings.defaultReminderOffset;
  if (Number.isFinite(offset) && offset > 0) {
    const before = new Date(due.getTime() - offset * MIN);
    // A reminder for a moment that has already gone is not worth arranging.
    if (before > new Date()) {
      const made = scheduleReminder({ taskId: task.id, fireAt: at(before), kind: 'pre_due', offsetMinutes: offset });
      if (made?.created_at) recordEvent(task.id, EVENT.reminderCreated, at(before));
      planned += 1;
    }
  }

  if (settings.remindAtDue && due > new Date()) {
    scheduleReminder({ taskId: task.id, fireAt: at(due), kind: 'due' });
    planned += 1;
  }

  if (settings.followUpEnabled) planned += scheduleNextFollowUp(task, settings, due);

  syncNextReminder(task.id);
  return { planned };
}

/**
 * Arranges the next rung of the ladder, if there is one left. Returns 0 when
 * the maximum has been reached - at which point the task is flagged rather than
 * chased again, which is the difference between reminding and spamming.
 */
export function scheduleNextFollowUp(task, settings = getSettings(), due = null) {
  if (!settings.followUpEnabled) return 0;
  const deadline = due || dueMoment(task, settings);
  if (!deadline) return 0;

  const round = (task.follow_up_count || 0) + 1;
  const max = settings.followUpMax;
  if (round > max || round > settings.followUpOffsets.length) {
    if (!task.needs_attention) {
      updateTask(task.id, { needs_attention: 1 });
      recordEvent(task.id, EVENT.needsAttention, `${max} follow-ups with no completion`);
      log.info(`Task ${task.id} reached ${max} follow-ups; flagged for attention.`);
    }
    return 0;
  }

  const offset = settings.followUpOffsets[round - 1];
  const previousOffset = round > 1 ? settings.followUpOffsets[round - 2] : 0;
  const planned = deadline.getTime() + offset * MIN;

  // A task found long after its deadline has several rungs already in the past.
  // Firing them on consecutive ticks would be three notifications inside a
  // minute, so each rung keeps its intended distance from when the previous one
  // actually went out. The first rung is never held back this way: a task an
  // hour overdue should be nudged now, not in another half hour.
  let floor = planned;
  if (round > 1) {
    const last = db
      .prepare(
        `SELECT triggered_at FROM reminders
         WHERE task_id = ? AND kind = 'follow_up' AND round = ? AND triggered_at IS NOT NULL`
      )
      .get(task.id, round - 1);
    if (last) {
      floor = Math.max(planned, Date.parse(last.triggered_at + 'Z') + (offset - previousOffset) * MIN);
    }
  }

  const fireAt = applyQuietHours(new Date(floor), settings, config.timezone);
  scheduleReminder({
    taskId: task.id,
    fireAt: fireAt.toISOString(),
    kind: 'follow_up',
    round,
    offsetMinutes: offset,
  });
  recordEvent(task.id, EVENT.followUpScheduled, fireAt.toISOString(), { round });
  return 1;
}

/** Copies the next pending reminder onto the task, for display and the digest. */
export function syncNextReminder(taskId) {
  const next = nextReminderFor(taskId);
  db.prepare(
    `UPDATE tasks SET remind_at = ?, remind_at_sent = 0, updated_at = datetime('now') WHERE id = ?`
  ).run(next, taskId);
  return next;
}

/** Completing a task ends its lifecycle: nothing further is ever sent about it. */
export function completeTask(taskId) {
  const cancelled = cancelRemindersForTask(taskId);
  if (cancelled) recordEvent(taskId, EVENT.reminderCancelled, `${cancelled} pending`);
  recordEvent(taskId, EVENT.completed, onTimeLabel(getTask(taskId)));
  db.prepare(
    `UPDATE tasks SET remind_at = NULL, needs_attention = 0, updated_at = datetime('now') WHERE id = ?`
  ).run(taskId);
  return cancelled;
}

/**
 * Moving the deadline starts the whole cycle again from the new time: the old
 * schedule goes, the escalation count resets, and the ladder is rebuilt.
 */
export function rescheduleTask(taskId, { due_date, due_at }) {
  const before = getTask(taskId);
  const patch = { follow_up_count: 0, needs_attention: 0 };
  if (due_date !== undefined) patch.due_date = due_date;
  if (due_at !== undefined) patch.due_at = due_at;
  const task = updateTask(taskId, patch);
  if (!task) return null;

  resetSchedule(taskId);
  planTask(task, { reset: true });

  const wasAt = before?.due_at || before?.due_date || null;
  const nowAt = task.due_at || task.due_date || null;
  if (wasAt !== nowAt) {
    recordEvent(taskId, wasAt ? EVENT.deadlineChanged : EVENT.deadlineSet, nowAt, { from: wasAt });
  }
  return getTask(taskId);
}

/**
 * Whether a finished task beat its deadline. Unknown when there was no
 * deadline to beat - which is not the same as being on time.
 */
export function onTimeLabel(task) {
  if (!task?.completed_at) return null;
  const due = dueMoment(task);
  if (!due) return 'no deadline';
  const completed = new Date(task.completed_at.includes('T')
    ? task.completed_at
    : `${task.completed_at.replace(' ', 'T')}Z`);
  return completed <= due ? 'on time' : 'late';
}

/** Everything the history view shows about one finished task. */
export function taskHistory(task) {
  return {
    ...task,
    ...taskSchedule(task),
    on_time: onTimeLabel(task),
    counts: eventCounts(task.id),
    events: eventsForTask(task.id),
  };
}

/** Open tasks with a deadline, for the engine to walk. */
export const tasksWithDeadlines = () =>
  db.prepare(
    `SELECT * FROM tasks
     WHERE status != 'done' AND (due_at IS NOT NULL OR due_date IS NOT NULL)`
  ).all();

export { activeRemindersForTask };
