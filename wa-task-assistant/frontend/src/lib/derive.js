import { isDone, isOverdue, isoDay, taskChat, todayIso } from './task.js';

/** SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no marker; Date needs one. */
export function parseStamp(value) {
  if (!value) return null;
  const at = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

const onDay = (stamp, iso) => {
  const at = parseStamp(stamp);
  return at ? at.toISOString().slice(0, 10) === iso : false;
};

export const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

/**
 * Everything the dashboard shows, computed from the tasks actually loaded.
 * Nothing here is estimated: a figure with no data behind it comes back as
 * null so the view can say so rather than print a zero that means nothing.
 */
export function summarise(tasks) {
  const today = todayIso();
  const tomorrow = isoDay(1);
  const weekEnd = isoDay(7);
  const nextWeekEnd = isoDay(14);

  const open = tasks.filter((t) => !isDone(t));
  const dueToday = open.filter((t) => t.due_date === today);
  const overdue = open.filter(isOverdue);
  const completedToday = tasks.filter((t) => isDone(t) && onDay(t.completed_at, today));
  const createdToday = tasks.filter((t) => onDay(t.created_at, today));

  // Today's work is what was due today plus anything finished today. With
  // neither, there is no progress to report - not zero progress.
  const todayTotal = dueToday.length + completedToday.length;
  const progress = todayTotal
    ? Math.round((completedToday.length / todayTotal) * 100)
    : null;

  return {
    open,
    counts: {
      open: open.length,
      inProgress: open.filter((t) => t.status === 'in_progress').length,
      overdue: overdue.length,
      done: tasks.filter(isDone).length,
      dueToday: dueToday.length,
      completedToday: completedToday.length,
      highOpen: open.filter((t) => t.priority === 'high').length,
      aiCreatedToday: createdToday.filter((t) => t.origin === 'ai').length,
      total: tasks.length,
    },
    progress,
    todayTotal,
    overdue,
    upcoming: [
      { key: 'tomorrow', label: 'Tomorrow', count: open.filter((t) => t.due_date === tomorrow).length },
      {
        key: 'week',
        label: 'Next 7 days',
        count: open.filter((t) => t.due_date > today && t.due_date <= weekEnd).length,
      },
      {
        key: 'later',
        label: 'The week after',
        count: open.filter((t) => t.due_date > weekEnd && t.due_date <= nextWeekEnd).length,
      },
    ],
  };
}

/** Chats that have tasks, busiest first. Names come from the tasks themselves. */
export function chatCounts(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    const name = taskChat(task);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * A history table does not exist, so activity is read off the timestamps the
 * tasks already carry: when one was created, and when one was completed. Those
 * are recorded facts. Anything else - an edited due date, a changed priority -
 * leaves no trace, so it is not claimed here.
 */
export function activity(tasks, limit = 6) {
  const events = [];
  for (const task of tasks) {
    const created = parseStamp(task.created_at);
    if (created) {
      events.push({
        at: created,
        kind: task.origin === 'ai' ? 'ai' : 'manual',
        text: task.origin === 'ai' ? `AI created "${task.title}"` : `You added "${task.title}"`,
      });
    }
    const completed = parseStamp(task.completed_at);
    if (completed) events.push({ at: completed, kind: 'done', text: `Completed "${task.title}"` });
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Days of the month that carry a due date, for the compact calendar. */
export function dueByDay(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    if (task.due_date && !isDone(task)) {
      counts.set(task.due_date, (counts.get(task.due_date) || 0) + 1);
    }
  }
  return counts;
}
