import TaskItem from './TaskItem.jsx';

export default function TaskList({ tasks, loading, onToggle, onDelete, onEdit }) {
  if (!tasks.length) {
    return (
      <p className="empty">
        {loading ? 'Loading…' : 'Nothing here yet. Tasks from WhatsApp appear automatically.'}
      </p>
    );
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />
      ))}
    </ul>
  );
}
