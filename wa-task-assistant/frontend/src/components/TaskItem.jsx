import { useState } from 'react';

const today = () => new Date().toISOString().slice(0, 10);
const dayMs = 86400000;

/** Short, human date. Long ISO strings read as noise on a phone. */
function dueLabel(dueDate) {
  if (!dueDate) return null;
  const diff = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / dayMs
  );
  if (diff < 0) return { text: `Overdue ${Math.abs(diff)}d`, tone: 'danger' };
  if (diff === 0) return { text: 'Today', tone: 'warn' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'warn' };
  if (diff <= 6) return { text: `in ${diff}d`, tone: '' };
  return {
    text: new Date(`${dueDate}T00:00:00Z`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
    tone: '',
  };
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
        aria-label={done ? `Reopen ${task.title}` : `Mark done: ${task.title}`}
      />

      <div className="t-body">
        <div className="t-title">{task.title}</div>
        {task.description && <div className="t-desc">{task.description}</div>}

        <div className="t-foot">
          <div className="t-tags">
            {due && <span className={`tag ${due.tone}`}>{due.text}</span>}
            {task.remind_at && (
              <span className="tag warm">
                ⏰{' '}
                {new Date(task.remind_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
            {task.contact && <span className="tag">{task.contact}</span>}
            {task.chat_name && task.chat_name !== task.contact && (
              <span className="tag">{task.chat_name}</span>
            )}
            {task.reminder_count > 0 && (
              <span className="tag nag" title={`Last reminded ${task.last_reminded_at} UTC`}>
                asked {task.reminder_count + 1}×
              </span>
            )}
          </div>

          <div className="t-actions">
            <button className="link" onClick={() => setEditing((v) => !v)}>
              {editing ? 'close' : 'edit'}
            </button>
            <button className="link danger" onClick={() => onDelete(task)}>
              delete
            </button>
          </div>
        </div>

        {editing && (
          <div className="task-edit">
            <input
              type="date"
              aria-label="Due date"
              defaultValue={task.due_date || ''}
              onChange={(event) => onEdit(task, { due_date: event.target.value })}
            />
            <select
              aria-label="Priority"
              defaultValue={task.priority}
              onChange={(event) => onEdit(task, { priority: event.target.value })}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <input
              type="time"
              aria-label="Remind at a specific time"
              defaultValue={task.remind_at ? new Date(task.remind_at).toTimeString().slice(0, 5) : ''}
              onChange={(event) => {
                const time = event.target.value;
                if (!time) return onEdit(task, { remind_at: '' });
                // A time needs a day; fall back to today when the task has no due date.
                const day = task.due_date || today();
                onEdit(task, { remind_at: new Date(`${day}T${time}`).toISOString() });
              }}
            />
          </div>
        )}
      </div>
    </li>
  );
}
