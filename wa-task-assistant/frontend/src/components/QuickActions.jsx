import Icon from './Icon.jsx';

/**
 * Shortcuts into views that already exist.
 *
 * Each one sets the same state the sidebar and toolbar do, so nothing here is
 * a second way of doing something. Two things it deliberately does not do any
 * more: carry its own New Task button — the primary action already sits in the
 * page header three inches above, and one screen with two of the same button
 * makes neither read as the one to press — and colour its icons by "tone".
 * These are destinations, not states; spending the status palette on
 * navigation leaves nothing left to say a task is actually overdue.
 */
export default function QuickActions({ counts, onAction, active }) {
  const actions = [
    { key: 'myday', label: 'My Day', icon: 'sun' },
    { key: 'high', label: 'High Priority', icon: 'flag', count: counts.highOpen },
    { key: 'chat', label: 'By Chat', icon: 'chat' },
    { key: 'ai', label: 'AI Tasks', icon: 'robot' },
    { key: 'done', label: 'Completed', icon: 'check', count: counts.done },
  ];

  return (
    <section className="quick" aria-label="Jump to">
      <span className="quick-title">Jump to</span>
      {actions.map((a) => (
        <button
          key={a.key}
          className={`qa ${active === a.key ? 'on' : ''}`}
          aria-pressed={active === a.key}
          onClick={() => onAction(a.key)}
        >
          <Icon name={a.icon} size={15} />
          {a.label}
          {a.count > 0 && <span className="qa-count">{a.count}</span>}
        </button>
      ))}
    </section>
  );
}
