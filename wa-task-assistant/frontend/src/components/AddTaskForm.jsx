import { useState } from 'react';
import Icon from './Icon.jsx';
import { PRIORITIES, isoDay } from '../lib/task.js';
import { REMINDER_OFFSETS } from '../lib/schedule.js';

const FOLLOW_UPS = [
  { key: '', label: 'Use the default' },
  { key: 30, label: '30 minutes after' },
  { key: 60, label: '1 hour after' },
  { key: 120, label: '2 hours after' },
  { key: 960, label: 'Next morning' },
];

const localIso = (date, time) => (date ? new Date(`${date}T${time || '18:00'}`).toISOString() : null);

/**
 * One line is enough for most tasks, so that is what the form opens as. The
 * deadline, reminder and follow-up are one click away rather than six fields
 * in the way of writing a title.
 */
export default function AddTaskForm({ onAdd, onClose }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState(false);
  const [form, setForm] = useState({
    notes: '', date: '', time: '18:00', reminder: '', followUp: '', priority: 'medium',
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (event) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;

    onAdd({
      title: clean,
      notes: form.notes.trim() || null,
      due_date: form.date || null,
      due_at: localIso(form.date, form.time),
      priority: form.priority,
      reminder_offset: form.reminder === '' ? undefined : Number(form.reminder),
      follow_up_offset: form.followUp === '' ? undefined : Number(form.followUp),
    });
    setTitle('');
    setForm({ notes: '', date: '', time: '18:00', reminder: '', followUp: '', priority: 'medium' });
    setDetail(false);
  };

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="add-row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="Task"
          autoFocus
        />
        <button className="btn primary" type="submit" disabled={!title.trim()}>Add</button>
      </div>

      <div className="add-toggle">
        <button type="button" className="link" onClick={() => setDetail((v) => !v)}>
          {detail ? 'Hide details' : 'Deadline, reminder and follow-up'}
        </button>
        {form.date && !detail && (
          <span className="add-summary">
            <Icon name="clock" size={13} /> {form.date} · {form.time}
          </span>
        )}
        {onClose && <button type="button" className="link" onClick={onClose}>Close</button>}
      </div>

      {detail && (
        <div className="add-detail">
          <div className="field">
            <label htmlFor="a-notes">Notes</label>
            <textarea id="a-notes" rows={2} value={form.notes} onChange={set('notes')}
              placeholder="Anything worth remembering about this one" />
          </div>

          <fieldset className="field-group">
            <legend>Deadline</legend>
            <p className="field-note">When does this need to be finished?</p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="a-date">Date</label>
                <input id="a-date" type="date" value={form.date} onChange={set('date')} />
                <div className="quick-dates">
                  <button type="button" className="link" onClick={() => setForm((f) => ({ ...f, date: isoDay(0) }))}>today</button>
                  <button type="button" className="link" onClick={() => setForm((f) => ({ ...f, date: isoDay(1) }))}>tomorrow</button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="a-time">Time</label>
                <input id="a-time" type="time" value={form.time} onChange={set('time')} />
              </div>
            </div>
          </fieldset>

          <div className="field-row">
            <div className="field">
              <label htmlFor="a-reminder">Reminder</label>
              <select id="a-reminder" value={form.reminder} onChange={set('reminder')} disabled={!form.date}>
                <option value="">Use the default</option>
                {REMINDER_OFFSETS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-follow">Follow-up</label>
              <select id="a-follow" value={form.followUp} onChange={set('followUp')} disabled={!form.date}>
                {FOLLOW_UPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <p className="field-note">
            The reminder comes <b>before</b> the deadline; the follow-up chases you
            <b> after</b> it, if the task is still open.
          </p>

          <div className="field">
            <label>Priority</label>
            <div className="segment">
              {PRIORITIES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={form.priority === p.key ? 'active' : ''}
                  onClick={() => setForm((f) => ({ ...f, priority: p.key }))}
                >
                  {p.dot} {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
