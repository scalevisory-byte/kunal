import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { agoLabel } from '../lib/task.js';

/**
 * What is happening on a task, written down as it happens.
 *
 * Three questions were being asked of one field. Status says whether work is
 * owed. Stage says how far along it is — "sent to the CA", "quote given",
 * "waiting for signature". And the update is what was last said about it,
 * which is the part that cannot be reconstructed a week later from either of
 * the other two, and the part that decides what to do next.
 *
 * It is a stream, not a box you overwrite. "Waiting for the CA" and "CA
 * replied, one more signature needed" are two facts a week apart, and read in
 * order they are an account of what happened; kept in one field, the first is
 * simply gone. Correcting an update means writing the next one — the same rule
 * the deadline log already follows.
 */
const when = (value) => {
  if (!value) return '';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export default function TaskProgress({ task, initial, stages: known = [], onChanged, onError, autoFocus }) {
  const [updates, setUpdates] = useState(initial || []);
  const [stages, setStages] = useState(known);
  const [body, setBody] = useState('');
  const [stage, setStage] = useState('');
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    let live = true;
    api.updates(task.id)
      .then((d) => { if (live) { setUpdates(d.updates); setStages(d.stages || []); } })
      .catch(() => {});
    return () => { live = false; };
  }, [task.id]);

  useEffect(() => { if (autoFocus) box.current?.focus(); }, [autoFocus]);

  const add = async (event) => {
    event.preventDefault();
    const text = body.trim();
    const next = moving ? stage.trim() : '';
    if (!text && !next) return;
    setBusy(true);
    try {
      const res = await api.addUpdate(task.id, {
        body: text,
        // Sent only when the stage is actually being moved. Sending the current
        // one back on every update would write "changed to the same thing" into
        // the record over and over.
        ...(moving ? { stage: next } : {}),
      });
      setUpdates(res.updates);
      setStages(res.stages || stages);
      setBody('');
      setStage('');
      setMoving(false);
      onChanged?.(res.task);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      setUpdates((await api.deleteUpdate(task.id, id)).updates);
      onChanged?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field progress-panel">
      <label>
        Progress
        {task.stage && <span className={`stage-chip${moving ? ' dim' : ''}`}>{task.stage}</span>}
      </label>

      <form className="prog-add" onSubmit={add}>
        <textarea
          ref={box}
          rows={2}
          value={body}
          placeholder="What is happening on this? — “CA ko docs bhej diye, kal reply”"
          aria-label="Add a progress update"
          onChange={(e) => setBody(e.target.value)}
        />

        {moving ? (
          <div className="prog-stage">
            <input
              list="known-stages"
              value={stage}
              autoFocus
              placeholder={task.stage ? `Now: ${task.stage}` : 'e.g. Waiting for documents'}
              aria-label="Move to stage"
              onChange={(e) => setStage(e.target.value)}
            />
            <datalist id="known-stages">
              {stages.map((s) => <option key={s} value={s} />)}
            </datalist>
            <button
              type="button"
              className="link"
              onClick={() => { setMoving(false); setStage(''); }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="link prog-stage-btn" onClick={() => setMoving(true)}>
            <Icon name="flag" size={13} /> {task.stage ? 'Move to another stage' : 'Set a stage'}
          </button>
        )}

        <div className="prog-actions">
          <button
            type="submit"
            className="btn small"
            disabled={busy || (!body.trim() && !(moving && stage.trim()))}
          >
            Add update
          </button>
        </div>
      </form>

      {updates.length === 0 ? (
        <p className="field-note">
          Nothing written down yet. An update here is what you read back when somebody
          asks where this stands.
        </p>
      ) : (
        <ol className="prog-log">
          {updates.map((u) => (
            <li key={u.id}>
              <div className="prog-head">
                {u.stage && <span className="stage-chip small">{u.stage}</span>}
                <span className="prog-when" title={when(u.created_at)}>{agoLabel(u.created_at)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove this update"
                  disabled={busy}
                  onClick={() => remove(u.id)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
              {u.body ? <p className="prog-body">{u.body}</p> : (
                <p className="prog-body muted">Moved to {u.stage || 'no stage'}.</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
