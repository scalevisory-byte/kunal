import { useEffect, useRef, useState } from 'react';
import {
  STANDALONE,
  api,
  download,
  downloadBackup,
  eraseEverything,
  restoreBackup,
} from '../api.js';
import AttendanceReport from './AttendanceReport.jsx';
import AttendanceRequests from './AttendanceRequests.jsx';
import PunchImport from './PunchImport.jsx';
import MonthlyStatusImport from './MonthlyStatusImport.jsx';
import Statutory from './Statutory.jsx';
import LeaveRegister from './LeaveRegister.jsx';
import ReportFilters from './ReportFilters.jsx';
import { CATEGORIES, REPORTS, STATUS, catalogueTotals, reportsIn } from '../../../shared/reportCatalog.js';
import { rupees } from '../format.js';

/**
 * Every report in one place, by category.
 *
 * This screen used to be a card of download buttons, with the rest of the
 * reports scattered across six other tabs. Somebody looking for "the late
 * coming report" had no way to know where it was — or whether it existed.
 *
 * Now the listing comes from `shared/reportCatalog.js`, so it cannot claim a
 * report the system does not have, or quietly leave one out. A report that is
 * not built yet is LISTED and says so, rather than being hidden to make the
 * screen look finished.
 *
 * Nothing here recalculates anything. Each report opens the panel or the file
 * that already produces it, which is why the totals reconcile with payroll by
 * construction rather than by checking.
 */
export default function Reports({ period, payroll, onReload, onGo, employees = [], companies = [], focus, onFocused}) {
  const tools = useRef(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  /*
   * Arriving here with "import" means somebody pressed a button on another
   * tab to get to it. Open the fold, scroll to it, and hand the request back
   * so switching away and returning does not keep re-opening it.
   */
  useEffect(() => {
    if (focus !== 'import') return;
    setToolsOpen(true);
    const at = tools.current;
    if (at) requestAnimationFrame(() => at.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    onFocused?.();
  }, [focus, onFocused]);

  const [openId, setOpenId] = useState(null);
  const [filters, setFilters] = useState({
    company_id: '', branch_id: '', department: '', employee_id: '', from: '', to: '', q: '',
  });
  const [query, setQuery] = useState('');
  const [openCategory, setOpenCategory] = useState('attendance');
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

  /*
   * Where each report actually comes from. A panel renders inline; a file is
   * downloaded; a tab is somewhere it has not been moved off yet, and says so
   * rather than pretending to live here.
   */
  const PANELS = {
    'payroll-by-company': () => <Totals period={period} payroll={payroll} grab={grab} />,
    'cost-company': () => <Totals period={period} payroll={payroll} grab={grab} />,
    'attendance-register': () => (payroll ? <AttendanceReport payroll={payroll} /> : null),
    'attendance-percent': () => (payroll ? <AttendanceReport payroll={payroll} /> : null),
    absenteeism: () => (payroll ? <AttendanceReport payroll={payroll} /> : null),
    'attendance-approvals': () => (
      <AttendanceRequests period={period} onReload={onReload} onError={(err) => setError(err.message)} />
    ),
    'leave-status': () => (
      <AttendanceRequests period={period} onReload={onReload} onError={(err) => setError(err.message)} />
    ),
    'leave-month': () => (payroll ? <LeaveRegister payroll={payroll} /> : null),
    'leave-lop': () => (payroll ? <LeaveRegister payroll={payroll} /> : null),
    'pf-register': () => <Statutory period={period} />,
    'esi-register': () => <Statutory period={period} />,
    'pt-register': () => <Statutory period={period} />,
    'wage-register': () => <Statutory period={period} />,
  };

  const FILES = period
    ? {
        'salary-register': [`/periods/${period.id}/export.xlsx`, `Salary-${period.label}.xlsx`],
        'sunday-register': [`/periods/${period.id}/sunday.csv`, `Sunday-${period.label}.csv`],
        'sunday-holiday-pay': [`/periods/${period.id}/sunday.csv`, `Sunday-${period.label}.csv`],
        'bank-register': [`/periods/${period.id}/bank.csv`, `Bank-${period.label}.csv`],
        'unpaid-salary': [`/periods/${period.id}/bank.csv`, `Bank-${period.label}.csv`],
        'leave-balance': [`/leave.csv?year=${period.year}`, `Leave-${period.year}.csv`],
        'employee-master': ['/employees.csv', 'Employees.csv'],
        'employee-active': ['/employees.csv', 'Employees.csv'],
      }
    : {};

  /*
   * These do not belong to a month, so they are available whether or not one
   * is open — and they are real files the app already serves. The asset and
   * hiring rows used to send somebody off to another tab, which is not a
   * report, which is why those categories looked empty from here.
   */
  Object.assign(FILES, {
    'asset-register': ['/people/assets/register.csv', 'Asset-register.csv'],
    'asset-allocation': ['/people/assets/register.csv', 'Asset-register.csv'],
    'asset-handovers': ['/people/assets/handovers.csv', 'Asset-handovers.csv'],
    'asset-services': ['/people/maintenance/services.csv', 'Asset-services.csv'],
    'asset-maintenance': ['/people/maintenance/services.csv', 'Asset-services.csv'],
    'asset-cost': ['/people/maintenance/ownership.csv', 'Asset-cost-of-ownership.csv'],
    'hiring-pipeline': ['/hiring/export/pipeline.csv', 'Hiring-pipeline.csv'],
    'hiring-candidates': ['/hiring/export/candidates.csv', 'Hiring-candidates.csv'],
  });

  const TAB_LABEL = {
    hiring: 'Hiring',
    dashboard: 'Dashboard', time: 'Time', attendance: 'Attendance', sheet: 'Salary sheet',
    people: 'People', employees: 'Employees', assets: 'Assets', loans: 'Loans',
  };

  const open = REPORTS.find((r) => r.id === openId) || null;
  const totals = catalogueTotals();

  /*
   * The tree, filtered by the search box. A search looks across every
   * category at once — somebody who knows a report is called "Wage register"
   * should not have to know it lives under Statutory.
   */
  const hunt = query.trim().toLowerCase();
  const tree = CATEGORIES.map((category) => ({
    ...category,
    rows: reportsIn(category.key).filter(
      (r) => !hunt || r.name.toLowerCase().includes(hunt) || category.label.toLowerCase().includes(hunt)
    ),
  })).filter((c) => c.rows.length > 0);

  const found = tree.reduce((n, c) => n + c.rows.length, 0);

  return (
    <section className="report-shell">
      {/*
        * A report tree, the way accounting software has always done it: one
        * line per report under its heading, the open one marked, and a search
        * that reaches all of them. The table of chips and notes that was here
        * before made nine lines of every report and buried the list.
        */}
      <aside className="report-tree">
        <input
          className="search"
          placeholder="Find a report"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hunt && (
          <p className="muted small">
            {found} of {totals.total} {found === 1 ? 'report' : 'reports'}
          </p>
        )}
        {tree.map((category) => (
          <details key={category.key} open={Boolean(hunt) || category.key === openCategory}>
            <summary title={category.hint}>{category.label}</summary>
            <ul>
              {category.rows.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    className={`${report.id === openId ? 'on' : ''} s-${report.status}`}
                    title={report.note || STATUS[report.status].label}
                    onClick={() => {
                      setOpenId(report.id);
                      setOpenCategory(category.key);
                    }}
                  >
                    {report.name}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {!tree.length && <p className="muted small">Nothing called that.</p>}
      </aside>

      <div className="report-body stack">
        {!open ? (
          <div className="card">
            <h2>Reports</h2>
            <p className="muted small">
              Pick one from the list. {totals.total} in all — {totals.ready} ready,{' '}
              {totals.partial} that work but are not yet a report of their own, and{' '}
              {totals.planned} still to be built. The ones not finished are listed too, so the
              gaps are visible rather than hidden.
            </p>
            {!period && <p className="muted small">No month is open.</p>}
          </div>
        ) : (
          <div className="card">
            <div className="late-head">
              <div>
                <p className="muted small">
                  {CATEGORIES.find((c) => c.key === open.category)?.label}
                  {period ? ` · ${period.label}` : ''}
                </p>
                <h2>{open.name}</h2>
                {open.status !== 'ready' && (
                  <p className="small">
                    <span className={`chip ${STATUS[open.status].tone}`}>
                      {STATUS[open.status].label}
                    </span>{' '}
                    <span className="muted">{open.note}</span>
                  </p>
                )}
              </div>
              {FILES[open.id] && (
                <button className="primary" onClick={() => grab(...FILES[open.id])}>
                  Download
                </button>
              )}
              {!FILES[open.id] && open.at?.startsWith('tab:') && (
                <button onClick={() => onGo?.(open.at.slice(4))}>
                  Open the {TAB_LABEL[open.at.slice(4)] || ''} tab
                </button>
              )}
            </div>

            <ReportFilters
              report={open}
              employees={employees}
              companies={companies}
              value={filters}
              onChange={setFilters}
            />

            {PANELS[open.id] ? (
              PANELS[open.id]()
            ) : FILES[open.id] ? (
              <p className="muted small">
                Downloads as a CSV, which opens in Excel. Everything in it comes from the same
                records the salary sheet is paid from.
              </p>
            ) : open.at?.startsWith('tab:') ? (
              <p className="muted small">
                This one lives on the {TAB_LABEL[open.at.slice(4)]} tab and has not been brought
                across yet.
              </p>
            ) : (
              <p className="muted small">
                Not built yet. {open.note}
              </p>
            )}
          </div>
        )}

      {error && <p className="error">{error}</p>}

      {/*
        * Open on demand, and say so by scrolling to itself.
        *
        * Everything that brings data in lives behind this fold, and Dinesh
        * asked for "excel import ka option" that was already here - which
        * means it was not findable. The Attendance toolbar now sends people
        * straight to it, so it has to arrive open and on screen rather than
        * as one more closed line to notice.
        */}
      <details className="card fold" ref={tools} open={toolsOpen} onToggle={(e) => setToolsOpen(e.currentTarget.open)}>
        <summary>
          <strong>Tools</strong>
          <span className="muted small"> — bringing data in, and taking a backup out</span>
        </summary>
        <div className="stack">
          {/*
            * With no month open, both attendance importers simply VANISHED -
            * they write onto a month's grid and there was none. What was left
            * was the salary-sheet importer, which is the one Dinesh then put
            * his BasicWorkDurationReport.xls into, and it told him to re-save
            * the file as .xlsx. Perfectly true, and completely the wrong
            * advice: his file was fine, the month was missing.
            *
            * So the gap says what it is and offers the way out of it.
            */}
          {period ? (
            <>
              <MonthlyStatusImport period={period} onReload={onReload} />
              <PunchImport period={period} onReload={onReload} />
            </>
          ) : (
            <div className="card">
              <h2>Attendance needs a month first</h2>
              <p className="muted small">
                The two attendance importers — the machine's month-wide report and the punch log —
                write onto a month's grid, and no month is open yet. Open one with{' '}
                <strong>New month</strong> at the top of this page and they will appear here.
              </p>
              <p className="muted small">
                Importing the staff list below works without one; attendance does not.
              </p>
            </div>
          )}
      <div className="card">
        <h2>Import a salary sheet</h2>
        <p className="muted small">
          Reads a tab laid out like the April sheet: company in column A, name in C, day marks in D–AG,
          monthly salary in AL. Employees are matched by company and name, so importing the same sheet
          twice updates rather than duplicates.
        </p>
        {/* .xls is listed although this one needs a .xlsx - see PunchImport.
            An invisible file is a worse answer than an explained one. */}
        <input
          type="file"
          accept=".xls,.xlsx,.xlsm"
          onChange={(e) => pickFile(e.target.files?.[0] || null)}
        />

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

          {/*
            * Empty it.
            *
            * Asked for by name — a clean file to test with, or to hand on. It
            * is the one button here with no undo, so it asks twice: once for
            * the backup, once for the word. The backup taken beside it is the
            * only way back.
            */}
          <h3 style={{ margin: '1.1rem 0 0.3rem', fontSize: '0.84rem' }}>Start again, empty</h3>
          <p className="muted small">
            Clears every company, person, month, mark and record from this browser. The staff
            list this file was sent with goes too. <strong>There is no undo</strong> — take the
            backup above first, or it is gone.
          </p>
          <button
            onClick={async () => {
              if (
                !window.confirm(
                  'Erase everything in this browser?\n\n' +
                    'Every company, person, month and mark. There is no undo.\n\n' +
                    'Have you taken the backup above?'
                )
              )
                return;
              const said = window.prompt('Type ERASE to confirm.');
              if (String(said || '').trim().toUpperCase() !== 'ERASE') return;
              setError('');
              try {
                await eraseEverything();
                await onReload();
              } catch (err) {
                setError(`Could not erase: ${err.message}`);
              }
            }}
          >
            Erase everything
          </button>
        </div>
      )}
        </div>
      </details>
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

/** The month's figures and the files that go out — Payroll → company summary. */
function Totals({ period, payroll, grab }) {
  if (!payroll) return <p className="muted">Open a month first.</p>;
  return (
    <>

            <div className="stat-row">
              <Stat label="Employees" value={payroll.totals.count} plain />
              <Stat label="Gross" value={payroll.totals.gross_salary} />
              <Stat label="PT" value={payroll.totals.pt} />
              <Stat label="ESI" value={payroll.totals.esi} />
              <Stat label="PF" value={payroll.totals.pf} />
              <Stat label="Net payable" value={payroll.totals.net_salary} strong />
              <Stat label="Sunday (paid apart)" value={payroll.totals.sunday_salary} />
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
                    <th>Net payable</th>
                    <th title="Settled on the Sunday register, not in the salary above">Sunday</th>
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
                      <td className="num grand">{rupees(c.totals.net_salary)}</td>
                      <td className="num">{rupees(c.totals.sunday_salary)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="button-row">
              <button
                className="primary"
                title="The three sheets you send out: bank salary, cash salary, and Sunday + Festival"
                onClick={() =>
                  grab(`/periods/${period.id}/pack.xlsx`, `Salary-Pack-${period.label}.xlsx`)
                }
              >
                Monthly report pack
              </button>
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
              {/*
                * These two do not belong to a month - the leave register is a
                * year and the staff list is right now - so they sit beside the
                * month's files rather than inside them.
                */}
              {!STANDALONE && (
                <>
                  <button onClick={() => grab(`/leave.csv?year=${period.year}`, `Leave-${period.year}.csv`)}>
                    Leave register ({period.year})
                  </button>
                  <button onClick={() => grab('/employees.csv', 'Employees.csv')}>Staff list</button>
                </>
              )}
            </div>
            <p className="muted small">
              <strong>Monthly report pack</strong> is the one that goes out: three sheets in the
              layout you already circulate — <em>{period.label.split(' ')[0].slice(0, 3)}-
              {String(period.year).slice(2)}</em> for everyone paid by bank, the same again for
              everyone paid in cash, and <em>Sunday + Festival</em> for the days settled apart.
              Your marks (P / A / HF / W/O / H/O), your columns, live formulas. <strong>Download
              Excel</strong> is the app's own fuller layout, with the hours and OT columns.
            </p>
    </>
  );
}
