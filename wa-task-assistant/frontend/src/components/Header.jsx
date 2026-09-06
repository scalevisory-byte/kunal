import { useEffect, useRef } from 'react';
import { formatWaNumber, initialOf } from '../lib/task.js';

/** Which WhatsApp account this dashboard is reading. Identity, not a control. */
function Account({ wa }) {
  const number = formatWaNumber(wa?.me);
  const connected = wa?.status === 'ready';

  if (!number && !wa?.meName) {
    return (
      <div className="account pending" title="No WhatsApp account is linked yet">
        <span className="avatar">·</span>
        <span className="account-text">
          <strong>Not linked</strong>
          <small>Scan the QR to connect</small>
        </span>
      </div>
    );
  }

  return (
    <div
      className={`account ${connected ? 'on' : 'off'}`}
      title={connected ? 'WhatsApp connected' : 'WhatsApp not connected'}
    >
      <span className="avatar">{initialOf(wa?.meName, wa?.me)}</span>
      <span className="account-text">
        <strong>{wa?.meName || 'WhatsApp'}</strong>
        <small>{number || '—'}</small>
      </span>
    </div>
  );
}

/** Brand, search and the actions that apply to the whole page. */
export default function Header({
  query, onQuery, onRefresh, loading, onNewTask, onEnablePush, pushSupported, pushOn, wa, install,
}) {
  const search = useRef(null);

  // Ctrl/Cmd + K puts the cursor in search, as it does in every tool like this.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <h1>WA Tasks</h1>
        <p>Task management</p>
      </div>

      <div className="topbar-search">
        <input
          ref={search}
          type="search"
          value={query}
          placeholder="Search tasks, chats or notes…"
          aria-label="Search tasks, chats or notes"
          onChange={(event) => onQuery(event.target.value)}
        />
        <kbd>Ctrl K</kbd>
      </div>

      <div className="topbar-actions">
        <Account wa={wa} />
        {pushSupported && !pushOn && (
          <button className="btn ghost" onClick={onEnablePush} title="Enable browser notifications">
            Notifications
          </button>
        )}
        {install?.canPrompt && (
          <button className="btn ghost" onClick={install.install} title="Install as an app">
            Install
          </button>
        )}
        <button className="btn ghost" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
        <button className="btn primary" onClick={onNewTask}>
          New task
        </button>
      </div>
    </header>
  );
}
