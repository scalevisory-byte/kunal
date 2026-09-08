import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Why a task shows the sender and not the group it came from.
 *
 * The name is read from WhatsApp when the message arrives, and that read fails
 * often enough — a Meta-hosted chat, a sync still running — that the row ends up
 * holding the chat's id instead. An id is not something the list can show, so
 * the row falls back to the sender and the group disappears.
 *
 * This says how many groups are in that state and offers the one thing that
 * fixes it: asking WhatsApp again, now, rather than waiting for a restart.
 */
export default function GroupNames({ onError }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(() => {
    api.groupNames().then(setState).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const repair = async () => {
    setBusy(true);
    setDone(null);
    try {
      const result = await api.repairGroupNames();
      setDone(result);
      load();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const ready = state.whatsapp === 'ready';

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Group names</h3>
        <span>{state.groups} group{state.groups === 1 ? '' : 's'} seen</span>
      </header>

      <p className="field-note">
        A task from a group should read <b>sender · group</b>. Where WhatsApp could
        not be asked for the name when the message arrived, the row has only the
        sender.
      </p>

      <dl className="facts">
        <div>
          <dt>Named</dt>
          <dd>{state.groups - state.unnamed - state.fixable_now}</dd>
        </div>
        <div>
          <dt>Nameable from what is stored</dt>
          <dd>{state.fixable_now}</dd>
        </div>
        <div>
          <dt>Need asking WhatsApp</dt>
          <dd>{state.unnamed}</dd>
        </div>
      </dl>

      {done && (
        <p className={`field-note ${done.named ? 'ok-text' : ''}`}>
          {done.named
            ? `Named ${done.named} group${done.named === 1 ? '' : 's'} — ${done.tasks} task${done.tasks === 1 ? '' : 's'} updated.`
            : done.asked
              ? `Asked WhatsApp about ${done.asked} group${done.asked === 1 ? '' : 's'} and it could not name ${done.asked === 1 ? 'it' : 'them'}. Try again once it has finished syncing.`
              : 'Every group already has its name.'}
        </p>
      )}

      <div className="set-control">
        <button type="button" className="btn small" disabled={busy} onClick={repair}>
          {busy ? 'Asking WhatsApp…' : 'Fix group names'}
        </button>
      </div>

      {!ready && (
        <p className="field-note warn-text">
          WhatsApp is {state.whatsapp === 'authenticated' ? 'still syncing' : 'not connected'}, so it
          cannot be asked for names yet. Anything already stored is repaired regardless.
        </p>
      )}
    </section>
  );
}
