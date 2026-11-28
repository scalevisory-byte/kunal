import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import Glyph from '../../icons.jsx';
import { Avatar } from '../EmployeePhoto.jsx';
import { todayIso } from '../../../../shared/today.js';
import { serviceOf, statusOf } from '../../../../shared/personFile.js';
import PersonFile from './PersonFile.jsx';
import Records from './Records.jsx';
import Appraisals from './Appraisals.jsx';
import Claims from './Claims.jsx';
import Penalties from './Penalties.jsx';
import Helpdesk from './Helpdesk.jsx';
import Noticeboard from './Noticeboard.jsx';
import Leaving from './Leaving.jsx';
import Reminders from './Reminders.jsx';
import Trail from './Trail.jsx';

/**
 * People: the paper trail around somebody that is not pay, attendance or leave.
 *
 * It has two shapes, because the office asks two different questions and one
 * screen cannot answer both.
 *
 *   EVERYONE  - "which claims are waiting?", "what is overdue?" One screen per
 *               record type, listing the whole office. This is what the tab
 *               has always been and nothing has been taken out of it.
 *
 *   ONE PERSON - "what is going on with Vaibhav?" Which used to mean opening
 *               six panels and remembering. Pick a name and you get their
 *               file, built from the SAME panels narrowed to them.
 *
 * What it deliberately does not hold: the employee master and their documents
 * (Employees -> their record), attendance and hours, pay, leave, and the asset
 * register. Each has a module; this points at them rather than copying them,
 * which is how two screens start disagreeing.
 */

/*
 * v2.41.0: the names the redesign briefs asked for. The KEYS are unchanged,
 * so every reminder line and link that opens a panel by key still lands.
 */
const PANELS = [
  ['records', 'Employee Records', 'person'],
  ['appraisals', 'Performance Reviews', 'bars'],
  ['claims', 'Claims & Expenses', 'rupee'],
  ['penalties', 'Disciplinary', 'alert'],
  /* Tasks moved to the Task desk tab (v2.35.0): Dinesh, "task desk already
     banaya he to yaha pe need nahi". The desk holds these same rows, with the
     thread and the statuses, so a second list here was two answers. */
  ['helpdesk', 'Helpdesk', 'help'],
  ['noticeboard', 'Noticeboard', 'bell'],
  ['leaving', 'Exit Management', 'employees'],
  ['reminders', 'Reminders', 'clock'],
  ['trail', 'Activity Log', 'reports'],
];

const STATUSES = [
  ['', 'Everyone'],
  ['working', 'Working'],
  ['probation', 'On probation'],
  ['leaving', 'Serving notice'],
  ['left', 'Left'],
];

export default function People({
  employees, companies, period, me, companyId = null, onError, onReload, focus = null, onFocused,
  onAddEmployee, onOpenRecord,
}) {
  const [panel, setPanel] = useState('records');
  /* A reminder line ("2 expense claims to approve") names the panel that can
     act on it, so arriving here lands on that panel, not on the first one. */
  useEffect(() => {
    if (focus && PANELS.some(([key]) => key === focus)) {
      setPanel(focus);
      onFocused?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  const [picked, setPicked] = useState(null);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [designation, setDesignation] = useState('');
  const [location, setLocation] = useState('');
  const [page, setPage] = useState(1);
  /*
   * What is waiting on HR, for the figures at the top. Read from the same
   * lists the panels below show - nothing counted twice or kept apart.
   */
  const [waiting, setWaiting] = useState(null);
  const [exits, setExits] = useState(new Map());
  useEffect(() => {
    let alive = true;
    (async () => {
      const safe = (p) => p.catch(() => null);
      const [claims, tickets, appraisals, leaving] = await Promise.all([
        safe(api.get('/people/claims')),
        safe(api.get('/people/tickets')),
        safe(api.get('/people/appraisals')),
        safe(api.get('/people/exits')),
      ]);
      if (!alive) return;
      setWaiting({
        claims: (claims?.claims || []).filter((c) => c.status === 'pending').length,
        tickets: (tickets?.tickets || []).filter((t) => t.status !== 'closed').length,
        reviews: (appraisals?.appraisals || []).filter((a) => !a.applied_at).length,
      });
      setExits(new Map((leaving?.exits || []).map((x) => [x.employee_id, x])));
    })();
    return () => {
      alive = false;
    };
  }, []);

  /*
   * The company filter running across the whole app narrows this too. It never
   * reached People before, so "BOOKNFLY" on the strip above showed SCALE's
   * staff here - which is the opposite of company-wise access.
   */
  const inCompany = useMemo(
    () => employees.filter((e) => !companyId || e.company_id === companyId),
    [employees, companyId]
  );

  const departments = useMemo(
    () => [...new Set(inCompany.map((e) => e.department).filter(Boolean))].sort(),
    [inCompany]
  );

  const designations = useMemo(
    () => [...new Set(inCompany.map((e) => e.designation).filter(Boolean))].sort(),
    [inCompany]
  );
  const locations = useMemo(
    () => [...new Set(inCompany.map((e) => e.work_location || e.branch_name).filter(Boolean))].sort(),
    [inCompany]
  );
  /* The status a person reads includes an open exit, so "Serving notice"
     finds somebody who has resigned - it never could before. */
  const statusFor = (e) => statusOf(e, exits.get(e.id));

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inCompany
      .filter((e) => !department || e.department === department)
      .filter((e) => !designation || e.designation === designation)
      .filter((e) => !location || (e.work_location || e.branch_name) === location)
      .filter((e) => !status || statusFor(e).key === status)
      .filter(
        (e) =>
          !needle ||
          [e.name, e.code, e.designation, e.department, e.phone, e.email, e.office_email]
            .some((f) => String(f || '').toLowerCase().includes(needle))
      )
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCompany, query, department, designation, location, status, exits]);
  useEffect(() => setPage(1), [query, department, designation, location, status, companyId]);

  const counts = useMemo(() => {
    const out = { total: inCompany.length, working: 0, probation: 0, leaving: 0, left: 0, joined: 0 };
    const month = todayIso().slice(0, 7);
    for (const e of inCompany) {
      out[statusFor(e).key] += 1;
      if (String(e.joined_on || '').startsWith(month)) out.joined += 1;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCompany, exits]);

  const filtered = Boolean(query.trim() || department || designation || location || status);
  const reset = () => {
    setQuery('');
    setDepartment('');
    setDesignation('');
    setLocation('');
    setStatus('');
  };

  const person = picked ? employees.find((e) => e.id === picked) : null;

  if (person) {
    return (
      <PersonFile
        employee={person}
        employees={employees}
        companies={companies}
        period={period}
        me={me}
        onError={onError}
        onReload={onReload}
        onBack={() => setPicked(null)}
      />
    );
  }

  const props = { employees: inCompany, companies, period, me, onError, onReload };

  return (
    <section className="stack">
      {/*
        * Said once, at the top, rather than switching the tab off: what is
        * missing offline is a second person, not the records.
        */}
      {STANDALONE && (
        <p className="muted small">
          All of this works in this file. What it cannot do is involve anybody else: you raise a
          claim and you approve it, an employee cannot open the helpdesk themselves, and the
          trail’s “who” is a name typed on a form — which is true of the server version too,
          since there is one shared password.
        </p>
      )}

      {/* ---------------- header ---------------- */}
      <div className="pp-head">
        <div>
          <h2 className="pp-title">People</h2>
          <p className="muted small">
            Everybody's file — reviews, claims, disciplinary records, helpdesk, notices and exits — in one place.
          </p>
        </div>
        {onAddEmployee ? (
          <button className="primary pp-add" onClick={onAddEmployee}>+ Add employee</button>
        ) : null}
      </div>

      {/* ---------------- what needs attention ---------------- */}
      <div className="ao-kpis pp-kpis">
        {[
          ['employees', 'Total employees', counts.total, `${counts.joined} joined this month`, 'navy', () => { reset(); setPanel('records'); }],
          ['person', 'Working', counts.working + counts.probation, `${counts.probation} on probation`, 'green', () => { reset(); setStatus('working'); setPanel('records'); }],
          ['clock', 'Serving notice', counts.leaving, 'an exit not yet settled', 'orange', () => { reset(); setStatus('leaving'); setPanel('leaving'); }],
          ['close', 'Left', counts.left, 'not active', 'grey', () => { reset(); setStatus('left'); setPanel('records'); }],
          ['bars', 'Reviews not applied', waiting ? waiting.reviews : '…', 'performance reviews', 'blue', () => setPanel('appraisals')],
          ['rupee', 'Claims waiting', waiting ? waiting.claims : '…', 'to approve', 'orange', () => setPanel('claims')],
          ['help', 'Open tickets', waiting ? waiting.tickets : '…', 'helpdesk', 'red', () => setPanel('helpdesk')],
        ].map(([icon, label, n, hint, tone, go]) => (
          <button key={label} type="button" className={`ao-kpi tone-${tone}`} onClick={go}>
            <span className="ao-kpi-icon"><Glyph name={icon} size={18} /></span>
            <span className="ao-kpi-text">
              <span className="k">{label}</span>
              <span className="n">{n}</span>
              <span className="h">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      {/* ---------------- one search and filter bar ---------------- */}
      <div className="card pp-filters">
        <input
          className="search"
          value={query}
          placeholder="Search name, employee ID, designation, email or phone"
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={designation} onChange={(e) => setDesignation(e.target.value)} aria-label="Designation">
          <option value="">All designations</option>
          {designations.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {locations.length ? (
          <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location">
            <option value="">All locations</option>
            {locations.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        ) : null}
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map(([key, label]) => <option key={key} value={key}>{key ? label : 'Any status'}</option>)}
        </select>
        <span className="muted small pp-count">{found.length} of {inCompany.length}</span>
        {filtered ? <button className="ghost small" onClick={reset}>Reset</button> : null}
      </div>

      {/* ---------------- the sections ---------------- */}
      <div className="sub-tabs toolbar pp-tabs">
        {PANELS.map(([key, label, icon]) => (
          <button key={key} className={panel === key ? 'active' : undefined} onClick={() => setPanel(key)}>
            <Glyph name={icon} size={14} /> {label}
          </button>
        ))}
      </div>

      {/* The staff directory heads Employee Records: a person is the way into
          their whole file. A filter that finds them opens it in one click. */}
      {panel === 'records' || filtered ? (
        <Directory
          rows={found}
          page={page}
          setPage={setPage}
          statusFor={statusFor}
          companies={companies}
          filtered={filtered}
          onReset={reset}
          onPick={setPicked}
          onOpenRecord={onOpenRecord}
          onAddEmployee={onAddEmployee}
        />
      ) : null}

      {panel === 'records' && <Records {...props} />}
      {panel === 'appraisals' && <Appraisals {...props} />}
      {panel === 'claims' && <Claims {...props} />}
      {panel === 'penalties' && <Penalties {...props} />}
      {panel === 'helpdesk' && <Helpdesk {...props} />}
      {panel === 'noticeboard' && <Noticeboard companies={companies} onError={onError} />}
      {panel === 'leaving' && <Leaving {...props} />}
      {panel === 'reminders' && <Reminders {...props} />}
      {panel === 'trail' && <Trail {...props} />}
    </section>
  );
}

/**
 * The staff directory: avatar, name and ID, job, company, joining date and
 * status, a page at a time. A row opens that person's file here; "Record"
 * opens their master record on Employees, where it is edited.
 */
const PAGE = 25;
function Directory({ rows, page, setPage, statusFor, companies, filtered, onReset, onPick, onOpenRecord, onAddEmployee }) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages);
  const shown = rows.slice((at - 1) * PAGE, at * PAGE);
  const companyName = (id) => companies.find((c) => c.id === id)?.name || '';
  if (!rows.length) {
    return (
      <div className="card pp-empty">
        <span className="pp-empty-icon"><Glyph name="employees" size={30} /></span>
        <h3>{filtered ? 'Nobody matches' : 'No employees yet'}</h3>
        <p className="muted">
          {filtered
            ? 'Nobody on the staff list fits this search and these filters. Clear them, or add the person if they have just joined.'
            : 'Add the first employee and their file starts here: reviews, claims, records and their exit, all in one place.'}
        </p>
        <div className="row">
          {filtered ? <button onClick={onReset}>Clear filters</button> : null}
          {onAddEmployee ? <button className="primary" onClick={onAddEmployee}>+ Add employee</button> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="card pp-directory">
      <div className="table-wrap unboxed">
        <table className="sheet pp-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Designation</th>
              <th>Department</th>
              <th>Company</th>
              <th>Joined</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const where = statusFor(e);
              return (
                <tr key={e.id} className="pp-row" onClick={() => onPick(e.id)}>
                  <td>
                    <span className="pp-person">
                      <Avatar employee={e} />
                      <span>
                        <button type="button" className="link name-link" onClick={(ev) => { ev.stopPropagation(); onPick(e.id); }}>{e.name}</button>
                        <span className="muted small pp-code">{e.code || `#${e.id}`}</span>
                      </span>
                    </span>
                  </td>
                  <td>{e.designation || <span className="muted">—</span>}</td>
                  <td>{e.department || <span className="muted">—</span>}</td>
                  <td className="muted small">{e.company_name || companyName(e.company_id) || '—'}</td>
                  <td className="small">
                    {e.joined_on || '—'}
                    {e.joined_on ? <span className="muted"> · {serviceOf(e.joined_on)}</span> : null}
                  </td>
                  <td><span className={`pf-status ${where.key}`}>{where.label}</span></td>
                  <td className="pp-actions" onClick={(ev) => ev.stopPropagation()}>
                    <button className="ghost small" onClick={() => onPick(e.id)}>Open file</button>
                    {onOpenRecord ? <button className="ghost small" onClick={() => onOpenRecord(e.id)}>Record</button> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="asset-pager">
        <span className="muted small">Showing {(at - 1) * PAGE + 1}–{Math.min(at * PAGE, rows.length)} of {rows.length}</span>
        <span className="grow" />
        <button className="ghost small" disabled={at <= 1} onClick={() => setPage(at - 1)}>‹</button>
        <span className="small">Page {at} of {pages}</span>
        <button className="ghost small" disabled={at >= pages} onClick={() => setPage(at + 1)}>›</button>
      </div>
    </div>
  );
}
