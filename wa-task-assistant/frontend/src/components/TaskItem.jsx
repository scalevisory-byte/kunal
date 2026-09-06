import { useState } from 'react';

const today = () => new Date().toISOString().slice(0, 10);
const dayMs = 86400000;

/** Short, human date. Long ISO strings read as noise on a phone. */
function dueLabel(dueDate) {
  if (!dueDate) return null;
  const diff = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / dayMs
  );
  if (diff < 0) return { text: `${Math.abs(diff)}d late`, tone: 'danger' };
  if (diff === 0) return { text: 'Today', tone: 'warn' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'warn' };
  if (diff <= 6) return { text: `${diff}d`, tone: '' };
  return {
    text: new Date(`${dueDate}T00:00:00Z`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
    tone: '',
  };
}

const FILLER = new Set([
  'a', 'an', 'and', 'be', 'by', 'do', 'done', 'for', 'has', 'have', 'is', 'it',
  'need', 'needs', 'of', 'on', 'the', 'to', 'today', 'tomorrow', 'up', 'with',
]);

const words = (text) =>
  new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !FILLER.has(w))
  );

/**
 * "Process BNF salary" / "BNF salary payment needs to be done today" says the
 * same thing twice. A description only earns its line when it carries something
 * the title does not.
 */
function addsNothing(title, description) {
  if (!description) return true;
  const inTitle = words(title);
  const inDesc = words(description);
  if (!inDesc.size) return true;
  let shared = 0;
  for (const w of inDesc) if (inTitle.has(w)) shared += 1;
  return shared / inDesc.size >= 0.6;
}

const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function TaskItem({ task, onToggle, onDelete, onEdit }) {
  const [open, setOpen] = useState(false);
  const done = task.status === 'done';
  const due = dueLabel(task.due_date);
  const description = addsNothing(task.title, task.description) ? null : task.description;
  const source = task.contact || task.chat_name;

  return (
    <li className={`task ${done ? 'done' : ''} p-${task.priority} ${open ? 'open' : ''}`}>
      <div className="t-row">
        <input
          type="checkbox"
          checked={done}
          onChange={() => onToggle(task)}
          aria-label={done ? `Reopen ${task.title}` : `Mark done: ${task.title}`}
        />

        <button
          type="button"
          className="t-title"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {task.title}
        </button>

        {task.remind_at && <span className="tag warm">{timeLabel(task.remind_at)}</span>}
        {due && <span className={`tag ${due.tone}`}>{due.text}</span>}
        {task.reminder_count > 0 && <span className="tag nag">{task.reminder_count + 1}×</span>}
      </div>

      {open && (
        <div className="t-detail">
          {description && <p className="t-desc">{description}</p>}
          {source && <p className="t-source">from {source}</p>}

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
            <button className="link danger" onClick={() => onDelete(task)}>
              delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
