/**
 * The figures that decide what to do next. Each one is a view: pressing it
 * filters the list below to exactly what it counts, and pressing it again
 * clears that.
 *
 * Five now, because "what came in today" is a question the dashboard could not
 * answer - the intake is a different thing from what is due, and on a day when
 * thirty messages become tasks that is the number worth seeing.
 *
 * Five small tinted boxes. They used to be white cards with borders, shadows
 * and an icon each - a lot of furniture for a number, and the furniture was
 * what you saw first. The tint does the work the border and the icon were
 * doing, in less room: each state has its own colour, so the row is read by
 * colour before it is read by word, and overdue is findable without looking.
 * Two lines each, 46px, against 78 for the cards.
 */
export default function StatBoard({ counts, view, onPick }) {
  const cells = [
    {
      key: 'open',
      tone: 'info',
      label: 'Open',
      value: counts.open,
      note: counts.open === 0 ? 'Nothing outstanding' : `${counts.dueToday} due today`,
    },
    {
      key: 'in_progress',
      tone: 'warn',
      label: 'In Progress',
      value: counts.inProgress,
      note: counts.inProgress === 0 ? 'Nothing active' : 'Being worked on',
    },
    {
      key: 'overdue',
      tone: 'danger',
      label: 'Overdue',
      value: counts.overdue,
      note: counts.overdue === 0 ? "You're all caught up" : 'Needs attention',
    },
    {
      key: 'done',
      tone: 'ok',
      label: 'Done',
      value: counts.done,
      note: `${counts.completedToday} completed today`,
    },
    {
      key: 'added_today',
      tone: 'brand',
      label: 'Added today',
      value: counts.addedToday,
      note: counts.addedToday === 0
        ? 'Nothing new yet'
        : `${counts.aiCreatedToday} from WhatsApp`,
    },
  ];

  return (
    <section className="kpis tint" aria-label="Task summary">
      {cells.map((cell) => (
        <button
          key={cell.key}
          type="button"
          className={`kpi t-${cell.tone} ${view === cell.key ? 'picked' : ''}`}
          aria-pressed={view === cell.key}
          onClick={() => onPick(view === cell.key ? 'all' : cell.key)}
        >
          <span className="kpi-num">{cell.value}</span>
          <span className="kpi-label">{cell.label}</span>
          <span className="kpi-note">{cell.note}</span>
        </button>
      ))}
    </section>
  );
}
