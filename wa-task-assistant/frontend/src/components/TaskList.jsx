import TaskItem from './TaskItem.jsx';
import { isDone, isOverdue, isoDay, taskChat, todayIso } from '../lib/task.js';

/** Sections by day: what is late, what is today, what is next. */
function byDate(open) {
  const today = todayIso();
  const tomorrow = isoDay(1);
  const dayAfter = isoDay(2);

  return [
    { key: 'overdue', label: 'Overdue', match: (t) => t.due_date && t.due_date < today },
    { key: 'today', label: 'Today', match: (t) => t.due_date === today },
    { key: 'tomorrow', label: 'Tomorrow', match: (t) => t.due_date === tomorrow },
    { key: 'dayafter', label: 'Day after', match: (t) => t.due_date === dayAfter },
    { key: 'later', label: 'Upcoming', match: (t) => t.due_date && t.due_date > dayAfter },
    { key: 'undated', label: 'No date', match: (t) => !t.due_date },
  ].map((c) => ({ ...c, items: open.filter(c.match) }));
}

/** Sections by conversation, for working through one person or group at a time. */
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
 * My day is the answer to "what now": late work first, then what is already
 * underway, then what is urgent or due today, and finally what was finished.
 */
function myDay(open, done) {
  const today = todayIso();
  const completedToday = done.filter((t) => (t.completed_at || '').slice(0, 10) === today);

  return [
    { key: 'overdue', label: 'Overdue', items: open.filter(isOverdue) },
    {
      key: 'today',
      label: 'Due today',
      items: open.filter((t) => t.due_date === today && !isOverdue(t)),
    },
    {
      key: 'doing',
      label: 'In progress',
      items: open.filter((t) => t.status === 'in_progress' && t.due_date !== today && !isOverdue(t)),
    },
    {
      key: 'high',
      label: 'High priority',
      items: open.filter(
        (t) => t.priority === 'high' && t.status !== 'in_progress' && t.due_date !== today && !isOverdue(t)
      ),
    },
    { key: 'donetoday', label: 'Completed today', items: completedToday },
  ];
}

const count = (n) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

export default function TaskList({
  tasks, loading, error, groupBy, view, query, onRetry, onToggle, onOpen, onStatus, onQuickDate,
}) {
  if (error) {
    return (
      <div className="empty error-state">
        <strong>Unable to load tasks</strong>
        <p>Check your connection, then try again.</p>
        <button className="btn ghost" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  if (loading && !tasks.length) {
    return (
      <div className="empty" aria-busy="true">
        <strong>Loading tasks…</strong>
        <p>One moment.</p>
      </div>
    );
  }

  const open = tasks.filter((t) => !isDone(t));
  const done = tasks.filter(isDone);

  let sections;
  if (view === 'myday') sections = myDay(open, done);
  else if (groupBy === 'chat') sections = byChat(open);
  else sections = byDate(open);

  sections = sections.filter((s) => s.items.length);
  if (view !== 'myday' && done.length) sections.push({ key: 'done', label: 'Completed', items: done });

  if (!sections.length) {
    return (
      <div className="empty">
        <strong>{query ? 'No tasks match your search.' : "You're all caught up."}</strong>
        <p>
          {query
            ? 'Try a different word, or clear the filters.'
            : view === 'all'
              ? 'Tasks from WhatsApp appear here on their own.'
              : 'No pending tasks for this period.'}
        </p>
      </div>
    );
  }

  return (
    <div className="sections">
      {sections.map((section) => (
        <section className={`section ${section.key}`} key={section.key}>
          <header className="section-head">
            <h3>{section.label}</h3>
            <span className="section-count">{count(section.items.length)}</span>
          </header>
          <ul className="task-list">
            {section.items.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onOpen={onOpen}
                onStatus={onStatus}
                onQuickDate={onQuickDate}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
