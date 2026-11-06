import { useMemo, useState } from 'react';
import { STANDALONE } from '../../api.js';
import { serviceOf, statusOf } from '../../../../shared/personFile.js';
import PersonFile from './PersonFile.jsx';
import Records from './Records.jsx';
import Appraisals from './Appraisals.jsx';
import Claims from './Claims.jsx';
import Penalties from './Penalties.jsx';
import Tasks from './Tasks.jsx';
import Helpdesk from './Helpdesk.jsx';
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

const PANELS = [
  ['records', 'On the record'],
  ['appraisals', 'Appraisals'],
  ['claims', 'Claims'],
  ['penalties', 'Penalties'],
  ['tasks', 'Tasks'],
  ['helpdesk', 'Helpdesk'],
  ['leaving', 'Leaving'],
  ['reminders', 'Reminders'],
  ['trail', 'Trail'],
];

const STATUSES = [
  ['', 'Everyone'],
  ['working', 'Working'],
  ['probation', 'On probation'],
  ['leaving', 'Serving notice'],
  ['left', 'Left'],
];

export default function People({
  employees, companies, period, me, companyId = null, onError, onReload,
}) {
  const [panel, setPanel] = useState('records');
  const [picked, setPicked] = useState(null);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');

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

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inCompany
      .filter((e) => !department || e.department === department)
      .filter((e) => !status || statusOf(e).key === status)
      .filter(
        (e) =>
          !needle ||
          [e.name, e.code, e.designation, e.department, e.phone]
            .some((f) => String(f || '').toLowerCase().includes(needle))
      )
      .slice(0, 200);
  }, [inCompany, query, department, status]);

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

      <div className="card person-find">
        <div className="pf-find-row">
          <input
            className="search"
            value={query}
            placeholder="Find somebody — name, employee ID, designation"
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="field inline">
            Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="field inline">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        {query.trim() || department || status ? (
          <div className="pf-results">
            {!found.length ? (
              <p className="muted small">Nobody matches.</p>
            ) : (
              found.map((e) => {
                const where = statusOf(e);
                return (
                  <button key={e.id} className="pf-hit" onClick={() => setPicked(e.id)}>
                    <span className="pf-hit-name">{e.name}</span>
                    <span className="muted small">
                      {[e.code, e.designation, e.department].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <span className={`pf-status ${where.key}`}>{where.label}</span>
                    <span className="muted small num">{serviceOf(e.joined_on)}</span>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <p className="muted small">
            Type a name to open one person’s file — everything on them in one place. Or use the
            lists below, which are the same records across the whole office.
          </p>
        )}
      </div>

      <div className="tabs sub-tabs">
        {PANELS.map(([key, label]) => (
          <button key={key} className={panel === key ? 'active' : undefined} onClick={() => setPanel(key)}>
            {label}
          </button>
        ))}
      </div>

      {panel === 'records' && <Records {...props} />}
      {panel === 'appraisals' && <Appraisals {...props} />}
      {panel === 'claims' && <Claims {...props} />}
      {panel === 'penalties' && <Penalties {...props} />}
      {panel === 'tasks' && <Tasks {...props} />}
      {panel === 'helpdesk' && <Helpdesk {...props} />}
      {panel === 'leaving' && <Leaving {...props} />}
      {panel === 'reminders' && <Reminders {...props} />}
      {panel === 'trail' && <Trail {...props} />}
    </section>
  );
}
