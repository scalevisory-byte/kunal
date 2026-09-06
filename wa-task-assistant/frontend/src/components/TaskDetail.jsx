import { useEffect, useState } from 'react';
import {
  PRIORITIES, STATUSES, dateTimeLabel, isoDay, taskChat, todayIso,
} from '../lib/task.js';

/** Reminder offsets, all expressed against the task's own due date and time. */
const REMINDERS = [
  { key: 'none', label: 'No reminder', minutes: null },
  { key: 'at', label: 'At due time', minutes: 0 },
  { key: 'h1', label: '1 hour before', minutes: 60 },
  { key: 'h2', label: '2 hours before', minutes: 120 },
  { key: 'd1', label: '1 day before', minutes: 1440 },
];

/** Local "YYYY-MM-DDTHH:MM" for a date and time the user picked. */
const localIso = (day, time) => new Date(`${day}T${time || '09:00'}`).toISOString();

export default function TaskDetail({ task, onClose, onEdit, onDelete }) {
  const [showMessage, setShowMessage] = useState(false);

  // Escape closes the panel, as it does in every other tool.
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  const chat = taskChat(task);
  const dueTime = task.remind_at ? new Date(task.remind_at).toTimeString().slice(0, 5) : '';

  const setReminder = (minutes) => {
    if (minutes === null) return onEdit(task, { remind_at: '' });
    const day = task.due_date || todayIso();
    const base = new Date(`${day}T${dueTime || '09:00'}`);
    onEdit(task, { remind_at: new Date(base.getTime() - minutes * 60000).toISOString() });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <aside
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>{task.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="sheet-body">
          <div className="field">
            <label htmlFor="d-title">Title</label>
            <input
              id="d-title"
              defaultValue={task.title}
              onBlur={(e) => e.target.value.trim() && e.target.value !== task.title
                && onEdit(task, { title: e.target.value.trim() })}
            />
          </div>

          <div className="field">
            <label htmlFor="d-desc">Notes</label>
            <textarea
              id="d-desc"
              rows={3}
              defaultValue={task.description || ''}
              placeholder="Anything worth remembering about this one"
              onBlur={(e) => e.target.value !== (task.description || '')
                && onEdit(task, { description: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Status</label>
            <div className="segment">
              {STATUSES.map((s) => (
                <button
                  key={s.key}
                  className={task.status === s.key ? 'active' : ''}
                  onClick={() => onEdit(task, { status: s.key })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Priority</label>
            <div className="segment">
              {PRIORITIES.map((p) => (
                <button
                  key={p.key}
                  className={task.priority === p.key ? 'active' : ''}
                  onClick={() => onEdit(task, { priority: p.key })}
                >
                  {p.dot} {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="d-due">Due date</label>
              <input
                id="d-due"
                type="date"
                value={task.due_date || ''}
                onChange={(e) => onEdit(task, { due_date: e.target.value })}
              />
              <div className="quick">
                <button className="link" onClick={() => onEdit(task, { due_date: isoDay(0) })}>today</button>
                <button className="link" onClick={() => onEdit(task, { due_date: isoDay(1) })}>tomorrow</button>
                {task.due_date && (
                  <button className="link" onClick={() => onEdit(task, { due_date: '' })}>clear</button>
                )}
              </div>
            </div>

            <div className="field">
              <label htmlFor="d-time">Time</label>
              <input
                id="d-time"
                type="time"
                value={dueTime}
                onChange={(e) => {
                  if (!e.target.value) return onEdit(task, { remind_at: '' });
                  onEdit(task, { remind_at: localIso(task.due_date || todayIso(), e.target.value) });
                }}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="d-remind">Reminder</label>
            <select
              id="d-remind"
              value={task.remind_at ? 'at' : 'none'}
              onChange={(e) => setReminder(REMINDERS.find((r) => r.key === e.target.value)?.minutes ?? null)}
            >
              {REMINDERS.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <p className="field-note">
              {task.remind_at
                ? `Set for ${dateTimeLabel(task.remind_at)}. Reminders also repeat twice a day on WhatsApp until this is done.`
                : 'Twice-daily WhatsApp reminders still apply until this is done.'}
            </p>
          </div>

          <dl className="facts">
            <div>
              <dt>Source</dt>
              <dd>{task.origin === 'ai' ? '🤖 AI-created' : '✋ Added by hand'}</dd>
            </div>
            {chat && (
              <div>
                <dt>WhatsApp chat</dt>
                <dd>💬 {chat}</dd>
              </div>
            )}
            <div>
              <dt>Created</dt>
              <dd>{dateTimeLabel(task.created_at)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{dateTimeLabel(task.updated_at)}</dd>
            </div>
            {task.completed_at && (
              <div>
                <dt>Completed</dt>
                <dd>{dateTimeLabel(task.completed_at)}</dd>
              </div>
            )}
            {task.reminder_count > 0 && (
              <div>
                <dt>Reminded</dt>
                <dd>{task.reminder_count} time{task.reminder_count === 1 ? '' : 's'}</dd>
              </div>
            )}
          </dl>

          {task.source_message && (
            <div className="field">
              <button className="link" onClick={() => setShowMessage((v) => !v)}>
                {showMessage ? 'Hide original message' : 'Show original message'}
              </button>
              {showMessage && (
                <blockquote className="quote">
                  {task.source_message}
                  {task.source_message_at && (
                    <cite>{dateTimeLabel(task.source_message_at)}</cite>
                  )}
                </blockquote>
              )}
            </div>
          )}
        </div>

        <footer className="sheet-foot">
          {task.status !== 'done' ? (
            <button className="btn" onClick={() => onEdit(task, { status: 'done' })}>
              Mark done
            </button>
          ) : (
            <button className="btn ghost" onClick={() => onEdit(task, { status: 'open' })}>
              Reopen
            </button>
          )}
          <button className="link danger" onClick={() => onDelete(task)}>
            Delete
          </button>
        </footer>
      </aside>
    </div>
  );
}
