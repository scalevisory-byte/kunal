import Icon from './Icon.jsx';

/**
 * The four figures that decide what to do next. Each is a view, and each
 * carries one line of context so the number means something on its own.
 */
export default function StatBoard({ counts, view, onPick }) {
  const cells = [
    {
      key: 'open',
      tone: 'info',
      icon: 'clipboard',
      label: 'Open',
      value: counts.open,
      note: counts.open === 0 ? 'Nothing outstanding' : `${counts.dueToday} due today`,
    },
    {
      key: 'in_progress',
      tone: 'warn',
      icon: 'play',
      label: 'In Progress',
      value: counts.inProgress,
      note: counts.inProgress === 0 ? 'Nothing currently active' : 'Being worked on',
    },
    {
      key: 'overdue',
      tone: 'danger',
      icon: 'alert',
      label: 'Overdue',
      value: counts.overdue,
      note: counts.overdue === 0 ? "You're all caught up" : 'Needs attention',
    },
    {
      key: 'done',
      tone: 'ok',
      icon: 'check',
      label: 'Done',
      value: counts.done,
      note: `${counts.completedToday} completed today`,
    },
  ];

  return (
    <section className="kpis" aria-label="Task summary">
      {cells.map((cell) => (
        <button
          key={cell.key}
          type="button"
          className={`kpi t-${cell.tone} ${view === cell.key ? 'picked' : ''}`}
          aria-pressed={view === cell.key}
          onClick={() => onPick(view === cell.key ? 'all' : cell.key)}
        >
          <span className="kpi-icon"><Icon name={cell.icon} size={20} /></span>
          <span className="kpi-body">
            <span className="kpi-num">{cell.value}</span>
            <span className="kpi-label">{cell.label}</span>
            <span className="kpi-note">{cell.note}</span>
          </span>
        </button>
      ))}
    </section>
  );
}
