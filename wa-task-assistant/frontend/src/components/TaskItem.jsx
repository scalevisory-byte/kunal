import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { dateTimeLabel, dueLabel, isDone, isOverdue, taskChat, timeLabel } from '../lib/task.js';

const PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' };

/** Everything you can do to a task without opening it, behind one control. */
function RowMenu({ task, onOpen, onStatus, onQuickDate, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="row-menu" ref={wrap}>
      <button
        className="row-menu-btn"
        aria-label={`Actions for ${task.title}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={17} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {task.status !== 'in_progress' && !isDone(task) && (
            <button role="menuitem" onClick={run(() => onStatus(task, 'in_progress'))}>
              <Icon name="play" size={15} /> Start
            </button>
          )}
          {task.status === 'in_progress' && (
            <button role="menuitem" onClick={run(() => onStatus(task, 'open'))}>
              <Icon name="circle" size={15} /> Back to open
            </button>
          )}
          <button role="menuitem" onClick={run(() => onQuickDate(task, 0))}>
            <Icon name="sun" size={15} /> Due today
          </button>
          <button role="menuitem" onClick={run(() => onQuickDate(task, 1))}>
            <Icon name="calendar" size={15} /> Due tomorrow
          </button>
          <button role="menuitem" onClick={run(() => onOpen(task))}>
            <Icon name="clipboard" size={15} /> Details
          </button>
          <button className="danger" role="menuitem" onClick={run(() => onDelete(task))}>
            <Icon name="trash" size={15} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function TaskItem({ task, onToggle, onOpen, onStatus, onQuickDate, onDelete }) {
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
        <button type="button" className="t-title" onClick={() => onOpen(task)}>
          {task.title}
        </button>

        <div className="t-meta">
          {chat && (
            <span className="m-item" title={chat}>
              <Icon name="chat" size={13} /> {chat}
            </span>
          )}
          <span className="m-item">
            <Icon name={task.origin === 'ai' ? 'robot' : 'clipboard'} size={13} />
            {task.origin === 'ai' ? 'AI-created' : 'Manual'}
          </span>
          <span className={`pri p-${task.priority}`}>
            <span className="pri-dot" />
            {PRIORITY[task.priority]}
          </span>
          {task.status === 'in_progress' && <span className="state-chip">In progress</span>}
          {task.remind_at && !done && (
            <span className="m-item"><Icon name="clock" size={13} /> {timeLabel(task.remind_at)}</span>
          )}
          {done && task.completed_at && (
            <span className="m-item">Completed {dateTimeLabel(task.completed_at)}</span>
          )}
        </div>
      </div>

      <span className={`due ${due?.tone || 'none'}`}>{due ? due.text : 'No date'}</span>

      <RowMenu
        task={task}
        onOpen={onOpen}
        onStatus={onStatus}
        onQuickDate={onQuickDate}
        onDelete={onDelete}
      />
    </li>
  );
}
