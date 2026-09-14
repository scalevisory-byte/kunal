import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Why a row does not say which chat it came from.
 *
 * The name is read from WhatsApp when the message arrives, and that read fails
 * often enough — a Meta-hosted chat, a sync still running — that the row ends up
 * holding the chat's id instead. An id is not something the list can show, so a
 * group falls back to the sender alone, and a one-to-one chat under a `@lid` id
 * shows nothing at all: there is no dialable number inside a linked identity to
 * fall back on.
 *
 * This used to count groups only, which is why "still name not coming" survived
 * the first fix — the chats that showed nothing were the ones it was not
 * looking at. It now covers every chat, and offers the one thing that fixes
 * them: asking WhatsApp again, now, rather than waiting for a restart.
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
        <h3>Chat names</h3>
        <span>{state.groups} chat{state.groups === 1 ? '' : 's'} seen</span>
      </header>

      <p className="field-note">
        A task from a group should read <b>sender · group</b>, and one from a
        person should read their name. Where WhatsApp could not be asked when the
        message arrived, the row has only the sender — or, for a chat with no
        number in its id, <b>Unnamed chat</b>.
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

      {/*
        * The same question counted over the rows he is looking at.
        *
        * "Name abhi nahi aya" is asked of the task list, and a count of chats
        * cannot answer it. These three add up to every task, and they say which
        * of the blanks the button below can still fill.
        */}
      {state.tasks && (
        <>
          <p className="field-note">On the task rows themselves:</p>
          <dl className="facts">
            <div>
              <dt>Rows showing their chat</dt>
              <dd>{state.tasks.named}</dd>
            </div>
            <div>
              <dt>Blank, but askable</dt>
              <dd className={state.tasks.askable ? 'warn-text' : ''}>{state.tasks.askable}</dd>
            </div>
            <div>
              {/* No id, no message: there is nothing to look a name up from,
                  now or ever. The row says "No chat" rather than staying blank. */}
              <dt>No chat recorded at all</dt>
              <dd>{state.tasks.noSource}</dd>
            </div>
          </dl>
          {/*
            * What the blank rows actually hold.
            *
            * Three rounds went on guessing this from a screenshot, and the
            * guess was wrong each time. The stored value says which cause it
            * is on sight: a "…:33" is a linked identity, a bare number is a
            * contact that never resolved, and an empty one is a chat that was
            * never recorded at all.
            */}
          {state.blanks?.length > 0 && (
            <details className="blank-chats">
              <summary>What those rows hold ({state.blanks.length} shown)</summary>
              <ul>
                {state.blanks.map((row) => (
                  <li key={row.id}>
                    <span className="bc-title">{row.title}</span>
                    <code>{row.chat_name || (row.chat_id ? '(no name, has an id)' : '(nothing stored)')}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {state.tasks.noSource > 0 && (
            <p className="field-note">
              <b>{state.tasks.noSource}</b>{' '}
              {state.tasks.noSource === 1 ? 'task carries' : 'tasks carry'} no chat and no
              message, so there is nothing to look a name up from — for those the row says
              “No chat”. Everything else is fixable by the button below.
            </p>
          )}
        </>
      )}

      {done && (
        <p className={`field-note ${done.named ? 'ok-text' : ''}`}>
          {done.named
            ? `Named ${done.named} chat${done.named === 1 ? '' : 's'} — ${done.tasks} task${done.tasks === 1 ? '' : 's'} updated.`
            : done.asked
              ? `Asked WhatsApp about ${done.asked} chat${done.asked === 1 ? '' : 's'} and it could not name ${done.asked === 1 ? 'it' : 'them'}. Try again once it has finished syncing.`
              : 'Every chat already has its name.'}
        </p>
      )}

      <div className="set-control">
        <button type="button" className="btn small" disabled={busy} onClick={repair}>
          {busy ? 'Asking WhatsApp…' : 'Fix chat names'}
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
