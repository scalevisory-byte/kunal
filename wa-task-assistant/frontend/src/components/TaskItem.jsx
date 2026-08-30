import { useState } from 'react';

const today = () => new Date().toISOString().slice(0, 10);

function dueLabel(dueDate) {
  if (!dueDate) return null;
  const diff = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);
  if (diff === 0) return { text: 'Due today', tone: 'warn' };
  if (diff < 0) return { text: `Overdue ${Math.abs(diff)}d`, tone: 'danger' };
  if (diff === 1) return { text: 'Due tomorrow', tone: 'warn' };
  return { text: `Due ${dueDate}`, tone: 'muted' };
}

export default function TaskItem({ task, onToggle, onDelete, onEdit }) {
  const [editing, setEditing] = useState(false);
  const done = task.status === 'done';
  const due = dueLabel(task.due_date);

  return (
    <li className={`task ${done ? 'done' : ''} p-${task.priority}`}>
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(task)}
        aria-label={done ? 'Mark as open' : 'Mark as done'}
      />

      <div className="task-body">
        <div className="task-title">{task.title}</div>
        {task.description && <div className="task-desc">{task.description}</div>}

        <div className="task-meta">
          <span className={`tag p-${task.priority}`}>{task.priority}</span>
          {due && <span className={`tag ${due.tone}`}>{due.text}</span>}
          {task.contact && <span className="tag muted">{task.contact}</span>}
          {task.chat_name && task.chat_name !== task.contact && (
            <span className="tag muted">{task.chat_name}</span>
          )}
          {task.source === 'whatsapp' && <span className="tag muted">from WhatsApp</span>}
        </div>

        {editing && (
          <div className="task-edit">
            <input
              type="date"
              defaultValue={task.due_date || ''}
              onChange={(event) => onEdit(task, { due_date: event.target.value })}
            />
            <select
              defaultValue={task.priority}
              onChange={(event) => onEdit(task, { priority: event.target.value })}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        )}
      </div>

      <div className="task-actions">
        <button className="link" onClick={() => setEditing((v) => !v)}>
          {editing ? 'close' : 'edit'}
        </button>
        <button className="link danger" onClick={() => onDelete(task)}>
          delete
        </button>
      </div>
    </li>
  );
}
