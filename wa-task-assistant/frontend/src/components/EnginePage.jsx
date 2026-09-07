import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

const KIND = {
  pre_due: 'Before deadline',
  due: 'At deadline',
  follow_up: 'Follow-up',
  custom: 'Custom',
};

const when = (iso, timezone) => {
  if (!iso) return '—';
  const at = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return at.toLocaleString([], {
    timeZone: timezone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
};

const relative = (iso) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  const mins = Math.round(Math.abs(ms) / 60000);
  const text = mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
  return ms >= 0 ? `in ${text}` : `${text} ago`;
};

/**
 * What the reminder engine is actually doing.
 *
 * The settings said how it is configured; nothing said what it had lined up.
 * A schedule you cannot see is a schedule you cannot trust - and this is the
 * part of the app that decides whether a deadline gets chased at all.
 *
 * Read-only by design: acting on a row goes through the task drawer, so there
 * is one path for every change rather than a second way to edit a schedule.
 */
export default function EnginePage({ onOpenTask, onError }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('upcoming');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.engine());
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const runNow = async () => {
    setBusy(true);
    try {
      await api.runEngine();
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;

  const tz = data.timezone;
  const rows = data[tab] || [];
  const TABS = [
    ['upcoming', 'Scheduled', data.counts?.scheduled ?? 0],
    ['recent', 'Already sent', data.counts?.triggered ?? 0],
    ['missed', 'Missed', data.counts?.missed ?? 0],
    ['attention', 'Stopped asking', data.attention?.length ?? 0],
  ];

  return (
    <section className="engine">
      <div className="engine-figures">
        {[
          { label: 'Scheduled', value: data.counts?.scheduled ?? 0, note: 'waiting to fire' },
          { label: 'Follow-ups', value: data.counts?.follow_ups ?? 0, note: 'after a deadline' },
          { label: 'Already sent', value: data.counts?.triggered ?? 0, note: 'all time' },
          { label: 'Stopped asking', value: data.attention?.length ?? 0, note: 'reached the cap' },
        ].map((f) => (
          <div className="engine-figure" key={f.label}>
            <span className="ef-value">{f.value}</span>
            <span className="ef-label">{f.label}</span>
            <span className="ef-note">{f.note}</span>
          </div>
        ))}
      </div>

      <div className="engine-head">
        <nav className="segment tabs" role="tablist" aria-label="Engine view">
          {TABS.map(([key, label, count]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key)}
            >
              {label} {count > 0 && <span className="tab-count">{count}</span>}
            </button>
          ))}
        </nav>
        <button type="button" className="btn small ghost" onClick={runNow} disabled={busy}>
          {busy ? 'Running…' : 'Run the engine now'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="engine-empty">
          {tab === 'upcoming' && 'Nothing is scheduled. Give a task a deadline and its ladder appears here.'}
          {tab === 'recent' && 'Nothing has fired yet.'}
          {tab === 'missed' && 'Nothing was missed — the engine has been running when it was needed.'}
          {tab === 'attention' && 'Nothing has been given up on.'}
        </p>
      ) : (
        <ul className="engine-list">
          {rows.map((r) => (
            <li key={tab === 'attention' ? `t${r.id}` : `r${r.id}`}>
              <button className="engine-title" onClick={() => onOpenTask(r.task_id ?? r.id)}>
                {r.title}
              </button>
              <span className="engine-meta">
                {tab === 'attention' ? (
                  <>
                    <span className="engine-kind attention">
                      {r.follow_up_count} follow-ups, no completion
                    </span>
                    {r.due_at && <span>Deadline {when(r.due_at, tz)}</span>}
                  </>
                ) : (
                  <>
                    <span className={`engine-kind k-${r.kind}`}>
                      {KIND[r.kind] || r.kind}{r.kind === 'follow_up' ? ` ${r.round}` : ''}
                    </span>
                    <span>
                      <Icon name="clock" size={12} />{' '}
                      {when(tab === 'recent' ? r.triggered_at : r.fire_at, tz)}
                      <span className="engine-rel"> · {relative(tab === 'recent' ? `${r.triggered_at}Z` : r.fire_at)}</span>
                    </span>
                    {r.snooze_count > 0 && <span>snoozed {r.snooze_count}×</span>}
                  </>
                )}
                {r.assigned_to && <span className="engine-who">for {r.assigned_to}</span>}
                {r.chat_name && <span className="engine-chat">{r.chat_name}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="engine-foot">
        Times are shown in {tz}. The engine ticks every few minutes in the background,
        whether or not this page is open.
      </p>
    </section>
  );
}
