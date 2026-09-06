import Icon from './Icon.jsx';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'myday', label: 'My Day', icon: 'sun' },
  { key: 'all', label: 'All Tasks', icon: 'list' },
  { key: 'chat', label: 'By Chat', icon: 'chat' },
  { key: 'ai', label: 'AI Tasks', icon: 'robot' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'done', label: 'Completed', icon: 'check' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

/** The application's spine: where you are, and the one fact that matters below. */
export default function Sidebar({ section, onSection, connected, open, onClose }) {
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
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`side-item ${section === item.key ? 'on' : ''}`}
              aria-current={section === item.key ? 'page' : undefined}
              onClick={() => { onSection(item.key); onClose(); }}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
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
