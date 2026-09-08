import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import TaskItem from './TaskItem.jsx';
import { api } from '../api.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHOWN_IN_CELL = 3;

const isoOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The date a task sits on: its deadline if it has one, else its plain due date. */
const dayOf = (task) => {
  if (task.due_at) return isoOf(new Date(task.due_at));
  return task.due_date || null;
};

/** A note sits on a day only when it has been given a reminder for one. */
const dayOfNote = (note) => (note.remind_at ? isoOf(new Date(note.remind_at)) : null);

const clockOf = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * The month, as a page you can write on.
 *
 * It was a month you could read: which days had work, and the list for the day
 * you clicked. What it could not do is the thing a calendar is for - going to
 * the 20th and putting something on it. So each day now shows what is actually
 * on it, and the day you pick has a box: a task, which enters the ordinary
 * ladder and is reminded and chased like any other, or a note, which is
 * remembered on that morning and never chased.
 *
 * Everything here is the same task and the same note the rest of the app uses.
 * The calendar decides the day; nothing else about them is different.
 */
export default function CalendarPage({
  tasks, notes = [], onOpen, onToggle, onStatus, onQuickDate, onDelete, onNotATask,
  onChanged, onOpenNote, onError,
}) {
  const today = isoOf(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [picked, setPicked] = useState(today);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // Grouped once: the grid and the day list read the same two maps.
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

  const notesByDay = useMemo(() => {
    const map = new Map();
    for (const note of notes) {
      const day = dayOfNote(note);
      if (!day) continue;
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(note);
    }
    return map;
  }, [notes]);

  const cells = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Monday-first, matching how a working week is read here.
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const out = [];
    for (let i = 0; i < lead; i += 1) out.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const items = byDay.get(iso) || [];
      const dayNotes = notesByDay.get(iso) || [];
      const open = items.filter((t) => t.status !== 'done');
      out.push({
        iso,
        day,
        items,
        notes: dayNotes,
        open: open.length,
        overdue: open.filter(() => iso < today).length,
        // What the cell prints: the work first, then anything remembered.
        chips: [
          ...open.map((t) => ({ key: `t${t.id}`, kind: 'task', label: t.title, task: t })),
          ...items.filter((t) => t.status === 'done')
            .map((t) => ({ key: `t${t.id}`, kind: 'done', label: t.title, task: t })),
          ...dayNotes.map((n) => ({
            key: `n${n.id}`, kind: 'note', label: n.title || n.body || 'Note', note: n,
          })),
        ],
      });
    }
    return out;
  }, [year, month, byDay, notesByDay, today]);

  const undated = useMemo(() => tasks.filter((t) => !dayOf(t) && t.status !== 'done'), [tasks]);
  const chosen = byDay.get(picked) || [];
  const chosenNotes = notesByDay.get(picked) || [];
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
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
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
            <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">›</button>
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
            const extra = cell.chips.length - SHOWN_IN_CELL;
            return (
              <div
                key={cell.iso}
                className={classes}
                role="gridcell"
                aria-selected={cell.iso === picked}
                onClick={() => setPicked(cell.iso)}
              >
                <span className="cal-num">{cell.day}</span>

                {/* What is actually on the day, rather than a number standing
                    for it: at a glance the month reads as a diary. */}
                <span className="cal-chips">
                  {cell.chips.slice(0, SHOWN_IN_CELL).map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      /* Prefixed: a bare "task" or "done" here would pick up
                         the task row's own styles, negative margin and all. */
                      className={`cal-chip k-${chip.kind} ${chip.kind === 'task' && cell.iso < today ? 'is-late' : ''}`}
                      title={chip.label}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPicked(cell.iso);
                        if (chip.task) onOpen(chip.task);
                        else if (chip.note) onOpenNote?.(chip.note);
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                  {extra > 0 && <span className="cal-more">+{extra} more</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <section className="cal-day">
        <header>
          <h3>{label(picked)}</h3>
          <span>
            {chosen.length === 0 && chosenNotes.length === 0
              ? 'Nothing on this day'
              : [
                  chosen.length ? `${chosen.length} task${chosen.length === 1 ? '' : 's'}` : null,
                  chosenNotes.length ? `${chosenNotes.length} note${chosenNotes.length === 1 ? '' : 's'}` : null,
                ].filter(Boolean).join(' · ')}
          </span>
        </header>

        <DayAdd day={picked} onAdded={onChanged} onError={onError} />

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

        {chosenNotes.length > 0 && (
          <div className="cal-notes">
            <h4>Notes for this day</h4>
            <ul>
              {chosenNotes.map((note) => (
                <li key={note.id}>
                  <button type="button" onClick={() => onOpenNote?.(note)}>
                    <Icon name="note" size={13} />
                    <span>{note.title || note.body}</span>
                    <span className="cal-note-at">{clockOf(note.remind_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
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

/**
 * Putting something on the day you are looking at.
 *
 * Two kinds, because they are two different things and the calendar is where
 * the difference shows: a task is owed on that day - it takes the deadline,
 * and the ordinary engine reminds and then chases about it - while a note is
 * only remembered on it, once, and never chased.
 *
 * Both are made through the paths the rest of the app uses, so nothing
 * downstream can tell that this one came from the calendar.
 */
function DayAdd({ day, onAdded, onError }) {
  const [kind, setKind] = useState('task');
  const [text, setText] = useState('');
  const [time, setTime] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const box = useRef(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);
  // Moving to another day clears what was half-typed for the last one.
  useEffect(() => { setSaid(null); }, [day]);

  const readable = new Date(`${day}T00:00:00Z`).toLocaleDateString([], {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });

  const add = async (event) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const at = new Date(`${day}T${time || '18:00'}`).toISOString();
      if (kind === 'task') {
        await api.quickAdd({ text: clean, when: 'custom', due_date: day, due_at: at });
        setSaid(`Task added for ${readable} · ${time} — you will be reminded before it.`);
      } else {
        await api.createNote({ title: clean, remind_at: at });
        setSaid(`Note saved for ${readable} · ${time} — you will be told once, and not chased.`);
      }
      setText('');
      onAdded?.();
      box.current?.focus();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaid(null), 7000);
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="cal-add" onSubmit={add}>
      <div className="cal-add-kind" role="group" aria-label="What to add">
        <button
          type="button"
          className={kind === 'task' ? 'on' : ''}
          aria-pressed={kind === 'task'}
          onClick={() => setKind('task')}
        >
          Task
        </button>
        <button
          type="button"
          className={kind === 'note' ? 'on' : ''}
          aria-pressed={kind === 'note'}
          onClick={() => setKind('note')}
        >
          Note
        </button>
      </div>

      <input
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === 'task' ? `What is due on ${readable}?` : `What to remember on ${readable}?`}
        aria-label={kind === 'task' ? 'New task for this day' : 'New note for this day'}
      />
      <input
        type="time"
        value={time}
        aria-label="Time"
        onChange={(e) => setTime(e.target.value)}
      />
      <button type="submit" className="btn primary small" disabled={busy || !text.trim()}>
        {busy ? 'Adding…' : 'Add'}
      </button>

      {said && <p className="cal-add-said" role="status"><Icon name="check" size={13} /> {said}</p>}
    </form>
  );
}
