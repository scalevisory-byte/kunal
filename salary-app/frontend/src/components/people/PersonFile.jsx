import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import {
  pendingFor,
  recentFor,
  serviceOf,
  statusOf,
  summaryFor,
} from '../../../../shared/personFile.js';
import { rupees } from '../../format.js';
import Records from './Records.jsx';
import Appraisals from './Appraisals.jsx';
import Claims from './Claims.jsx';
import Tasks from './Tasks.jsx';
import Helpdesk from './Helpdesk.jsx';
import Leaving from './Leaving.jsx';

/*
 * One person, everything about them that is not pay, attendance or leave.
 *
 * The panels underneath are the SAME components the "Everyone" view uses,
 * handed one person instead of all of them. Two copies of a claims table is
 * exactly the duplication the brief warns about, and the second copy is always
 * the one that quietly stops matching.
 *
 * Deliberately not here, because each already has a home and pointing at it
 * beats copying it: the employee master and their documents (Employees → the
 * person's record), attendance and hours (Attendance, Time), pay (Salary
 * sheet, the payslip), leave (Leave) and the asset register (Assets).
 */

const TABS = [
  ['overview', 'Overview'],
  ['records', 'Warnings & appreciations'],
  ['appraisals', 'Appraisals'],
  ['claims', 'Claims'],
  ['tasks', 'Tasks'],
  ['helpdesk', 'Helpdesk'],
  ['leaving', 'Leaving'],
  ['activity', 'Activity'],
];

export default function PersonFile({ employee, employees, companies, period, me, onError, onReload, onBack }) {
  const [tab, setTab] = useState('overview');
  const [file, setFile] = useState(null);

  /* Everything about this one person, from the panels that own each part. */
  const load = async () => {
    try {
      const [notes, appraisals, claims, tasks, tickets] = await Promise.all([
        api.get(`/people/notes?employee_id=${employee.id}`),
        api.get(`/people/appraisals?employee_id=${employee.id}`),
        api.get(`/people/claims?employee_id=${employee.id}`),
        api.get(`/people/tasks?employee_id=${employee.id}`),
        api.get(`/people/tickets?employee_id=${employee.id}`),
      ]);
      /*
       * An exit is a 404 for almost everybody, which is not an error - it is
       * the normal answer for somebody who is not leaving.
       */
      let exit = null;
      try {
        const found = await api.get(`/people/exits/${employee.id}`);
        exit = found?.exit || null;
      } catch {
        exit = null;
      }
      setFile({
        employee,
        notes: notes.notes || [],
        appraisals: appraisals.appraisals || [],
        claims: claims.claims || [],
        tasks: tasks.tasks || [],
        tickets: tickets.tickets || [],
        documents: [],
        exit,
      });
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    setFile(null);
    setTab('overview');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id]);

  /*
   * Re-read whenever the Overview is opened.
   *
   * The panels underneath are the office-wide ones and most of them do not
   * take an onReload - Records does not - so recording a warning on this
   * person's file left the Overview still saying "nothing on their file yet",
   * which is worse than a stale figure: it reads as a fault. Coming back to
   * the summary re-reads it, which is also when somebody is looking.
   */
  useEffect(() => {
    if (tab === 'overview' || tab === 'activity') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const pending = useMemo(() => (file ? pendingFor(file) : []), [file]);
  const recent = useMemo(() => (file ? recentFor(file) : []), [file]);
  const recentAll = useMemo(() => (file ? recentFor(file, { limit: 500 }) : []), [file]);
  const totals = useMemo(() => (file ? summaryFor(file) : null), [file]);
  const status = statusOf(employee, file?.exit);
  const company = companies.find((c) => c.id === employee.company_id);
  const manager = employees.find((e) => e.id === employee.reports_to_id);

  // The panels take the same props they always did, narrowed to one person.
  const props = {
    // The pickers inside each panel get this ONE person, because there is
    // nobody else on this screen to pick.
    employees: [employee],
    companies,
    period,
    me,
    onError,
    onReload: () => {
      onReload?.();
      load();
    },
    only: employee,
  };

  return (
    <section className="stack person-file">
      <header className="pf-head">
        <button className="link" onClick={onBack}>← Everyone</button>
        <div className="pf-who">
          <h2>{employee.name}</h2>
          <span className={`pf-status ${status.key}`}>{status.label}</span>
        </div>
        <dl className="pf-facts">
          <Fact k="Employee ID" v={employee.code || `#${employee.id}`} />
          <Fact k="Company" v={company?.name} />
          <Fact k="Department" v={employee.department} />
          <Fact k="Designation" v={employee.designation} />
          <Fact k="Joined" v={employee.joined_on} extra={serviceOf(employee.joined_on)} />
          <Fact k="Reports to" v={manager?.name} />
        </dl>
        <p className="muted small">
          Their master details, documents and KYC are on their record under Employees; pay is on
          the salary sheet, hours on Attendance and Time, leave on Leave, and anything issued to
          them on Assets. This tab is only what those do not cover.
        </p>
      </header>

      <nav className="tabs sub-tabs">
        {TABS.map(([key, name]) => (
          <button key={key} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)}>
            {name}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="stack">
          <div className="card">
            <h3>Needs doing</h3>
            {!file ? (
              <p className="loading">Reading their file…</p>
            ) : !pending.length ? (
              <p className="muted small">Nothing waiting on anybody for {firstName(employee.name)}.</p>
            ) : (
              <div className="lines">
                {pending.map((item) => (
                  <div key={item.text}>
                    <span className="what">
                      <span className={`pf-dot ${item.urgency}`} aria-hidden="true" />
                      {item.text}
                    </span>
                    <button className="link" onClick={() => setTab(item.go === 'documents' || item.go === 'overview' ? 'overview' : item.go)}>
                      open
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {totals ? (
            <div className="card">
              <h3>On the record</h3>
              <div className="figures">
                <Figure n={totals.warnings} k="Warnings" onClick={() => setTab('records')} />
                <Figure n={totals.appreciations} k="Appreciations" onClick={() => setTab('records')} />
                <Figure n={totals.increments} k="Increments" onClick={() => setTab('appraisals')} />
                <Figure n={totals.open_tasks} k="Open tasks" onClick={() => setTab('tasks')} />
                <Figure n={totals.open_tickets} k="Open questions" onClick={() => setTab('helpdesk')} />
              </div>
              {totals.last_increment ? (
                <p className="muted small">
                  Last increment {totals.last_increment.reviewed_on}:{' '}
                  {rupees(totals.last_increment.from_salary)} → {rupees(totals.last_increment.to_salary)}
                  {totals.last_increment.cycle ? ` (${totals.last_increment.cycle})` : ''}
                </p>
              ) : (
                <p className="muted small">No increment has been applied through an appraisal yet.</p>
              )}
              {totals.claims_paid_total ? (
                <p className="muted small">
                  {rupees(totals.claims_paid_total)} of claims paid through the payroll.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="card">
            <h3>Lately</h3>
            {!file ? (
              <p className="loading">…</p>
            ) : !recent.length ? (
              <p className="muted small">Nothing on their file yet.</p>
            ) : (
              <div className="lines">
                {recent.map((e, i) => (
                  <div key={`${e.on}-${i}`}>
                    <span className="what">
                      <strong className="pf-what">{e.what}</strong> {e.text}
                    </span>
                    <span className="muted small num">{e.on}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'records' && <Records {...props} />}
      {tab === 'appraisals' && <Appraisals {...props} />}
      {tab === 'claims' && <Claims {...props} />}
      {tab === 'tasks' && <Tasks {...props} />}
      {tab === 'helpdesk' && <Helpdesk {...props} />}
      {tab === 'leaving' && <Leaving {...props} />}
      {tab === 'activity' && (
        <div className="card">
          <h3>Everything on this file</h3>
          {!file ? (
            <p className="loading">…</p>
          ) : !recentAll.length ? (
            <p className="muted small">Nothing on their file yet.</p>
          ) : (
            <div className="lines">
              {recentAll.map((e, i) => (
                <div key={`${e.on}-${i}`}>
                  <span className="what">
                    <strong className="pf-what">{e.what}</strong> {e.text}
                  </span>
                  <span className="muted small num">{e.on}</span>
                </div>
              ))}
            </div>
          )}
          {/*
            * Said plainly rather than faking a filter. The change trail is
            * keyed on the record that changed, not on a person, so narrowing
            * it to somebody would mean matching on their name - which breaks
            * on two Vaibhavs and on anybody who is ever renamed.
            */}
          <p className="muted small">
            This is what happened to {firstName(employee.name)}. Who CHANGED what, with dates
            and the old value, is the office-wide trail under Everyone → Trail.
          </p>
        </div>
      )}
    </section>
  );
}

function Fact({ k, v, extra }) {
  return (
    <div className="pf-fact">
      <dt>{k}</dt>
      <dd>
        {v || <span className="muted">—</span>}
        {v && extra ? <span className="muted small"> · {extra}</span> : null}
      </dd>
    </div>
  );
}

function Figure({ n, k, onClick }) {
  return (
    <div className="figure">
      <button className="n" onClick={onClick}>{n}</button>
      <span className="k">{k}</span>
    </div>
  );
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'them';
