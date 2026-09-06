import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { FU_STATUS, SNOOZE_OPTIONS, whenLabel } from '../lib/followup.js';
import { dateTimeLabel } from '../lib/task.js';

const isoLocal = (date, time) => new Date(`${date}T${time || '09:00'}`).toISOString();

/** The create form, kept out of the way until it is wanted. */
function NewFollowUp({ chats, onCreate, onClose }) {
  const [form, setForm] = useState({
    title: '', contact: '', chat_id: '', date: '', time: '09:00',
    reason: '', interval_days: '', max_follow_ups: '',
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.date) return;
    const dueAt = isoLocal(form.date, form.time);
    onCreate({
      title: form.title.trim(),
      reason: form.reason.trim() || null,
      contact: form.contact.trim() || null,
      chat_name: form.chat_id || null,
      chat_id: form.chat_id || null,
      due_at: dueAt,
      remind_at: dueAt,
      interval_days: form.interval_days ? Number(form.interval_days) : null,
      max_follow_ups: form.max_follow_ups ? Number(form.max_follow_ups) : null,
    });
  };

  return (
    <form className="fu-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="fu-title">Follow up on</label>
        <input id="fu-title" value={form.title} onChange={set('title')} placeholder="Follow up with Ravi on the quotation" autoFocus />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="fu-contact">Contact</label>
          <input id="fu-contact" value={form.contact} onChange={set('contact')} placeholder="Ravi" />
        </div>
        <div className="field">
          <label htmlFor="fu-chat">WhatsApp chat</label>
          <select id="fu-chat" value={form.chat_id} onChange={set('chat_id')}>
            <option value="">Not linked</option>
            {chats.map(([name]) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="fu-date">Date</label>
          <input id="fu-date" type="date" value={form.date} onChange={set('date')} />
        </div>
        <div className="field">
          <label htmlFor="fu-time">Time</label>
          <input id="fu-time" type="time" value={form.time} onChange={set('time')} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="fu-reason">Reason</label>
        <input id="fu-reason" value={form.reason} onChange={set('reason')} placeholder="Waiting for response" />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="fu-repeat">Repeat</label>
          <select id="fu-repeat" value={form.interval_days} onChange={set('interval_days')}>
            <option value="">Never</option>
            <option value="1">Every day</option>
            <option value="2">Every 2 days</option>
            <option value="3">Every 3 days</option>
            <option value="7">Weekly</option>
            <option value="30">Monthly</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="fu-max">Maximum</label>
          <select id="fu-max" value={form.max_follow_ups} onChange={set('max_follow_ups')} disabled={!form.interval_days}>
            <option value="">No limit</option>
            <option value="2">2 follow-ups</option>
            <option value="3">3 follow-ups</option>
            <option value="5">5 follow-ups</option>
          </select>
        </div>
      </div>

      <div className="fu-form-foot">
        <button className="btn primary" type="submit" disabled={!form.title.trim() || !form.date}>
          Create follow-up
        </button>
        <button className="link" type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function FollowUpRow({ followUp, onAction, expanded, onExpand }) {
  const status = FU_STATUS[followUp.status] || FU_STATUS.waiting;
  const replied = Boolean(followUp.responded_at);

  return (
    <li className={`fu tone-${status.tone} ${replied ? 'replied' : ''}`}>
      <div className="fu-main">
        <button className="fu-title" onClick={() => onExpand(expanded ? null : followUp.id)}>
          {followUp.title}
        </button>
        <div className="fu-meta">
          <span className={`fu-status s-${status.tone}`}>{status.label}</span>
          {followUp.contact && <span className="m-item"><Icon name="chat" size={13} /> {followUp.contact}</span>}
          {followUp.reason && <span className="m-item">{followUp.reason}</span>}
          {followUp.interval_days && (
            <span className="m-item">
              every {followUp.interval_days}d · {followUp.follow_up_count}
              {followUp.max_follow_ups ? `/${followUp.max_follow_ups}` : ''} sent
            </span>
          )}
          {replied && <span className="m-item ok-text">Reply received</span>}
        </div>
      </div>

      <span className="fu-when">{whenLabel(followUp.due_at)}</span>

      <div className="fu-tools">
        <button className="tool" onClick={() => onAction(followUp, 'complete')}>Done</button>
        <button className="tool" onClick={() => onAction(followUp, 'snooze')}>Snooze</button>
      </div>

      {expanded && (
        <div className="fu-detail">
          <div className="fu-snooze">
            <span>Snooze for</span>
            {SNOOZE_OPTIONS.map((o) => (
              <button key={o.minutes} className="tool" onClick={() => onAction(followUp, 'snooze', o.minutes)}>
                {o.label}
              </button>
            ))}
            <button className="tool" onClick={() => onAction(followUp, 'snoozeDays', 3)}>3 days</button>
          </div>

          <h4>History</h4>
          <ul className="fu-history">
            {(followUp.events || []).map((e) => (
              <li key={e.id}>
                <span>{dateTimeLabel(e.at)}</span>
                <span>{e.kind}{e.detail ? ` — ${e.detail}` : ''}</span>
              </li>
            ))}
          </ul>

          <div className="fu-detail-foot">
            <button className="link danger" onClick={() => onAction(followUp, 'cancel')}>Cancel follow-up</button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function FollowUps({ chats, onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.followUps());
    } catch (err) {
      onError(err);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const act = async (followUp, action, amount) => {
    try {
      if (action === 'complete') await api.updateFollowUp(followUp.id, { status: 'completed' });
      else if (action === 'cancel') await api.updateFollowUp(followUp.id, { status: 'cancelled' });
      else if (action === 'snooze') await api.snoozeFollowUp(followUp.id, { minutes: amount || 60 * 24 });
      else if (action === 'snoozeDays') await api.snoozeFollowUp(followUp.id, { days: amount });
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const create = async (body) => {
    try {
      await api.createFollowUp(body);
      setCreating(false);
      await load();
    } catch (err) {
      onError(err);
    }
  };

  const groups = useMemo(() => {
    if (!data) return [];
    const list = data.followUps;
    return [
      { key: 'overdue', label: 'Overdue', items: list.filter((f) => f.status === 'overdue') },
      { key: 'attention', label: 'Needs attention', items: list.filter((f) => f.status === 'needs_attention') },
      { key: 'due', label: 'Due', items: list.filter((f) => f.status === 'due') },
      { key: 'waiting', label: 'Waiting', items: list.filter((f) => ['waiting', 'snoozed'].includes(f.status)) },
      { key: 'done', label: 'Completed', items: list.filter((f) => f.status === 'completed') },
    ].filter((g) => g.items.length);
  }, [data]);

  if (loading && !data) {
    return <div className="empty" aria-busy="true"><strong>Loading follow-ups…</strong></div>;
  }
  if (!data) return null;

  const { stats } = data;

  return (
    <div className="followups">
      <section className="kpis">
        {[
          { key: 'due', label: 'Due', value: stats.due, tone: 'warn', icon: 'sun' },
          { key: 'overdue', label: 'Overdue', value: stats.overdue, tone: 'danger', icon: 'alert' },
          { key: 'waiting', label: 'Waiting', value: stats.waiting, tone: 'info', icon: 'clock' },
          { key: 'completed', label: 'Completed', value: stats.completed, tone: 'ok', icon: 'check' },
        ].map((c) => (
          <div key={c.key} className={`kpi static t-${c.tone}`}>
            <span className="kpi-top">
              <span className="kpi-label">{c.label}</span>
              <Icon name={c.icon} size={15} className="kpi-icon" />
            </span>
            <span className="kpi-num">{c.value}</span>
          </div>
        ))}
      </section>

      {creating ? (
        <NewFollowUp chats={chats} onCreate={create} onClose={() => setCreating(false)} />
      ) : (
        <button className="btn primary" onClick={() => setCreating(true)}>+ New follow-up</button>
      )}

      {groups.length === 0 ? (
        <div className="empty">
          <strong>Nothing to follow up on.</strong>
          <p>Follow-ups appear here when you add one, or when Claude spots that you are waiting on someone.</p>
        </div>
      ) : (
        <div className="sections">
          {groups.map((group) => (
            <section className="section" key={group.key}>
              <div className="section-head static">
                <h3>{group.label}</h3>
                <span className="section-count">{group.items.length}</span>
              </div>
              <ul className="fu-list">
                {group.items.map((f) => (
                  <FollowUpRow
                    key={f.id}
                    followUp={f}
                    expanded={expanded === f.id}
                    onExpand={setExpanded}
                    onAction={act}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
