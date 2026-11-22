import { useEffect, useState } from 'react';
import { STANDALONE, api } from '../api.js';
import { PUNCH_ID_COLUMNS, REACH, punchIdReport } from '../../../shared/punchIdReport.js';
import { col, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';
import ScrollFrame from './ScrollFrame.jsx';

/**
 * Whose attendance can actually arrive.
 *
 * Dinesh: *"punch id report kahi dikhta he?"* — it did not. The number was a
 * column on the Employees table and a list inside the import panel that
 * vanished with the file. This is the standing answer.
 *
 * It computes in the browser off the staff list, like the leave register and
 * the absent/present report, so the single-file build gets it too. The one
 * thing it asks the server for is **which reader numbers belong to nobody**,
 * which only exists where punches have been collected.
 */
export default function PunchIdReport({ employees = [], onGo }) {
  const [seen, setSeen] = useState([]);

  useEffect(() => {
    if (STANDALONE) return;
    api
      .get('/devices')
      .then((body) => setSeen(body?.unknownIds || []))
      .catch(() => setSeen([]));
  }, []);

  const report = punchIdReport({ people: employees, seen });
  const { counts } = report;

  const csv = () =>
    toCsv(
      PUNCH_ID_COLUMNS.map(([, label]) => label),
      report.rows.map((r) => PUNCH_ID_COLUMNS.map(([key]) => r[key] ?? '')),
    );

  const download = () => {
    const blob = new Blob(['﻿', csv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'punch-ids.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="card">
      <h2>Punch IDs — whose attendance can arrive</h2>
      <p className="muted small">
        The readers know people by a <strong>number</strong> and hold no names at all. Anybody
        without one never appears in a punch, however well the machines run &mdash; and nothing
        else on any screen says so.
      </p>

      {/*
        * `.late-figs` is the established class - value first in a <b>, then
        * what it is in an <em>. A class invented here with no CSS behind it
        * renders as one run-on sentence; that is exactly what `.late-figures`
        * did in v1.82, and I wrote `.figs` and did it again. Measured.
        */}
      <div className="late-figs">
        <span><b>{counts.staff}</b> <em>on the staff list</em></span>
        <span><b>{counts.own}</b> <em>with a Punch ID</em></span>
        <span><b>{counts.fallback}</b> <em>matching on their employee code</em></span>
        <span className={counts.none ? 'charge' : undefined}>
          <b>{counts.none}</b> <em>cannot be reached</em>
        </span>
      </div>

      {counts.none > 0 ? (
        <p className="note small">
          <strong>
            {counts.none} {counts.none === 1 ? 'person' : 'people'} will never receive attendance
            from the machines
          </strong>{' '}
          until a Punch ID is put on their record. They are at the top of the list below.{' '}
          {onGo ? (
            <button type="button" className="ghost" onClick={() => onGo('employees')}>
              Fill them in →
            </button>
          ) : null}
        </p>
      ) : (
        <p className="ok small">Every active person can be matched to a punch.</p>
      )}

      {/*
        * Two people on one number is not a tidiness problem: every punch on it
        * lands on whichever of them the importer meets first, so one person is
        * paid for the other's attendance.
        */}
      {counts.clashes > 0 ? (
        <div className="note small">
          <p className="warn">
            <strong>
              {counts.clashes} {counts.clashes === 1 ? 'number is' : 'numbers are'} on more than
              one person.
            </strong>{' '}
            Every punch on such a number lands on one of them, so somebody is paid for somebody
            else&rsquo;s attendance. One of each pair is wrong.
          </p>
          <ul>
            {report.clashes.map((c) => (
              <li key={c.id}>
                <strong>{c.id}</strong> — {c.people.join(' and ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="row gap wrap">
        <button type="button" onClick={download}>Download CSV</button>
        <button type="button" className="ghost" onClick={print}>Print</button>
      </div>

      <ScrollFrame>
        <table className="sheet">
          <thead>
            <tr>
              {PUNCH_ID_COLUMNS.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.employee_id} className={r.reach === REACH.none ? 'bad-row' : undefined}>
                <td className="sticky-name">
                  {r.name}
                  {r.clash ? <span className="warn small"> · shared number</span> : null}
                </td>
                <td className="mono small">{r.code}</td>
                <td className="small">{r.company}</td>
                <td className="small">{r.department}</td>
                <td className="mono">{r.device_code || <span className="muted">—</span>}</td>
                <td className="mono small">{r.matches_on || <span className="muted">nothing</span>}</td>
                <td className={r.reach === REACH.none ? 'warn small' : 'small'}>{r.reach_label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollFrame>

      {/* ---------------- numbers nobody carries ---------------- */}

      {STANDALONE ? (
        <p className="muted small">
          Which reader numbers belong to nobody can only be worked out where punches have been
          collected, so that half needs the server.
        </p>
      ) : report.unknown.length ? (
        <>
          <h3 className="spaced">Numbers on the readers that belong to nobody</h3>
          <p className="muted small">
            {report.unknown.length} number{report.unknown.length === 1 ? '' : 's'}
            {counts.unknownPunches != null
              ? `, ${counts.unknownPunches.toLocaleString('en-IN')} punches`
              : ''}
            . These are being collected and cannot be given to anybody — somebody who has left,
            never been added, or whose number is typed differently here.
          </p>
          <p className="mono small">
            {report.unknown.slice(0, 40).map((u) => `${u.id} (${u.punches})`).join(', ')}
            {report.unknown.length > 40 ? ` … and ${report.unknown.length - 40} more` : ''}
          </p>
        </>
      ) : counts.unknownPunches === null ? (
        <p className="muted small">
          Nothing has been collected from our own readers yet, so this cannot yet say which
          numbers belong to nobody.
        </p>
      ) : null}
    </section>
  );
}
