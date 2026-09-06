/**
 * Today's work: what was due today, plus what was finished today. With neither,
 * there is nothing to measure, so it says so instead of showing an empty bar.
 */
export default function Progress({ progress, completedToday, todayTotal }) {
  if (progress === null) {
    return (
      <div className="progress">
        <div className="progress-head">
          <span className="rail-title">Today's progress</span>
        </div>
        <p className="rail-empty">No tasks scheduled for today.</p>
      </div>
    );
  }

  return (
    <div className="progress">
      <div className="progress-head">
        <span className="rail-title">Today's progress</span>
        <span className="progress-pct">{progress}%</span>
      </div>
      <div
        className="bar"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Today's progress"
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="rail-note">
        {completedToday} of {todayTotal} {todayTotal === 1 ? 'task' : 'tasks'} completed
      </p>
    </div>
  );
}
