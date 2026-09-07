import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import Checklist from './Checklist.jsx';
import TaskProgress from './TaskProgress.jsx';
import Dependencies from './Dependencies.jsx';
import Attachments from './Attachments.jsx';
import { api } from '../api.js';
import { REMINDER_OFFSETS, TASK_STATE, clock as fmtClock, dueLabel } from '../lib/schedule.js';
import {
  PRIORITIES, STATUSES, dateTimeLabel, isoDay, taskSource, todayIso,
} from '../lib/task.js';

/** Local "YYYY-MM-DDTHH:MM" for a date and time the user picked. */
const localIso = (day, time) => new Date(`${day}T${time || '09:00'}`).toISOString();

const clock = fmtClock;

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

/**
 * Where the task is in its chase: what has already gone out, what is next, and
 * how many rounds are left before the app stops asking.
 */
function FollowUpLadder({ task }) {
  if (!task.due_at) {
    return (
      <div className="field">
        <label>Follow-ups</label>
        <p className="field-note">
          Give this task a due date and the app will remind you before it, at it, and keep
          asking afterwards until it is done.
        </p>
      </div>
    );
  }

  const count = task.follow_up_count || 0;
  const max = task.follow_up_max || 0;

  return (
    <div className="field">
      <label>Follow-ups</label>
      <dl className="facts tight">
        <div>
          <dt>Next follow-up</dt>
          <dd>{task.next_follow_up_at ? clock(task.next_follow_up_at) : count >= max ? 'none left' : '—'}</dd>
        </div>
        <div>
          <dt>Sent so far</dt>
          <dd>{count} of {max}</dd>
        </div>
      </dl>
      {task.needs_attention && (
        <p className="field-note error-text">
          The app has stopped asking after {max} follow-ups. Change the due date to start again.
        </p>
      )}
    </div>
  );
}

export default function TaskDetail({
  task, tasks, groups = [], focusProgress = false,
  onClose, onEdit, onDelete, onNotATask, onError, onChanged,
}) {
  const [showMessage, setShowMessage] = useState(false);

  // Escape closes the panel, as it does in every other tool.
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  const source = taskSource(task);
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
            <label htmlFor="d-desc">Description</label>
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

          {task.status === 'waiting' && (
            <div className="field">
              <label htmlFor="d-waiting">Waiting for</label>
              <input
                id="d-waiting"
                defaultValue={task.waiting_for || ''}
                placeholder="Client, vendor, colleague…"
                onBlur={(e) => e.target.value !== (task.waiting_for || '')
                  && onEdit(task, { waiting_for: e.target.value })}
              />
              <p className="field-note">Waiting is not done — reminders and follow-ups keep running.</p>
            </div>
          )}

          {/* Above the checklist: a checklist is the plan, progress is what
              actually happened, and the second is what you open a task to
              find out. */}
          <TaskProgress
            task={task}
            initial={task.updates}
            stages={task.stages}
            autoFocus={focusProgress}
            onError={onError}
            onChanged={onChanged}
          />

          <Checklist
            task={task}
            initial={task.subtasks}
            onError={onError}
            onChanged={onChanged}
          />

          <Dependencies task={task} tasks={tasks} initial={task} onError={onError} />

          <Attachments task={task} initial={task.attachments} onError={onError} />

          {groups.length > 0 && (
            <div className="field">
              <label htmlFor="d-group">Business</label>
              <select
                id="d-group"
                value={task.group_id ?? ''}
                onChange={(e) => onEdit(task, { group_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">No group</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="d-notes">Notes</label>
            <textarea
              id="d-notes"
              rows={2}
              defaultValue={task.notes || ''}
              placeholder="Internal note — never sent to WhatsApp"
              onBlur={(e) => e.target.value !== (task.notes || '') && onEdit(task, { notes: e.target.value })}
            />
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

          {/*
            * Who is doing it.
            *
            * Editable because the extractor only fills this in when it is sure,
            * and because work changes hands. Clearing the box takes the task
            * back, which is the same thing as never having delegated it - one
            * control for both directions rather than an "unassign" button.
            */}
          <div className="field">
            <label htmlFor="d-assign">Given to</label>
            <input
              id="d-assign"
              type="text"
              placeholder="Nobody — this one is yours"
              defaultValue={task.assigned_to || ''}
              key={`assign-${task.id}-${task.assigned_to || ''}`}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name === (task.assigned_to || '')) return;
                api.assign(task.id, name, task.assigned_to_wid)
                  .then(() => onChanged())
                  .catch(onError);
              }}
            />
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

          <FollowUpLadder task={task} />

          <dl className="facts">
            {task.state && (
              <div>
                <dt>State</dt>
                <dd className={`s-${TASK_STATE[task.state]?.tone || 'plain'}`}>
                  {TASK_STATE[task.state]?.label || task.state}
                  {task.due_at && task.state !== 'done' && ` · ${dueLabel(task.due_at)}`}
                </dd>
              </div>
            )}
            <div>
              <dt>Source</dt>
              <dd>{task.origin === 'ai' ? '🤖 AI-created' : '✋ Added by hand'}</dd>
            </div>
            {task.requested_by && (
              <div>
                <dt>Asked by</dt>
                <dd>📥 {task.requested_by}</dd>
              </div>
            )}
            {task.assigned_to && (
              <div>
                <dt>Given to</dt>
                <dd>
                  📤 {task.assigned_to}
                  {task.assigned_at && ` · ${dateTimeLabel(task.assigned_at)}`}
                </dd>
              </div>
            )}
            {source && (
              <div>
                <dt>{source.group ? 'WhatsApp group' : 'WhatsApp chat'}</dt>
                <dd>💬 {source.chat}</dd>
              </div>
            )}
            {/* The drawer has room to say them separately rather than joined. */}
            {source?.sender && (
              <div>
                <dt>Written by</dt>
                <dd>{source.sender}</dd>
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
          {/* Different from Archive: this says the extractor was wrong, and
              that reason is what Work History keeps. */}
          {onNotATask && (
            <button className="link" onClick={() => onNotATask(task)}>
              Not a task
            </button>
          )}
          <button className="link danger" onClick={() => onDelete(task)}>
            Archive
          </button>
        </footer>
      </aside>
    </div>
  );
}
