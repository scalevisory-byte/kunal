import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const blank = { title: '', day_of_month: '7', due_time: '18:00', priority: 'high', lead_days: '1', group_id: '' };

/**
 * Deadlines that come round on the same date every month.
 *
 * TDS on the 7th, GST on the 11th, GSTR-3B on the 20th. Each month the rule
 * becomes a real task a few days ahead of its date, so the reminder ladder, the
 * briefing and the history treat it exactly like anything else - there is no
 * second kind of deadline in the system.
 */
export default function Recurring({ groups = [], onChanged, onError }) {
  const [rules, setRules] = useState([]);
  const [soon, setSoon] = useState([]);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.recurring();
      setRules(data.rules);
      setSoon(data.upcoming);
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        title: form.title,
        day_of_month: Number(form.day_of_month),
        due_time: form.due_time,
        priority: form.priority,
        lead_days: Number(form.lead_days),
        group_id: form.group_id ? Number(form.group_id) : null,
      };
      if (editing) await api.updateRule(editing, body);
      else await api.createRule(body);
      setForm(null);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Every month</h3>
        <span>{rules.length ? `${rules.length} deadline${rules.length === 1 ? '' : 's'}` : 'None yet'}</span>
      </header>

      {rules.length === 0 && !form && (
        <p className="field-note">
          For the dates that never move — TDS on the 7th, GST on the 11th, GSTR-3B on the
          20th. Each becomes a real task a day or two before its date, with the usual
          reminder and follow-up, so nothing is different about it except that it comes
          back every month.
        </p>
      )}

      {soon.length > 0 && (
        <ul className="recur-soon">
          {soon.slice(0, 4).map((u) => (
            <li key={`${u.rule.id}-${u.month}`}>
              <span className={`recur-when ${u.days_away <= 1 ? 'near' : ''}`}>
                {u.days_away === 0 ? 'Today' : u.days_away === 1 ? 'Tomorrow' : `in ${u.days_away} days`}
              </span>
              <span className="recur-name">{u.rule.title}</span>
              <span className="recur-date">{u.due_date}</span>
              {u.task && <span className="recur-made">task created</span>}
            </li>
          ))}
        </ul>
      )}

      {rules.length > 0 && (
        <ul className="group-list">
          {rules.map((r) => (
            <li key={r.id} className={r.active ? '' : 'off'}>
              <span className="recur-day">{ordinal(r.day_of_month)}</span>
              <div className="group-what">
                <strong>{r.title}</strong>
                <span className="group-meta">
                  {r.due_time} · {r.priority} priority · warns{' '}
                  {r.lead_days === 0 ? 'on the day' : `${r.lead_days} day${r.lead_days === 1 ? '' : 's'} before`}
                  {r.group_name && ` · ${r.group_name}`}
                  {!r.active && ' · paused'}
                </span>
              </div>
              <div className="group-actions">
                <button type="button" className="btn small ghost" disabled={busy}
                  onClick={async () => {
                    try { await api.updateRule(r.id, { active: r.active ? 0 : 1 }); await load(); }
                    catch (err) { onError(err); }
                  }}>
                  {r.active ? 'Pause' : 'Resume'}
                </button>
                <button type="button" className="btn small ghost" disabled={busy}
                  onClick={() => {
                    setEditing(r.id);
                    setForm({
                      title: r.title, day_of_month: String(r.day_of_month), due_time: r.due_time,
                      priority: r.priority, lead_days: String(r.lead_days),
                      group_id: r.group_id ? String(r.group_id) : '',
                    });
                  }}>
                  Edit
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete ${r.title}`} disabled={busy}
                  onClick={async () => {
                    try { await api.deleteRule(r.id); await load(); onChanged?.(); }
                    catch (err) { onError(err); }
                  }}>
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
            <label htmlFor="r-title">What has to be done</label>
            <input id="r-title" value={form.title} onChange={set('title')}
              placeholder="Pay TDS" required autoFocus />
          </div>
          <div className="template-row">
            <div className="field">
              <label htmlFor="r-day">Day of the month</label>
              <select id="r-day" value={form.day_of_month} onChange={set('day_of_month')}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{ordinal(d)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="r-time">By</label>
              <input id="r-time" type="time" value={form.due_time} onChange={set('due_time')} />
            </div>
            <div className="field">
              <label htmlFor="r-lead">Warn me</label>
              <select id="r-lead" value={form.lead_days} onChange={set('lead_days')}>
                <option value="0">on the day</option>
                <option value="1">1 day before</option>
                <option value="2">2 days before</option>
                <option value="3">3 days before</option>
                <option value="7">a week before</option>
              </select>
            </div>
          </div>
          <div className="template-row">
            <div className="field">
              <label htmlFor="r-pri">Priority</label>
              <select id="r-pri" value={form.priority} onChange={set('priority')}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            {groups.length > 0 && (
              <div className="field">
                <label htmlFor="r-group">Business</label>
                <select id="r-group" value={form.group_id} onChange={set('group_id')}>
                  <option value="">No group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <p className="field-note">
            Only the 1st to the 28th, because those are the days every month actually has —
            a rule on the 30th would skip February.
          </p>
          <div className="template-form-foot">
            <button type="submit" className="btn primary" disabled={busy || !form.title.trim()}>
              {editing ? 'Save' : 'Add deadline'}
            </button>
            <button type="button" className="btn ghost" onClick={() => { setForm(null); setEditing(null); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn small ghost" onClick={() => { setForm(blank); setEditing(null); }}>
          New monthly deadline
        </button>
      )}
    </section>
  );
}
