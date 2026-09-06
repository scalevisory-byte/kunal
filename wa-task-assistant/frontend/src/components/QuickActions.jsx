import Icon from './Icon.jsx';

/**
 * Shortcuts into views that already exist. Each one sets the same state the
 * sidebar and toolbar do, so nothing here is a second way of doing something.
 */
export default function QuickActions({ counts, onAction, active, onNewTask }) {
  const actions = [
    { key: 'myday', label: 'My Day', icon: 'sun', tone: 'warn' },
    { key: 'high', label: 'High Priority', icon: 'flag', tone: 'danger', count: counts.highOpen },
    { key: 'chat', label: 'WhatsApp Tasks', icon: 'whatsapp', tone: 'ok' },
    { key: 'ai', label: 'AI Tasks', icon: 'robot', tone: 'info' },
    { key: 'done', label: 'Completed', icon: 'check', tone: 'ok', count: counts.done },
  ];

  return (
    <section className="quick">
      <h3 className="quick-title">Quick actions</h3>
      <div className="quick-row">
        <button className="qa primary" onClick={onNewTask}>
          <Icon name="plus" size={17} />
          New Task
        </button>
        {actions.map((a) => (
          <button
            key={a.key}
            className={`qa t-${a.tone} ${active === a.key ? 'on' : ''}`}
            aria-pressed={active === a.key}
            onClick={() => onAction(a.key)}
          >
            <Icon name={a.icon} size={17} />
            {a.label}
            {a.count > 0 && <span className="qa-count">{a.count}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
