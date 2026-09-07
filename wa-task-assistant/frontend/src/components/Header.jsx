import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { resolvedTheme } from '../lib/theme.js';
import { formatWaNumber, initialOf } from '../lib/task.js';

/** Which WhatsApp account this dashboard is reading. Identity, not a control. */
function Account({ wa, onSettings }) {
  const number = formatWaNumber(wa?.me);
  const connected = wa?.status === 'ready';

  const linked = Boolean(number || wa?.meName);

  /*
   * The account's name and number only arrive with the `ready` event, so
   * between accepting a login and finishing the sync there is nothing to show.
   * It used to say "Not linked" through all of that - which is wrong, and sends
   * you looking for a QR code that is not there. Say what is actually true.
   */
  const syncing = !linked && wa?.status === 'authenticated';

  return (
    <button
      className={`account ${linked ? (connected ? 'on' : 'off') : syncing ? 'off' : 'pending'}`}
      title={
        linked
          ? `${wa?.meName || 'WhatsApp'} · ${number || 'number unknown'} · ${connected ? 'connected' : 'not connected'}`
          : syncing
            ? 'Logged in, still syncing your chats'
            : 'No WhatsApp account is linked yet'
      }
      onClick={onSettings}
    >
      <span className="avatar">{linked ? initialOf(wa?.meName, wa?.me) : syncing ? '⋯' : '·'}</span>
      <span className="account-text">
        <strong>{linked ? wa?.meName?.split(' ')[0] || 'WhatsApp' : syncing ? 'Syncing' : 'Not linked'}</strong>
        <small>{linked ? number || '—' : syncing ? 'Logged in' : 'Open settings'}</small>
      </span>
      <Icon name="chevronDown" size={15} className="account-chevron" />
    </button>
  );
}

/** Brand, search and the actions that apply to the whole page. */
export default function Header({
  query, onQuery, onRefresh, loading, onNewTask, onEnablePush, pushSupported, pushOn, wa, install,
  onSettings, onMenu, alerts, onBell, onThemeChange,
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
        <button
          className="icon-action"
          onClick={onBell}
          title={alerts > 0 ? `${alerts} unread` : 'Notifications'}
          aria-label="Notifications"
        >
          <Icon name="bell" size={19} />
          {alerts > 0 && <span className="ping" />}
        </button>
        {pushSupported && !pushOn && (
          <button className="btn ghost" onClick={onEnablePush} title="Enable browser notifications">
            Enable alerts
          </button>
        )}
        {install?.canPrompt && (
          <button className="btn ghost" onClick={install.install} title="Install as an app">
            Install
          </button>
        )}
        {/*
          * Straight to the other one. Settings has the three-way choice,
          * including "match my device"; this is the one people reach for when
          * the room gets dark, and making them go two levels in for it is the
          * reason theme switches go unused.
          */}
        <button
          className="icon-action"
          onClick={() => onThemeChange(resolvedTheme() === 'dark' ? 'light' : 'dark')}
          title={resolvedTheme() === 'dark' ? 'Switch to light' : 'Switch to dark'}
          aria-label={resolvedTheme() === 'dark' ? 'Switch to light' : 'Switch to dark'}
        >
          <Icon name={resolvedTheme() === 'dark' ? 'sun' : 'moon'} size={19} />
        </button>
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
