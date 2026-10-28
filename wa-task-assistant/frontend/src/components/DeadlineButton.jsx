import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The deadline, set from the row - on Task allotted and in the All Tasks
 * table, one component for both.
 *
 * The automatic reminder hangs off the deadline. The engine's pass reads
 * `tasksWithDeadlines()`, a task with neither `due_at` nor `due_date` is not
 * in it, so no reminder and no follow-up is ever built for it. That is why
 * the deadline is the control that sets it rather than a fact printed on the
 * row: setting one IS starting the follow-up engine for that task.
 *
 * Asked first as *"hua abhi auto kese hoga"* on Task allotted, and then as
 * *"due date and followup engine kese add karna he"* over the table, whose Due
 * column read "No date" on thirty rows and could not be pressed.
 *
 * `due_at` and `due_date` are written together, because the day is derived
 * from the moment unless the caller says otherwise. `label`, `tone` and
 * `title` are the caller's, so each page keeps its own way of saying when.
 */

const pad = (n) => String(n).padStart(2, '0');
const localDay = (at) => at.toLocaleDateString('en-CA');
const localClock = (at) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;
const dayAfter = (offset) => {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  return localDay(at);
};

export default function DeadlineButton({ task, onDeadline, label, tone = '', title, className = '' }) {
  /*
   * `at` holds where the menu goes, and its presence is what "open" means.
   *
   * It is rendered onto the body, not beside the button: both places it is
   * used scroll sideways (the pipeline strip, the table's frame), and a menu
   * inside a scroll container is clipped by it - which is exactly how this
   * first shipped, with "Today, 6pm" sliced in half by the edge of a card.
   */
  const [at, setAt] = useState(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('18:00');
  const open = Boolean(at);
  const has = Boolean(task.due_at || task.due_date);

  const set = (isoDay, clock) => {
    setAt(null);
    onDeadline(task, isoDay, clock || '18:00');
  };
  /* A call that went unanswered is followed up in an hour, not at six. */
  const inHours = (hours) => {
    const when = new Date(Date.now() + hours * 3600_000);
    set(localDay(when), localClock(when));
  };

  const place = (event) => {
    if (open) return setAt(null);
    const box = event.currentTarget.getBoundingClientRect();
    /* Kept inside the window: 210px of menu hanging off the edge of a phone
       is the same as no menu. Sideways is decided here, because the width is
       known; the height is not, so it is corrected below. */
    const width = 210;
    setAt({
      top: box.bottom + 4,
      left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
      width,
      above: box.top,
    });
  };

  /*
   * Measured, not guessed. A height that changes with the contents cannot be
   * a constant, so the menu is measured once it exists and flipped above the
   * row when it does not fit below - which is what a row near the bottom of
   * a long list always is.
   */
  const fit = useCallback((node) => {
    if (!node || !at) return;
    const height = node.getBoundingClientRect().height;
    const room = window.innerHeight - 8;
    if (at.top + height <= room) return;
    const flipped = at.above - height - 4;
    const top = flipped >= 8 ? flipped : Math.max(8, room - height);
    if (Math.abs(top - at.top) > 1) setAt((now) => (now ? { ...now, top } : now));
  }, [at]);

  return (
    <span className={`deadline-pick ${className}`}>
      <button
        type="button"
        className={`deadline-btn ${has ? '' : 'none'} ${tone}`}
        onClick={place}
        aria-expanded={open}
        title={title || (has ? 'Change the deadline' : 'Nothing is chased automatically without one')}
      >
        {label}
      </button>

      {open && createPortal(
        <>
          <span className="menu-scrim" onClick={() => setAt(null)} role="presentation" />
          <div
            className="menu due-menu floating"
            role="menu"
            ref={fit}
            style={{ top: at.top, left: at.left, width: at.width }}
          >
            <button onClick={() => inHours(1)}>In 1 hour</button>
            <button onClick={() => set(dayAfter(0))}>Today, 6pm</button>
            <button onClick={() => set(dayAfter(1), '11:00')}>Tomorrow, 11am</button>
            <button onClick={() => set(dayAfter(1))}>Tomorrow, 6pm</button>
            <div className="due-exact">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
              <button className="btn primary small" disabled={!date} onClick={() => set(date, time)}>
                Set
              </button>
            </div>
            {has && (
              <button className="danger" onClick={() => { setAt(null); onDeadline(task, null); }}>
                No deadline
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </span>
  );
}
