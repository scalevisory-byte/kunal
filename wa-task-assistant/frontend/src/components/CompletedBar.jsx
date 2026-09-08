import Icon from './Icon.jsx';
import { isoDay, todayIso } from '../lib/task.js';

/**
 * Which day's finished work to show.
 *
 * "What did I actually close today?" is the question this page gets asked, and
 * a single list of everything ever finished cannot answer it - by the second
 * week the day you want is a hundred rows down. Today and yesterday are the
 * two asked for most, so they are one press each; any other day is the picker.
 *
 * The count is of what is on screen, so the number and the list always agree.
 */
export default function CompletedBar({ day, onDay: pick, count }) {
  const today = todayIso();
  const yesterday = isoDay(-1);

  const chips = [
    { key: null, label: 'All' },
    { key: today, label: 'Today' },
    { key: yesterday, label: 'Yesterday' },
  ];
  // A day chosen in the picker that is neither of the two shortcuts gets its
  // own chip, so the page always shows which day it is answering for.
  const other = day && day !== today && day !== yesterday ? day : null;

  const pretty = (iso) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="donebar">
      <div className="donebar-chips" role="group" aria-label="Which day">
        {chips.map((c) => (
          <button
            key={c.label}
            className={`chip ${day === c.key ? 'on' : ''}`}
            aria-pressed={day === c.key}
            onClick={() => pick(c.key)}
          >
            {c.label}
          </button>
        ))}
        {other && (
          <button className="chip on" aria-pressed="true" onClick={() => pick(null)}>
            {pretty(other)} <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      <label className="donebar-pick">
        <Icon name="calendar" size={15} />
        <span className="sr-only">Pick a day</span>
        <input
          type="date"
          value={day || ''}
          max={today}
          onChange={(e) => pick(e.target.value || null)}
        />
      </label>

      <span className="donebar-count">
        {count} {count === 1 ? 'task' : 'tasks'}
        {day ? ` finished ${day === today ? 'today' : day === yesterday ? 'yesterday' : `on ${pretty(day)}`}` : ' finished'}
      </span>
    </div>
  );
}
