import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import { REPORTS, asGrid, cell, reportFileName, reportMeta } from '../../../../shared/hiringReports.js';
import { toCsv } from '../../../../shared/hiringCsv.js';

/**
 * The recruitment reports.
 *
 * One screen, eleven reports, because they share a shape: pick one, narrow it,
 * read it, export it. Eleven tabs would have been eleven places to look for
 * the filter you just used.
 *
 * The columns come from shared/hiringReports.js, so the table, the print view
 * and the CSV cannot disagree about what is in the report.
 */
export default function HiringReports({ companies, companyId, vacancies = [], onError }) {
  const [key, setKey] = useState('schedule');
  const [filters, setFilters] = useState({});
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const report = reportMeta(key);

  useEffect(() => {
    if (STANDALONE) return;
    setBusy(true);
    const q = new URLSearchParams();
    // Only the filters this report actually uses are sent. One that did
    // nothing would still look as if it worked.
    for (const f of report.uses) {
      const v = f === 'company_id' ? filters.company_id ?? companyId : filters[f];
      if (v) q.set(f, v);
    }
    api
      .get(`/hiring/reports/${key}?${q}`)
      .then(({ rows: got }) => setRows(got || []))
      .catch(onError)
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filters, companyId]);

  const grid = useMemo(() => asGrid(report, rows), [report, rows]);

  if (STANDALONE) {
    return (
      <div className="card">
        <h2>Reports</h2>
        <p className="empty">
          These report on applications, interviews and offers, which live on the server.
        </p>
      </div>
    );
  }

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v || undefined }));
  const uses = (f) => report.uses.includes(f);

  const download = () => {
    const csv = toCsv(report.columns.map((c) => c.label), grid.rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFileName(key);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="card">
        <h2>Reports</h2>
        <div className="chips">
          {REPORTS.map((r) => (
            <button key={r.key} className={key === r.key ? 'chip active' : 'chip'} onClick={() => setKey(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="muted small">{report.hint}</p>

        <div className="rep-filters">
          {uses('from') ? (
            <label className="field">From<input type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
          ) : null}
          {uses('to') ? (
            <label className="field">To<input type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
          ) : null}
          {uses('company_id') ? (
            <label className="field">
              Company
              <select value={filters.company_id ?? ''} onChange={(e) => set('company_id', e.target.value)}>
                <option value="">All companies</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : null}
          {uses('vacancy_id') ? (
            <label className="field">
              Position
              <select value={filters.vacancy_id ?? ''} onChange={(e) => set('vacancy_id', e.target.value)}>
                <option value="">Every opening</option>
                {vacancies.map((v) => <option key={v.id} value={v.id}>{v.ref_no} · {v.title}</option>)}
              </select>
            </label>
          ) : null}
          {uses('department') ? (
            <label className="field">Department<input value={filters.department ?? ''} onChange={(e) => set('department', e.target.value)} /></label>
          ) : null}
          {uses('interviewer') ? (
            <label className="field">Interviewer<input value={filters.interviewer ?? ''} onChange={(e) => set('interviewer', e.target.value)} /></label>
          ) : null}
          {uses('round') ? (
            <label className="field">Round<input type="number" value={filters.round ?? ''} onChange={(e) => set('round', e.target.value)} /></label>
          ) : null}
          {uses('status') ? (
            <label className="field">
              Status
              <select value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
                <option value="">Any</option>
                {['Scheduled', 'Done', 'No show', 'Cancelled', 'Rescheduled'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          ) : null}
          <span className="spacer" />
          <button onClick={() => setFilters({})}>Clear</button>
          <button onClick={() => window.print()}>Print</button>
          <button className="primary" disabled={!rows.length} onClick={download}>Export CSV</button>
        </div>
      </div>

      <div className="card scroll">
        <p className="muted small">
          {busy ? 'Reading…' : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
          {' — every figure here was decided on another screen and stored. Nothing is worked out twice.'}
        </p>
        <table className="sheet hiring-table">
          <thead>
            <tr>
              {report.columns.map((c, i) => (
                <th key={c.key} className={i === 1 ? 'grow' : c.type === 'number' ? 'num' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {report.columns.map((c) => (
                  <td key={c.key} className={['number', 'money', 'percent'].includes(c.type) ? 'num' : 'small'}>
                    {cell(row, c) || <span className="muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!busy && !rows.length ? <p className="empty">Nothing matches. Try widening the dates.</p> : null}
      </div>
    </>
  );
}
