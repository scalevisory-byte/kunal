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

  const blockedSet = new Set(blocked.map((b) => b.pattern.toLowerCase()));
  const suggestions = recent
    .filter((c) => c.chat_name && !blockedSet.has(c.chat_name.toLowerCase()))
    .slice(0, 8);

  return (
    <section className="panel-block">
      <button className="link block-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Manage'} blocked chats{blocked.length ? ` (${blocked.length})` : ''}
      </button>

      {open && (
        <div className="block-body">
          <p className="hint">
            Chats listed here are never read and never stored. Part of a name is enough.
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
              placeholder="Name or number to block…"
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

          {suggestions.length > 0 && (
            <>
              <p className="hint">Recent chats — tap to block:</p>
              <ul className="chip-list">
                {suggestions.map((c) => (
                  <li key={c.chat_id}>
                    <button className="chip ghost" onClick={() => add(c.chat_name)}>
                      {c.chat_name} <span className="chip-count">{c.messages}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
