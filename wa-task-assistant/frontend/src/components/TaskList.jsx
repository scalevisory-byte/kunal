import TaskItem from './TaskItem.jsx';
import { isDone, isOverdue, isoDay, taskChat, todayIso } from '../lib/task.js';

/**
 * Columns by day, because that is how the work is actually decided: what is
 * late, what is today, what is tomorrow. Everything past that is one column -
 * a separate column per future date would be mostly empty.
 */
function byDate(open) {
  const today = todayIso();
  const tomorrow = isoDay(1);
  const dayAfter = isoDay(2);

  return [
    { key: 'overdue', label: 'Overdue', match: (t) => t.due_date && t.due_date < today },
    { key: 'today', label: 'Today', match: (t) => t.due_date === today },
    { key: 'tomorrow', label: 'Tomorrow', match: (t) => t.due_date === tomorrow },
    { key: 'dayafter', label: 'Day after', match: (t) => t.due_date === dayAfter },
    { key: 'later', label: 'Later', match: (t) => t.due_date && t.due_date > dayAfter },
    { key: 'undated', label: 'No date', match: (t) => !t.due_date },
  ].map((c) => ({ ...c, items: open.filter(c.match) }));
}

/** Columns by conversation, for working through one person or group at a time. */
function byChat(open) {
  const groups = new Map();
  for (const task of open) {
    const name = taskChat(task) || 'Added by hand';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(task);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ key: name, label: name, items }));
}

/**
 * My Day is a single ranked list rather than columns: late first, then what is
 * already underway, then what is high priority or due today.
 */
function myDay(open) {
  const today = todayIso();
  const rank = (t) => {
    if (isOverdue(t)) return 0;
    if (t.status === 'in_progress') return 1;
    if (t.priority === 'high') return 2;
    if (t.due_date === today) return 3;
    return 4;
  };
  const items = open.filter((t) => rank(t) < 4).sort((a, b) => rank(a) - rank(b));
  return [{ key: 'myday', label: 'My day', items }];
}

export default function TaskList({
  tasks, loading, error, groupBy, view, onRetry, onToggle, onOpen, onQuickDate,
}) {
  if (error) {
    return (
      <p className="empty error-state">
        <strong>Unable to load tasks</strong>
        Check your connection, then try again.
        <button className="btn ghost" onClick={onRetry}>Try again</button>
      </p>
    );
  }

  if (loading && !tasks.length) {
    return (
      <p className="empty" aria-busy="true">
        <strong>Loading tasks…</strong>
        One moment.
      </p>
    );
  }

  if (!tasks.length) {
    return (
      <p className="empty">
        <strong>You're all caught up 🎉</strong>
        {view === 'all'
          ? 'Tasks from WhatsApp show up here on their own.'
          : 'Nothing matches this view.'}
      </p>
    );
  }

  const open = tasks.filter((t) => !isDone(t));
  const done = tasks.filter(isDone);

  let columns;
  if (view === 'myday') columns = myDay(open);
  else if (groupBy === 'chat') columns = byChat(open);
  else columns = byDate(open);

  columns = columns.filter((c) => c.items.length);
  if (done.length) columns.push({ key: 'done', label: 'Done', items: done });

  if (!columns.length) {
    return (
      <p className="empty">
        <strong>You're all caught up 🎉</strong>
        No pending tasks in this view.
      </p>
    );
  }

  return (
    <div className={`columns ${view === 'myday' ? 'single' : ''}`}>
      {columns.map((column) => (
        <section className={`column ${column.key}`} key={column.key}>
          <header className="column-head">
            <span className="column-title">{column.label}</span>
            <span className="column-count">{column.items.length}</span>
          </header>
          <ul className="task-list">
            {column.items.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onOpen={onOpen}
                onQuickDate={onQuickDate}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
