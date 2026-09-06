/**
 * On a phone the page is long, so the views live in a fixed bar at the bottom
 * where a thumb reaches them. It is the same state the tabs above drive.
 */
export default function MobileNav({ view, onView, onNewTask, onSummary }) {
  const tabs = [
    { key: 'myday', label: 'My day' },
    { key: 'open', label: 'Open' },
  ];
  const rest = [
    { key: 'all', label: 'All' },
    { key: 'summary', label: 'Summary' },
  ];

  const Tab = ({ tab }) => (
    <button
      key={tab.key}
      className={`mnav-tab ${view === tab.key ? 'on' : ''}`}
      aria-pressed={view === tab.key}
      onClick={() => (tab.key === 'summary' ? onSummary() : onView(tab.key))}
    >
      {tab.label}
    </button>
  );

  return (
    <nav className="mnav" aria-label="Views">
      {tabs.map((tab) => <Tab key={tab.key} tab={tab} />)}
      <button className="mnav-add" onClick={onNewTask} aria-label="New task">+</button>
      {rest.map((tab) => <Tab key={tab.key} tab={tab} />)}
    </nav>
  );
}
