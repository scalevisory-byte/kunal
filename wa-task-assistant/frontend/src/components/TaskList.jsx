import TaskItem from './TaskItem.jsx';

const today = () => new Date().toISOString().slice(0, 10);

/** Group by how urgent a task is, so the phone answers "what's late?" first. */
const GROUPS = [
  { key: 'overdue', label: 'Overdue', match: (t) => t.due_date && t.due_date < today() },
  { key: 'today', label: 'Today', match: (t) => t.due_date === today() },
  { key: 'later', label: 'Coming up', match: (t) => t.due_date && t.due_date > today() },
  { key: 'undated', label: 'No date', match: (t) => !t.due_date },
];

export default function TaskList({ tasks, loading, onToggle, onDelete, onEdit }) {
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

  const sections = GROUPS.map((group) => ({
    ...group,
    items: open.filter(group.match),
  })).filter((group) => group.items.length);

  if (done.length) sections.push({ key: 'done', label: 'Done', items: done });

  const render = (items) => (
    <ul className="task-list">
      {items.map((task) => (
        <TaskItem key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />
      ))}
    </ul>
  );

  // A single group needs no heading - the filter above already says what this is.
  if (sections.length === 1) return render(sections[0].items);

  return (
    <>
      {sections.map((section) => (
        <section className={`group ${section.key}`} key={section.key}>
          <header className="group-head">
            <span className="group-title">{section.label}</span>
            <span className="group-rule" />
            <span className="group-count">{section.items.length}</span>
          </header>
          {render(section.items)}
        </section>
      ))}
    </>
  );
}
