import { useMemo } from 'react';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';

const weekday = (y, m, d) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, d).getDay()];

/**
 * The month's paid holidays, day by day.
 *
 * A festival is not a holiday for everyone — Eid for the Muslim staff, Diwali
 * for the Hindu staff, and the rest work as normal — so "there was a holiday
 * on the 10th" is never the whole story. This says, for each day somebody had
 * off: how many were given it, and who WORKED it anyway.
 *
 * It computes nothing of its own. It counts the same marks the salary sheet is
 * paid from, so this and the payslip cannot disagree:
 *
 *   PH  given the day off, paid in full, nothing deducted
 *   HP  worked the holiday — paid in full AND owed an extra day, which is
 *       settled in the Sunday register, never in the month's salary
 */
export default function HolidayDetail({ period, rows }) {
  const days = useMemo(() => {
    const found = new Map();
    for (const row of rows || []) {
      for (const [day, entry] of Object.entries(row.attendance || {})) {
        const code = (typeof entry === 'object' ? entry?.code : entry) || '';
        if (code !== 'PH' && code !== 'HP') continue;
        const seen = found.get(day) || { day: Number(day), off: [], worked: [] };
        (code === 'PH' ? seen.off : seen.worked).push(row.employee_name);
        found.set(day, seen);
      }
    }
    for (const d of found.values()) {
      d.off.sort();
      d.worked.sort();
    }
    return [...found.values()].sort((a, b) => a.day - b.day);
  }, [rows]);

  const offTotal = days.reduce((n, d) => n + d.off.length, 0);
  const workedTotal = days.reduce((n, d) => n + d.worked.length, 0);

  if (!days.length) {
    return (
      <p className="muted small">
        No paid holiday is marked this month. Add one under{' '}
        <strong>Festivals &amp; holidays</strong> above, or mark a day{' '}
        <strong>{ATTENDANCE_CODES.PH.label}</strong> on the grid.
      </p>
    );
  }

  return (
    <>
      <div className="figures">
        <div className="figure">
          <span className="n">{days.length}</span>
          <span className="k">{days.length === 1 ? 'Holiday' : 'Holidays'}</span>
        </div>
        <div className="figure">
          <span className="n">{offTotal}</span>
          <span className="k">Days given off</span>
        </div>
        <div className="figure">
          <span className="n">{workedTotal}</span>
          <span className="k">Worked anyway</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th>Day</th>
              <th className="num">Off</th>
              <th className="num">Worked</th>
              <th>Who worked it</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td>
                  {d.day} <span className="muted small">{weekday(period.year, period.month, d.day)}</span>
                </td>
                <td className="num">{d.off.length}</td>
                <td className="num">{d.worked.length || <span className="muted">—</span>}</td>
                <td className="wraps muted small">
                  {d.worked.length ? d.worked.join(', ') : 'Nobody — everyone had it off'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted small">
        A day off costs nothing — the salary is paid in full. Somebody who <strong>worked</strong>{' '}
        a holiday is owed an extra day, and that is settled in <strong>Sunday working</strong>{' '}
        above, never in the month&apos;s salary.
      </p>
    </>
  );
}
