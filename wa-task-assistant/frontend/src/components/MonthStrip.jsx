import { monthsFor } from '../lib/task.js';

/**
 * The list by month, as a row of chips above it.
 *
 * Asked for as "itna karo ki usme month wise dikhe — month complete ho aur us
 * month ke task pending he to us month ki tab me dikhe". The two halves of
 * that are one rule, and it lives in `monthsFor`: a month that is over keeps
 * its chip for exactly as long as it still has work owed. September's audit,
 * still open in October, does not quietly become October's problem and it does
 * not disappear either - it stays under September, with its own count, until
 * it is finished.
 *
 * A month a task belongs to is its DEADLINE's month, falling back to when it
 * arrived. Work due on 20 October is October's work whenever the message came.
 *
 * Counts come from the rows the board is already showing, after the same
 * filters, so a chip reading 6 opens a list of 6. Deriving them from a second
 * query would eventually mean a chip and its list disagreeing, and then
 * neither would be believed.
 */
export default function MonthStrip({ tasks = [], active, onPick }) {
  const months = monthsFor(tasks);
  // One chip, this month, nothing in it: a row that says only what the empty
  // list below already says is a row worth not drawing.
  if (months.length <= 1 && !active) return null;

  const total = tasks.length;

  return (
    <div className="month-strip" role="group" aria-label="Filter by month">
      <button
        type="button"
        className={`chip month-chip${!active ? ' on' : ''}`}
        onClick={() => onPick(null)}
      >
        All months
        <span className="month-n">{total}</span>
      </button>

      {months.map((m) => (
        <button
          key={m.key}
          type="button"
          className={`chip month-chip${active === m.key ? ' on' : ''}${m.overdue ? ' late' : ''}`}
          onClick={() => onPick(active === m.key ? null : m.key)}
          title={m.overdue
            ? `${m.pending} still open in ${m.label}, ${m.overdue} of them past their date`
            : `${m.pending} still open in ${m.label}`}
        >
          {m.label}
          {!m.current && !m.pending ? null : (
            <span className="month-n">{m.pending || 0}</span>
          )}
        </button>
      ))}
    </div>
  );
}
