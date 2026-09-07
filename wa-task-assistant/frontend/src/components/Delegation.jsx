import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import TaskItem from './TaskItem.jsx';
import { api } from '../api.js';

/**
 * Work between the user and other people, read from whichever end you are on.
 *
 * **Task received** is what somebody has asked him for. It is his to do, so it
 * behaves like any other task; the only thing this view adds is who asked, so
 * he can see at a glance that four of today's six came from one person.
 *
 * **Task allotted** is what he has handed out. It is still his to chase - the
 * app reminds *him*, never the assignee - so each row carries a Nudge button
 * that composes a message and sends it only when pressed. Nothing on this page
 * messages anybody on its own.
 */

const ago = (iso) => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return '';
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

/**
 * One person, and everything on their side of the ledger.
 *
 * The rows are the app's own task rows, not a second design: the same one-line
 * shape, the same checkbox, the same ⋮ menu. Grouping by person is the only
 * thing this page changes about how a task is read.
 */
function Person({ person, tasks, side, actions, onNudge }) {
  const [shut, setShut] = useState(false);
  const key = side === 'allotted' ? 'assigned_to' : 'requested_by';
  const mine = tasks.filter((t) => t[key] === person.name);
  if (!mine.length) return null;

  return (
    <section className="section tone-plain">
      <button className="section-head" aria-expanded={!shut} onClick={() => setShut((v) => !v)}>
        <Icon name="person" size={17} className="section-icon" />
        <h3>{person.name}</h3>
        <span className="section-count">{mine.length}</span>
        {side === 'allotted' && person.last_at && (
          <span className="section-note">given {ago(person.last_at)}</span>
        )}
        <Icon name="chevronDown" size={17} className={`section-chevron ${shut ? '' : 'up'}`} />
      </button>

      {!shut && (
        <ul className="task-list">
          {mine.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              {...actions}
              extra={side === 'allotted' && task.status !== 'done' ? (
                <button
                  className="btn ghost small nudge"
                  onClick={() => onNudge(task)}
                  title={`Write a WhatsApp message to ${task.assigned_to}`}
                >
                  <Icon name="whatsapp" size={14} /> Nudge
                </button>
              ) : null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The nudge, shown in full before it goes anywhere.
 *
 * The text is editable and is exactly what gets sent - a preview that differed
 * from the message would be worse than no preview. Sending happens on this
 * button and nowhere else in the app.
 */
function NudgeSheet({ task, onClose, onSent, onError }) {
  const [preview, setPreview] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.nudgePreview(task.id)
      .then((p) => { if (live) { setPreview(p); setText(p.text); } })
      .catch(onError);
    return () => { live = false; };
  }, [task.id, onError]);

  const send = async () => {
    setBusy(true);
    try {
      await api.sendNudge(task.id, text);
      onSent();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  /*
   * Rendered onto the body rather than in place. `.page > *` is a stacking
   * context, so a sheet mounted inside it sits under the sticky top bar however
   * high its z-index goes - which cut the heading off. Every other sheet in the
   * app is mounted at the root; this is the same thing said with a portal.
   */
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-label={`Follow up with ${task.assigned_to}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>Follow up with {task.assigned_to}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="sheet-body">
          <p className="muted">
            This sends one WhatsApp message, now, to {task.assigned_to}. It is the only thing
            in the app that messages anybody but you — reminders and follow-ups always come
            to you, never to them.
          </p>

          <label className="field">
            <span>Message</span>
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </label>

          {preview && !preview.can_send && (
            <p className="banner error">
              {preview.wid
                ? 'WhatsApp is not connected right now.'
                : `No WhatsApp chat is known for ${task.assigned_to}. A task captured from a chat carries one; this one was typed by hand.`}
            </p>
          )}
        </div>

        <footer className="sheet-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={busy || !text.trim() || !preview?.can_send}
            onClick={send}
          >
            {busy ? 'Sending…' : 'Send on WhatsApp'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export default function Delegation({ side, onOpenTask, onError, onChanged }) {
  const [data, setData] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [nudging, setNudging] = useState(null);
  const [sent, setSent] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.delegation(showDone ? 'all' : 'open'));
    } catch (err) {
      onError(err);
    }
  }, [showDone, onError]);

  useEffect(() => { load(); }, [load]);

  /*
   * Every change goes through PATCH /api/tasks/:id, the same call the main
   * board makes - so finishing something here cancels its reminders exactly as
   * it would anywhere else. Grouping by person changes what is shown, never
   * what a change to a task means.
   */
  const patch = async (id, body) => {
    try {
      await api.updateTask(id, body);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    }
  };

  const isoDay = (offset) => {
    const at = new Date();
    at.setDate(at.getDate() + offset);
    return at.toISOString().slice(0, 10);
  };

  const actions = {
    onToggle: (task) => patch(task.id, { status: task.status === 'done' ? 'open' : 'done' }),
    onOpen: (task) => onOpenTask(task.id),
    onStatus: (task, status) => patch(task.id, { status }),
    onQuickDate: (task, offset) => patch(task.id, { due_date: isoDay(offset) }),
    onDelete: async (task) => {
      if (!window.confirm(`Delete "${task.title}"?`)) return;
      try {
        await api.deleteTask(task.id);
        await load();
        onChanged?.();
      } catch (err) {
        onError(err);
      }
    },
  };

  if (!data) return <p className="muted">Loading…</p>;

  const tasks = side === 'allotted' ? data.allotted : data.received;
  const people = side === 'allotted' ? data.people.allotted : data.people.received;
  const listed = new Set(tasks.map((t) => (side === 'allotted' ? t.assigned_to : t.requested_by)));
  const shown = people.filter((p) => listed.has(p.name));

  return (
    <div className="deleg">
      <div className="toolbar">
        <label className="check-inline">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          <span>Include finished</span>
        </label>
        <span className="muted">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} across {shown.length}{' '}
          {shown.length === 1 ? 'person' : 'people'}
        </span>
      </div>

      {sent && (
        <p className="banner ok" role="status">
          Sent to {sent}. <button className="link" onClick={() => setSent(null)}>Dismiss</button>
        </p>
      )}

      {!tasks.length ? (
        <p className="empty">
          {side === 'allotted'
            ? 'Nothing is with anybody else. When you write "Rahul, GST documents kal bhej dena" in a chat, the task lands here with his name on it.'
            : 'Nobody has asked you for anything. Requests that arrive in your chats show up here, alongside who sent them.'}
        </p>
      ) : (
        shown.map((person) => (
          <Person
            key={person.name}
            person={person}
            tasks={tasks}
            side={side}
            actions={actions}
            onNudge={setNudging}
          />
        ))
      )}

      {nudging && (
        <NudgeSheet
          task={nudging}
          onClose={() => setNudging(null)}
          onSent={() => { setSent(nudging.assigned_to); setNudging(null); load(); }}
          onError={onError}
        />
      )}
    </div>
  );
}
