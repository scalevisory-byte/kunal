import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Only meaningful in AI mode: names listed here are never read or stored.
 * Matching is loose, so "Mummy" also blocks "Mummy ❤️".
 */
export default function BlockedChats({ mode, onError }) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState([]);
  const [recent, setRecent] = useState([]);
  const [value, setValue] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.blockedChats();
      setBlocked(data.blocked);
      setRecent(data.recent);
    } catch (err) {
      onError?.(err);
    }
  }, [onError]);

  // Load on mount so the toggle can show the count without being opened first.
  useEffect(() => {
    if (mode === 'ai') load();
  }, [mode, load]);

  const add = async (pattern) => {
    const trimmed = String(pattern || '').trim();
    if (!trimmed) return;
    try {
      setBlocked((await api.blockChat(trimmed)).blocked);
      setValue('');
    } catch (err) {
      onError?.(err);
    }
  };

  const remove = async (id) => {
    try {
      setBlocked((await api.unblockChat(id)).blocked);
    } catch (err) {
      onError?.(err);
    }
  };

  if (mode !== 'ai') return null;

  /*
   * The box searches the chats the app has actually seen.
   *
   * It used to be a plain pattern field with eight of the most recent chats
   * under it, which is fine only if the chat you want is one of those eight -
   * and the one you want to block is usually a group you have stopped reading,
   * so it is not. Typing now filters every chat on record by name, and pressing
   * Block still blocks exactly what was typed, so a chat that has never sent a
   * message can be blocked before it does.
   */
  const query = value.trim().toLowerCase();
  const blockedSet = new Set(blocked.map((b) => b.pattern.toLowerCase()));
  const available = recent.filter(
    (c) => c.chat_name && !blockedSet.has(c.chat_name.toLowerCase())
  );

  const matches = query
    ? available
      .filter((c) => c.chat_name.toLowerCase().includes(query))
      // When searching, the loudest match first: that is the one worth blocking.
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 12)
    : available.slice(0, 8);

  return (
    <section className="panel-block">
      <button className="link block-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Manage'} blocked chats{blocked.length ? ` (${blocked.length})` : ''}
      </button>

      {open && (
        <div className="block-body">
          <p className="hint">
            Chats listed here are never read and never stored. Part of a name is enough.
            Blocking a <b>group</b> blocks the whole group — nothing anybody writes in it
            is read.
          </p>

          <form
            className="add-row"
            onSubmit={(event) => {
              event.preventDefault();
              add(value);
            }}
          >
            <input
              className="grow"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Search a chat, or type a name or number…"
              autoComplete="off"
            />
            <button className="btn primary" type="submit" disabled={!value.trim()}>
              Block
            </button>
          </form>

          {blocked.length > 0 && (
            <ul className="chip-list">
              {blocked.map((b) => (
                <li key={b.id} className="chip">
                  {b.pattern}
                  <button className="chip-x" onClick={() => remove(b.id)} aria-label={`Unblock ${b.pattern}`}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {matches.length > 0 && (
            <>
              <p className="hint">
                {query
                  ? `${matches.length} chat${matches.length === 1 ? '' : 's'} match — tap to block:`
                  : 'Recent chats — tap to block:'}
              </p>
              <ul className="chip-list">
                {matches.map((c) => (
                  <li key={c.chat_id}>
                    <button className="chip ghost" onClick={() => add(c.chat_name)}>
                      {c.chat_name}
                      {/* Which of these is a group matters here more than anywhere
                          else: blocking one silences every person in it. */}
                      {Boolean(c.is_group) && <span className="chip-tag">group</span>}
                      <span className="chip-count">{c.messages}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/*
            * Nothing matched, which is not a dead end: the name is still
            * blockable. A chat that has never sent a message is not on this
            * list and is exactly the one you would want to block in advance.
            */}
          {query && matches.length === 0 && (
            <p className="hint">
              No chat on record matches “{value.trim()}”. Press <b>Block</b> to block that
              name anyway — anything containing it is then never read.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
