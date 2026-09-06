import { dateTimeLabel, dueLabel, isDone, isOverdue, taskChat, timeLabel } from '../lib/task.js';

const PRIORITY_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

/**
 * Title first, then only what is needed to trust it: where it came from, when
 * it is due, how urgent. The controls stay hidden until the row is hovered or
 * focused, so a list of twenty reads as twenty titles.
 */
export default function TaskItem({ task, onToggle, onOpen, onStatus, onQuickDate }) {
  const done = isDone(task);
  const due = dueLabel(task.due_date);
  const chat = taskChat(task);

  return (
    <li className={`task ${done ? 'done' : ''} s-${task.status} ${isOverdue(task) ? 'late' : ''}`}>
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(task)}
        aria-label={done ? `Reopen ${task.title}` : `Mark done: ${task.title}`}
      />

      <div className="t-main">
        <div className="t-line">
          <button type="button" className="t-title" onClick={() => onOpen(task)}>
            {task.title}
          </button>
          {due && !done && <span className={`due ${due.tone}`}>{due.text}</span>}
        </div>

        <div className="t-meta">
          <span className={`pri p-${task.priority}`} title={PRIORITY_LABEL[task.priority]}>
            <span className="pri-dot" />
            {task.priority === 'high' ? 'High' : task.priority === 'medium' ? 'Medium' : 'Low'}
          </span>
          {task.status === 'in_progress' && <span className="state-chip">In progress</span>}
          {chat && <span className="m-item" title={chat}>{chat}</span>}
          <span className="m-item">{task.origin === 'ai' ? 'AI-created' : 'Manual'}</span>
          {task.remind_at && !done && <span className="m-item">{timeLabel(task.remind_at)}</span>}
          {done && task.completed_at && (
            <span className="m-item">Completed {dateTimeLabel(task.completed_at)}</span>
          )}
        </div>
      </div>

      {!done && (
        <div className="t-tools">
          {task.status !== 'in_progress' && (
            <button className="tool" title="Start" onClick={() => onStatus(task, 'in_progress')}>
              Start
            </button>
          )}
          {!task.due_date && (
            <>
              <button className="tool" title="Due today" onClick={() => onQuickDate(task, 0)}>Today</button>
              <button className="tool" title="Due tomorrow" onClick={() => onQuickDate(task, 1)}>Tomorrow</button>
            </>
          )}
          <button className="tool" title="Open details" onClick={() => onOpen(task)}>Details</button>
        </div>
      )}
    </li>
  );
}
