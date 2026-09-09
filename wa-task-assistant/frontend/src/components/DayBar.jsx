import Icon from './Icon.jsx';
import { isoDay, todayIso } from '../lib/task.js';

/**
 * Which day of work to show, on a list that is already about days.
 *
 * Two questions, one control. On the task lists it means "what is due then" -
 * All, Today, Tomorrow, or a date. On Completed it means "what did I close
 * then" - All, Today, Yesterday, or a date. Same shape, same press, and the
 * word that differs is the one that is genuinely different: nothing is ever
 * due yesterday and nothing is ever completed tomorrow.
 *
 * The count is of what is on screen, so the number and the list always agree.
 */
export default function DayBar({ mode = 'due', day, onDay: pick, count }) {
  const done = mode === 'done';
  const today = todayIso();
  // Completed work looks backwards; a deadline looks forwards.
  const other = isoDay(done ? -1 : 1);

  const chips = [
    { key: null, label: 'All' },
    { key: today, label: 'Today' },
    { key: other, label: done ? 'Yesterday' : 'Tomorrow' },
  ];
  // A day chosen in the picker that is neither of the two shortcuts gets its
  // own chip, so the page always shows which day it is answering for.
  const picked = day && day !== today && day !== other ? day : null;

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
        {picked && (
          <button className="chip on" aria-pressed="true" onClick={() => pick(null)}>
            {pretty(picked)} <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      <label className="donebar-pick">
        <Icon name="calendar" size={15} />
        <span className="sr-only">Pick a day</span>
        <input
          type="date"
          value={day || ''}
          /* A deadline can be any day; work can only have been finished by now. */
          max={done ? today : undefined}
          onChange={(e) => pick(e.target.value || null)}
        />
      </label>

      {/*
        * With no day chosen it is just the count: calling all of them "due"
        * would be untrue, since plenty have no deadline at all.
        */}
      <span className="donebar-count">
        {count} {count === 1 ? 'task' : 'tasks'}
        {day && ` ${done ? 'finished' : 'due'} ${
          day === today ? 'today'
            : day === other ? (done ? 'yesterday' : 'tomorrow')
              : `on ${pretty(day)}`
        }`}
      </span>
    </div>
  );
}
