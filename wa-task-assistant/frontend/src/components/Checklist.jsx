import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

/**
 * The checklist inside one task.
 *
 * Ticking everything deliberately does not finish the task: completing it
 * cancels the whole reminder ladder, which is too much to happen as a side
 * effect of ticking a box. The panel says so once the last box is ticked, and
 * leaves finishing as the explicit action it is.
 */
export default function Checklist({ task, initial, onChanged, onError }) {
  const [items, setItems] = useState(initial || []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.subtasks(task.id)
      .then((d) => { if (live) setItems(d.subtasks); })
      .catch(() => {});
    return () => { live = false; };
  }, [task.id]);

  const apply = useCallback((next) => {
    setItems(next);
    onChanged?.(next);
  }, [onChanged]);

  const act = async (fn) => {
    setBusy(true);
    try {
      const { subtasks } = await fn();
      apply(subtasks);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const add = (event) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    act(() => api.addSubtask(task.id, title));
  };

  const done = items.filter((i) => i.done).length;
  const all = items.length > 0 && done === items.length;

  return (
    <div className="field">
      <label>
        Checklist
        {items.length > 0 && <span className="count-note">{done} of {items.length}</span>}
      </label>

      {items.length > 0 && (
        <div className="check-bar" role="presentation">
          <span style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
        </div>
      )}

      <ul className="checklist">
        {items.map((item) => (
          <li key={item.id} className={item.done ? 'done' : ''}>
            <label>
              <input
                type="checkbox"
                checked={Boolean(item.done)}
                disabled={busy}
                onChange={(e) => act(() => api.updateSubtask(task.id, item.id, { done: e.target.checked }))}
              />
              <span>{item.title}</span>
            </label>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${item.title}`}
              onClick={() => act(() => api.deleteSubtask(task.id, item.id))}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>

      {all && (
        <p className="field-note">
          Every item is ticked. The task itself is still open — mark it done when you are ready.
        </p>
      )}

      <form className="check-add" onSubmit={add}>
        <input
          value={draft}
          placeholder="Add a step…"
          aria-label="Add a checklist item"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn small" disabled={!draft.trim() || busy}>Add</button>
      </form>
    </div>
  );
}
