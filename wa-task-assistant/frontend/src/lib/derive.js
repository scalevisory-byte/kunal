import { isDone, isOverdue, isoDay, taskChat, todayIso } from './task.js';

/** SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no marker; Date needs one. */
export function parseStamp(value) {
  if (!value) return null;
  const at = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

// The same local calendar todayIso() reads, for the same reason: a stamp and
// the day it is compared against must be read on one clock.
export const onDay = (stamp, iso) => {
  const at = parseStamp(stamp);
  return at ? at.toLocaleDateString('en-CA') === iso : false;
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
      // What arrived today, however it arrived - the day's intake, which is a
      // different question from what is due today.
      addedToday: createdToday.length,
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

/**
 * Every task, cut into slices that do not overlap.
 *
 * The mockup for this asked for a stacked bar of Open · Due today · Overdue ·
 * Added today · Completed. Those five are not parts of a whole: an overdue
 * task is also open, a task due today is also open, and "added today" can be
 * any of them - the five sum to more than there are tasks, so a bar drawn from
 * them shows parts that do not make up the thing they sit inside. A chart is
 * a claim about proportion, and that one would be false.
 *
 * So the slices are disjoint and they add up: overdue, due today (and not yet
 * late), everything else still open, and finished. "Added today" is not a
 * status at all - it is when a task arrived - so it stays a figure of its own
 * above and does not enter the bar.
 */
export function statusSlices(tasks) {
  const today = todayIso();
  const open = tasks.filter((t) => !isDone(t));
  const overdue = open.filter(isOverdue);
  const dueToday = open.filter((t) => !isOverdue(t) && t.due_date === today);
  const later = open.length - overdue.length - dueToday.length;
  const done = tasks.length - open.length;

  const slices = [
    { key: 'overdue', tone: 'danger', label: 'Overdue', value: overdue.length },
    { key: 'due_today', tone: 'warn', label: 'Due today', value: dueToday.length },
    { key: 'open', tone: 'info', label: 'Open', value: later },
    { key: 'done', tone: 'ok', label: 'Completed', value: done },
  ];
  // The invariant the bar depends on, kept where it is computed rather than
  // trusted: if these ever stop adding up the bar is wrong, not the caption.
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return { slices, total, exact: total === tasks.length };
}

/**
 * This week, Monday to Sunday: how much was finished on each day.
 *
 * Read off `completed_at`, which is a recorded fact - the same source Recent
 * activity uses. The mockup drew a bar on every day of the week including the
 * four that had not happened yet, which reads as "you did nothing on Friday"
 * about a Friday that is still two days away. A day in the future carries no
 * bar and says so; a day that has passed with nothing finished carries a real
 * zero, which is a different fact and worth seeing.
 */
export function weekActivity(tasks, now = new Date()) {
  const today = todayIso();
  const monday = new Date(now);
  // getDay() is 0 for Sunday, and the working week here starts on Monday.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const at = new Date(monday);
    at.setDate(monday.getDate() + i);
    const iso = at.toLocaleDateString('en-CA');
    const future = iso > today;
    days.push({
      iso,
      label: at.toLocaleDateString([], { weekday: 'short' }),
      today: iso === today,
      future,
      count: future ? null : tasks.filter((t) => isDone(t) && onDay(t.completed_at, iso)).length,
    });
  }
  const peak = Math.max(1, ...days.map((d) => d.count || 0));
  return { days, peak, total: days.reduce((sum, d) => sum + (d.count || 0), 0) };
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
