/**
 * Shortcuts into views that already exist. Each one sets the same state the
 * toolbar does, so nothing here is a second way of doing something.
 */
export default function QuickActions({ counts, onAction, active }) {
  const actions = [
    { key: 'myday', label: 'My day', count: null },
    { key: 'high', label: 'High priority', count: counts.highOpen },
    { key: 'chat', label: 'By chat', count: null },
    { key: 'ai', label: 'AI-created', count: null },
    { key: 'done', label: 'Completed', count: counts.done },
  ];

  return (
    <nav className="quick-actions" aria-label="Quick actions">
      {actions.map((a) => (
        <button
          key={a.key}
          className={`qa ${active === a.key ? 'on' : ''}`}
          aria-pressed={active === a.key}
          onClick={() => onAction(a.key)}
        >
          {a.label}
          {a.count > 0 && <span className="qa-count">{a.count}</span>}
        </button>
      ))}
    </nav>
  );
}
