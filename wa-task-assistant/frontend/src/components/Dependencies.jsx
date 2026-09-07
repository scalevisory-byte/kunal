import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

/**
 * What a task is waiting on, and what is waiting on it.
 *
 * Being blocked does not silence reminders - a deadline is still a deadline,
 * and going quiet on one is how things get forgotten. What it changes is that
 * the reminder names what is in the way.
 */
export default function Dependencies({ task, tasks, initial, onError }) {
  const [blockers, setBlockers] = useState(initial?.blockers || []);
  const [blocking, setBlocking] = useState(initial?.blocking || []);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.dependencies(task.id)
      .then((d) => {
        if (!live) return;
        setBlockers(d.blockers);
        setBlocking(d.blocking);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [task.id]);

  const act = async (fn) => {
    setBusy(true);
    try {
      const data = await fn();
      setBlockers(data.blockers);
      setBlocking(data.blocking);
      setPicking(false);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  // Anything already a blocker, or this task itself, is not worth offering.
  const chosen = new Set(blockers.map((b) => b.id));
  const options = (tasks || []).filter(
    (t) => t.id !== task.id && !chosen.has(t.id) && t.status !== 'done'
  );

  const open = blockers.filter((b) => b.status !== 'done');

  return (
    <div className="field">
      <label>
        Waiting on
        {open.length > 0 && <span className="count-note blocked">{open.length} not done</span>}
      </label>

      {blockers.length === 0 && !picking && (
        <p className="field-note">Nothing is in the way of this task.</p>
      )}

      {blockers.length > 0 && (
        <ul className="dep-list">
          {blockers.map((b) => (
            <li key={b.id} className={b.status === 'done' ? 'done' : ''}>
              <Icon name={b.status === 'done' ? 'check' : 'alert'} size={13} />
              <span>{b.title}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Stop waiting on ${b.title}`}
                disabled={busy}
                onClick={() => act(() => api.removeDependency(task.id, b.id))}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <select
          autoFocus
          defaultValue=""
          aria-label="Choose the task this one waits on"
          disabled={busy}
          onChange={(e) => e.target.value && act(() => api.addDependency(task.id, Number(e.target.value)))}
        >
          <option value="" disabled>Choose a task…</option>
          {options.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      ) : (
        <button type="button" className="btn small ghost" onClick={() => setPicking(true)}>
          Add what it waits on
        </button>
      )}

      {blocking.length > 0 && (
        <p className="field-note">
          Finishing this frees: {blocking.map((b) => b.title).join(', ')}.
        </p>
      )}
    </div>
  );
}
