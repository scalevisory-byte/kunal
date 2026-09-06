/** Answers "what needs me right now?" before any list is read. Each cell is a view. */
export default function StatBoard({ stats, overdueCount, view, onPick }) {
  const cells = [
    { key: 'open', label: 'open', value: stats?.open ?? 0 },
    { key: 'in_progress', label: 'in progress', value: stats?.in_progress ?? 0 },
    { key: 'overdue', label: 'overdue', value: overdueCount, tone: overdueCount > 0 ? 'alert' : '' },
    { key: 'done', label: 'done', value: stats?.done ?? 0, tone: (stats?.done ?? 0) > 0 ? 'good' : '' },
  ];

  return (
    <section className="board" aria-label="Task summary">
      {cells.map((cell) => (
        <button
          key={cell.key}
          type="button"
          className={`board-cell ${cell.tone || ''} ${view === cell.key ? 'picked' : ''}`}
          aria-pressed={view === cell.key}
          onClick={() => onPick(view === cell.key ? 'all' : cell.key)}
        >
          <span className="board-num">{cell.value}</span>
          <span className="board-label">{cell.label}</span>
        </button>
      ))}
    </section>
  );
}
