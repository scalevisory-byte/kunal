import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { attendanceStatement } from '../../../shared/attendanceStatement.js';
import { formatDuration } from '../../../shared/timesheet.js';
import { punchTimes, showPunches } from '../../../shared/punchLog.js';
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

  /*
   * EVERY punch of each day, not just the two ends.
   *
   * The readers are door locks: a normal day is six or eight openings, and In
   * and Out are the first and the last of them. Everything between is what
   * settles "I left at 6:30, that 5:45 one was tea" - and until the spool's
   * raw punches were kept, the app did not have it to show.
   *
   * It is NOT a second opinion about the hours. In and Out are still earliest
   * and latest, which is what the sheet is paid from; this only says what
   * else the machine saw.
   */
  const [punches, setPunches] = useState({});
  useEffect(() => {
    if (STANDALONE || !row?.employee_id || !period?.id) return;
    setPunches({});
    api
      .get(`/employees/${row.employee_id}/punches?period_id=${period.id}`)
      .then((body) => setPunches(body?.days || {}))
      .catch(() => setPunches({}));
  }, [row?.employee_id, period?.id]);

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

  /*
   * GROUPED, NOT EIGHT TILES IN A ROW.
   *
   * Dinesh, looking at it: *"make clear design"*. Eight figures side by side
   * at the same weight is a wall of numbers - days and hours and a count of
   * blanks all shouting equally, and the eye has nowhere to land. They are
   * two different questions, so they are two blocks, each with ONE headline
   * figure and the rest beside it at a quieter size.
   *
   * `.stm-*` and not `.fo-figures`: that class is on eight other screens,
   * and restyling it here would silently redraw the front office, the
   * dashboard and the payment tracker. The same trap as `.alerts`, `.login`
   * and `.sticky-name`.
   */
  const fig = (label, value, tone = '') => (
    <div className={`stm-fig${tone ? ` ${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
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
          {/* Said in the band itself, because this is the first question
              anybody asks of a screen full of somebody's days. */}
          <span className="stm-readonly" title="Attendance is marked on the grid behind this">
            Read-only
          </span>
          <button className="icon-x stm-close" onClick={onClose} title="Close">✕</button>
        </header>

        <div className="stm-body">
          <div className="stm-stats">
            <section className="stm-group">
              <h3>Days</h3>
              <div className="stm-figs">
                {/* The sheet's own figure, and the one somebody is actually
                    looking for - so it is the big one. */}
                <div className="stm-fig lead" title="The salary sheet’s own figure for this month">
                  <b>{summary.payable_days ?? '—'}</b>
                  <span>payable</span>
                </div>
                {fig('at work', summary.at_work)}
                {fig('paid off', summary.paid_off)}
                {fig('pay lost', summary.days_lost || '—', summary.days_lost ? 'bad' : '')}
              </div>
              <p className="stm-foot">
                At work counts present, half days, work from home, official duty and any Sunday or
                holiday worked. <strong>Pay lost is in days of pay</strong> — a half day costs 0.5
                and a double absence costs 2.
              </p>
            </section>

            <section className="stm-group">
              <h3>Hours</h3>
              <div className="stm-figs">
                <div className="stm-fig lead" title={`Over ${summary.clocked_days} day(s) with in and out times`}>
                  <b>{summary.worked_minutes ? formatDuration(summary.worked_minutes) : '—'}</b>
                  <span>clocked</span>
                </div>
                {fig('overtime', summary.overtime_minutes ? formatDuration(summary.overtime_minutes) : '—',
                  summary.overtime_minutes ? 'good' : '')}
                {fig('short', summary.short_minutes ? formatDuration(summary.short_minutes) : '—',
                  summary.short_minutes ? 'warn' : '')}
              </div>
              <p className="stm-foot">
                Clocked is from the in and out times on {summary.clocked_days} day
                {summary.clocked_days === 1 ? '' : 's'}. A day with no times is <em>not known</em>,
                never nought.
              </p>
            </section>
          </div>

          {/*
            * The marks, as the marks - in the grid's own colours rather than
            * as a run-on line of "P 15 · OD 1 · CL 1" that has to be read
            * word by word.
            */}
          <div className="toolbar stm-bar">
            {Object.keys(summary.counts).length ? (
              <span className="stm-chips">
                {Object.entries(summary.counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => (
                    <span key={code} className="stm-chip" title={code}>
                      <span className={`brush code-${code}`}>{code}</span>
                      {count}
                    </span>
                  ))}
                {summary.unmarked_days ? (
                  <span className="stm-chip muted" title="Days with no mark at all. A blank day counts as worked.">
                    <span className="brush code-none">—</span>
                    {summary.unmarked_days} not marked
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="muted small">Nothing marked this month.</span>
            )}
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
                  <td className="val">
                    {d.out_time || '—'}
                    {showPunches(d, punches[d.day] || []) ? (
                      <span className="my-att-punches">
                        {punchTimes(punches[d.day])}
                      </span>
                    ) : null}
                  </td>
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
