import Icon from './Icon.jsx';

/**
 * The figures that decide what to do next. Each one is a view: pressing it
 * filters the list below to exactly what it counts, and pressing it again
 * clears that.
 *
 * Five now, because "what came in today" is a question the dashboard could not
 * answer - the intake is a different thing from what is due, and on a day when
 * thirty messages become tasks that is the number worth seeing.
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
      note: counts.inProgress === 0 ? 'Nothing active' : 'Being worked on',
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
    {
      key: 'added_today',
      tone: 'info',
      icon: 'inbox',
      label: 'Added today',
      value: counts.addedToday,
      note: counts.addedToday === 0
        ? 'Nothing new yet'
        : `${counts.aiCreatedToday} from WhatsApp`,
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
          <span className="kpi-top">
            <span className="kpi-label">{cell.label}</span>
            <Icon name={cell.icon} size={14} className="kpi-icon" />
          </span>
          <span className="kpi-num">{cell.value}</span>
          <span className="kpi-note">{cell.note}</span>
        </button>
      ))}
    </section>
  );
}
