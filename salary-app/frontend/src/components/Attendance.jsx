import { useEffect, useMemo, useRef, useState } from 'react';
import { absentDaysFromAttendance, countMarks, sundaysFromAttendance } from '../../../shared/calc.js';
import { days, daysInMonth, isSunday, weekday } from '../format.js';

/**
 * The day-by-day grid from the left of the sheet.
 *
 * Clicking a day opens a menu of the marks by name - Present, Absent, Half Day,
 * Paid Leave and so on - so nobody has to remember the two-letter codes. The
 * codes are still shown in the cell, and still typeable, because marking 75
 * people over a month is faster from the keyboard.
 */
export default function Attendance({ period, rows, codes, onSave, locked }) {
  const [draft, setDraft] = useState({}); // "employeeId:day" -> code, unsaved
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState(null); // { employeeId, day, name }
  const [status, setStatus] = useState('');
  const saveTimer = useRef(null);

  const total = daysInMonth(period.year, period.month);
  const dayList = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.employee_name.toLowerCase().includes(q) || (r.company_name || '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  const markOf = (row, day) => {
    const key = `${row.employee_id}:${day}`;
    return key in draft ? draft[key] : row.attendance?.[day] || '';
  };

  /** Marks as they stand including unsaved edits, for the live day counts. */
  const effectiveAttendance = (row) => {
    const merged = { ...(row.attendance || {}) };
    for (const [key, code] of Object.entries(draft)) {
      const [empId, day] = key.split(':');
      if (Number(empId) !== row.employee_id) continue;
      if (code) merged[day] = code;
      else delete merged[day];
    }
    return merged;
  };

  const queueSave = (next) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const entries = Object.entries(next).map(([key, code]) => {
        const [employee_id, day] = key.split(':');
        return { employee_id: Number(employee_id), day: Number(day), code };
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

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Escape closes the menu; clicking elsewhere is handled by the backdrop.
  useEffect(() => {
    if (!picker) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPicker(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker]);

  const setMark = (employeeId, day, rawCode) => {
    if (locked) return;
    const code = String(rawCode || '').trim().toUpperCase();
    if (code && !codes[code]) return; // ignore anything not in the legend
    const next = { ...draft, [`${employeeId}:${day}`]: code };
    setDraft(next);
    queueSave(next);
  };

  /** Mark a whole row, skipping days that already carry a mark. */
  const fillRow = (row, code) => {
    if (locked) return;
    const next = { ...draft };
    for (const day of dayList) {
      if (markOf(row, day)) continue;
      if (code === 'S' && !isSunday(period.year, period.month, day)) continue;
      next[`${row.employee_id}:${day}`] = code;
    }
    setDraft(next);
    queueSave(next);
  };

  const clearRow = (row) => {
    if (locked) return;
    const next = { ...draft };
    for (const day of dayList) next[`${row.employee_id}:${day}`] = '';
    setDraft(next);
    queueSave(next);
  };

  return (
    <section>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search employee"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="muted small">Click any day to choose a mark.</span>
        <span className="grow" />
        {status && <span className="pill saving">{status}</span>}
        {locked && <span className="pill locked">Locked</span>}
      </div>

      <div className="table-wrap dense">
        <table className="sheet attendance">
          <thead>
            <tr>
              <th className="sticky-name">Employee</th>
              {dayList.map((d) => (
                <th key={d} className={isSunday(period.year, period.month, d) ? 'sunday' : undefined}>
                  <span className="dow">{weekday(period.year, period.month, d)}</span>
                  <span>{d}</span>
                </th>
              ))}
              <th title="Days of salary these marks cost">Absent</th>
              <th title="Paid leave taken">PL</th>
              <th title="Unpaid leave taken">UL</th>
              <th title="Sundays and holidays worked">Sun</th>
              <th>Whole row</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const merged = effectiveAttendance(row);
              const counts = countMarks(merged);
              return (
                <tr key={row.employee_id}>
                  <td className="sticky-name" title={row.company_name}>{row.employee_name}</td>
                  {dayList.map((d) => {
                    const code = markOf(row, d);
                    const open = picker?.employeeId === row.employee_id && picker?.day === d;
                    return (
                      <td key={d} className={`mark${isSunday(period.year, period.month, d) ? ' sunday' : ''}`}>
                        <button
                          type="button"
                          className={`mark-cell code-${code || 'none'}${open ? ' open' : ''}`}
                          disabled={locked}
                          title={code ? codes[code]?.label : 'No mark - counted as worked'}
                          onClick={() =>
                            setPicker(open ? null : { employeeId: row.employee_id, day: d, name: row.employee_name })
                          }
                          onKeyDown={(e) => {
                            // Typing a code still works: "a" for Absent, "p"/"pl" and so on.
                            if (!/^[a-z]$/i.test(e.key)) return;
                            const typed = e.key.toUpperCase();
                            const exact = codes[typed] ? typed : null;
                            const guess = Object.keys(codes).find((c) => c.startsWith(typed));
                            if (exact || guess) {
                              e.preventDefault();
                              setMark(row.employee_id, d, exact || guess);
                            }
                          }}
                        >
                          {code || '·'}
                        </button>
                      </td>
                    );
                  })}
                  <td className="num strong">{days(absentDaysFromAttendance(merged))}</td>
                  <td className="num">{counts.PL || '-'}</td>
                  <td className="num">{counts.UL || '-'}</td>
                  <td className="num">{days(sundaysFromAttendance(merged))}</td>
                  <td className="row-fill">
                    <select
                      value=""
                      disabled={locked}
                      onChange={(e) => {
                        if (e.target.value === '__clear') clearRow(row);
                        else if (e.target.value) fillRow(row, e.target.value);
                        e.target.value = '';
                      }}
                    >
                      <option value="">Fill blanks…</option>
                      {Object.entries(codes).map(([code, meta]) => (
                        <option key={code} value={code}>{meta.label}</option>
                      ))}
                      <option value="__clear">Clear the row</option>
                    </select>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={total + 6} className="empty">No employees in this month yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {picker && (
        <MarkPicker
          codes={codes}
          picker={picker}
          period={period}
          current={
            filtered.find((r) => r.employee_id === picker.employeeId)
              ? markOf(filtered.find((r) => r.employee_id === picker.employeeId), picker.day)
              : ''
          }
          onPick={(code) => {
            setMark(picker.employeeId, picker.day, code);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}

      <div className="legend card">
        <strong>What each mark does to the salary</strong>
        <ul>
          {Object.entries(codes).map(([code, meta]) => (
            <li key={code}>
              <span className={`brush code-${code}`}>{code}</span>
              <span>{meta.label}</span>
              <em>
                {meta.absent > 0
                  ? `−${meta.absent} day${meta.absent === 1 ? '' : 's'} salary`
                  : meta.sunday > 0
                    ? "+1 day's pay"
                    : 'no change'}
              </em>
            </li>
          ))}
        </ul>
        <p className="muted small">
          A day left blank counts as worked. <strong>Paid Leave</strong> costs nothing;{' '}
          <strong>Unpaid Leave</strong> deducts a day, the same as Absent, but is counted separately
          so leave and absence can be told apart on the payslip and in the export.
        </p>
      </div>
    </section>
  );
}

/** The menu of marks, by name, anchored over the grid. */
function MarkPicker({ codes, picker, period, current, onPick, onClose }) {
  const date = new Date(period.year, period.month - 1, picker.day);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker card" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>{picker.name}</strong>
          <span className="muted small">
            {weekday(period.year, period.month, picker.day)} {picker.day}{' '}
            {date.toLocaleString('en-IN', { month: 'long' })}
          </span>
        </div>
        <ul className="picker-list">
          {Object.entries(codes).map(([code, meta]) => (
            <li key={code}>
              <button
                type="button"
                className={current === code ? 'active' : undefined}
                onClick={() => onPick(code)}
              >
                <span className={`brush code-${code}`}>{code}</span>
                <span className="picker-label">{meta.label}</span>
                <span className="picker-effect">
                  {meta.absent > 0
                    ? `−${meta.absent} day${meta.absent === 1 ? '' : 's'}`
                    : meta.sunday > 0
                      ? '+1 day'
                      : '—'}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="clear" onClick={() => onPick('')}>
              <span className="brush">✕</span>
              <span className="picker-label">Clear the mark</span>
              <span className="picker-effect">—</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
