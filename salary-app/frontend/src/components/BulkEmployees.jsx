import { useRef, useState } from 'react';
import { AuthError, STANDALONE, download, getToken } from '../api.js';

/**
 * The staff master, out to Excel and back.
 *
 * Dinesh: "bulk me employee update karne k liye?", then "sari chizo me xls ka
 * default format do jisse bulk import ho sake".
 *
 * ONE FILE BOTH WAYS, deliberately. The download is the template: the staff
 * already down the page, every column headed and explained on a second sheet.
 * Edit it, add rows underneath, send it back. Two formats - a blank template
 * and a separate export - would be two things to keep in step, and the first
 * mismatch would be somebody's salary.
 */
export default function BulkEmployees({ onReload, onError }) {
  const file = useRef(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');

  const grab = async (blank) => {
    setBusy('Making the file…');
    try {
      await download(
        `/employees/sheet${blank ? '?blank=true' : ''}`,
        blank ? 'Employees-template.xlsx' : 'Employees.xlsx',
      );
    } catch (err) {
      onError?.(err instanceof AuthError ? 'Sign in again' : err.message);
    } finally {
      setBusy('');
    }
  };

  const post = async (dryRun) => {
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    setBusy(dryRun ? 'Reading the file…' : 'Writing…');
    setDone('');
    try {
      const form = new FormData();
      form.append('file', chosen);
      form.append('dry_run', String(dryRun));
      const res = await fetch('/api/employees/sheet', {
        method: 'POST',
        headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {},
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'that file could not be read');
      if (dryRun) {
        setPlan(body);
      } else {
        setPlan(null);
        if (file.current) file.current.value = '';
        setDone(`${body.created} added, ${body.updated} updated.`);
        onReload?.();
      }
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy('');
    }
  };

  if (STANDALONE) {
    return (
      <div className="card">
        <h2>Staff list in Excel</h2>
        <p className="muted small">
          Reading and writing a workbook needs the server. In this single file, add and edit people
          on the list below.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Staff list in Excel — add or update in bulk</h2>
      <p className="muted small">
        Download the list, edit it in Excel, send it back. A row that matches somebody already here
        updates them; a row that matches nobody is added. <strong>A blank cell changes nothing</strong>,
        so a file with four columns filled in cannot wipe the other twenty.
      </p>

      {/*
        * Fetched, not a plain <a href>. Every /api route needs the bearer
        * token, and a browser does not put one on an ordinary link - the
        * download would have come back 401 and looked like a broken button.
        */}
      <div className="button-row">
        <button className="primary" disabled={!!busy} onClick={() => grab(false)}>
          Download the staff list
        </button>
        <button disabled={!!busy} onClick={() => grab(true)}>
          Blank template
        </button>
      </div>

      <div className="inline-form" style={{ marginTop: '0.6rem' }}>
        <input
          ref={file}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          onChange={() => {
            setPlan(null);
            setDone('');
          }}
        />
        <button disabled={!!busy} onClick={() => post(true)}>
          Check it first
        </button>
      </div>

      {busy ? <p className="muted small">{busy}</p> : null}
      {done ? <p className="banner good">{done}</p> : null}

      {plan ? (
        <>
          <div className="figures" style={{ marginTop: '0.6rem' }}>
            <Fig n={plan.counts.create} k="To add" />
            <Fig n={plan.counts.update} k="To update" />
            <Fig n={plan.counts.unchanged} k="Already right" />
            <Fig n={plan.counts.problems} k="Problems" />
          </div>

          {/*
            * The salary line is on its own, in its own banner. Everything
            * else on this sheet is a detail somebody can correct next week;
            * a salary is a payslip, and it must not arrive as one row among
            * ninety in a list nobody reads to the bottom.
            */}
          {plan.salaryMoves ? (
            <div className="banner bad">
              <strong>
                {plan.salaryMoves} {plan.salaryMoves === 1 ? 'salary changes' : 'salaries change'}.
              </strong>{' '}
              {plan.update
                .flatMap((u) =>
                  u.changes
                    .filter((c) => c.field === 'monthly_salary')
                    .map((c) => `${u.name}: ${c.from} → ${c.to}`),
                )
                .join(' · ')}
            </div>
          ) : null}

          {plan.newCompanies?.length ? (
            <div className="banner">
              <strong>New {plan.newCompanies.length === 1 ? 'company' : 'companies'}:</strong>{' '}
              {plan.newCompanies.join(', ')} — these will be created.
            </div>
          ) : null}

          {plan.problems?.length ? (
            <div className="banner bad">
              {plan.problems.map((p) => (
                <div key={p.row}>
                  Row {p.row} {p.name ? `(${p.name})` : ''} — {p.why}. Left alone.
                </div>
              ))}
            </div>
          ) : null}

          {plan.update?.length ? (
            <details className="fold" style={{ marginTop: '0.5rem' }}>
              <summary>
                What changes on {plan.update.length} {plan.update.length === 1 ? 'person' : 'people'}
              </summary>
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>Field</th>
                    <th>Now</th>
                    <th>Becomes</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.update.flatMap((u) =>
                    u.changes.map((c) => (
                      <tr key={`${u.id}-${c.field}`}>
                        <td>{u.name}</td>
                        <td>{c.label}</td>
                        <td className="muted">{String(c.from) || '—'}</td>
                        <td>
                          <strong>{String(c.to)}</strong>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </details>
          ) : null}

          {plan.create?.length ? (
            <p className="small" style={{ marginTop: '0.4rem' }}>
              <strong>Adding:</strong>{' '}
              {plan.create.slice(0, 12).map((c) => `${c.name} (${c.company})`).join(', ')}
              {plan.create.length > 12 ? ` and ${plan.create.length - 12} more` : ''}.
            </p>
          ) : null}

          {plan.unknownColumns?.length ? (
            <p className="muted small">
              Columns this app does not know, ignored:{' '}
              {plan.unknownColumns.map((c) => c.label).join(', ')}.
            </p>
          ) : null}

          <div className="button-row" style={{ marginTop: '0.6rem' }}>
            <button
              className="primary"
              disabled={!!busy || !(plan.counts.create + plan.counts.update)}
              onClick={() => post(false)}
            >
              {plan.counts.create + plan.counts.update
                ? `Write ${plan.counts.create} new and ${plan.counts.update} changed`
                : 'Nothing to write'}
            </button>
            <button className="ghost" onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Fig({ n, k }) {
  return (
    <div className="fig">
      <strong>{n}</strong>
      <span>{k}</span>
    </div>
  );
}
