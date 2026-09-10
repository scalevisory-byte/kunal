import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';

/**
 * A deadline that has arrived, said once, in the way.
 *
 * The list already shows what is late - and a list is exactly what nobody
 * reads while in the middle of something else, which is how a hundred tasks
 * reached their deadline unnoticed. A deadline passing is worth interrupting
 * for once; after that it is a row in a list again, and this stays quiet.
 *
 * What was done with it is recorded on the server, not in this browser: seen
 * on the phone means seen on the laptop, a refresh does not bring it back, and
 * clearing a browser does not resurrect it. It is keyed on the deadline it was
 * for, so moving a task to Friday raises a fresh notice on Friday rather than
 * inheriting the silence of the one before.
 */
const LATER_MINUTES = 60;

/** "2 days late", "3 hours late" - how long the promise has been broken. */
function lateBy(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins <= 1 ? 'Due now' : `${mins} minutes late`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} late`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} late`;
}

const stamp = (iso) =>
  new Date(iso).toLocaleString([], {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });

export default function DueNowPopup({ onOpenTask, onDone, refreshedAt }) {
  const [due, setDue] = useState([]);
  const [busy, setBusy] = useState(false);
  /*
   * One interruption at a time. Several deadlines can pass while the tab is
   * shut, and answering one dialog only to be handed the next is how a popup
   * becomes something you dismiss without reading.
   */
  const [shown, setShown] = useState(true);

  const load = useCallback(() => {
    api.dueNow().then((d) => setDue(d.due || [])).catch(() => {});
  }, []);

  // Reloaded with the board, so finishing a task closes its notice.
  useEffect(() => { load(); }, [load, refreshedAt]);

  const item = shown ? due[0] : null;
  if (!item) return null;

  const answer = async (action, extra) => {
    if (busy) return;
    setBusy(true);
    try {
      if (extra) await extra();
      const d = await api.answerDueNow(item.id, {
        due_key: item.due_key,
        action,
        minutes: LATER_MINUTES,
      });
      setDue(d.due || []);
    } catch {
      // A failed dismissal must not leave the dialog stuck on screen; it will
      // be back on the next load, which is the honest outcome.
      setShown(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notice-backdrop" role="presentation" onClick={() => answer('later')}>
      <div
        className="notice"
        role="alertdialog"
        aria-labelledby="due-now-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="notice-kicker danger-text">
          <Icon name="alert" size={13} /> Deadline reached
        </p>
        <h2 id="due-now-title">{item.title}</h2>
        <p className="notice-sub">
          {[item.group_name, item.chat_name].filter(Boolean).join(' · ') || 'Added by hand'}
        </p>
        <p className="notice-when">{lateBy(item.due_at)} · was due {stamp(item.due_at)}</p>
        {due.length > 1 && (
          <p className="notice-body">
            {due.length - 1} more {due.length === 2 ? 'deadline has' : 'deadlines have'} passed —
            you will be asked about {due.length === 2 ? 'it' : 'them'} after this one.
          </p>
        )}

        <div className="notice-foot">
          <button className="btn primary small" disabled={busy} onClick={() => answer('seen', () => onDone(item.id))}>
            Mark it done
          </button>
          <button className="btn ghost small" disabled={busy} onClick={() => answer('later')}>
            Remind me in an hour
          </button>
          <button className="link" disabled={busy} onClick={() => answer('seen', () => onOpenTask(item.id))}>
            Open it
          </button>
          <button className="link" disabled={busy} onClick={() => answer('seen')}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
