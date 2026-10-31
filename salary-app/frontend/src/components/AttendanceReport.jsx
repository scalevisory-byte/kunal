import { useMemo, useState } from 'react';
import {
  SUMMARY_COLUMNS,
  attendanceDaywise,
  attendanceSummary,
  daywiseCsv,
} from '../../../shared/attendanceReport.js';
import { toCsv } from '../../../shared/statutory.js';

const save = (body, filename, type = 'text/csv;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * The absent / present report, asked for by name.
 *
 * It counts the same marks the salary sheet is paid from, so the two can never
 * disagree — which is why "Payable days" sits next to "Days lost" rather than
 * being worked out again here.
 */
export default function AttendanceReport({ payroll }) {
  const [view, setView] = useState('summary');
  const [query, setQuery] = useState('');

  const summary = useMemo(() => attendanceSummary(payroll), [payroll]);
  const daywise = useMemo(() => attendanceDaywise(payroll), [payroll]);

  if (!payroll) return null;
  const month = payroll.period.label;

  const match = (row) =>
    !query ||
    `${row.name} ${row.code} ${row.company_name}`.toLowerCase().includes(query.toLowerCase());

  const rows = summary.rows.filter(match);
  const dayRows = daywise.rows.filter(match);

  return (
    <section className="card">
      <div className="row" style={{ marginBottom: '0.7rem' }}>
        <h2 style={{ margin: 0 }}>Absent / present report — {month}</h2>
        <span className="spacer" />
        <div className="chips">
          <button
            className={`chip ${view === 'summary' ? 'active' : ''}`}
            onClick={() => setView('summary')}
          >
            Month summary
          </button>
          <button
            className={`chip ${view === 'daywise' ? 'active' : ''}`}
            onClick={() => setView('daywise')}
          >
            Day by day
          </button>
        </div>
        <input
          value={query}
          placeholder="Find somebody…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={() =>
            view === 'summary'
              ? save(toCsv(SUMMARY_COLUMNS, rows), `attendance-${month.replace(/\s+/g, '-')}.csv`)
              : save(daywiseCsv({ ...daywise, rows: dayRows }), `muster-${month.replace(/\s+/g, '-')}.csv`)
          }
        >
          Export CSV
        </button>
      </div>

      {summary.totals.unmarked_days > 0 ? (
        <p className="banner">
          {summary.totals.unmarked_days} day
          {summary.totals.unmarked_days === 1 ? '' : 's'} across the month are still unmarked.
          Nothing is guessed — an unmarked day is paid as a working day, so mark the grid or
          import the machine&apos;s report before this is filed.
        </p>
      ) : null}

      {view === 'summary' ? (
        <div className="scroll">
          <table className="sheet">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Company</th>
                <th className="num">P</th>
                <th className="num">HF</th>
                <th className="num">A</th>
                <th className="num">CL</th>
                <th className="num">SL</th>
                <th className="num">PL</th>
                <th className="num">UL</th>
                <th className="num">Hol</th>
                <th className="num">Sun off</th>
                <th className="num">Sun worked</th>
                <th className="num">At work</th>
                <th className="num">Days lost</th>
                <th className="num">Payable</th>
                <th className="num">Not marked</th>
                <th className="num">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id}>
                  <td className="small muted num">{r.code}</td>
                  <td className="name-cell">{r.name}</td>
                  <td className="small muted">{r.company_name}</td>
                  <td className="num">{r.present || ''}</td>
                  <td className="num">{r.half_day || ''}</td>
                  <td className="num" style={{ color: r.absent ? 'var(--bad)' : undefined }}>
                    {r.absent || ''}
                  </td>
                  <td className="num">{r.casual_leave || ''}</td>
                  <td className="num">{r.sick_leave || ''}</td>
                  <td className="num">{r.paid_leave || ''}</td>
                  <td className="num">{r.unpaid_leave || ''}</td>
                  <td className="num">{r.holiday || ''}</td>
                  <td className="num">{r.sunday_off || ''}</td>
                  <td className="num">{r.sunday_worked || ''}</td>
                  <td className="num">{r.worked_days}</td>
                  <td className="num">{r.days_lost || ''}</td>
                  <td className="num">
                    {r.payable_days}
                    {r.overridden ? <span className="muted small" title="typed over the formula"> ✎</span> : null}
                  </td>
                  <td className="num" style={{ color: r.unmarked_days ? 'var(--warn)' : undefined }}>
                    {r.unmarked_days || ''}
                  </td>
                  <td className="num">{r.attendance_percent == null ? '—' : `${r.attendance_percent}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <strong>{summary.totals.people} people</strong>
                </td>
                <td className="num">{summary.totals.present}</td>
                <td className="num">{summary.totals.half_day}</td>
                <td className="num">{summary.totals.absent}</td>
                <td className="num">{summary.totals.casual_leave}</td>
                <td className="num">{summary.totals.sick_leave}</td>
                <td className="num">{summary.totals.paid_leave}</td>
                <td className="num">{summary.totals.unpaid_leave}</td>
                <td className="num">{summary.totals.holiday}</td>
                <td className="num">{summary.totals.sunday_off}</td>
                <td className="num">{summary.totals.sunday_worked}</td>
                <td className="num">{summary.totals.worked_days}</td>
                <td className="num">{summary.totals.days_lost}</td>
                <td className="num">{summary.totals.payable_days}</td>
                <td className="num">{summary.totals.unmarked_days}</td>
                <td className="num">
                  {summary.totals.attendance_percent == null ? '—' : `${summary.totals.attendance_percent}%`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="scroll">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name">Name</th>
                {daywise.days.map((d) => (
                  <th key={d.day} className="num" style={{ color: d.sunday ? 'var(--muted)' : undefined }}>
                    {d.day}
                    <div className="muted" style={{ fontWeight: 400 }}>{d.weekday.slice(0, 2)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dayRows.map((r) => (
                <tr key={r.employee_id}>
                  <td className="sticky-name name-cell">{r.name}</td>
                  {r.marks.map((mark, i) => (
                    <td
                      key={i}
                      className="num"
                      style={{
                        color: mark === 'A' || mark === 'AD' || mark === 'UL' ? 'var(--bad)' : undefined,
                      }}
                    >
                      {mark || <span className="muted">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted small" style={{ marginTop: '0.6rem' }}>
        Counted from the same marks the salary sheet is paid from — if a figure here looks
        wrong, the mark is wrong, and it is wrong on the payslip too. <strong>Days lost</strong>{' '}
        is in days of pay, not in marks: a half day costs 0.5 and an AD costs 2.{' '}
        <strong>Payable days</strong> is what the sheet actually charges, so a figure typed over
        the formula shows here as well, marked ✎.
      </p>
    </section>
  );
}
