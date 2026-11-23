import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { PUNCH_LOG_COLUMNS } from '../../../shared/punchLog.js';
import { col, printReport } from '../printReport.js';
import { toCsv } from '../../../shared/statutory.js';

/**
 * THE PUNCH LOG — every punch, one line each.
 *
 * Dinesh: *"sare logs kaha dikhte he?"*. The counts were on Punch totals and
 * a day's punches showed under the out time on a statement, but the record
 * itself could not be opened anywhere.
 *
 * IT IS THE RAW RECORD AND IT IS NOT ATTENDANCE. A punch is one door opening.
 * What the day BECOMES — present, half day, the hours, the lunch break — is
 * worked out separately and lives on the attendance grid, which is what the
 * salary is paid from. The two cannot disagree because they are not asked the
 * same question. Nothing here writes anything.
 */
export default function PunchLog({ period, employees = [], onGo }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [day, setDay] = useState(0);
  const [who, setWho] = useState(0);

  const month = period ? `${period.year}-${String(period.month).padStart(2, '0')}` : '';
  const days = period ? new Date(period.year, period.month, 0).getDate() : 0;

  useEffect(() => {
    if (STANDALONE || !month) return;
    setReport(null);
    setError('');
    api
      .get(`/punch-log?month=${month}&day=${day}&employee_id=${who}`)
      .then(setReport)
      .catch((err) => setError(err.message || 'could not be read'));
  }, [month, day, who]);

  /* Only people the readers could ever match are worth offering: picking
     somebody with no Punch ID would always return nothing and read as a
     fault in the log rather than a missing number. */
  const pickable = useMemo(
    () =>
      employees
        .filter((e) => e.active !== 0 && !e.is_draft)
        .filter((e) => String(e.device_code || '').trim() || /^\d+$/.test(String(e.code || '').trim()))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [employees]
  );

  if (STANDALONE) {
    return (
      <section className="card">
        <h2>Punch log</h2>
        <p className="muted small">
          The punches are rows in the app&rsquo;s own store and files in the Bizcompass folder on
          the server. Neither of those exists in a single file on a laptop, so this log needs the
          server.
        </p>
      </section>
    );
  }

  const n = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN'));

  const header = (
    <>
      <h2>Punch log — every punch the readers recorded</h2>
      <p className="muted small">
        One line per punch in <strong>{month}</strong>, newest first. The readers are on the doors,
        so a normal day is six or eight openings. This is the <strong>raw record</strong>, not
        attendance: what a punch becomes is worked out separately and lives on the attendance grid,
        which is what the salary is paid from. <strong>Nothing here changes anything.</strong>
      </p>
      <div className="row gap wrap">
        <label>
          Day
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            <option value={0}>Whole month</option>
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Employee
          <select value={who} onChange={(e) => setWho(Number(e.target.value))}>
            <option value={0}>Everybody</option>
            {pickable.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.device_code || e.code})
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );

  if (error) {
    return (
      <section className="card">
        {header}
        <p className="warn small">It could not be read: {error}</p>
      </section>
    );
  }
  if (!report) {
    return (
      <section className="card">
        {header}
        <p className="muted small">Reading&hellip;</p>
      </section>
    );
  }

  const { rows, shown, total, more, counts, spool, limit } = report;

  const table = rows.map((r) =>
    PUNCH_LOG_COLUMNS.map(({ key }) => {
      const v = r[key];
      return v === null || v === undefined ? '' : String(v);
    })
  );
  const csv = () => toCsv(PUNCH_LOG_COLUMNS.map((c) => c.label), table);

  const download = () => {
    const blob = new Blob(['﻿', csv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `punch-log-${month}${day ? `-day-${day}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const print = () =>
    printReport({
      title: 'Punch log',
      subtitle: `${month}${day ? ` · day ${day}` : ''} · the readers' own record, not attendance`,
      columns: [
        col('Date', (r) => r.date, 1),
        col('Time', (r) => r.time, 1),
        col('Punch ID', (r) => r.punch_id, 1),
        col('Employee', (r) => r.employee_name || 'nobody carries this number', 3),
        col('Code', (r) => r.code || '—', 1),
        col('Company', (r) => r.company_name || '—', 2),
        col('Seen by', (r) => r.where || '—', 2),
      ],
      rows,
    });

  return (
    <section className="card">
      {header}

      <div className="late-figs">
        <span><b>{n(counts.punches)}</b> <em>punches{day ? ' that day' : ' this month'}</em></span>
        <span><b>{n(counts.people)}</b> <em>people seen</em></span>
        <span><b>{n(counts.days)}</b> <em>days covered</em></span>
        <span className={counts.unmatched ? 'charge' : undefined}>
          <b>{n(counts.unmatched)}</b> <em>punches nobody carries</em>
        </span>
      </div>

      {!counts.punches ? (
        <p className="note small">
          <strong>Nothing was recorded here.</strong> That is not the same as everybody being
          absent — it means no punch reached the app{day ? ' on that day' : ' this month'}. Check
          the feed on{' '}
          {onGo ? (
            <button type="button" className="ghost" onClick={() => onGo('reports')}>
              the import panels
            </button>
          ) : (
            'the import panels'
          )}
          .
        </p>
      ) : null}

      {/*
        * A punch on a number nobody carries is the whole reason somebody opens
        * this. It is attendance arriving for a person it can never reach, and
        * it is listed rather than quietly dropped.
        */}
      {counts.unmatched ? (
        <p className="note small">
          <strong>{n(counts.unmatched)}</strong> of these are on{' '}
          <strong>{n(counts.unknownIds)}</strong> reader number
          {counts.unknownIds === 1 ? '' : 's'} nobody on the staff list carries. They are being
          collected and cannot be given to anybody.{' '}
          {onGo ? (
            <button type="button" className="ghost" onClick={() => onGo('employees')}>
              Match the numbers up →
            </button>
          ) : null}
        </p>
      ) : null}

      {counts.unreadable ? (
        <p className="warn small">
          {n(counts.unreadable)} punch{counts.unreadable === 1 ? '' : 'es'} carried a time stamp
          that could not be read and {counts.unreadable === 1 ? 'is' : 'are'} not listed.
        </p>
      ) : null}

      {/* A list silently cut short reads as "that is all there was", which on
          a punch log sends somebody looking for a feed that is working
          perfectly. So it says so, and says how to narrow it. */}
      {more ? (
        <p className="note small">
          Showing the most recent <strong>{n(shown)}</strong> of <strong>{n(total)}</strong> —{' '}
          <strong>{n(more)}</strong> more are not on screen. Pick a day or a person above to narrow
          it, or download the CSV, which carries {n(limit)} at a time.
        </p>
      ) : null}

      <p className="muted small">
        Where they came from:{' '}
        {spool.error
          ? `the Bizcompass folder could not be read — ${spool.error}. `
          : spool.files
            ? `${n(spool.read)} from ${n(spool.files)} Bizcompass file(s); `
            : 'no Bizcompass folder is set on this server, so all of these came '}
        {spool.files || spool.error
          ? 'the rest from readers the app collects from itself.'
          : 'from readers the app collects from itself.'}
        {/* An imported month holds the spool's punches as rows AND still has
            the files they came from. Saying so stops "read 3" beside a count
            of 1 reading as punches going missing. */}
        {spool.already
          ? ` ${n(spool.already)} of the file's punches were already filed from an earlier import and are listed once, not twice.`
          : ''}
      </p>

      <div className="row gap wrap">
        <button type="button" onClick={download}>Download CSV</button>
        <button type="button" className="ghost" onClick={print}>Print</button>
      </div>

      <div className="report-body">
        <table className="sheet">
          <thead>
            <tr>
              {PUNCH_LOG_COLUMNS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.date}-${r.time}-${r.punch_id}-${i}`} className={r.employee_id ? undefined : 'bad-row'}>
                <td className="small">{r.date}</td>
                <td className="mono strong">{r.time}</td>
                <td className="mono">{r.punch_id}</td>
                <td className="sticky-name">
                  {r.employee_name || <span className="muted">nobody carries this number</span>}
                </td>
                <td className="mono small">{r.code || '—'}</td>
                <td className="small">{r.company_name || '—'}</td>
                <td className="small muted">{r.where || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
