import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { IN_OUT_COLUMNS, inOutCells, inOutRegister } from '../../../shared/inOutRegister.js';
import { formatDuration } from '../../../shared/timesheet.js';
import { col, printReport } from '../printReport.js';
import { toCsv } from '../../../shared/statutory.js';
import ScrollFrame from './ScrollFrame.jsx';

/**
 * EVERY IN AND OUT, for the whole month, on one page.
 *
 * Dinesh: *"need all logs / all in out"*. The Time tab shows one DAY across
 * everybody or one PERSON down the month and never both; the punch log lists
 * raw door openings, which answers a different question. This is the plain
 * register.
 *
 * It ASSEMBLES — the hours come from `readTimes` and what a day costs comes
 * from the `minutes` stored on it, which is the column the salary sheet has
 * always been paid from. So the register and the payslip cannot disagree.
 */
export default function InOutRegister({ payroll, filters }) {
  /*
   * `payroll` is the month OBJECT — { period, rows } — not an array. Every
   * sibling panel takes it that way and reads `.rows` itself; taking it as a
   * list is how the first attempt threw "t is not iterable" on render.
   */
  const period = payroll?.period || {};
  const rows = payroll?.rows || [];
  const [punches, setPunches] = useState(null);
  const [everyDay, setEveryDay] = useState(false);
  const [error, setError] = useState('');

  const month = period.year ? `${period.year}-${String(period.month).padStart(2, '0')}` : '';

  /* One request for everybody, not one per person. The raw punches need the
     server; the register itself does not, so it still works offline. */
  useEffect(() => {
    if (STANDALONE || !month) return;
    setPunches(null);
    setError('');
    api
      .get(`/punches/month?month=${month}`)
      .then((got) => setPunches(got))
      .catch((err) => setError(err.message || 'the punches could not be read'));
  }, [month]);

  const report = useMemo(
    () => inOutRegister(rows, period, { punches: punches?.punches || null, everyDay }),
    [rows, period, punches, everyDay]
  );

  if (!payroll || !rows.length) {
    return (
      <section className="card">
        <h2>Working hours — every in and out</h2>
        <p className="muted small">There is nobody on this month to list.</p>
      </section>
    );
  }

  const { lines, totals } = report;
  const n = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN'));

  /* Named apart from the payroll's own `rows`, which is what this panel is
     handed — one `rows` for two different things is how the build broke. */
  const csvRows = lines.map((l) => {
    const c = inOutCells(l);
    return IN_OUT_COLUMNS.map(({ key }) => c[key] ?? '');
  });
  const csv = () => toCsv(IN_OUT_COLUMNS.map((c) => c.label), csvRows);

  const download = () => {
    const blob = new Blob(['﻿', csv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `in-out-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const print = () =>
    printReport({
      title: 'Working hours — every in and out',
      subtitle: `${month}${filters?.company_id ? ' · one company' : ''} · the same times the salary is worked out from`,
      columns: [
        col('Date', (l) => `${l.date.slice(8)} ${l.weekday}`, 1),
        col('Employee', (l) => l.employee_name, 3),
        col('Mark', (l) => l.code || '—', 1),
        col('In', (l) => l.in_time || '—', 1),
        col('Lunch', (l) => (l.lunch_out || l.lunch_in ? `${l.lunch_out || '—'}–${l.lunch_in || '—'}` : '—'), 2),
        col('Out', (l) => l.out_time || '—', 1),
        col('Worked', (l) => (l.worked_minutes === null ? '—' : formatDuration(l.worked_minutes)), 1),
        col('OT / short', (l) => (l.minutes ? `${l.minutes > 0 ? '+' : '−'}${Math.abs(l.minutes)}m` : '—'), 1),
      ],
      rows: lines,
    });

  return (
    <section className="card">
      <h2>Working hours — every in and out</h2>
      <p className="muted small">
        Every person and every day of <strong>{month}</strong>, with the clock times the salary is
        actually worked out from. The hours are <strong>out − in</strong>
        {period.lunch_paid ? ' with the lunch break inside the paid day' : ', less the lunch break'}.
        Only the first and the last punch of a day count towards them.
      </p>

      <div className="late-figs">
        <span><b>{n(totals.people)}</b> <em>people</em></span>
        <span><b>{n(totals.with_times)}</b> <em>days with clock times</em></span>
        <span><b>{formatDuration(totals.worked_minutes)}</b> <em>worked in all</em></span>
        <span><b>{formatDuration(totals.ot_minutes)}</b> <em>overtime</em></span>
        <span className={totals.short_minutes ? 'charge' : undefined}>
          <b>{formatDuration(totals.short_minutes)}</b> <em>short</em>
        </span>
      </div>

      {/*
        * A day nobody clocked is NOT a day nobody worked. Saying how many are
        * blank stops the register reading as the whole truth when most of the
        * month has no times on it at all.
        */}
      {totals.blank_days ? (
        <p className="muted small">
          <strong>{n(totals.blank_days)}</strong> person-days have neither a mark nor a clock time
          {everyDay ? ' and are listed below as empty rows' : ' and are left out'}. A blank day
          means the times are <strong>not known</strong>, never that nothing was worked.
        </p>
      ) : null}

      {totals.no_out ? (
        <p className="note small">
          <strong>{n(totals.no_out)}</strong> day{totals.no_out === 1 ? ' has' : 's have'} an
          arrival and no departure — one punch, somebody still at work, or a missed punch out.
          Nothing is charged for their hours. Reports → <strong>Missing punch</strong> lists them
          on their own.
        </p>
      ) : null}

      {/* A figure typed over the clock is the one thing that would otherwise
          read as the sum not adding up. */}
      {totals.typed_over ? (
        <p className="muted small">
          <strong>{n(totals.typed_over)}</strong> day
          {totals.typed_over === 1 ? ' carries' : 's carry'} an OT/short figure somebody typed in
          rather than the one the clock comes to; those are marked <strong>typed</strong> and are
          what the salary uses.
        </p>
      ) : null}

      {error ? (
        <p className="warn small">
          The register is complete, but the raw punches could not be read: {error}
        </p>
      ) : null}
      {!STANDALONE && !punches && !error ? (
        <p className="muted small">Reading the punches&hellip;</p>
      ) : null}
      {STANDALONE ? (
        <p className="muted small">
          The <strong>Every punch</strong> column needs the server — the raw punches are rows in
          the app&rsquo;s own store. The in and out times below are the record either way.
        </p>
      ) : null}

      <div className="row gap wrap">
        <button type="button" onClick={download}>Download CSV</button>
        <button type="button" className="ghost" onClick={print}>Print</button>
        <label className="field inline" title="Also list days with no mark and no times">
          <input type="checkbox" checked={everyDay} onChange={(e) => setEveryDay(e.target.checked)} />
          <span>Include blank days</span>
        </label>
      </div>

      <ScrollFrame>
        <table className="sheet inout">
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Mark</th>
              <th>In</th>
              <th>Lunch out</th>
              <th>Lunch in</th>
              <th>Out</th>
              <th className="num">Worked</th>
              <th className="num">OT / short</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.employee_id}-${l.day}`} className={l.in_time && !l.out_time ? 'part-row' : undefined}>
                <td className="small">
                  {l.date.slice(8)} <span className="muted">{l.weekday}</span>
                </td>
                <td className="sticky-name">
                  {l.employee_name}
                  {l.department ? <span className="hint">{l.department}</span> : null}
                </td>
                <td className="num muted">{l.code || '·'}</td>
                <td className="num">{l.in_time || '—'}</td>
                <td className="num">{l.lunch_out || '—'}</td>
                <td className="num">
                  {l.lunch_in || '—'}
                  {l.lunch_minutes ? (
                    <span className="ts-lunch-len">
                      {formatDuration(l.lunch_minutes)}
                      {l.lunch_deducted ? ' off' : ''}
                    </span>
                  ) : null}
                </td>
                <td className="num">
                  {l.out_time || '—'}
                  {/*
                    * Under the out time, the same place the Time tab, the
                    * statement and the employee's own page put it. As its own
                    * tenth column it was clipped off the right edge — a day
                    * runs to six or eight openings and that column is the
                    * widest thing on the page.
                    */}
                  {l.punch_times ? (
                    <span className="ts-lunch-len punches" title="every punch the reader recorded - only the first and the last count towards the hours">
                      {l.punch_times}
                    </span>
                  ) : null}
                </td>
                <td className="num strong">
                  {l.worked_minutes === null ? '—' : formatDuration(l.worked_minutes)}
                  {l.worked_minutes === null && l.warning ? (
                    <span className="ts-lunch-len">{l.warning}</span>
                  ) : null}
                </td>
                <td className={`num${l.minutes < 0 ? ' deduct' : ''}`}>
                  {l.minutes ? `${l.minutes > 0 ? '+' : '−'}${Math.abs(l.minutes)}m` : '—'}
                  {l.typed_over ? (
                    <span className="ts-lunch-len" title={`the clock comes to ${l.from_clock}m`}>typed</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollFrame>

      {!lines.length ? (
        <p className="muted small">
          Nothing is marked or clocked on this month yet. Import the punch file or type the times
          on the Time tab, and every day will be listed here.
        </p>
      ) : null}
    </section>
  );
}
