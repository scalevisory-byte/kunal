import { Fragment } from 'react';
import Icon from './Icon.jsx';

/** Grouped so the list reads as three short lists rather than one long one. */
const NAV = [
  {
    label: 'Workspace',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { key: 'myday', label: 'My Day', icon: 'sun' },
      { key: 'all', label: 'All Tasks', icon: 'list' },
      { key: 'attention', label: 'Needs Attention', icon: 'alert' },
      { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    ],
  },
  {
    label: 'Organise',
    items: [
      { key: 'chat', label: 'By Chat', icon: 'chat' },
      { key: 'ai', label: 'AI Tasks', icon: 'robot' },
      { key: 'done', label: 'Completed', icon: 'check' },
      { key: 'history', label: 'Work History', icon: 'clipboard' },
    ],
  },
  {
    label: 'Automation',
    items: [
      // The reminder and follow-up engine is the heart of this thing; it was
      // buried at the top of Settings, under the connection panel.
      { key: 'reminders', label: 'Reminders', icon: 'bell' },
      { key: 'templates', label: 'Templates', icon: 'flag' },
      { key: 'groups', label: 'Manage groups', icon: 'settings' },
    ],
  },
  {
    label: 'System',
    afterBusinesses: true,
    items: [
      { key: 'usage', label: 'AI Usage', icon: 'clipboard' },
      { key: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

/** The application's spine: where you are, and the one fact that matters below. */
export default function Sidebar({ section, onSection, connected, open, onClose, groups = [] }) {
  return (
    <>
      <div className={`scrim ${open ? 'on' : ''}`} onClick={onClose} role="presentation" />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Sections">
        <div className="side-brand">
          <span className="side-mark"><Icon name="whatsapp" size={20} /></span>
          <span className="side-name">
            <strong>WA Tasks</strong>
            <small>Task management</small>
          </span>
        </div>

        <nav className="side-nav">
          {NAV.map((group) => (
            <Fragment key={group.label}>
              {/* The businesses sit with the work, above the housekeeping. */}
              {group.afterBusinesses && groups.length > 0 && (
                <div className="side-group">
                  <p className="side-group-label">Businesses</p>
                  {groups.map((g) => {
                    const key = `group:${g.id}`;
                    return (
                      <button
                        key={key}
                        className={`side-item ${section === key ? 'on' : ''}`}
                        aria-current={section === key ? 'page' : undefined}
                        onClick={() => { onSection(key); onClose(); }}
                      >
                        <span className={`group-dot c-${g.colour}`} aria-hidden="true" />
                        <span className="side-item-name">{g.name}</span>
                        {g.counts?.open > 0 && <span className="side-count">{g.counts.open}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            <div className="side-group">
              <p className="side-group-label">{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  className={`side-item ${section === item.key ? 'on' : ''}`}
                  aria-current={section === item.key ? 'page' : undefined}
                  onClick={() => { onSection(item.key); onClose(); }}
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                </button>
              ))}
            </div>
            </Fragment>
          ))}
        </nav>

        <div className="side-foot">
          <p className="side-motto">Stay organised<br />Do more</p>
          <p className={`side-state ${connected ? 'on' : 'off'}`}>
            <span className="state-dot" />
            {connected ? 'Connected via WhatsApp' : 'WhatsApp not connected'}
          </p>
        </div>
      </aside>
    </>
  );
}
