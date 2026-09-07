import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

const OFFSETS = [
  { value: '', label: 'Use the default' },
  { value: 0, label: 'At the deadline' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

const blank = {
  name: '', title: '', description: '', priority: 'medium',
  due_in_days: '', due_time: '18:00', reminder_offset: '', subtasks: '',
};

/**
 * Work that recurs, kept as a shape: the title, the usual priority, when it is
 * normally due, and the checklist that goes with it. Using one builds an
 * ordinary task, so the reminder ladder and the history treat it as one - there
 * is no second kind of task in the system.
 */
export default function Templates({ onUsed, onError }) {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { templates: rows } = await api.templates();
      setTemplates(rows);
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createTemplate({
        ...form,
        due_in_days: form.due_in_days === '' ? null : Number(form.due_in_days),
        reminder_offset: form.reminder_offset === '' ? null : Number(form.reminder_offset),
        subtasks: form.subtasks.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      setForm(null);
      load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const use = async (template) => {
    setBusy(true);
    try {
      const task = await api.useTemplate(template.id);
      onUsed?.(task);
      load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Templates</h3>
        <span>Work you do again and again</span>
      </header>

      {templates.length === 0 && !form && (
        <p className="field-note">
          No templates yet. One is worth making for anything you set up the same way each
          month — a GST filing, an onboarding, a recurring audit.
        </p>
      )}

      {templates.length > 0 && (
        <ul className="template-list">
          {templates.map((t) => (
            <li key={t.id}>
              <div className="template-what">
                <strong>{t.name}</strong>
                <span className="template-title">{t.title}</span>
                <span className="template-meta">
                  {t.priority} priority
                  {Number.isFinite(t.due_in_days) && t.due_in_days !== null
                    && ` · due in ${t.due_in_days} day${t.due_in_days === 1 ? '' : 's'}`}
                  {t.subtasks.length > 0 && ` · ${t.subtasks.length} step${t.subtasks.length === 1 ? '' : 's'}`}
                  {t.used_count > 0 && ` · used ${t.used_count}×`}
                </span>
              </div>
              <div className="template-actions">
                <button type="button" className="btn small" disabled={busy} onClick={() => use(t)}>
                  Create task
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Delete template ${t.name}`}
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const { templates: rows } = await api.deleteTemplate(t.id);
                      setTemplates(rows);
                    } catch (err) { onError(err); }
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form ? (
        <form className="template-form" onSubmit={save}>
          <div className="field">
            <label htmlFor="tpl-name">Template name</label>
            <input id="tpl-name" value={form.name} onChange={set('name')}
              placeholder="Monthly GST filing" required />
          </div>
          <div className="field">
            <label htmlFor="tpl-title">Task title</label>
            <input id="tpl-title" value={form.title} onChange={set('title')}
              placeholder="File GST return" required />
          </div>
          <div className="field">
            <label htmlFor="tpl-steps">Checklist, one step per line</label>
            <textarea id="tpl-steps" rows={3} value={form.subtasks} onChange={set('subtasks')}
              placeholder={'Collect invoices\nReconcile the ledger\nFile and save the receipt'} />
          </div>
          <div className="template-row">
            <div className="field">
              <label htmlFor="tpl-pri">Priority</label>
              <select id="tpl-pri" value={form.priority} onChange={set('priority')}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="tpl-days">Due in</label>
              <input id="tpl-days" type="number" min="0" max="365" value={form.due_in_days}
                onChange={set('due_in_days')} placeholder="days" />
            </div>
            <div className="field">
              <label htmlFor="tpl-time">At</label>
              <input id="tpl-time" type="time" value={form.due_time} onChange={set('due_time')} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="tpl-rem">Reminder</label>
            <select id="tpl-rem" value={form.reminder_offset} onChange={set('reminder_offset')}>
              {OFFSETS.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <p className="field-note">
            Leave “Due in” empty for a template with no deadline of its own — you set the date
            when you use it.
          </p>
          <div className="template-form-foot">
            <button type="submit" className="btn primary" disabled={busy}>Save template</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn small ghost" onClick={() => setForm(blank)}>
          New template
        </button>
      )}
    </section>
  );
}
