import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { readableName } from '../lib/task.js';

/**
 * The messages the app has read, and what each one produced.
 *
 * "Why did this message not become a task?" has two answers that look
 * identical from outside — it never arrived, or it arrived and nothing was
 * made of it — and until now neither of us could tell which. Every round of
 * "still not working" was spent guessing between them.
 *
 * So it is a lookup instead. Find the message; if it is not here it never
 * reached the app, which is a connection problem. If it is here with nothing
 * beside it, it arrived and Claude did not think it was a task, which is a
 * wording problem and a different fix entirely.
 */
const when = (value) => {
  if (!value) return '';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const today = at.toLocaleDateString('en-CA') === new Date().toLocaleDateString('en-CA');
  return at.toLocaleString([], {
    hour: 'numeric', minute: '2-digit',
    ...(today ? {} : { day: 'numeric', month: 'short' }),
  });
};

export default function MessagesRead({ mode, onError }) {
  const [messages, setMessages] = useState(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setMessages((await api.messagesRead(80)).messages);
    } catch (err) {
      onError(err);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const q = query.trim().toLowerCase();
  const shown = (messages || []).filter(
    (m) => !q || [m.body, m.chat_name, m.contact_name].some((f) => String(f || '').toLowerCase().includes(q))
  );

  return (
    <section className="settings-block">
      <header className="settings-head">
        <h3>Messages read</h3>
        <span>
          {messages ? `${messages.length} most recent` : 'Loading…'}
          <button className="link" onClick={load} style={{ marginLeft: 10 }}>Refresh</button>
        </span>
      </header>

      <p className="confirm-lede">
        Every message the app has taken in, newest first, and what it became. If a message
        you expected is <b>not here at all</b>, it never reached the app. If it is here with
        nothing beside it, it arrived and Claude did not read a task in it — a different
        problem with a different fix.
      </p>

      {mode === 'manual' && (
        <p className="field-note">
          Capture is set to <b>manual</b>, so other people's messages are never stored. Only
          what you write yourself, or forward to your own chat, can appear here.
        </p>
      )}

      <label className="field">
        <span className="sr-only">Find a message</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a message — a word from it, a chat, a name"
        />
      </label>

      {messages && shown.length === 0 && (
        <p className="field-note">
          {q ? 'No message read so far contains that.' : 'Nothing has been read yet.'}
        </p>
      )}

      <ul className="msg-log">
        {shown.map((m) => (
          <li key={m.id} className={m.tasks?.length || m.merged ? 'made' : ''}>
            <div className="msg-head">
              <b>{m.from_me ? 'You' : readableName(m.contact_name || m.contact_number || 'unknown')}</b>
              {m.chat_name && <span className="msg-chat">{readableName(m.chat_name)}</span>}
              {m.is_group ? <span className="msg-tag">group</span> : null}
              <span className="msg-when">{when(m.sent_at)}</span>
            </div>
            <p className="msg-body">{m.body}</p>
            {m.tasks?.length ? (
              m.tasks.map((t) => (
                <p className="msg-out" key={t.id}>
                  → <b>{t.title}</b>
                  {t.assigned_to ? ` · given to ${readableName(t.assigned_to)}` : ''}
                  {t.archived_at ? ' · archived' : t.status === 'done' ? ' · done' : ''}
                </p>
              ))
            ) : m.merged ? (
              <p className="msg-out">
                → <b>{m.merged.title}</b>
                <span className="muted"> · already on the list, so nothing new was made</span>
              </p>
            ) : (
              <p className="msg-out"><span className="muted">no task was made from this</span></p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
