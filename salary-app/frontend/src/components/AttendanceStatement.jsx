import { useMemo } from 'react';
import { attendanceStatement } from '../../../shared/attendanceStatement.js';
import { formatDuration } from '../../../shared/timesheet.js';
import { col, num, printReport } from '../printReport.js';

/**
 * ONE PERSON'S ATTENDANCE, DAY BY DAY.
 *
 * Dinesh: *"Clicking an employee name should open their monthly attendance
 * statement"* — details, date-wise attendance, check-in/out, working hours,
 * OT, leave, summary, print and export.
 *
 * READ-ONLY ON PURPOSE. The grid behind it is where attendance is marked, and
 * a day that can be changed from two screens is a day that gets changed from
 * the wrong one. The figures are `attendanceStatement`'s, which assembles
 * what is already on the row — so this and the grid cannot disagree.
 */

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

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const hours = (m) => (m === null || m === undefined ? '' : formatDuration(m));

export default function AttendanceStatement({ row, period, holidays = [], onClose }) {
  const stm = useMemo(
    () => attendanceStatement(row, period, { holidays }),
    [row, period, holidays]
  );
  if (!row) return null;

  const { employee, days, summary } = stm;
  const monthName = `${period.label || `${period.month}/${period.year}`}`;
  const fileBase = `${employee.name.replace(/[^a-z0-9]+/gi, '-')}-attendance-${period.year}-${String(period.month).padStart(2, '0')}`;

  /* A day with nothing on it says so, rather than reading as a blank row
     somebody forgot to fill in. */
  const what = (d) => {
    if (d.code) return d.label;
    if (d.holiday) return `${d.holiday} (not marked)`;
    if (d.weekly_off) return 'Weekly off (not marked)';
    return 'Not marked';
  };

  const csv = () => {
    const head = ['Date', 'Day', 'Mark', 'What it means', 'In', 'Lunch out', 'Lunch in', 'Out',
      'Hours worked', 'OT / short (min)', 'Reason', 'Approved'];
    const lines = days.map((d) => [
      `${String(d.day).padStart(2, '0')}/${String(period.month).padStart(2, '0')}/${period.year}`,
      d.weekday, d.code, what(d), d.in_time, d.lunch_out, d.lunch_in, d.out_time,
      hours(d.worked_minutes), d.ot_minutes || '',
      d.reason, d.approved === null ? '' : d.approved ? 'yes' : 'no',
    ]);
    /* A BOM, so Excel opens the rupee signs and names correctly. */
    save(`﻿${[head, ...lines].map((r) => r.map(cell).join(',')).join('\r\n')}`, `${fileBase}.csv`);
  };

  const print = () =>
    printReport({
      title: `${employee.name} — attendance`,
      subtitle: [employee.code, employee.company, employee.department].filter(Boolean).join(' · '),
      meta: [
        monthName,
        `${summary.at_work} day(s) at work · ${summary.paid_off} paid off · ${summary.days_lost} day(s) of pay lost`,
        `${formatDuration(summary.worked_minutes)} clocked over ${summary.clocked_days} day(s)`,
      ],
      columns: [
        col('Date', (d) => `${d.day} ${d.weekday}`, '10%'),
        col('Mark', (d) => d.code || '—', '6%'),
        col('What it means', (d) => what(d)),
        col('In', (d) => d.in_time, '8%'),
        col('Out', (d) => d.out_time, '8%'),
        num('Hours', (d) => hours(d.worked_minutes)),
        num('OT / short', (d) => (d.ot_minutes ? `${d.ot_minutes > 0 ? '+' : ''}${d.ot_minutes}` : '')),
        col('Reason', (d) => d.reason),
      ],
      rows: days,
      empty: 'Nothing marked this month.',
      footer:
        'These are the same marks the salary sheet is paid from — this page counts them, it works nothing out of its own. A day left blank counts as worked.',
    });

  const tile = (label, value, title) => (
    <div title={title}><b>{value}</b><span>{label}</span></div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal statement" onClick={(e) => e.stopPropagation()}>
        <header className="stm-head">
          <div>
            <h2>{employee.name}</h2>
            <p>
              {[employee.code, employee.company, employee.branch, employee.department, employee.designation]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="stm-month">
            <span>Attendance</span>
            <strong>{monthName}</strong>
          </div>
          <button className="icon-x stm-close" onClick={onClose} title="Close">✕</button>
        </header>

        <div className="stm-body">
          <div className="fo-figures">
            {tile('days at work', summary.at_work, 'Present, half days, work from home, official duty, Sundays and holidays worked')}
            {tile('paid time off', summary.paid_off, 'CL, SL, PL and paid holidays')}
            {tile('days of pay lost', summary.days_lost, 'A half day costs 0.5 and a double absence costs 2')}
            {tile('payable days', summary.payable_days ?? '—', 'The salary sheet’s own figure for this month')}
            {tile('hours clocked', summary.worked_minutes ? formatDuration(summary.worked_minutes) : '—', `Over ${summary.clocked_days} day(s) with in and out times`)}
            {tile('overtime', summary.overtime_minutes ? formatDuration(summary.overtime_minutes) : '—')}
            {tile('short hours', summary.short_minutes ? formatDuration(summary.short_minutes) : '—')}
            {tile('not marked', summary.unmarked_days || '—', 'Days with no mark at all. A blank day counts as worked.')}
          </div>

          <div className="toolbar">
            <span className="muted small">
              {Object.entries(summary.counts).map(([code, count]) => `${code} ${count}`).join(' · ') ||
                'Nothing marked this month.'}
            </span>
            <span className="grow" />
            <button className="ghost" onClick={csv}>Export CSV</button>
            <button className="ghost" onClick={print}>Print</button>
          </div>

          <table className="sheet numbered">
            <thead>
              <tr>
                <th className="row-no">#</th>
                <th>Day</th>
                <th>Mark</th>
                <th className="grow">What it means</th>
                <th>In</th>
                <th>Lunch</th>
                <th>Out</th>
                <th className="num">Hours</th>
                <th className="num">OT / short</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className={d.weekly_off ? 'off-row' : undefined}>
                  <td className="row-no">{d.day}</td>
                  <td className="muted small">{d.weekday}</td>
                  <td>{d.code ? <span className={`brush code-${d.code}`}>{d.code}</span> : <span className="muted">—</span>}</td>
                  <td>
                    {what(d)}
                    {d.holiday && d.code ? <span className="muted small"> · {d.holiday}</span> : null}
                    {/* Three-state on purpose: nobody has decided is NOT a
                        refusal, so a blank stays blank. */}
                    {d.approved === true ? <span className="pill ok small"> approved</span> : null}
                    {d.approved === false ? <span className="pill bad small"> not approved</span> : null}
                  </td>
                  <td className="val">{d.in_time || '—'}</td>
                  <td className="val muted small">
                    {d.lunch_out || d.lunch_in ? `${d.lunch_out || '…'}–${d.lunch_in || '…'}` : '—'}
                  </td>
                  <td className="val">{d.out_time || '—'}</td>
                  <td className="num">{hours(d.worked_minutes) || '—'}</td>
                  <td className={`num${d.ot_minutes < 0 ? ' deduct' : ''}`}>
                    {d.ot_minutes ? `${d.ot_minutes > 0 ? '+' : ''}${d.ot_minutes}` : '—'}
                  </td>
                  <td className="muted small">{d.reason || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="muted small">
            These are the same marks the salary sheet is paid from — this page counts them and works
            nothing out of its own. <strong>A day left blank counts as worked.</strong> Hours are what
            was clocked in and out; <em>OT / short</em> is the difference from the day expected, which
            is the column the sheet pays from. To change a day, use the grid behind this.
          </p>
        </div>
      </div>
    </div>
  );
}
