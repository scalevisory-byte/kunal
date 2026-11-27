import { useEffect, useMemo, useRef, useState } from 'react';
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
import BizcompassImport from './BizcompassImport.jsx';
import PunchDevices from './PunchDevices.jsx';
import Statutory from './Statutory.jsx';
import LeaveRegister from './LeaveRegister.jsx';
import { LeaveApplications, LeaveBalanceReport, LeaveByDepartment } from './LeaveReports.jsx';
import AppraisalSheet from './AppraisalSheet.jsx';
import { DeductionStatement, SalaryByDepartment } from './PayReports.jsx';
import MissingPunch from './MissingPunch.jsx';
import PunchIdReport from './PunchIdReport.jsx';
import PunchTotals from './PunchTotals.jsx';
import PunchLog from './PunchLog.jsx';
import InOutRegister from './InOutRegister.jsx';
import LoanSettlement from './LoanSettlement.jsx';
import ContactList from './ContactList.jsx';
import DocumentRegister from './DocumentRegister.jsx';
import ReportFilters from './ReportFilters.jsx';
import { CATEGORIES, REPORTS, STATUS, catalogueTotals, reportsIn } from '../../../shared/reportCatalog.js';
import { rupees } from '../format.js';
import { printFromCsv } from '../printCsv.js';

import AttendanceSheet from './AttendanceSheet.jsx';
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
  /*
   * THE FILTER BAR HAS TO ACTUALLY FILTER.
   *
   * Dinesh sent a screenshot of Salary deductions with Company set to
   * BOOKNFLY PRIVATE LIMITED and all 86 people still in it, on screen and in
   * the print. Nine panels took `payroll` whole and never looked at
   * `filters` - the bar was drawn because the catalogue says those reports
   * accept a company and a department, and then nothing read it.
   *
   * Narrowed ONCE here and handed to every panel that takes a month, rather
   * than nine panels each growing their own idea of what a filter means.
   * The original object is passed through untouched when nothing is
   * narrowed, so a report that was right stays byte-identical.
   */
  const shown = useMemo(() => {
    if (!payroll) return null;
    const rows = (payroll.rows || []).filter(
      (r) =>
        (!filters.company_id || String(r.company_id) === String(filters.company_id)) &&
        (!filters.department || String(r.department || '') === String(filters.department)) &&
        (!filters.employee_id || String(r.employee_id) === String(filters.employee_id))
    );
    return rows.length === (payroll.rows || []).length ? payroll : { ...payroll, rows };
  }, [payroll, filters.company_id, filters.department, filters.employee_id]);

  const [query, setQuery] = useState('');
  const [openCategory, setOpenCategory] = useState('attendance');

  /*
   * Arriving with "approvals" means somebody clicked the dashboard line
   * saying staff are waiting on a decision. That line used to open People,
   * which does not hold this queue - so the one line telling the office
   * somebody had applied for leave led nowhere.
   *
   * It has to run after `openId` exists, which is why it is here rather than
   * beside the "import" effect above.
   */
  useEffect(() => {
    if (focus !== 'approvals') return;
    setOpenCategory('attendance');
    setOpenId('attendance-approvals');
    onFocused?.();
  }, [focus, onFocused]);
  /* "N documents not checked yet" on the dashboard opens the register that
     can check them, already narrowed to those. */
  const [docsOnly, setDocsOnly] = useState('');
  useEffect(() => {
    if (focus !== 'documents') return;
    setOpenCategory('employee');
    setOpenId('employee-documents');
    setDocsOnly('unchecked');
    onFocused?.();
  }, [focus, onFocused]);
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

  const [printing, setPrinting] = useState(false);

  const grab = async (path, filename) => {
    setError('');
    try {
      await download(path, filename);
    } catch (err) {
      setError(err.message);
    }
  };

  /*
   * PRINTING ONE.
   *
   * The lines under the title say what this document IS - the month and the
   * filters that were on when it was taken. A printed register with no
   * month on it is a page somebody has to ask about.
   */
  const printOne = async (report) => {
    setError('');
    setPrinting(true);
    try {
      const narrowed = [
        period ? period.label : null,
        filters.company_id
          ? companies.find((c) => String(c.id) === String(filters.company_id))?.name
          : null,
        filters.department || null,
        filters.employee_id
          ? employees.find((e) => String(e.id) === String(filters.employee_id))?.name
          : null,
      ].filter(Boolean);
      const [file, , printable] = FILES[report.id];
      const rows = await printFromCsv(printable || file, {
        title: report.name,
        subtitle: CATEGORIES.find((c) => c.key === report.category)?.label || '',
        meta: narrowed,
        footer: 'Booknfly HRMS — the same records the salary sheet is paid from.',
      });
      if (!rows) setError('There is nothing in this report for the month and filters chosen.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPrinting(false);
    }
  };

  /*
   * Where each report actually comes from. A panel renders inline; a file is
   * downloaded; a tab is somewhere it has not been moved off yet, and says so
   * rather than pretending to live here.
   */
  const PANELS = {
    'payroll-by-company': () => <Totals period={period} payroll={shown} grab={grab} />,
    'cost-company': () => <Totals period={period} payroll={shown} grab={grab} />,
    'attendance-register': () => (shown ? <AttendanceReport payroll={shown} /> : null),
    'attendance-percent': () => (shown ? <AttendanceReport payroll={shown} /> : null),
    absenteeism: () => (shown ? <AttendanceReport payroll={shown} /> : null),
    'attendance-approvals': () => (
      <AttendanceRequests period={period} onReload={onReload} onError={(err) => setError(err.message)} />
    ),
    'leave-status': () => (
      <LeaveApplications period={period} companyId={filters.company_id || null} onGo={onGo} />
    ),
    'missing-punch': () => (shown ? <MissingPunch payroll={shown} onGo={onGo} /> : null),
    /* Not a month's report: it reads the staff list as it is today, so it
       takes `employees` and not `shown`. */
    'punch-ids': () => <PunchIdReport employees={employees} onGo={onGo} />,
    'punch-totals': () => <PunchTotals period={period} onGo={onGo} />,
    'punch-log': () => <PunchLog period={period} employees={employees} onGo={onGo} />,
    'working-hours': () => (shown ? <InOutRegister payroll={shown} filters={filters} /> : null),
    'loan-settled': () => <LoanSettlement period={period} />,
    'employee-contacts': () => (
      <ContactList
        employees={employees}
        companyId={filters.company_id || null}
        department={filters.department || null}
      />
    ),
    deductions: () => (shown ? <DeductionStatement payroll={shown} /> : null),
    'cost-department': () => (shown ? <SalaryByDepartment payroll={shown} /> : null),
    'leave-by-department': () => (
      <LeaveByDepartment period={period} companyId={filters.company_id || null} />
    ),
    'appraisal-sheet': () => (shown ? <AppraisalSheet payroll={shown} onReload={onReload} onGo={onGo} /> : null),
    'leave-balance': () => (
      <LeaveBalanceReport
        period={period}
        companyId={filters.company_id || null}
        department={filters.department || null}
      />
    ),
    'leave-month': () => (shown ? <LeaveRegister payroll={shown} /> : null),
    'leave-lop': () => (shown ? <LeaveRegister payroll={shown} /> : null),
    'employee-documents': () => (
      <DocumentRegister
        startOn={docsOnly}
        companyId={filters.company_id || null}
        onGo={onGo}
        onError={(m) => setError(m)}
      />
    ),
    'pf-register': () => <Statutory period={period} show="pf" />,
    'esi-register': () => <Statutory period={period} show="esi" />,
    'pt-register': () => <Statutory period={period} show="pt" />,
    'wage-register': () => <Statutory period={period} show="wages" />,
  };

  const FILES = period
    ? {
        /* The download is the workbook, with its formulas and its sheets.
           PRINTING one takes the same month as a flat CSV - a spreadsheet
           is a zip, and there is nothing honest to lay out from it without
           a parser the standalone file cannot carry. Both come off the same
           calculated month. */
        'salary-register': [
          `/periods/${period.id}/export.xlsx`,
          `Salary-${period.label}.xlsx`,
          `/periods/${period.id}/export.csv`,
        ],
        'sunday-register': [`/periods/${period.id}/sunday.csv`, `Sunday-${period.label}.csv`],
        'sunday-holiday-pay': [`/periods/${period.id}/sunday.csv`, `Sunday-${period.label}.csv`],
        'bank-register': [`/periods/${period.id}/bank.csv`, `Bank-${period.label}.csv`],
        'unpaid-salary': [`/periods/${period.id}/bank.csv`, `Bank-${period.label}.csv`],
        'leave-balance': [`/leave.csv?year=${period.year}`, `Leave-${period.year}.csv`],
        'employee-master': ['/employees.csv', 'Employee-master.csv'],
        /*
         * THE ACTIVE LIST HAS TO BE NARROWED TO THE ACTIVE.
         *
         * Both entries fetched the same unfiltered file, so "Active employee
         * list" handed over everybody, leavers included - under a name that
         * says it does not. The route has taken `?active=` all along;
         * nothing was asking it to. They also shared one filename, so taking
         * both left the second as "Employees (1).csv" with nothing on the
         * name to tell them apart.
         */
        'employee-active': ['/employees.csv?active=1', 'Active-employees.csv'],
      }
    : {};

  /*
   * These do not belong to a month, so they are available whether or not one
   * is open — and they are real files the app already serves. The asset and
   * hiring rows used to send somebody off to another tab, which is not a
   * report, which is why those categories looked empty from here.
   */
  if (period) {
    /* The four statutory registers each have a CSV of their own - the panel
       shows them, and this is the same figures on paper. */
    Object.assign(FILES, {
      'pf-register': [`/periods/${period.id}/statutory/pf.csv`, `PF-${period.label}.csv`],
      'esi-register': [`/periods/${period.id}/statutory/esi.csv`, `ESI-${period.label}.csv`],
      'pt-register': [`/periods/${period.id}/statutory/pt.csv`, `PT-${period.label}.csv`],
      'wage-register': [`/periods/${period.id}/statutory/wages.csv`, `Wages-${period.label}.csv`],
    });
  }

  Object.assign(FILES, {
    'employee-documents': ['/documents/register.csv', 'Employee-documents.csv'],
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
              {/*
                * PRINT, beside Download.
                *
                * Dinesh: *"sare reports me proper printing reports dalo"*.
                * Half these reports were a download and nothing else, which
                * is right for a bank file and useless for a register the
                * office has to sign and file. The file is fetched and laid
                * out as a document - the same printer the muster roll and
                * the payslip use - with the month, the filters that were on
                * and a total under every column that is actually figures.
                *
                * Only a CSV: an .xlsx is a zip, and there is nothing honest
                * to print from it without a parser the standalone build
                * cannot carry.
                */}
              {FILES[open.id] && (FILES[open.id][2] || FILES[open.id][0]).includes('.csv') && (
                <button
                  disabled={printing}
                  onClick={() => printOne(open)}
                  title="Lays the same file out as a printed report"
                >
                  {printing ? 'Preparing…' : 'Print'}
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
              <AttendanceSheet
                period={period}
                locked={!!period.locked}
                onReload={onReload}
                onError={setError}
              />
              <PunchDevices period={period} onReload={onReload} onGo={onGo} />
              <BizcompassImport period={period} onReload={onReload} onGo={onGo} />
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
