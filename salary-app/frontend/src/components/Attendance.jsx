import { useEffect, useMemo, useRef, useState } from 'react';
import { absentDaysFromAttendance, sundaysFromAttendance } from '../../../shared/calc.js';
import { days, daysInMonth, isSunday, weekday } from '../format.js';

/**
 * The day-by-day grid from the left of the sheet. Marks are typed straight into
 * the cell (or picked from the palette); every change is batched and saved, and
 * the absent/present counts beside each name update as you go.
 */
export default function Attendance({ period, rows, codes, onSave, locked }) {
  const [draft, setDraft] = useState({}); // "employeeId:day" -> code, unsaved
  const [query, setQuery] = useState('');
  const [brush, setBrush] = useState('P');
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

  const setMark = (row, day, rawCode) => {
    if (locked) return;
    const code = String(rawCode || '').trim().toUpperCase();
    if (code && !codes[code]) return; // ignore anything not in the legend
    const next = { ...draft, [`${row.employee_id}:${day}`]: code };
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

  return (
    <section>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search employee"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="brushes">
          <span className="muted small">Click a cell to apply:</span>
          {Object.entries(codes).map(([code, meta]) => (
            <button
              key={code}
              className={`brush code-${code}${brush === code ? ' active' : ''}`}
              title={meta.label}
              onClick={() => setBrush(code)}
            >
              {code}
            </button>
          ))}
          <button
            className={`brush${brush === '' ? ' active' : ''}`}
            title="Clear the mark"
            onClick={() => setBrush('')}
          >
            ✕
          </button>
        </div>
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
              <th>Absent</th>
              <th>Sun</th>
              <th>Fill</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const merged = effectiveAttendance(row);
              const absent = absentDaysFromAttendance(merged);
              return (
                <tr key={row.employee_id}>
                  <td className="sticky-name" title={row.company_name}>{row.employee_name}</td>
                  {dayList.map((d) => {
                    const code = markOf(row, d);
                    return (
                      <td key={d} className={`mark${isSunday(period.year, period.month, d) ? ' sunday' : ''}`}>
                        <input
                          className={`mark-input code-${code || 'none'}`}
                          value={code}
                          disabled={locked}
                          maxLength={2}
                          onChange={(e) => setMark(row, d, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          onClick={() => { if (!code) setMark(row, d, brush); }}
                        />
                      </td>
                    );
                  })}
                  <td className="num strong">{days(absent)}</td>
                  <td className="num">{days(sundaysFromAttendance(merged))}</td>
                  <td>
                    <button className="tiny" disabled={locked} onClick={() => fillRow(row, brush || 'P')}>
                      {brush || 'P'} →
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={total + 4} className="empty">No employees in this month yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="legend card">
        <strong>Marks</strong>
        <ul>
          {Object.entries(codes).map(([code, meta]) => (
            <li key={code}>
              <span className={`brush code-${code}`}>{code}</span> {meta.label}
              {meta.absent > 0 && <em> counts {meta.absent} absent day{meta.absent === 1 ? '' : 's'}</em>}
              {meta.sunday > 0 && <em> paid extra at the day rate</em>}
            </li>
          ))}
        </ul>
        <p className="muted small">
          A day left blank is treated as worked. Only <strong>A</strong>, <strong>HF</strong> and{' '}
          <strong>AD</strong> reduce the salary; <strong>SP</strong> and <strong>HP</strong> add a day's pay.
        </p>
      </div>
    </section>
  );
}
