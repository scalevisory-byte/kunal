import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { PUNCH_TOTAL_COLUMNS } from '../../../shared/punchTotals.js';
import { col, printReport } from '../printReport.js';
import { toCsv } from '../../../shared/statutory.js';

/**
 * How many punches each person actually has — just to look at.
 *
 * Dinesh: *"sare employee ka total punches dekhne ho alag se ek uska report
 * bhi banana / o sirf dekhne k liye hoga"*. So: no buttons that change
 * anything, no marks written, nothing to approve.
 *
 * It counts the RAW events the readers recorded. What a punch becomes —
 * present, half day, the hours — is `punchesToMarks`' job and lives on the
 * grid, which is what the sheet is paid from. The two can never disagree
 * because they are not asked the same question.
 *
 * It needs the server: the punches are rows in our own store and files in
 * the Bizcompass folder, and neither exists in a file on a laptop.
 */
export default function PunchTotals({ period, onGo }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const month = period
    ? `${period.year}-${String(period.month).padStart(2, '0')}`
    : '';

  useEffect(() => {
    if (STANDALONE || !month) return;
    setReport(null);
    setError('');
    api
      .get(`/punch-totals?month=${month}`)
      .then(setReport)
      .catch((err) => setError(err.message || 'could not be read'));
  }, [month]);

  if (STANDALONE) {
    return (
      <section className="card">
        <h2>Punch totals</h2>
        <p className="muted small">
          The punches are rows in the app&rsquo;s own store and files in the Bizcompass folder on
          the server. Neither of those exists in a single file on a laptop, so this report needs
          the server.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card">
        <h2>Punch totals</h2>
        <p className="warn small">It could not be read: {error}</p>
      </section>
    );
  }
  if (!report) {
    return (
      <section className="card">
        <h2>Punch totals</h2>
        <p className="muted small">Counting&hellip;</p>
      </section>
    );
  }

  const { lines, unknown, totals, spool } = report;
  const n = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN'));

  const rows = lines.map((l) =>
    PUNCH_TOTAL_COLUMNS.map(({ key }) => {
      const v = l[key];
      return v === null || v === undefined ? '' : String(v);
    })
  );
  const csv = () => toCsv(PUNCH_TOTAL_COLUMNS.map((c) => c.label), rows);

  const download = () => {
    const blob = new Blob(['﻿', csv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `punch-totals-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const print = () =>
    printReport({
      title: 'Punch totals',
      subtitle: `${month} · counted from the readers, not from attendance`,
      columns: [
        col('Employee', (r) => r.employee_name, 3),
        col('Punch ID', (r) => r.punch_id || r.code || '—', 1),
        col('Company', (r) => r.company_name, 2),
        col('Punches', (r) => n(r.punches), 1),
        col('Days seen', (r) => n(r.days), 1),
        col('First', (r) => r.first_day || '—', 1),
        col('Last', (r) => r.last_day || '—', 1),
      ],
      rows: lines,
    });

  return (
    <section className="card">
      <h2>Punch totals — how many punches each person has</h2>
      <p className="muted small">
        Every punch the readers recorded in <strong>{month}</strong>, counted per person. This is
        the <strong>raw count</strong>, not attendance: what a punch becomes — present, half day,
        the hours — is worked out separately and lives on the attendance grid, which is what the
        salary is paid from. <strong>Nothing here changes anything.</strong>
      </p>

      <div className="late-figs">
        <span><b>{n(totals.punches)}</b> <em>punches this month</em></span>
        <span><b>{n(totals.days)}</b> <em>days covered</em></span>
        <span><b>{n(totals.reaching)}</b> <em>people the readers saw</em></span>
        <span className={totals.silent ? 'charge' : undefined}>
          <b>{n(totals.silent)}</b> <em>have a number but no punches</em>
        </span>
        <span className={totals.unreachable ? 'charge' : undefined}>
          <b>{n(totals.unreachable)}</b> <em>cannot be reached at all</em>
        </span>
      </div>

      {totals.punches === null ? (
        <p className="note small">
          <strong>No punches have come in for this month at all.</strong> That is not the same as
          everybody being absent — it means nothing is reaching the app. Check the feed on{' '}
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
        * "Cannot be reached" and "reached and silent" are different problems
        * and must never be added together. The first is a Punch ID nobody has
        * typed; the second is somebody who has left, is on leave all month, or
        * walks through a door they were never enrolled on.
        */}
      {totals.unreachable > 0 ? (
        <p className="note small">
          <strong>{totals.unreachable}</strong> {totals.unreachable === 1 ? 'person has' : 'people have'}{' '}
          no Punch ID and an employee code the readers cannot match, so no punch will ever find
          them. Their count reads <strong>—</strong>, not 0 — nobody has looked, so nothing was
          counted.{' '}
          {onGo ? (
            <button type="button" className="ghost" onClick={() => onGo('employees')}>
              Fill the numbers in →
            </button>
          ) : null}
        </p>
      ) : null}

      {/* The two feeds are named apart because "the spool is running and our
          own reader is not" is the answer somebody needs, and one combined
          figure hides it. Saying "the rest came from our readers" when there
          is no spool at all reads as a broken sentence - caught by reading it
          on screen. */}
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
              {PUNCH_TOTAL_COLUMNS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Seen by</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.employee_id} className={l.punches === null ? 'bad-row' : undefined}>
                <td className="sticky-name">{l.employee_name}</td>
                <td className="mono small">{l.code || '—'}</td>
                {/* Somebody with no Punch ID whose employee code IS a number
                    is still matched, by the importer's fallback. A bare dash
                    beside a count of 3 reads as a contradiction. */}
                <td className="mono">
                  {l.punch_id || (
                    <span className="muted" title={l.reach === 'fallback' ? 'matched on the employee code' : 'no number the readers can match'}>
                      {l.reach === 'fallback' ? `${l.code} (code)` : '—'}
                    </span>
                  )}
                </td>
                <td className="small">{l.company_name}</td>
                <td className="small">{l.department}</td>
                <td className="num strong">{n(l.punches)}</td>
                <td className="num">{n(l.days)}</td>
                <td className="small">{l.first_day || '—'}</td>
                <td className="small">
                  {l.last_day ? `${l.last_day} ${l.last_time}` : '—'}
                </td>
                <td className="small muted">{l.sources.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unknown.length ? (
        <>
          <h3 className="spaced">Reader numbers that belong to nobody</h3>
          <p className="muted small">
            {unknown.length} number{unknown.length === 1 ? '' : 's'}, {n(totals.unknownPunches)}{' '}
            punches. These are being collected and cannot be given to anybody — somebody who has
            left, was never added, or whose number is typed differently here.
          </p>
          <p className="mono small">
            {unknown.slice(0, 40).map((u) => `${u.id} (${u.punches})`).join(', ')}
            {unknown.length > 40 ? ` … and ${unknown.length - 40} more` : ''}
          </p>
        </>
      ) : null}
    </section>
  );
}
