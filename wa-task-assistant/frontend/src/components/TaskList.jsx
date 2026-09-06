import TaskItem from './TaskItem.jsx';

const dayMs = 86400000;
const isoDay = (offset = 0) => new Date(Date.now() + offset * dayMs).toISOString().slice(0, 10);

/**
 * Columns by day, because that is how the work is actually decided: what is
 * late, what is today, what is tomorrow. Everything past that is one column -
 * a separate column per future date would be mostly empty.
 */
function byDate(open) {
  const today = isoDay(0);
  const tomorrow = isoDay(1);
  const dayAfter = isoDay(2);

  const columns = [
    { key: 'overdue', label: 'Overdue', match: (t) => t.due_date && t.due_date < today },
    { key: 'today', label: 'Today', match: (t) => t.due_date === today },
    { key: 'tomorrow', label: 'Tomorrow', match: (t) => t.due_date === tomorrow },
    { key: 'dayafter', label: 'Day after', match: (t) => t.due_date === dayAfter },
    { key: 'later', label: 'Later', match: (t) => t.due_date && t.due_date > dayAfter },
    { key: 'undated', label: 'No date', match: (t) => !t.due_date },
  ];
  return columns.map((c) => ({ ...c, items: open.filter(c.match) }));
}

/** Columns by conversation, for working through one person or group at a time. */
function byChat(open) {
  const groups = new Map();
  for (const task of open) {
    const name = task.chat_name || task.contact || 'Added by hand';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(task);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ key: name, label: name, items }));
}

export default function TaskList({ tasks, loading, groupBy, onToggle, onDelete, onEdit }) {
  if (!tasks.length) {
    return (
      <p className="empty">
        {loading ? (
          'Loading…'
        ) : (
          <>
            <strong>Nothing pending</strong>
            Tasks from WhatsApp show up here on their own.
          </>
        )}
      </p>
    );
  }

  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done');

  const columns = (groupBy === 'chat' ? byChat(open) : byDate(open)).filter((c) => c.items.length);
  if (done.length) columns.push({ key: 'done', label: 'Done', items: done });

  return (
    <div className="columns">
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
                onDelete={onDelete}
                onEdit={onEdit}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
