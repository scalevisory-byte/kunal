import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { spanLabel } from '../lib/task.js';

/**
 * Which chats are read.
 *
 * Asked as "jitni chat add kare wahi read kare, aur usme se task aaye": read
 * only the chats he adds, and make tasks only from those. The blocklist below
 * is the other shape - everything less what is named - and stays as it is;
 * with this on, a chat has to be listed AND not blocked to be read.
 *
 * With it on, an unlisted chat is dropped before anything is stored or sent to
 * the AI, so it costs nothing and leaves nothing behind. His own "message
 * yourself" chat is always read, and his own replies ("done 2") always work.
 */
export default function ListedChats({ mode, onError }) {
  const [data, setData] = useState(null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async (q = '') => {
    try {
      setData(await api.listedChats(q));
    } catch (err) {
      onError?.(err);
    }
  }, [onError]);

  useEffect(() => { if (mode === 'ai') load(); }, [mode, load]);

  // Search as he types, on the server's list of every chat on record.
  useEffect(() => {
    if (mode !== 'ai') return undefined;
    const t = setTimeout(() => load(value.trim()), 200);
    return () => clearTimeout(t);
  }, [value, mode, load]);

  const run = async (fn) => {
    try {
      const next = await fn();
      if (next?.switchedOff) {
        setNote('That was the last chat on the list, so every chat is read again (less the blocked ones).');
      }
      await load(value.trim());
    } catch (err) {
      onError?.(err);
    }
  };

  // Manual mode reads nobody else's messages at all; a list would mean nothing.
  if (mode !== 'ai' || !data) return null;

  const { on, listed, chats } = data;
  const offer = chats.filter((c) => !c.listed).slice(0, value.trim() ? 30 : 12);
  const add = (pattern, label) => { setNote(''); run(() => api.addListedChat(pattern, label)); };

  return (
    <section className="panel-block listed">
      <h3>Which chats are read</h3>

      <div className="segment" role="group" aria-label="Which chats are read">
        <button
          type="button"
          className={on ? '' : 'active'}
          aria-pressed={!on}
          onClick={() => on && run(() => api.setListedMode(false))}
        >
          Every chat, less the blocked ones
        </button>
        <button
          type="button"
          className={on ? 'active' : ''}
          aria-pressed={on}
          disabled={!on && listed.length === 0}
          title={!on && listed.length === 0 ? 'Add at least one chat first — with an empty list nothing would be read' : undefined}
          onClick={() => !on && run(() => api.setListedMode(true))}
        >
          Only the chats I list{listed.length ? ` (${listed.length})` : ''}
        </button>
      </div>

      <p className={`hint ${on ? 'ok-text' : ''}`}>
        {on ? (
          <>
            <b>Reading only the {listed.length} {listed.length === 1 ? 'chat' : 'chats'} below</b>, plus
            your own notes chat. Every other chat is ignored — not stored, not sent to the AI,
            no tasks from it.
            {/* The figure is only as long as the restart is old, so it says
                how long that is - the app restarts on every deploy. */}
            {data.unlistedDropped > 0
              && ` ${data.unlistedDropped} messages from other chats skipped in the ${spanLabel(data.bootedAt) || 'time'} since the app restarted.`}
          </>
        ) : listed.length ? (
          <>The list is ready but not in use — every chat is still read. Press <b>Only the chats I list</b> to switch.</>
        ) : (
          <>Every chat is read now. Add the chats you want tasks from, then switch to <b>Only the chats I list</b>.</>
        )}
      </p>
      {note && <p className="hint warn">{note}</p>}

      {listed.length > 0 && (
        <ul className="block-list">
          {listed.map((row) => (
            <li key={row.id} className={row.matches ? 'working' : 'idle'}>
              <span className="bl-name">{row.label || row.pattern}</span>
              <span className="bl-state">
                {/*
                  * A typed name that catches nothing is the failure nobody
                  * sees: the chat he meant is quietly never read.
                  */}
                {row.matches
                  ? row.examples.length && (row.examples[0] !== row.label || row.matches > 1)
                    ? `reads ${row.examples.join(', ')}${row.matches > row.examples.length ? ` +${row.matches - row.examples.length} more` : ''}`
                    : 'reads this chat'
                  : 'matches no chat on record yet — search below and tap the chat instead'}
              </span>
              <button className="chip-x" onClick={() => run(() => api.removeListedChat(row.id))} aria-label={`Stop reading ${row.label || row.pattern}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="add-row"
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) { add(value.trim()); setValue(''); } }}
      >
        <input
          className="grow"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search a chat or group to add…"
          autoComplete="off"
        />
        <button className="btn ghost" type="submit" disabled={!value.trim()}>Add name</button>
      </form>

      {offer.length > 0 && (
        <>
          <p className="hint">{value.trim() ? 'Tap to add:' : 'Recent chats — tap to add:'}</p>
          <ul className="chip-list">
            {offer.map((c) => (
              <li key={c.chat_id}>
                {/* Added by id, which is exact and survives a rename; the name
                    goes with it so the list reads as names. */}
                <button className="chip ghost" onClick={() => add(c.chat_id, c.chat_name)} disabled={c.blocked}
                  title={c.blocked ? 'This chat is blocked — unblock it below first' : undefined}>
                  + {c.chat_name}
                  {Boolean(c.is_group) && <span className="chip-tag">group</span>}
                  {c.blocked && <span className="chip-tag">blocked</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {value.trim() && offer.length === 0 && (
        <p className="hint">
          No chat on record matches “{value.trim()}”. <b>Add name</b> will read a chat of that
          name once it writes — or check the spelling.
        </p>
      )}
    </section>
  );
}
