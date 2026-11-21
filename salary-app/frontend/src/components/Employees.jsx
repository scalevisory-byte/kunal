import { useEffect, useMemo, useState } from 'react';
import { col, num, printReport } from '../printReport.js';
import { openOnboarding } from '../../../shared/onboarding.js';
import EmployeeReport from './EmployeeReport.jsx';
import { DEFAULT_TEMPLATE, applyTemplate } from '../../../shared/structure.js';
import EmployeeProfile from './EmployeeProfile.jsx';
import EmployeeForm from './EmployeeForm.jsx';
import { Avatar } from './EmployeePhoto.jsx';
import OrgChart from './OrgChart.jsx';
import DepartmentManagers from './DepartmentManagers.jsx';
import { bulkManagerPlan } from '../../../shared/orgChart.js';
import { namePlan } from '../../../shared/properName.js';
import { rupees } from '../format.js';
import ScrollFrame from './ScrollFrame.jsx';
import ExitEmployee from './ExitEmployee.jsx';
import PastEmployees from './PastEmployees.jsx';

import BulkEmployees from './BulkEmployees.jsx';
/* The people with nothing in that field - a group, not a gap. */
const NOT_SET = '\u0000none';


/*
 * Naming people in a note. Capped, because the honest thing is to say who is
 * affected - not to print seventy-four names into a toolbar.
 */
const listNames = (people, limit = 6) =>
  people.length > limit
    ? `${people.slice(0, limit).map((p) => p.name).join(', ')} and ${people.length - limit} more`
    : people.map((p) => p.name).join(', ');

/** The employee master: who gets paid, and what their monthly salary is. */
/**
 * TAKE THE SHOUTING OUT OF THE NAMES.
 *
 * Dinesh, looking at the roll call: *"sab ke letters thik karo"* — ANSHIKA
 * GUPTA next to Mahek Gotawala, because eighty-five names were typed by
 * different people over two years.
 *
 * It SHOWS what it would do first and renames nobody until the button is
 * pressed. A name is somebody's own, and the one rule underneath is stated on
 * screen: a name already written in ordinary letters — McDonald, D'Souza — is
 * left alone, because there is no telling a deliberate capital from an
 * accidental one.
 */
function TidyNames({ people, busy, onApply, onClose }) {
  const plan = useMemo(() => namePlan(people), [people]);

  return (
    <div className="card">
      <h3>Tidy the capitalisation of names</h3>
      {!plan.count ? (
        <p className="muted small">
          Nothing to change — every name is already in ordinary letters.
          {plan.left_mixed ? ` ${plan.left_mixed} were left alone because they are already mixed.` : ''}
        </p>
      ) : (
        <>
          <p className="muted small">
            <strong>{plan.count}</strong> of {plan.total} would change.{' '}
            {plan.already_tidy ? `${plan.already_tidy} are already right. ` : ''}
            {plan.left_mixed
              ? `${plan.left_mixed} are left alone because somebody has already mixed their capitals — McDonald and D'Souza are not mistakes.`
              : ''}
          </p>
          <div className="table-wrap" style={{ maxHeight: '18rem' }}>
            <table className="sheet">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Now</th>
                  <th>Would become</th>
                </tr>
              </thead>
              <tbody>
                {plan.changing.map((row) => (
                  <tr key={row.id}>
                    <td className="muted small">{row.code || '—'}</td>
                    <td>{row.from}</td>
                    <td><strong>{row.to}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button className="primary" disabled={busy} onClick={() => onApply(plan.changing)}>
              {busy ? 'Renaming…' : `Change these ${plan.count}`}
            </button>
            <button className="ghost" disabled={busy} onClick={onClose}>
              Leave them
            </button>
          </div>
          <p className="muted small">
            Only the staff list changes. Payslips, attendance and every report read the name from
            here, so they follow — nothing already paid moves.
          </p>
        </>
      )}
    </div>
  );
}

export default function Employees({
  /* Somebody the dashboard asked to open; cleared once it has been. */
  openFor,
  onOpened,
  companies,
  employees,
  companyId,
  onCompany,
  onCreate,
  onPatch,
  onBulkPatch,
  onDelete,
  onCreateCompany,
  onPatchCompany,
  onDeleteCompany,
  onReload,
  onError,
}) {
  const [companyName, setCompanyName] = useState('');
  const [query, setQuery] = useState('');
  /*
   * Narrowing by the two fields that say where somebody sits. Not remembered
   * between visits, unlike the company filter: a company is where you work all
   * day, these are "show me the ticketing staff for a minute", and a filter
   * still on tomorrow is how people conclude half the staff have vanished.
   *
   * '' is everybody; NOT_SET is the people with nothing in that field, which
   * is a group worth acting on rather than a gap.
   */
  const [designation, setDesignation] = useState('');
  const [department, setDepartment] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState('');
  // Setting a religion one row at a time is fine for three people and hopeless
  // for seventy, so rows can be ticked and given one in a single go.
  const [picked, setPicked] = useState(() => new Set());
  /* The capitalisation tidy: shown first, applied only on the button. */
  const [tidying, setTidying] = useState(false);
  const [bulkReligion, setBulkReligion] = useState('');
  const [bulkDepartment, setBulkDepartment] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileFor, setProfileFor] = useState(null);
  const [adding, setAdding] = useState(false);
  /*
   * Opened from elsewhere - the dashboard's register has a "view" beside each
   * name. Cleared straight away so returning to this tab later does not
   * reopen a drawer nobody asked for.
   */
  useEffect(() => {
    if (!openFor) return;
    setProfileFor(openFor);
    onOpened?.();
  }, [openFor, onOpened]);
  // The same people, read two ways: down a list, or up a reporting line.
  const [asChart, setAsChart] = useState(false);
  const [reportFor, setReportFor] = useState(null);
  /*
   * Whose leaving is on screen. The row holds the whole employee rather than
   * an id, because the modal's header reads their name and dates before the
   * exit record has been fetched - and for somebody being exited today there
   * is no exit record to fetch yet.
   */
  const [exitFor, setExitFor] = useState(null);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [showTemplate, setShowTemplate] = useState(false);
  // Setting the reporting line one record at a time is the reason twenty-six
  // people had no manager at all.
  const [bulkManager, setBulkManager] = useState('');
  const [showManager, setShowManager] = useState(false);

  /* Everybody who has left, counted on the tick that reveals them. */
  const left = useMemo(() => employees.filter((e) => !e.active), [employees]);

  /* Everybody a filter could show: the active/inactive rule and nothing else. */
  const onShow = useMemo(
    () => employees.filter((e) => showInactive || e.active),
    [employees, showInactive]
  );

  /** Who works here, as a list somebody can file or hand round. */
  const printStaff = () => {
    const narrowed = [
      designation && `designation: ${designation}`,
      department && `department: ${department}`,
      query.trim() && `matching “${query.trim()}”`,
      showInactive && 'including people who have left',
    ].filter(Boolean);
    const names = [...new Set(filtered.map((e) => e.company_name).filter(Boolean))];
    printReport({
      title: 'Employee list',
      subtitle: [names.length === 1 ? names[0] : 'All companies', ...narrowed].join(' · '),
      meta: [`${filtered.length} of ${onShow.length} people`],
      landscape: true,
      columns: [
        col('#', (_e, i) => i + 1, '3%'),
        col('Name', (e) => e.name),
        col('Code', (e) => e.employee_code || ''),
        col('Company', (e) => e.company_name || ''),
        col('Designation', (e) => e.designation || ''),
        col('Department', (e) => e.department || ''),
        col('Joined', (e) => e.joined_on || ''),
        col('Left', (e) => e.left_on || ''),
        col('Born', (e) => e.dob || ''),
        num('Salary', (e) => (Number(e.monthly_salary) ? rupees(e.monthly_salary) : '—')),
        col('Pay by', (e) => e.payment_mode || ''),
        col('Status', (e) => (e.active ? 'Working' : 'Left')),
      ],
      rows: filtered,
      totals: {
        label: `Total (${filtered.length})`,
        Salary: rupees(filtered.reduce((t, e) => t + (Number(e.monthly_salary) || 0), 0)),
      },
      /*
       * SAID ON THE PAPER: this carries what everybody earns. The register
       * is printed from a screen only the office can open, and the sheet
       * itself has no such warning once it is off the screen.
       */
      footer:
        'This list carries salaries. It is for the office, not for circulating.',
    });
  };

  const matches = (value, chosen) =>
    !chosen || (chosen === NOT_SET ? !String(value || '').trim() : String(value || '').trim() === chosen);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(
      (e) =>
        (showInactive || e.active) &&
        (!companyId || e.company_id === companyId) &&
        matches(e.designation, designation) &&
        matches(e.department, department) &&
        (!q ||
          e.name.toLowerCase().includes(q) ||
          (e.company_name || '').toLowerCase().includes(q) ||
          // Typing a job title into the search should find it too, rather than
          // making somebody hunt for the right dropdown.
          (e.designation || '').toLowerCase().includes(q) ||
          (e.department || '').toLowerCase().includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, query, showInactive, companyId, designation, department]);

  /*
   * What is in each field, counted off the people the OTHER filters leave -
   * so choosing a company changes the designations offered, and a count of 0
   * never appears. Counted on the unfiltered-by-itself set, or picking a
   * designation would immediately hide every other option.
   */
  const choicesFor = (field, other, otherChosen) => {
    const pool = employees.filter(
      (e) =>
        (showInactive || e.active) &&
        (!companyId || e.company_id === companyId) &&
        matches(e[other], otherChosen)
    );
    const counts = new Map();
    for (const person of pool) {
      const key = String(person[field] || '').trim() || NOT_SET;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => (a[0] === NOT_SET) - (b[0] === NOT_SET) || a[0].localeCompare(b[0])
    );
  };

  const designationChoices = useMemo(
    () => choicesFor('designation', 'department', department),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, showInactive, companyId, department]
  );
  const departmentChoices = useMemo(
    () => choicesFor('department', 'designation', designation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, showInactive, companyId, designation]
  );

  /*
   * Rows that are ticked but no longer on screen.
   *
   * A tick survives a filter change, and every bulk action here works on what
   * is ticked - so narrowing to five people after ticking thirty-six would
   * quietly act on all thirty-six. Named and countable rather than guessed at
   * either way: dropping the ticks silently loses work, and acting on people
   * who are not on screen is worse.
   */
  const hidden = useMemo(
    () => [...picked].filter((id) => !filtered.some((e) => e.id === id)),
    [picked, filtered]
  );

  /**
   * Splitting a salary into Basic/HRA for everyone ticked.
   *
   * Each person is split from THEIR OWN salary, so one call cannot give two
   * people the same basic. The total is untouched in every case - the split
   * only describes the money already being paid.
   */
  const applyStructure = async () => {
    setBusy(true);
    setError('');
    try {
      const chosen = filtered.filter((e) => picked.has(e.id));
      for (const employee of chosen) {
        await onPatch(employee.id, applyTemplate(employee.monthly_salary, template));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Switching PF and ESI between the typed amount and the worked-out one for
   * everybody ticked. It is confirmed first, because unlike the salary split
   * this one really does change what people take home.
   */
  const applyModes = async (mode) => {
    setBusy(true);
    setError('');
    try {
      await onBulkPatch([...picked], { pf_mode: mode, esi_mode: mode });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const applyReligion = async (name) => {
    if (!picked.size) return;
    setBusy(true);
    setError('');
    try {
      await onBulkPatch([...picked], { religion: name.trim() });
      setBulkReligion('');
      setPicked(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * One manager over everybody ticked.
   *
   * Worked out against the WHOLE list, never the filtered one: with a company
   * chosen, somebody's manager can legitimately be in another company, and
   * judging a loop off a shortened list would miss one.
   */
  const managerPlan = useMemo(
    () => bulkManagerPlan(employees, [...picked], bulkManager),
    [employees, picked, bulkManager]
  );

  const applyManager = async () => {
    if (!managerPlan.setting.length) return;
    setBusy(true);
    setError('');
    try {
      await onBulkPatch(
        managerPlan.setting.map((p) => p.id),
        { reports_to_id: bulkManager ? Number(bulkManager) : null }
      );
      setPicked(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * A department for everybody ticked. Same shape as the religion setter,
   * and for the same reason: a field nobody has filled cannot be filtered or
   * grouped by, and the department-wise manager panel has nothing to go on
   * until this is done once.
   */
  const applyDepartment = async (name) => {
    if (!picked.size) return;
    setBusy(true);
    setError('');
    try {
      await onBulkPatch([...picked], { department: name.trim() });
      setBulkDepartment('');
      setPicked(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Whatever is already in use, plus the usual ones, as suggestions only -
  // the box takes anything typed into it.
  const religions = useMemo(() => {
    const inUse = employees.map((e) => e.religion).filter(Boolean);
    const common = ['Hindu', 'Muslim', 'Jain', 'Christian', 'Sikh', 'Buddhist', 'Parsi'];
    return [...new Set([...inUse, ...common])].sort();
  }, [employees]);

  const departments = useMemo(() => {
    const inUse = employees.map((e) => e.department).filter(Boolean);
    const common = ['Accounts', 'Operations', 'Sales', 'Admin', 'HR', 'Ticketing'];
    return [...new Set([...inUse, ...common])].sort();
  }, [employees]);

  return (
    <section className="stack">
      <datalist id="department-list">
        {departments.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="religion-list">
        {religions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className="card">
        <div className="toolbar">
          <input className="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          {/*
            * "Show inactive" said nothing about who was behind it. The list
            * it reveals is people who have LEFT, which is what somebody is
            * looking for when they cannot find an ex-employee, so the tick
            * says that and counts them.
            */}
          <label className="check" title="People who have left stay on every month they were paid in — they are only kept off the current list.">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show people who have left
            {left.length > 0 ? ` (${left.length})` : ''}
          </label>
          <button
            className={asChart ? 'active' : undefined}
            onClick={() => setAsChart((v) => !v)}
            title="Who reports to whom"
          >
            {asChart ? 'As a list' : 'Reporting line'}
          </button>
          <button
            className={tidying ? 'active' : undefined}
            onClick={() => setTidying((v) => !v)}
            title="ANSHIKA GUPTA beside Mahek Gotawala — take the shouting out"
          >
            Tidy names
          </button>
          <span className="grow" />
          <span className="muted small">
            {/* "of N" counts against the people a filter COULD show, so it
                appears only when one is actually narrowing - an inactive
                employee is not a hidden one. */}
            {filtered.length}
            {filtered.length !== onShow.length && ` of ${onShow.length}`} employees
          </span>
        </div>

        <div className="toolbar">
          {/* The staff list as a document - not the editable table it is on
              screen, where every cell is a box somebody types in. */}
          <button className="ghost" onClick={printStaff} disabled={!filtered.length}>
            Print {filtered.length}
          </button>
          <label className="pick">
            Designation
            <select value={designation} onChange={(e) => setDesignation(e.target.value)}>
              <option value="">All</option>
              {designationChoices.map(([value, count]) => (
                <option key={value} value={value}>
                  {value === NOT_SET ? 'Not set' : value} ({count})
                </option>
              ))}
            </select>
          </label>
          <label className="pick">
            Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All</option>
              {departmentChoices.map(([value, count]) => (
                <option key={value} value={value}>
                  {value === NOT_SET ? 'Not set' : value} ({count})
                </option>
              ))}
            </select>
          </label>
          {(designation || department) && (
            <button
              className="ghost"
              onClick={() => {
                setDesignation('');
                setDepartment('');
              }}
            >
              Clear the filter
            </button>
          )}
          <span className="grow" />
          <span className="muted small">
            Everything below — ticking, the bulk setters, the reporting line — works on what
            this leaves.
          </span>
        </div>

        {hidden.length > 0 && (
          <div className="bulk-bar warn-bar">
            <strong>
              {hidden.length} of the {picked.size} ticked{' '}
              {hidden.length === 1 ? 'is' : 'are'} not on screen
            </strong>
            <span className="muted small">
              The filter is hiding {hidden.length === 1 ? 'it' : 'them'}, but everything below
              still counts {hidden.length === 1 ? 'it' : 'them'}.
            </span>
            <span className="grow" />
            <button
              onClick={() => setPicked(new Set(filtered.filter((e) => picked.has(e.id)).map((e) => e.id)))}
            >
              Tick only what is on screen
            </button>
          </div>
        )}

        {tidying && (
          <TidyNames
            people={onShow}
            busy={busy}
            onApply={async (rows) => {
              setBusy(true);
              try {
                // One at a time, because each name is its own change - and
                // the list is reloaded once at the end rather than per row.
                for (const row of rows) await onBulkPatch([row.id], { name: row.to });
                setTidying(false);
              } finally {
                setBusy(false);
              }
            }}
            onClose={() => setTidying(false)}
          />
        )}

        {picked.size > 0 && (
          <div className="bulk-bar">
            <strong>{picked.size} selected</strong>
            <label>
              Set religion to
              <input
                list="religion-list"
                placeholder="e.g. Hindu, Muslim, Jain"
                value={bulkReligion}
                onChange={(e) => setBulkReligion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyReligion(bulkReligion)}
              />
            </label>
            <button className="primary" disabled={busy || !bulkReligion.trim()} onClick={() => applyReligion(bulkReligion)}>
              {busy ? 'Saving…' : `Apply to ${picked.size}`}
            </button>
            <button disabled={busy} onClick={() => applyReligion('')}>Clear</button>
            <label>
              Set department to
              <input
                list="department-list"
                placeholder="e.g. Accounts, Operations"
                value={bulkDepartment}
                onChange={(e) => setBulkDepartment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyDepartment(bulkDepartment)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !bulkDepartment.trim()}
              onClick={() => applyDepartment(bulkDepartment)}
            >
              {busy ? 'Saving…' : `Apply to ${picked.size}`}
            </button>
            <span className="grow" />
            <button className="ghost" onClick={() => setShowTemplate((v) => !v)}>
              {showTemplate ? 'Hide the split' : 'Split their salary'}
            </button>
            <button className="ghost" onClick={() => setShowManager((v) => !v)}>
              {showManager ? 'Hide the manager' : 'Set their manager'}
            </button>
            <label>
              PF / ESI
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const mode = e.target.value;
                  const count = picked.size;
                  const what = mode === 'auto' ? 'work PF and ESI out from the rules' : 'go back to the typed amounts';
                  if (
                    !window.confirm(
                      `Set ${count} ${count === 1 ? 'person' : 'people'} to ${what}?\n\n` +
                        (mode === 'auto'
                          ? 'This changes what is deducted, and so what they take home. Open one record first if you want to see the figures.'
                          : 'Deductions go back to the amount typed on each record.')
                    )
                  ) {
                    e.target.value = '';
                    return;
                  }
                  applyModes(mode);
                  e.target.value = '';
                }}
              >
                <option value="">Leave as is</option>
                <option value="auto">Work it out</option>
                <option value="fixed">Fixed amounts</option>
              </select>
            </label>
            <span className="grow" />
            <button className="ghost" onClick={() => setPicked(new Set())}>Deselect</button>
          </div>
        )}

        {picked.size > 0 && showTemplate && (
          <div className="bulk-bar wrap">
            <strong>Basic / HRA for {picked.size}</strong>
            <label>
              Basic %
              <input
                type="number"
                value={template.basicPercent}
                onChange={(e) => setTemplate({ ...template, basicPercent: Number(e.target.value) })}
              />
            </label>
            <label>
              HRA, % of basic
              <input
                type="number"
                value={template.hraPercentOfBasic}
                onChange={(e) => setTemplate({ ...template, hraPercentOfBasic: Number(e.target.value) })}
              />
            </label>
            <label>
              Conveyance ₹
              <input
                type="number"
                value={template.conveyance}
                onChange={(e) => setTemplate({ ...template, conveyance: Number(e.target.value) })}
              />
            </label>
            <label>
              Medical ₹
              <input
                type="number"
                value={template.medical}
                onChange={(e) => setTemplate({ ...template, medical: Number(e.target.value) })}
              />
            </label>
            <button className="primary" disabled={busy} onClick={applyStructure}>
              {busy ? 'Saving…' : `Apply to ${picked.size}`}
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onBulkPatch([...picked], { basic: 0, hra: 0, conveyance: 0, medical: 0 });
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Clear
            </button>
            <span className="note muted small">
              Each person is split from their own salary — the total never moves, so nobody&apos;s
              pay changes. HRA is {template.hraPercentOfBasic}% of basic because Vadodara and
              Surat are not metros for the exemption.
            </span>
          </div>
        )}

        {picked.size > 0 && showManager && (
          <div className="bulk-bar wrap">
            <strong>Reporting line for {picked.size}</strong>
            <label>
              They all report to
              <select value={bulkManager} onChange={(e) => setBulkManager(e.target.value)}>
                <option value="">Nobody — take the manager away</option>
                {employees
                  .filter((e) => e.active)
                  .slice()
                  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.designation ? ` — ${m.designation}` : ''}
                      {m.company_name && !companyId ? ` (${m.company_name})` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={busy || !managerPlan.setting.length}
              onClick={applyManager}
            >
              {busy
                ? 'Saving…'
                : managerPlan.setting.length
                  ? `Set ${managerPlan.setting.length}`
                  : 'Nothing to set'}
            </button>
            {/*
              * What it will and will not do, before it does it. A bulk action
              * that quietly skips the manager himself leaves the chart looking
              * finished when it is not, so every refusal is named here.
              */}
            <div className="note small stack-tight">
              {managerPlan.missing && (
                <div className="bad">
                  That manager is not on the list any more. Choose another one.
                </div>
              )}
              {managerPlan.setting.length > 0 && (
                <div>
                  {managerPlan.clearing
                    ? `${managerPlan.setting.length} will be left with no manager.`
                    : `${managerPlan.setting.length} will report to ${managerPlan.manager?.name}.`}
                  {managerPlan.replacing.length > 0 &&
                    ` ${managerPlan.replacing.length} of them already report to somebody else — that link is replaced: ${listNames(managerPlan.replacing)}.`}
                </div>
              )}
              {managerPlan.already.length > 0 && (
                <div className="muted">
                  {managerPlan.already.length}{' '}
                  {managerPlan.clearing ? 'had no manager anyway' : 'already report to them'} —{' '}
                  {listNames(managerPlan.already)}.
                </div>
              )}
              {managerPlan.self.length > 0 && (
                <div className="warn">
                  {listNames(managerPlan.self)} is the manager, and is left alone — nobody can
                  report to themselves.
                </div>
              )}
              {managerPlan.circular.length > 0 && (
                /* The refused people are the subject of the sentence. Put the
                   manager first and it reads as though THEY were skipped. */
                <div className="warn">
                  {listNames(managerPlan.circular)} {managerPlan.circular.length === 1 ? 'is' : 'are'}{' '}
                  left alone — {managerPlan.manager?.name} already reports to{' '}
                  {managerPlan.circular.length === 1 ? 'them' : 'one of them'}, so it would make the
                  line circle back on itself.
                </div>
              )}
              <div className="muted">
                Nobody&apos;s pay changes. This only says who reports to whom, and it can be set
                again or taken away.
              </div>
            </div>
          </div>
        )}

        {asChart ? (
          <div className="stack">
            {/* The department-wise setter lives with the chart, because that
                is where you look to see whether it worked. */}
            <DepartmentManagers
              employees={filtered}
              onBulkPatch={onBulkPatch}
              onError={(err) => setError(err.message)}
            />
            <OrgChart employees={filtered} onOpen={(e) => setProfileFor(e.id)} />
          </div>
        ) : (
        <ScrollFrame>
          <table className="sheet staff-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    title="Select everyone on screen"
                    checked={filtered.length > 0 && filtered.every((e) => picked.has(e.id))}
                    onChange={(e) =>
                      setPicked(e.target.checked ? new Set(filtered.map((x) => x.id)) : new Set())
                    }
                  />
                </th>
                <th className="sticky-name">Name</th>
                <th>Company</th>
                <th>Designation</th>
                <th title="When this person's day starts. Blank follows the office's usual timing, set on the Time tab.">Shift in</th>
                <th title="When this person's day ends. Blank follows the office's usual timing.">Shift out</th>
                <th title="Groups people for the reporting line and the department-wise manager">Department</th>
                <th title="Decides which festivals are a paid holiday">Religion</th>
                <th title="Drives the birthday list on the dashboard">Born</th>
                <th title="Drives the new joinees and work anniversaries on the dashboard">Joined</th>
                {/*
                  * LEFT was only on the profile drawer, under six other
                  * blocks - so the only way out of the payroll anybody could
                  * see was the "active" tick beside it, which records NO
                  * DATE. The dashboard then read "Nobody left" for a month
                  * somebody had plainly left in.
                  */}
                {/*
                  * Typing a date that has already passed now takes them off
                  * the list as well - "exited employee abhi bhi dikha rahe he
                  * current list me". Two switches for one fact is how one of
                  * them gets forgotten.
                  */}
                <th title="The last working day. A date that has passed takes them off the list; unticking Active records no date, so type it here.">
                  Left
                </th>
                <th>Salary</th>
                <th>PF</th>
                <th>ESI</th>
                <th>Pay by</th>
                <th>Active</th>
                {/*
                  * PINNED TO THE RIGHT EDGE, the way the name is pinned to
                  * the left. Twenty columns scroll between them, and an exit
                  * button somebody has to scroll sideways to find is the
                  * thing that was wrong in the first place.
                  */}
                <th className="row-acts" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id} className={emp.active ? undefined : 'inactive'}>
                  <td className="num">
                    <input
                      type="checkbox"
                      checked={picked.has(emp.id)}
                      onChange={() => {
                        const next = new Set(picked);
                        if (next.has(emp.id)) next.delete(emp.id);
                        else next.add(emp.id);
                        setPicked(next);
                      }}
                    />
                  </td>
                  <td className="sticky-name">
                    {/* The face, where the name is. Initials where there is
                        none, which is also how the master shows at a glance
                        who still has no photograph. */}
                    <Avatar employee={emp} />
                    <button
                      className="link"
                      title="Open the full record — photo, bank, PAN, UAN, ESIC, contact"
                      onClick={() => setProfileFor(emp.id)}
                    >
                      {emp.name}
                    </button>
                    {/* A DRAFT IS SAID OUT LOUD. It is on this list because
                        it is a real row, and it is on no payroll at all -
                        reading it as an ordinary employee is how somebody
                        wonders in December why there is no payslip. */}
                    {emp.is_draft ? (
                      <span
                        className="pill draft"
                        title="Started and not finished. On no payroll month until it is saved properly — open it and press Finish."
                      >
                        draft
                      </span>
                    ) : null}
                    {/* The word only: the date is two columns along under
                        Left, and this cell is clipped at 17rem - a second
                        copy of the date pushed "report" and the bank warning
                        out of sight. */}
                    {!emp.active && (
                      <span
                        className="pill"
                        title={
                          emp.left_on
                            ? `Left ${emp.left_on}. They stay on every month they were already paid in.`
                            : 'Off the active list, with no leaving date recorded.'
                        }
                      >
                        left
                      </span>
                    )}
                    {!emp.bank_account && <span className="pill todo" title="No bank details yet">bank?</span>}
                    <button
                      className="ghost tiny"
                      title="Their own report — attendance, leave and pay, month by month"
                      onClick={() => setReportFor(emp.id)}
                    >
                      report
                    </button>
                  </td>
                  <td>
                    <select
                      value={emp.company_id}
                      onChange={(e) => onPatch(emp.id, { company_id: Number(e.target.value) })}
                    >
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      key={`designation-${emp.id}-${emp.designation || ''}`}
                      className="cell-input wide"
                      defaultValue={emp.designation || ''}
                      placeholder="-"
                      onBlur={(e) =>
                        e.target.value !== (emp.designation || '') &&
                        onPatch(emp.id, { designation: e.target.value })
                      }
                    />
                  </td>
                  {/*
                    * This person's own hours. Blank follows the office's usual
                    * day — it is NOT a shift of nothing. A night shift judged
                    * against a 9:30 start reads as five hours late every day,
                    * which is the whole reason these exist.
                    */}
                  <td>
                    <input
                      key={`shiftin-${emp.id}-${emp.shift_in || ''}`}
                      className="cell-input time"
                      defaultValue={emp.shift_in || ''}
                      placeholder="usual"
                      onBlur={(e) =>
                        e.target.value !== (emp.shift_in || '') &&
                        onPatch(emp.id, { shift_in: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      key={`shiftout-${emp.id}-${emp.shift_out || ''}`}
                      className="cell-input time"
                      defaultValue={emp.shift_out || ''}
                      placeholder="usual"
                      onBlur={(e) =>
                        e.target.value !== (emp.shift_out || '') &&
                        onPatch(emp.id, { shift_out: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    {/* Keyed on the stored value, so a bulk change under a row
                        already on screen re-renders instead of leaving a stale
                        one showing. */}
                    <input
                      key={`department-${emp.id}-${emp.department || ''}`}
                      className="cell-input wide"
                      list="department-list"
                      defaultValue={emp.department || ''}
                      placeholder="-"
                      onBlur={(e) =>
                        e.target.value !== (emp.department || '') &&
                        onPatch(emp.id, { department: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      key={`religion-${emp.id}-${emp.religion || ''}`}
                      className="cell-input wide"
                      list="religion-list"
                      defaultValue={emp.religion || ''}
                      placeholder="-"
                      onBlur={(e) =>
                        e.target.value !== (emp.religion || '') &&
                        onPatch(emp.id, { religion: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      key={`dob-${emp.id}-${emp.dob || ''}`}
                      className="cell-input date"
                      type="date"
                      defaultValue={emp.dob || ''}
                      onBlur={(e) =>
                        e.target.value !== (emp.dob || '') && onPatch(emp.id, { dob: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      key={`joined-${emp.id}-${emp.joined_on || ''}`}
                      className="cell-input date"
                      type="date"
                      defaultValue={emp.joined_on || ''}
                      onBlur={(e) =>
                        e.target.value !== (emp.joined_on || '') &&
                        onPatch(emp.id, { joined_on: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      key={`left-${emp.id}-${emp.left_on || ''}`}
                      className="cell-input date"
                      type="date"
                      defaultValue={emp.left_on || ''}
                      title={
                        emp.active
                          ? 'Their last working day. A date that has passed takes them off the list; a date still to come leaves them on it until that day.'
                          : 'Their last working day.'
                      }
                      onBlur={(e) =>
                        e.target.value !== (emp.left_on || '') &&
                        onPatch(emp.id, { left_on: e.target.value })
                      }
                    />
                    {!emp.active && !emp.left_on && (
                      <div className="muted small">no date</div>
                    )}
                  </td>
                  <td>
                    <input
                      key={`salary-${emp.id}-${emp.monthly_salary}`}
                      className="cell-input"
                      inputMode="decimal"
                      defaultValue={emp.monthly_salary}
                      onBlur={(e) =>
                        Number(e.target.value) !== emp.monthly_salary &&
                        onPatch(emp.id, { monthly_salary: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      key={`pf-${emp.id}-${emp.pf}`}
                      className="cell-input"
                      inputMode="decimal"
                      defaultValue={emp.pf}
                      onBlur={(e) =>
                        Number(e.target.value) !== emp.pf && onPatch(emp.id, { pf: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      key={`esi-${emp.id}-${emp.esi}`}
                      className="cell-input"
                      inputMode="decimal"
                      defaultValue={emp.esi}
                      onBlur={(e) =>
                        Number(e.target.value) !== emp.esi && onPatch(emp.id, { esi: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={emp.payment_mode || 'Bank'}
                      onChange={(e) => onPatch(emp.id, { payment_mode: e.target.value })}
                    >
                      <option>Bank</option>
                      <option>Cash</option>
                      <option>Gpay</option>
                      <option>Cheque</option>
                    </select>
                  </td>
                  <td className="num">
                    <input
                      type="checkbox"
                      checked={!!emp.active}
                      onChange={(e) => onPatch(emp.id, { active: e.target.checked })}
                      title="An inactive employee is left out of new months. It does not record a leaving date — type that in the Left column."
                    />
                  </td>
                  <td className="row-acts">
                    {/*
                      * IT COUNTS BEFORE IT ASKS.
                      *
                      * "Delete X and all their payroll history?" is true and
                      * useless: somebody added by mistake this morning and a
                      * cashier of four years read identically, and only one
                      * of them should go. Now the question names the months,
                      * the attendance and the documents that would go - a
                      * wrongly added person comes back with nothing against
                      * their name, which IS the answer.
                      */}
                    {/*
                      * EXIT SITS BEFORE DELETE, and it is the one that is
                      * nearly always meant.
                      *
                      * Somebody who has resigned has a last working day, a
                      * notice period, a clearance list and a final payment.
                      * Deleting them has none of that - it takes away every
                      * month they were ever paid in, which is the opposite of
                      * what an exit is for.
                      */}
                    <button
                      className="ghost tiny"
                      title={
                        emp.active
                          ? 'Record their resignation — notice, last working day, clearance and the full and final'
                          : 'Their leaving record and full and final'
                      }
                      onClick={() => setExitFor(emp)}
                    >
                      exit
                    </button>{' '}
                    <button
                      className="danger tiny"
                      title="Deletes the employee and every month they appear in"
                      onClick={() => onDelete(emp.id, emp.name)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={13} className="empty">No employees yet.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollFrame>
        )}
        <p className="muted small">
          Salary here is the master figure. Changing it does not rewrite a month that already has its
          own number - edit that on the salary sheet.
        </p>
        <p className="muted small">
          Click a name to open their full record — joining date, PAN, Aadhaar, UAN, ESIC number,
          bank account. Those are what the PF and ESI returns and the bank transfer file are
          built from, so they are worth filling in once.
        </p>
        <p className="muted small">
          Somebody leaving? Use <strong>exit</strong> on their row — it records the last working
          day, the notice and the full and final. Unticking <strong>Active</strong> only keeps
          them off the current list, and deleting takes their past months with them. Total
          salary bill: <strong>{rupees(
            filtered.reduce((sum, e) => sum + Number(e.monthly_salary || 0), 0)
          )}</strong> per month.
        </p>
      </div>

      <OnboardingQueue employees={filtered} onOpen={(emp) => setProfileFor(emp.id)} />

      {/* The people who have gone, as their own register rather than as grey
          rows folded back into the staff list. */}
      <PastEmployees
        /* The company filter narrows this like every other list on the page;
           the "show people who have left" tick does not - this register IS
           them. */
        employees={employees.filter((e) => !companyId || e.company_id === companyId)}
        companies={companies}
        onOpen={(id) => setProfileFor(id)}
        onExit={(emp) => setExitFor(emp)}
        onReport={(id) => setReportFor(id)}
        onError={(err) => setError(err.message)}
      />

      <BulkEmployees onReload={onReload} onError={(m) => (onError ? onError(m) : setError(m))} />

      {/*
        * THE JOINING FORM, behind a button.
        *
        * It used to be six boxes sitting on this page - company, name,
        * salary, PF, ESI, how they are paid - and everything else about a
        * person was typed into the drawer afterwards, if anybody remembered.
        * The eight-section form is `EmployeeForm`; the shape of it lives in
        * shared/employeeMaster.js so the form, the validation and the
        * completeness figure cannot drift apart.
        */}
      <div className="card">
        <div className="row">
          <h2>Add employee</h2>
          <span className="grow" />
          <button className="primary" onClick={() => setAdding(true)}>Add employee</button>
        </div>
        <p className="muted small">
          Eight sections — who they are, the job, where they live, the statutory numbers, pay
          and bank, the emergency contact, their documents and their access. Only a{' '}
          <strong>name and a company</strong> are needed to save; the rest is chased by the
          joining checklist on their record. <strong>Save draft</strong> keeps a half-finished
          form off every payroll until it is finished.
        </p>
        <p className="muted small">
          A new employee joins the open month the next time it is refreshed - salary, PF and ESI carry
          across, and anything already typed into that month stays put.
        </p>
      </div>

      {adding && (
        <div className="picker-backdrop" onClick={() => setAdding(false)}>
          <div className="modal ef-modal" onClick={(e) => e.stopPropagation()}>
            <EmployeeForm
              companies={companies}
              employees={employees}
              companyId={companyId || ''}
              onCreate={onCreate}
              onClose={(made) => {
                setAdding(false);
                /* A document cannot be attached to somebody who does not
                   exist yet - the file is stored against an employee id. So
                   their record opens on the same click, with the upload
                   boxes waiting. */
                if (made?.id) setProfileFor(made.id);
              }}
            />
          </div>
        </div>
      )}

      <div className="card">
        <h2>Companies</h2>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!companyName.trim()) return;
            await onCreateCompany({ name: companyName.trim() });
            setCompanyName('');
          }}
        >
          <input
            placeholder="New company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <button type="submit">Add company</button>
        </form>
        <ul className="chips">
          {companies.map((c) => (
            <li key={c.id} className={`chip${companyId === c.id ? ' active' : ''}`}>
              <button
                className="chip-name"
                title={companyId === c.id ? 'Showing only this one - click to show all' : `Show only ${c.name}`}
                onClick={() => onCompany?.(c.id)}
              >
                {c.name} <span className="muted">({c.employee_count})</span>
              </button>
              <button
                className="chip-action"
                title="Rename"
                onClick={() => {
                  const name = window.prompt(`Rename "${c.name}" to:`, c.name);
                  if (name && name.trim() && name.trim() !== c.name) {
                    onPatchCompany(c.id, { name: name.trim() });
                  }
                }}
              >
                ✎
              </button>
              <button
                className="chip-action danger"
                title={
                  c.employee_count
                    ? `${c.employee_count} employees are in this company`
                    : 'Delete this company'
                }
                onClick={() => {
                  const warning = c.employee_count
                    ? `Delete "${c.name}" AND its ${c.employee_count} employees, with every month they appear in?`
                    : `Delete "${c.name}"?`;
                  if (window.confirm(warning)) onDeleteCompany(c.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Click a company to show only its people — here, on the salary sheet and on the
          attendance grid. Click it again, or <strong>All</strong> at the top, to go back.
        </p>
      </div>

      {profileFor && (() => {
        const employee = employees.find((e) => e.id === profileFor);
        if (!employee) return null;
        return (
          <EmployeeProfile
            employee={employee}
            companies={companies}
            employees={employees}
            onPatch={onPatch}
            onClose={() => setProfileFor(null)}
          />
        );
      })()}

      {reportFor && (
        <EmployeeReport
          employeeId={reportFor}
          onClose={() => setReportFor(null)}
          onError={(err) => setError(err.message)}
        />
      )}

      {exitFor && (
        <ExitEmployee
          employee={employees.find((e) => e.id === exitFor.id) || exitFor}
          companies={companies}
          onClose={() => setExitFor(null)}
          onError={(err) => setError(err.message)}
          onReload={onReload}
        />
      )}
    </section>
  );
}

/**
 * Who is on the payroll but not finished. Everything here is a gap that only
 * bites later - at the PF return, or at the bank transfer - so it is worth a
 * card near the top rather than a surprise at month end.
 */
function OnboardingQueue({ employees, onOpen }) {
  const open = openOnboarding(employees || []);
  if (!open.length) return null;

  /*
   * Folded, because on a master nobody has filled in yet this is EVERYBODY -
   * twelve rows of the same sentence ("Date of birth, Sex, Married or single,
   * Mobile and 14 more") took the whole first screen, and pushed the list of
   * employees 1,434px down a page you came to to look somebody up.
   *
   * The count stays in the open: a fold may hide rows, never the fact that
   * there is something to do. It opens itself when only a couple are left,
   * which is when the names are worth reading rather than counting.
   */
  return (
    <details className="card fold" open={open.length <= 3}>
      <summary>
        <strong>Still to finish</strong>
        <span className="muted small">
          — {open.length} {open.length === 1 ? 'record is' : 'records are'} not complete
        </span>
      </summary>
      <p className="muted small">
        On the payroll, record not complete. Nothing is blocked — these are the gaps that bite
        at the PF return or the bank transfer. Click a name to fill them in.
      </p>
      <div className="lines">
        {open.slice(0, 12).map(({ employee, status }) => (
          <div key={employee.id}>
            <span className="what">
              <button className="link" onClick={() => onOpen(employee)}>
                {employee.name}
              </button>
              <span className="muted small">
                {' '}
                — {status.missing.slice(0, 4).join(', ')}
                {status.missing.length > 4 ? ` and ${status.missing.length - 4} more` : ''}
              </span>
            </span>
            <span className="small muted num">
              {status.done}/{status.total}
            </span>
          </div>
        ))}
      </div>
      {open.length > 12 ? (
        <p className="muted small">and {open.length - 12} more.</p>
      ) : null}
    </details>
  );
}
