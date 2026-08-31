import { useState } from 'react';
import { STANDALONE, api, download, downloadBackup, restoreBackup } from '../api.js';
import PunchImport from './PunchImport.jsx';
import Statutory from './Statutory.jsx';
import { rupees } from '../format.js';

/** Totals, downloads, and pulling an existing spreadsheet in. */
export default function Reports({ period, payroll, onReload }) {
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheet, setSheet] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const pickFile = async (chosen) => {
    setFile(chosen);
    setSheets([]);
    setSheet('');
    setResult(null);
    setError('');
    if (!chosen) return;
    setBusy('Reading…');
    try {
      const form = new FormData();
      form.append('file', chosen);
      const { sheets: found } = await api.upload('/import/sheets', form);
      setSheets(found);
      // The salary tab is usually the one named after the month.
      const match = found.find((s) => s.name.trim().toLowerCase() === (period?.label || '').split(' ')[0].toLowerCase());
      setSheet((match || found[0])?.name || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const runImport = async (dryRun) => {
    if (!file || !sheet) return;
    setBusy(dryRun ? 'Checking…' : 'Importing…');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('sheet', sheet);
      form.append('dry_run', String(dryRun));
      if (period) form.append('period_id', String(period.id));
      const res = await api.upload('/import', form);
      setResult(res);
      if (!dryRun) await onReload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const grab = async (path, filename) => {
    setError('');
    try {
      await download(path, filename);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="stack">
      <div className="card">
        <h2>{period ? period.label : 'No month open'} — totals</h2>
        {payroll ? (
          <>
            <div className="stat-row">
              <Stat label="Employees" value={payroll.totals.count} plain />
              <Stat label="Gross" value={payroll.totals.gross_salary} />
              <Stat label="PT" value={payroll.totals.pt} />
              <Stat label="ESI" value={payroll.totals.esi} />
              <Stat label="PF" value={payroll.totals.pf} />
              <Stat label="Net" value={payroll.totals.net_salary} />
              <Stat label="Sunday" value={payroll.totals.sunday_salary} />
              <Stat label="Payable" value={payroll.totals.final_payable} strong />
            </div>

            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th className="sticky-name">Company</th>
                    <th>Staff</th>
                    <th>Gross</th>
                    <th>PT</th>
                    <th>ESI</th>
                    <th>PF</th>
                    <th>Net</th>
                    <th>Sunday</th>
                    <th>Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.companies.map((c) => (
                    <tr key={c.company_id}>
                      <td className="sticky-name">{c.company_name}</td>
                      <td className="num">{c.totals.count}</td>
                      <td className="num">{rupees(c.totals.gross_salary)}</td>
                      <td className="num">{rupees(c.totals.pt)}</td>
                      <td className="num">{rupees(c.totals.esi)}</td>
                      <td className="num">{rupees(c.totals.pf)}</td>
                      <td className="num">{rupees(c.totals.net_salary)}</td>
                      <td className="num">{rupees(c.totals.sunday_salary)}</td>
                      <td className="num grand">{rupees(c.totals.final_payable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="button-row">
              <button onClick={() => grab(`/periods/${period.id}/export.xlsx`, `Salary-${period.label}.xlsx`)}>
                Download Excel
              </button>
              <button onClick={() => grab(`/periods/${period.id}/export.csv`, `Salary-${period.label}.csv`)}>
                Download CSV
              </button>
              <button onClick={() => grab(`/periods/${period.id}/bank.csv`, `Bank-${period.label}.csv`)}>
                Payment list (unpaid)
              </button>
              <button onClick={() => grab(`/periods/${period.id}/sunday.csv`, `Sunday-${period.label}.csv`)}>
                Sunday register
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Open a month first.</p>
        )}
      </div>

      {STANDALONE && (
        <div className="card">
          <h2>This file holds your data</h2>
          <p className="muted small">
            Everything lives in this browser, on this device. Nobody else can see it, and it is not
            on any server — which also means it is not backed up anywhere. Take a backup before
            clearing browsing data, changing computer, or at the end of a payroll run.
          </p>
          <div className="button-row">
            <button onClick={downloadBackup}>Download backup</button>
            <label className="restore">
              Restore a backup
              <input
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const chosen = e.target.files?.[0];
                  e.target.value = '';
                  if (!chosen) return;
                  if (!window.confirm('Replace everything in this browser with the backup?')) return;
                  setError('');
                  try {
                    await restoreBackup(chosen);
                    await onReload();
                  } catch (err) {
                    setError(`That backup could not be read: ${err.message}`);
                  }
                }}
              />
            </label>
          </div>
        </div>
      )}

      <Statutory period={period} />

      {period && <PunchImport period={period} onReload={onReload} />}

      <div className="card">
        <h2>Import a salary sheet</h2>
        <p className="muted small">
          Reads a tab laid out like the April sheet: company in column A, name in C, day marks in D–AG,
          monthly salary in AL. Employees are matched by company and name, so importing the same sheet
          twice updates rather than duplicates.
        </p>
        <input type="file" accept=".xlsx,.xlsm" onChange={(e) => pickFile(e.target.files?.[0] || null)} />

        {sheets.length > 0 && (
          <div className="inline-form">
            <label>
              Tab
              <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
                {sheets.map((s) => (
                  <option key={s.name} value={s.name}>{s.name} ({s.rows} rows)</option>
                ))}
              </select>
            </label>
            <button disabled={!!busy} onClick={() => runImport(true)}>Check first</button>
            <button className="primary" disabled={!!busy || !period} onClick={() => runImport(false)}>
              Import into {period?.label || '…'}
            </button>
          </div>
        )}

        {busy && <p className="muted">{busy}</p>}
        {error && <p className="error">{error}</p>}

        {result && (
          <div className="result">
            {result.dryRun ? (
              <p>
                <strong>{result.parsed}</strong> employees found on <strong>{result.sheet}</strong>
                {result.skipped.length > 0 && <> · {result.skipped.length} rows could not be read</>}.
                Nothing has been saved yet.
              </p>
            ) : (
              <p>
                Imported <strong>{result.parsed}</strong> rows from <strong>{result.sheet}</strong>:{' '}
                {result.created} new employees, {result.updated} updated, {result.rowsWritten} payroll
                rows{result.attendanceMarks ? `, ${result.attendanceMarks} attendance marks` : ''}.
              </p>
            )}
            {result.skipped?.length > 0 && (
              <ul className="skipped">
                {result.skipped.slice(0, 10).map((s) => (
                  <li key={s.row}>Row {s.row} {s.name ? `(${s.name})` : ''} — {s.reason}</li>
                ))}
              </ul>
            )}
            {result.preview?.length > 0 && (
              <div className="table-wrap">
                <table className="sheet">
                  <thead>
                    <tr><th className="sticky-name">Name</th><th>Company</th><th>Salary</th><th>Absent</th><th>Sun</th></tr>
                  </thead>
                  <tbody>
                    {result.preview.map((p) => (
                      <tr key={p.row}>
                        <td className="sticky-name">{p.name}</td>
                        <td>{p.company}</td>
                        <td className="num">{rupees(p.salary)}</td>
                        <td className="num">{p.absent ?? '-'}</td>
                        <td className="num">{p.sundays ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, strong, plain }) {
  return (
    <div className={`stat${strong ? ' strong' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{plain ? value : rupees(value)}</span>
    </div>
  );
}
