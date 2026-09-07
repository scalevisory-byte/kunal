import { useMemo, useState } from 'react';
import TaskItem from './TaskItem.jsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const isoOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The date a task sits on: its deadline if it has one, else its plain due date. */
const dayOf = (task) => {
  if (task.due_at) return isoOf(new Date(task.due_at));
  return task.due_date || null;
};

/**
 * A month, as the page rather than a widget in the rail.
 *
 * Every figure comes from the loaded tasks - a day shows the work actually on
 * it, and a day with nothing says so rather than displaying a zero.
 */
export default function CalendarPage({
  tasks, onOpen, onToggle, onStatus, onQuickDate, onDelete, onNotATask,
}) {
  const today = isoOf(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [picked, setPicked] = useState(today);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // Grouped once: the grid and the day list read the same map.
  const byDay = useMemo(() => {
    const map = new Map();
    for (const task of tasks) {
      const day = dayOf(task);
      if (!day) continue;
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(task);
    }
    return map;
  }, [tasks]);

  const cells = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Monday-first, matching how a working week is read here.
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const out = [];
    for (let i = 0; i < lead; i += 1) out.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const items = byDay.get(iso) || [];
      out.push({
        iso,
        day,
        total: items.length,
        open: items.filter((t) => t.status !== 'done').length,
        overdue: items.filter((t) => t.status !== 'done' && iso < today).length,
      });
    }
    return out;
  }, [year, month, byDay, today]);

  const undated = useMemo(() => tasks.filter((t) => !dayOf(t) && t.status !== 'done'), [tasks]);
  const chosen = byDay.get(picked) || [];
  const monthName = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const shift = (delta) => {
    const next = new Date(year, month + delta, 1);
    setCursor(next);
    // Keep the selection inside the month being looked at.
    setPicked(isoOf(new Date(next.getFullYear(), next.getMonth(), 1)));
  };

  const label = (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString([], {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });

  return (
    <div className="cal-page">
      <div className="cal-sheet">
        <header className="cal-head">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <strong>{monthName}</strong>
          <div className="cal-head-right">
            <button
              className="btn small ghost"
              onClick={() => {
                const now = new Date();
                setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                setPicked(today);
              }}
            >
              Today
            </button>
            <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">
              ›
            </button>
          </div>
        </header>

        <div className="cal-grid" role="grid">
          {WEEKDAYS.map((d) => <span key={d} className="cal-dow">{d}</span>)}
          {cells.map((cell, index) => {
            if (!cell) return <span key={`pad-${index}`} className="cal-cell empty" />;
            const classes = [
              'cal-cell',
              cell.iso === today ? 'today' : '',
              cell.iso === picked ? 'picked' : '',
              cell.overdue > 0 ? 'has-late' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={cell.iso}
                type="button"
                className={classes}
                aria-pressed={cell.iso === picked}
                onClick={() => setPicked(cell.iso)}
              >
                <span className="cal-num">{cell.day}</span>
                {cell.open > 0 && <span className="cal-count">{cell.open}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <section className="cal-day">
        <header>
          <h3>{label(picked)}</h3>
          <span>
            {chosen.length === 0
              ? 'Nothing scheduled'
              : `${chosen.length} task${chosen.length === 1 ? '' : 's'}`}
          </span>
        </header>

        {chosen.length === 0 ? (
          <p className="cal-empty">No work is due on this day.</p>
        ) : (
          <ul className="task-list">
            {chosen.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onOpen={onOpen}
                onStatus={onStatus}
                onQuickDate={onQuickDate}
                onDelete={onDelete}
                onNotATask={onNotATask}
              />
            ))}
          </ul>
        )}

        {undated.length > 0 && (
          <p className="cal-undated">
            {undated.length === 1
              ? 'One open task carries no date at all, so it appears on no day here.'
              : `${undated.length} open tasks carry no date at all, so they appear on no day here.`}
          </p>
        )}
      </section>
    </div>
  );
}
