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
export default function Duplicates({ onError, onChanged, onOpen, standalone = false }) {
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
    if (done > 0) {
      return (
        <div className="banner ok" role="status">
          {done} duplicate{done === 1 ? '' : 's'} archived. Nothing else looks like a copy.
        </div>
      );
    }
    /* On its own page, silence would be a blank screen: say the thing the page
       exists to report. Inside another page it still renders nothing. */
    return standalone ? (
      <div className="empty">
        <strong>Nothing looks like a copy.</strong>
        <p>Every open task reads as its own job.</p>
      </div>
    ) : null;
  }

  /*
   * The same words, exactly.
   *
   * Merging a whole list at once is dangerous where the match is a word count:
   * "Review Santosh Textile ledger" and "Review Parth Bajaj ledger" share five
   * words out of seven and are two clients. But where the titles are character
   * for character the same job, judgement adds nothing - and on a board of two
   * hundred tasks, pressing a button nineteen times is why the page does not
   * get used.
   */
  const flat = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const identical = groups.filter(
    (g) => g.drop.every((d) => flat(d.title) === flat(g.keep.title))
  );

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

  const mergeIdentical = async () => {
    setBusy('all');
    try {
      let merged = 0;
      // One at a time, so a group that fails does not take the rest with it.
      for (const group of identical) {
        const res = await api.mergeDuplicates(group.keep.id, group.drop.map((t) => t.id));
        merged += res.merged.length;
      }
      setDone((n) => n + merged);
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
      {/* On its own page the heading above already says all this; here the
          panel only needs to report the count and what pressing Keep does. */}
      <header>
        {!standalone && <h3><Icon name="alert" size={17} /> The same job, listed more than once</h3>}
        {standalone && <h3>What looks like a copy</h3>}
        <span>
          {total} extra {total === 1 ? 'copy' : 'copies'} across {groups.length}{' '}
          {groups.length === 1 ? 'job' : 'jobs'}
        </span>
      </header>

      <p className="confirm-lede">
        {standalone
          ? 'Keeping one archives the rest — they stay in Work History and can be restored.'
          : 'Each copy carries its own reminders, so the job gets chased once per copy. Keeping '
            + 'one archives the rest — they stay in Work History and can be restored.'}
      </p>

      {identical.length > 1 && (
        <p className="confirm-lede">
          <button
            type="button"
            className="btn small"
            disabled={busy === 'all'}
            onClick={mergeIdentical}
          >
            {busy === 'all'
              ? 'Merging…'
              : `Merge the ${identical.length} with identical titles`}
          </button>{' '}
          <span className="hint">
            Only where the words match exactly — the rest are left for you to read.
          </span>
        </p>
      )}

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
