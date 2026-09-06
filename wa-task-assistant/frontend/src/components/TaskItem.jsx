import { dueLabel, isDone, isOverdue, taskChat, timeLabel, dateTimeLabel } from '../lib/task.js';

/**
 * One task, one card. The top line is the decision - is it done, what is it.
 * The second line is the context you need to trust that decision: where it came
 * from, when it is due, how urgent. Everything else lives in the detail panel.
 */
export default function TaskItem({ task, onToggle, onOpen, onQuickDate }) {
  const done = isDone(task);
  const due = dueLabel(task.due_date);
  const chat = taskChat(task);
  const overdue = isOverdue(task);

  return (
    <li
      className={`task ${done ? 'done' : ''} p-${task.priority} s-${task.status} ${overdue ? 'late' : ''}`}
    >
      <div className="t-row">
        <input
          type="checkbox"
          checked={done}
          onChange={() => onToggle(task)}
          aria-label={done ? `Reopen ${task.title}` : `Mark done: ${task.title}`}
        />

        <button type="button" className="t-title" onClick={() => onOpen(task)}>
          {task.title}
        </button>

        {/* One chip only on the title line - more than that squeezes the title. */}
        {due && !done && <span className={`tag ${due.tone}`}>{due.text}</span>}
      </div>

      <div className="t-meta">
        <span className={`dot-p p-${task.priority}`} title={`${task.priority} priority`} />
        {task.status === 'in_progress' && <span className="tag doing">In progress</span>}
        {chat && <span className="m-item">💬 {chat}</span>}
        <span className="m-item">{task.origin === 'ai' ? '🤖 AI-created' : '✋ Added by hand'}</span>
        {task.remind_at && !done && <span className="m-item">⏰ {timeLabel(task.remind_at)}</span>}
        {task.reminder_count > 0 && !done && (
          <span className="m-item" title="Times you have been reminded">
            reminded {task.reminder_count}×
          </span>
        )}
        {done && task.completed_at && (
          <span className="m-item">Completed {dateTimeLabel(task.completed_at)}</span>
        )}
        {!task.due_date && !done && (
          <span className="m-actions">
            <button className="link" onClick={() => onQuickDate(task, 0)}>today</button>
            <button className="link" onClick={() => onQuickDate(task, 1)}>tomorrow</button>
            <button className="link" onClick={() => onOpen(task)}>pick date</button>
          </span>
        )}
      </div>
    </li>
  );
}
