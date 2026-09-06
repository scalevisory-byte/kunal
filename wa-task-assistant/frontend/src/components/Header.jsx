import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { formatWaNumber, initialOf } from '../lib/task.js';

/** Which WhatsApp account this dashboard is reading. Identity, not a control. */
function Account({ wa, onSettings }) {
  const number = formatWaNumber(wa?.me);
  const connected = wa?.status === 'ready';

  const linked = Boolean(number || wa?.meName);

  return (
    <button
      className={`account ${linked ? (connected ? 'on' : 'off') : 'pending'}`}
      title={
        linked
          ? `${wa?.meName || 'WhatsApp'} · ${number || 'number unknown'} · ${connected ? 'connected' : 'not connected'}`
          : 'No WhatsApp account is linked yet'
      }
      onClick={onSettings}
    >
      <span className="avatar">{linked ? initialOf(wa?.meName, wa?.me) : '·'}</span>
      <span className="account-text">
        <strong>{linked ? wa?.meName?.split(' ')[0] || 'WhatsApp' : 'Not linked'}</strong>
        <small>{linked ? number || '—' : 'Open settings'}</small>
      </span>
      <Icon name="chevronDown" size={15} className="account-chevron" />
    </button>
  );
}

/** Brand, search and the actions that apply to the whole page. */
export default function Header({
  query, onQuery, onRefresh, loading, onNewTask, onEnablePush, pushSupported, pushOn, wa, install,
  onSettings, onMenu, alerts,
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
      <button className="menu-btn" onClick={onMenu} aria-label="Open sections">
        <Icon name="list" size={20} />
      </button>

      <div className="topbar-search">
        <Icon name="search" size={17} className="search-icon" />
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
        {pushSupported && !pushOn && (
          <button
            className={`icon-action ${alerts ? 'flagged' : ''}`}
            onClick={onEnablePush}
            title="Enable browser notifications"
            aria-label="Enable browser notifications"
          >
            <Icon name="bell" size={19} />
            {alerts > 0 && <span className="ping" />}
          </button>
        )}
        {install?.canPrompt && (
          <button className="btn ghost" onClick={install.install} title="Install as an app">
            Install
          </button>
        )}
        <button
          className="icon-action"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
        >
          <Icon name="refresh" size={19} className={loading ? 'spin' : ''} />
        </button>
        <Account wa={wa} onSettings={onSettings} />
      </div>
    </header>
  );
}
