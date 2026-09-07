import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

/**
 * The same job, on the list more than once.
 *
 * Two faults used to make these — a monthly rule that created a task somebody
 * had already typed into a chat, and a matcher that stopped recognising copies
 * once two existed. Both are fixed, but neither helps the rows already here,
 * and those are the ones being chased twice a day.
 *
 * Nothing is merged automatically. A word count is a good enough signal to ask
 * about and a poor one to act on: "Pay BNF TDS" and "Pay BNF TDS" may still be
 * two genuinely different jobs, and only the person who wrote them knows. So
 * this shows what it found, keeps the oldest of each set by default, and waits.
 * The ones put away are archived, not deleted.
 */
export default function Duplicates({ onError, onChanged, onOpen }) {
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(0);

  const load = useCallback(async () => {
    try {
      setGroups((await api.duplicates()).groups);
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  if (!groups.length) {
    return done > 0 ? (
      <div className="banner ok" role="status">
        {done} duplicate{done === 1 ? '' : 's'} archived. Nothing else looks like a copy.
      </div>
    ) : null;
  }

  const merge = async (group) => {
    setBusy(group.keep.id);
    try {
      const res = await api.mergeDuplicates(group.keep.id, group.drop.map((t) => t.id));
      setDone((n) => n + res.merged.length);
      await load();
      onChanged?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const total = groups.reduce((n, g) => n + g.drop.length, 0);

  return (
    <section className="confirm-panel">
      <header>
        <h3><Icon name="alert" size={17} /> The same job, listed more than once</h3>
        <span>
          {total} extra {total === 1 ? 'copy' : 'copies'} across {groups.length}{' '}
          {groups.length === 1 ? 'job' : 'jobs'}
        </span>
      </header>

      <p className="confirm-lede">
        Each copy carries its own reminders, so the job gets chased once per copy. Keeping
        one archives the rest — they stay in Work History and can be restored.
      </p>

      <ul>
        {groups.map((group) => (
          <li key={group.keep.id}>
            <div className="confirm-what">
              <button type="button" className="confirm-title" onClick={() => onOpen?.(group.keep)}>
                {group.keep.title}
              </button>
              <div className="confirm-meta">
                <span>
                  keeping #{group.keep.id}
                  {group.keep.due_date ? ` · due ${group.keep.due_date}` : ' · no deadline'}
                </span>
                <span>archiving {group.drop.map((t) => `#${t.id}`).join(', ')}</span>
              </div>
            </div>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn small"
                disabled={busy === group.keep.id}
                onClick={() => merge(group)}
              >
                {busy === group.keep.id ? 'Merging…' : `Keep one, archive ${group.drop.length}`}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
