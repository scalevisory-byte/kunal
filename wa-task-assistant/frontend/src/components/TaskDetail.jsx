import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { REMINDER_OFFSETS } from '../lib/followup.js';
import {
  PRIORITIES, STATUSES, dateTimeLabel, isoDay, taskChat, todayIso,
} from '../lib/task.js';

/** Local "YYYY-MM-DDTHH:MM" for a date and time the user picked. */
const localIso = (day, time) => new Date(`${day}T${time || '09:00'}`).toISOString();

const clock = (iso) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const REMINDER_STATE = {
  scheduled: '', snoozed: 'snoozed', triggered: 'sent',
  acknowledged: 'done', cancelled: 'cancelled', missed: 'missed',
};

/**
 * A task can carry several reminders. They are listed with their state so a
 * fired one is visibly different from one still waiting, and adding the same
 * moment twice is refused by the server rather than producing two alarms.
 */
function Reminders({ task, onError, onChanged }) {
  const [rows, setRows] = useState(task.reminders || []);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ date: task.due_date || todayIso(), time: '09:00' });

  const reload = async () => {
    try {
      const data = await api.taskReminders(task.id);
      setRows(data.reminders);
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  const add = async (fireAt, offset) => {
    try {
      await api.addTaskReminder(task.id, { fire_at: fireAt, offset_minutes: offset ?? null });
      setAdding(false);
      await reload();
    } catch (err) {
      onError(err);
    }
  };

  const remove = async (id) => {
    try {
      await api.removeTaskReminder(task.id, id);
      await reload();
    } catch (err) {
      onError(err);
    }
  };

  const base = task.due_date ? new Date(`${task.due_date}T${(task.remind_at || '').slice(11, 16) || '17:00'}`) : null;
  const active = rows.filter((r) => !['cancelled'].includes(r.status));

  return (
    <div className="field">
      <label>Reminders</label>

      {active.length === 0 ? (
        <p className="field-note">None set. The twice-daily WhatsApp digest still covers this task until it is done.</p>
      ) : (
        <ul className="rem-list">
          {active.map((r) => (
            <li key={r.id} className={`s-${r.status}`}>
              <Icon name="clock" size={14} />
              <span className="rem-when">{clock(r.fire_at)}</span>
              {REMINDER_STATE[r.status] && <span className="rem-state">{REMINDER_STATE[r.status]}</span>}
              <button className="link danger" onClick={() => remove(r.id)} aria-label="Remove reminder">
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rem-add">
          <div className="field-row">
            <div className="field">
              <label htmlFor="rem-date">Date</label>
              <input id="rem-date" type="date" value={draft.date}
                onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="rem-time">Time</label>
              <input id="rem-time" type="time" value={draft.time}
                onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))} />
            </div>
          </div>
          <div className="quick-dates">
            <button className="btn small" onClick={() => add(localIso(draft.date, draft.time))}>Add</button>
            <button className="link" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="rem-presets">
          <button className="link" onClick={() => setAdding(true)}>+ Add reminder</button>
          {base && REMINDER_OFFSETS.map((o) => (
            <button
              key={o.key}
              className="tool"
              onClick={() => add(new Date(base.getTime() - o.key * 60000).toISOString(), o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Turning a task into something to chase, without leaving the drawer. */
function FollowUpBlock({ task, onError }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: isoDay(3), time: '09:00', reason: '' });
  const [created, setCreated] = useState(null);

  const create = async () => {
    try {
      const followUp = await api.createFollowUp({
        title: `Follow up: ${task.title}`,
        reason: form.reason.trim() || null,
        task_id: task.id,
        chat_id: task.chat_id,
        chat_name: task.chat_name,
        contact: task.contact,
        due_at: localIso(form.date, form.time),
        remind_at: localIso(form.date, form.time),
      });
      setCreated(followUp);
      setOpen(false);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="field">
      <label>Follow-up</label>
      {created ? (
        <p className="field-note ok-text">
          Follow-up created for {new Date(created.due_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}.
        </p>
      ) : open ? (
        <div className="rem-add">
          <div className="field-row">
            <div className="field">
              <label htmlFor="fub-date">Date</label>
              <input id="fub-date" type="date" value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="fub-time">Time</label>
              <input id="fub-time" type="time" value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="fub-reason">Reason</label>
            <input id="fub-reason" value={form.reason} placeholder="Waiting for response"
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          <div className="quick-dates">
            <button className="btn small" onClick={create}>Create follow-up</button>
            <button className="link" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="field-note">
            A follow-up is for chasing somebody else — it reminds you to check, it never messages them.
          </p>
          <button className="link" onClick={() => setOpen(true)}>+ Add follow-up</button>
        </>
      )}
    </div>
  );
}

export default function TaskDetail({ task, onClose, onEdit, onDelete, onError, onChanged }) {
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
              <div className="quick-dates">
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

          <Reminders task={task} onError={onError} onChanged={onChanged} />

          <FollowUpBlock task={task} onError={onError} />

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
            <button className="btn primary" onClick={() => onEdit(task, { status: 'done' })}>
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
