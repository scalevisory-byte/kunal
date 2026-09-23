import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { dueByDay } from '../lib/derive.js';
import { todayIso } from '../lib/task.js';

/**
 * A month at a glance: which days carry work, and which one is being viewed.
 *
 * It used to be one of the rail's cards, filed among the figures at the bottom
 * of the dashboard. It has its own file because it now has its own place - the
 * column beside the board - and a component rendered from two places is a
 * component that will eventually differ between them.
 */
export default function MonthCalendar({ tasks, selected, onSelect }) {
  const [monthStart, setMonthStart] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const due = useMemo(() => dueByDay(tasks), [tasks]);
  const today = todayIso();

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first, which is how a working week is read here.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;

  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { day, iso, count: due.get(iso) || 0 };
    }),
  ];

  const shift = (delta) => setMonthStart(new Date(year, month + delta, 1));

  return (
    <div className="cal">
      {/* The month IS the card's heading - a card titled "Calendar" with
          "September 2026" in smaller type underneath said the same thing
          twice and cost a line. */}
      <div className="cal-head">
        <span className="cal-mark"><Icon name="calendar" size={18} /></span>
        <span>{monthStart.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="cal-dow">{d}</span>
        ))}
        {cells.map((cell, i) =>
          cell ? (
            <button
              key={cell.iso}
              className={`cal-day ${cell.iso === today ? 'today' : ''} ${selected === cell.iso ? 'on' : ''} ${cell.count ? 'has' : ''}`}
              aria-pressed={selected === cell.iso}
              title={cell.count ? `${cell.count} task${cell.count === 1 ? '' : 's'}` : 'No tasks'}
              onClick={() => onSelect(selected === cell.iso ? null : cell.iso)}
            >
              {cell.day}
            </button>
          ) : (
            <span key={`pad-${i}`} />
          )
        )}
      </div>
    </div>
  );
}
