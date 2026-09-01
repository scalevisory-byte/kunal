import { useEffect, useMemo, useRef, useState } from 'react';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import {
  TIME_FIELDS,
  TIME_LABELS,
  formatDuration,
  formatTime,
  hasTimes,
  monthTotals,
  parseTime,
  timesToDay,
} from '../../../shared/timesheet.js';
import { days, daysInMonth, isSunday, weekday } from '../format.js';

/**
 * The Time tab - in, lunch out, lunch in, out, and the hours they come to.
 *
 * The attendance grid says whether somebody was here; this says for how long.
 * Two views, because the two questions are different ones: "what did everybody
 * do today" (a day, every employee) and "what did this person do this month"
 * (an employee, every day). Both write to the same place.
 *
 * Filling a day's times sets that day's short hours or overtime, which is the
 * same OT/LT column the salary sheet pays from - so hours typed here turn into
 * money without anything else being touched. The mark is only set to Present or
 * Half Day when the day has no mark of its own; a day already marked as leave,
 * a holiday or a Sunday keeps its mark and just records what was worked.
 */

/** Marks the times are allowed to overwrite - everything else is deliberate. */
const AUTO_MARKS = new Set(['', 'P', 'A', 'HF']);

const STANDARD_KEY = 'salary-app-standard-times';
const DEFAULT_STANDARD = { in_time: '09:30', lunch_out: '13:00', lunch_in: '13:45', out_time: '18:30' };

const readStandard = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(STANDARD_KEY) || 'null');
    if (stored && TIME_FIELDS.every((f) => typeof stored[f] === 'string')) return stored;
  } catch {
    // A corrupt or blocked store just means the usual timings.
  }
  return DEFAULT_STANDARD;
};

export default function TimeSheet({ period, rows, onSave, locked }) {
  const total = daysInMonth(period.year, period.month);
  const today = new Date();
  const isThisMonth = today.getFullYear() === period.year && today.getMonth() + 1 === period.month;

  const [view, setView] = useState('day'); // 'day' = everybody today, 'month' = one person
  const [day, setDay] = useState(isThisMonth ? today.getDate() : 1);
  const [personId, setPersonId] = useState(rows[0]?.employee_id || null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({}); // "employeeId:day" -> the four times
  const [standard, setStandard] = useState(readStandard);
  const [showStandard, setShowStandard] = useState(false);
  const [status, setStatus] = useState('');
  const saveTimer = useRef(null);

  const dayList = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);
  useEffect(() => {
    if (day > total) setDay(total);
  }, [day, total]);
  useEffect(() => {
    if (!rows.some((r) => r.employee_id === personId)) setPersonId(rows[0]?.employee_id || null);
  }, [rows, personId]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.employee_name.toLowerCase().includes(q) || (r.company_name || '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  /** A day's stored entry, with anything typed and not yet saved on top. */
  const entryOf = (row, d) => {
    const stored = row.attendance?.[d];
    const base = typeof stored === 'object' && stored ? stored : { code: stored || '', minutes: 0 };
    const key = `${row.employee_id}:${d}`;
    return key in draft ? { ...base, ...draft[key] } : base;
  };

  const readDay = (row, d) => timesToDay(entryOf(row, d), { hoursPerDay: period.hours_per_day });

  /**
   * Saves in a batch a moment after typing stops, the way the grid does, so
   * tabbing across four boxes is one request rather than four.
   */
  const queueSave = (next) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const entries = Object.entries(next).map(([key, times]) => {
        const [employeeId, d] = key.split(':').map(Number);
        const row = rows.find((r) => r.employee_id === employeeId);
        const merged = { ...(row?.attendance?.[d] || {}), ...times };
        const worked = timesToDay(merged, { hoursPerDay: period.hours_per_day });
        const current = String(row?.attendance?.[d]?.code || '').toUpperCase();
        return {
          employee_id: employeeId,
          day: d,
          // Only a mark that says nothing in particular gives way to the clock.
          code: worked.code && AUTO_MARKS.has(current) ? worked.code : current,
          minutes: worked.worked === null ? Number(row?.attendance?.[d]?.minutes) || 0 : worked.minutes,
          ...times,
        };
      });
      if (!entries.length) return;
      setStatus('Saving…');
      try {
        await onSave(entries);
        setDraft({});
        setStatus('Saved');
        setTimeout(() => setStatus(''), 1500);
      } catch (err) {
        setStatus(err.message);
      }
    }, 700);
  };

  const setTimes = (employeeId, d, patch) => {
    if (locked) return;
    const key = `${employeeId}:${d}`;
    const next = { ...draft, [key]: { ...(draft[key] || {}), ...patch } };
    setDraft(next);
    queueSave(next);
  };

  /** The usual timings, onto every blank day on screen. */
  const fillStandard = (targets, onlyBlank = true) => {
    if (locked) return;
    const next = { ...draft };
    let filled = 0;
    for (const { row, day: d } of targets) {
      if (onlyBlank && hasTimes(entryOf(row, d))) continue;
      next[`${row.employee_id}:${d}`] = { ...standard };
      filled++;
    }
    if (!filled) {
      setStatus('Every day on screen already has times');
      setTimeout(() => setStatus(''), 2500);
      return;
    }
    setDraft(next);
    queueSave(next);
  };

  const clearDay = (row, d) => setTimes(row.employee_id, d, Object.fromEntries(TIME_FIELDS.map((f) => [f, ''])));

  const person = rows.find((r) => r.employee_id === personId);

  /* The rows on screen, whichever view is showing: one day across people, or
     one person across days. Everything below draws from this. */
  const lines =
    view === 'day'
      ? filtered.map((row) => ({ key: row.employee_id, row, day, label: row.employee_name, sub: row.company_name }))
      : person
        ? dayList.map((d) => ({
            key: d,
            row: person,
            day: d,
            label: `${weekday(period.year, period.month, d)} ${d}`,
            sunday: isSunday(period.year, period.month, d),
          }))
        : [];

  const shown = lines.reduce(
    (acc, line) => {
      const read = readDay(line.row, line.day);
      if (read.worked === null) return acc;
      return {
        days: acc.days + 1,
        worked: acc.worked + read.worked,
        short: acc.short + (read.minutes < 0 ? -read.minutes : 0),
        overtime: acc.overtime + (read.minutes > 0 ? read.minutes : 0),
      };
    },
    { days: 0, worked: 0, short: 0, overtime: 0 }
  );

  return (
    <section className="stack">
      <div className="toolbar">
        <div className="sub-tabs toolbar">
          <button className={view === 'day' ? 'active' : undefined} onClick={() => setView('day')}>
            One day, everybody
          </button>
          <button className={view === 'month' ? 'active' : undefined} onClick={() => setView('month')}>
            One person, whole month
          </button>
        </div>

        {view === 'day' ? (
          <>
            <button className="ghost" disabled={day <= 1} onClick={() => setDay(day - 1)}>‹</button>
            <select value={day} onChange={(e) => setDay(Number(e.target.value))} title="Which day">
              {dayList.map((d) => (
                <option key={d} value={d}>
                  {weekday(period.year, period.month, d)} {d}
                  {isSunday(period.year, period.month, d) ? ' · Sunday' : ''}
                </option>
              ))}
            </select>
            <button className="ghost" disabled={day >= total} onClick={() => setDay(day + 1)}>›</button>
            <input
              className="search"
              placeholder="Search employee or company"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </>
        ) : (
          <select value={personId || ''} onChange={(e) => setPersonId(Number(e.target.value))}>
            {rows.map((r) => (
              <option key={r.employee_id} value={r.employee_id}>
                {r.employee_name} — {r.company_name}
              </option>
            ))}
          </select>
        )}

        <span className="grow" />
        {status && <span className="pill saving">{status}</span>}
        {locked && <span className="pill locked">Locked</span>}
      </div>

      <div className="toolbar">
        <button
          disabled={locked || !lines.length}
          onClick={() => fillStandard(lines.map(({ row, day: d }) => ({ row, day: d })))}
        >
          Fill the usual timings
        </button>
        <span className="muted small">
          {standard.in_time}–{standard.out_time}, lunch {standard.lunch_out}–{standard.lunch_in}. Only
          days with nothing on them are filled.
        </span>
        <button className="ghost tiny" onClick={() => setShowStandard((s) => !s)}>
          {showStandard ? 'done' : 'change'}
        </button>
      </div>

      {showStandard && (
        <div className="card inline-form">
          {TIME_FIELDS.map((field) => (
            <label key={field}>
              {TIME_LABELS[field]}
              <input
                value={standard[field]}
                placeholder="09:30"
                onChange={(e) => setStandard({ ...standard, [field]: e.target.value })}
                onBlur={(e) => {
                  const parsed = parseTime(e.target.value);
                  const next = { ...standard, [field]: parsed === null ? '' : formatTime(parsed) };
                  setStandard(next);
                  try {
                    localStorage.setItem(STANDARD_KEY, JSON.stringify(next));
                  } catch {
                    // Nothing to do - the timings just will not be remembered.
                  }
                }}
              />
            </label>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <table className="sheet timesheet">
          <thead>
            <tr>
              <th className="sticky-name">{view === 'day' ? 'Employee' : 'Day'}</th>
              <th title="The day's attendance mark">Mark</th>
              {TIME_FIELDS.map((field) => (
                <th key={field}>{TIME_LABELS[field]}</th>
              ))}
              <th title="Out − in, less the lunch break">Worked</th>
              <th title="Against the day's expected hours">+ / −</th>
              {view === 'day' && <th title="Hours worked so far this month">Month so far</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <TimeRow
                key={line.key}
                line={line}
                period={period}
                view={view}
                locked={locked}
                entry={entryOf(line.row, line.day)}
                read={readDay(line.row, line.day)}
                onSet={(patch) => setTimes(line.row.employee_id, line.day, patch)}
                onClear={() => clearDay(line.row, line.day)}
              />
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={view === 'day' ? 10 : 9} className="empty">
                  Nobody to show. Add employees under <strong>Employees</strong> first.
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td className="sticky-name">
                  {shown.days} day{shown.days === 1 ? '' : 's'} with times
                </td>
                <td colSpan={5} />
                <td className="num grand">{formatDuration(shown.worked)}</td>
                <td className="num">
                  {shown.short > 0 && <span className="deduct">−{formatDuration(shown.short)}</span>}
                  {shown.short > 0 && shown.overtime > 0 && ' '}
                  {shown.overtime > 0 && <span>+{formatDuration(shown.overtime)}</span>}
                  {!shown.short && !shown.overtime && '-'}
                </td>
                <td colSpan={view === 'day' ? 2 : 1} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="muted small">
        Worked hours are <strong>out − in, less the lunch break</strong>. Anything more or less than
        the day's {days(period.hours_per_day)} hours goes into that day's OT/LT minutes, which the
        salary sheet pays or deducts at the per-minute rate — a few minutes either way is ignored.
        A day under 4½ hours is marked <strong>HF</strong> and paid at half, so its short hours are
        not charged again. Marks that were set on purpose — leave, a holiday, a Sunday — are left
        as they are.
      </p>
    </section>
  );
}

function TimeRow({ line, period, view, locked, entry, read, onSet, onClear }) {
  const mark = String(entry.code || '').toUpperCase();
  const monthly = useMemo(() => {
    if (view !== 'day') return null;
    const stored = line.row.attendance || {};
    return monthTotals(Object.values(stored), { hoursPerDay: period.hours_per_day });
  }, [line.row.attendance, period.hours_per_day, view]);

  return (
    <tr className={line.sunday ? 'sunday-row' : undefined}>
      <td className="sticky-name">
        {line.label}
        {line.sub && <span className="hint">{line.sub}</span>}
      </td>
      <td className="num muted" title={ATTENDANCE_CODES[mark]?.label || 'No mark yet'}>
        {mark || '·'}
      </td>
      {TIME_FIELDS.map((field) => (
        <td key={field}>
          <TimeInput
            value={entry[field] || ''}
            disabled={locked}
            label={TIME_LABELS[field]}
            onCommit={(next) => onSet({ [field]: next })}
          />
        </td>
      ))}
      <td className="num strong">{read.worked === null ? '-' : formatDuration(read.worked)}</td>
      <td className={`num${read.minutes < 0 ? ' deduct' : ''}`}>
        {read.minutes ? `${read.minutes > 0 ? '+' : '−'}${Math.abs(read.minutes)}m` : '-'}
      </td>
      {view === 'day' && (
        <td className="num muted" title={`${monthly.days} days with times`}>
          {monthly.days ? formatDuration(monthly.worked) : '-'}
        </td>
      )}
      <td>
        {read.warning ? (
          <span className="pill error-pill" title={read.warning}>check</span>
        ) : (
          read.overnight && <span className="pill" title="Read as finishing after midnight">+1 day</span>
        )}
        {(read.worked !== null || entry.in_time || entry.out_time) && !locked && (
          <button className="ghost tiny" title="Clear this day's times" onClick={onClear}>
            clear
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * One clock time. Takes 9:30, 930, 9.30, 9, 6pm and 18:30, and tidies whatever
 * was typed into HH:MM when the box is left. Anything it cannot read is put
 * back rather than saved as a blank hour.
 */
function TimeInput({ value, disabled, label, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const text = draft.trim();
    if (text === (value || '')) return;
    if (text === '') return onCommit('');
    const parsed = parseTime(text);
    if (parsed === null) {
      setDraft(value);
      return;
    }
    const tidy = formatTime(parsed);
    setDraft(tidy);
    onCommit(tidy);
  };

  return (
    <input
      className="cell-input time-input"
      inputMode="numeric"
      disabled={disabled}
      placeholder="--:--"
      aria-label={label}
      title={`${label} — type 9:30, 930 or 6pm`}
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.target.blur();
        }
      }}
    />
  );
}
