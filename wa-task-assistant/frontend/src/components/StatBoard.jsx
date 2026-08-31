/** Answers "what needs me right now?" before any list is read. */
export default function StatBoard({ stats, overdueCount }) {
  const open = stats?.open ?? 0;
  const done = stats?.done ?? 0;

  return (
    <section className="board" aria-label="Task summary">
      <div className="board-cell">
        <span className="board-num">{open}</span>
        <span className="board-label">open</span>
      </div>
      <div className={`board-cell ${overdueCount > 0 ? 'alert' : ''}`}>
        <span className="board-num">{overdueCount}</span>
        <span className="board-label">overdue</span>
      </div>
      <div className={`board-cell ${done > 0 ? 'good' : ''}`}>
        <span className="board-num">{done}</span>
        <span className="board-label">done</span>
      </div>
    </section>
  );
}
