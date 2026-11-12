import { useMemo, useState } from 'react';
import { openOnboarding } from '../../../shared/onboarding.js';
import EmployeeReport from './EmployeeReport.jsx';
import { DEFAULT_TEMPLATE, applyTemplate, salaryStructure } from '../../../shared/structure.js';
import EmployeeProfile from './EmployeeProfile.jsx';
import { Avatar } from './EmployeePhoto.jsx';
import OrgChart from './OrgChart.jsx';
import DepartmentManagers from './DepartmentManagers.jsx';
import { bulkManagerPlan } from '../../../shared/orgChart.js';
import { rupees } from '../format.js';
import ScrollFrame from './ScrollFrame.jsx';

/* The people with nothing in that field - a group, not a gap. */
const NOT_SET = '\u0000none';

const BLANK = {
  name: '',
  company_id: '',
  monthly_salary: '',
  pf: '',
  esi: '',
  payment_mode: 'Bank',
  code: '',
  designation: '',
  religion: '',
  // Where the salary goes. Asked for here rather than only on the record,
  // because a bank transfer needs all three and the day somebody is added is
  // the day the passbook is in front of you.
  bank_name: '',
  bank_account: '',
  ifsc: '',
  // The salary breakup. Blank is a real answer - "no structure yet" - and the
  // app pays exactly the same either way.
  basic: '',
  hra: '',
  conveyance: '',
  medical: '',
};

/*
 * Naming people in a note. Capped, because the honest thing is to say who is
 * affected - not to print seventy-four names into a toolbar.
 */
const listNames = (people, limit = 6) =>
  people.length > limit
    ? `${people.slice(0, limit).map((p) => p.name).join(', ')} and ${people.length - limit} more`
    : people.map((p) => p.name).join(', ');

/** The employee master: who gets paid, and what their monthly salary is. */
export default function Employees({
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
}) {
  const [form, setForm] = useState(BLANK);
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
  const [bulkReligion, setBulkReligion] = useState('');
  const [bulkDepartment, setBulkDepartment] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileFor, setProfileFor] = useState(null);
  // The same people, read two ways: down a list, or up a reporting line.
  const [asChart, setAsChart] = useState(false);
  const [reportFor, setReportFor] = useState(null);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [showTemplate, setShowTemplate] = useState(false);
  // Setting the reporting line one record at a time is the reason twenty-six
  // people had no manager at all.
  const [bulkManager, setBulkManager] = useState('');
  const [showManager, setShowManager] = useState(false);

  /* Everybody a filter could show: the active/inactive rule and nothing else. */
  const onShow = useMemo(
    () => employees.filter((e) => showInactive || e.active),
    [employees, showInactive]
  );

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

  /* What the four boxes currently add up to, and what is left over. */
  const addSplit = salaryStructure({
    monthly_salary: Number(form.monthly_salary) || 0,
    basic: Number(form.basic) || 0,
    hra: Number(form.hra) || 0,
    conveyance: Number(form.conveyance) || 0,
    medical: Number(form.medical) || 0,
  });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const made = await onCreate({
        ...form,
        company_id: Number(form.company_id),
        monthly_salary: Number(form.monthly_salary) || 0,
        pf: Number(form.pf) || 0,
        esi: Number(form.esi) || 0,
        basic: Number(form.basic) || 0,
        hra: Number(form.hra) || 0,
        conveyance: Number(form.conveyance) || 0,
        medical: Number(form.medical) || 0,
      });
      setForm({ ...BLANK, company_id: form.company_id });
      /*
       * A document cannot be attached to somebody who does not exist yet - the
       * file is stored against an employee id. So the row is made first and
       * their record opens straight away, on the same click: the PAN card and
       * the passbook photo go on there, with the rest of the joining form.
       */
      if (made?.id) setProfileFor(made.id);
    } catch (err) {
      setError(err.message);
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
          <label className="check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <button
            className={asChart ? 'active' : undefined}
            onClick={() => setAsChart((v) => !v)}
            title="Who reports to whom"
          >
            {asChart ? 'As a list' : 'Reporting line'}
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
          <table className="sheet">
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
                <th>Salary</th>
                <th>PF</th>
                <th>ESI</th>
                <th>Pay by</th>
                <th>Active</th>
                <th />
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
                      title="An inactive employee is left out of new months"
                    />
                  </td>
                  <td>
                    <button
                      className="danger tiny"
                      title="Deletes the employee and every month they appear in"
                      onClick={() => {
                        if (window.confirm(`Delete ${emp.name} and all their payroll history?`)) onDelete(emp.id);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={12} className="empty">No employees yet.</td></tr>
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
          Finished with someone? Untick <strong>Active</strong> rather than deleting - that keeps their
          past months intact. Total salary bill: <strong>{rupees(
            filtered.reduce((sum, e) => sum + Number(e.monthly_salary || 0), 0)
          )}</strong> per month.
        </p>
      </div>

      <OnboardingQueue employees={filtered} onOpen={(emp) => setProfileFor(emp.id)} />

      <div className="card">
        <h2>Add employee</h2>
        <form className="form-grid" onSubmit={submit}>
          <label>
            Company
            <select
              required
              value={form.company_id}
              onChange={(e) => setForm({ ...form, company_id: e.target.value })}
            >
              <option value="">Select…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Monthly salary
            <input
              required
              inputMode="decimal"
              value={form.monthly_salary}
              onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })}
            />
          </label>
          <label>
            PF
            <input inputMode="decimal" value={form.pf} onChange={(e) => setForm({ ...form, pf: e.target.value })} />
          </label>
          <label>
            ESI
            <input inputMode="decimal" value={form.esi} onChange={(e) => setForm({ ...form, esi: e.target.value })} />
          </label>
          <label>
            Pay by
            <select value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>
              <option>Bank</option>
              <option>Cash</option>
              <option>Gpay</option>
              <option>Cheque</option>
            </select>
          </label>
          {/* Cash in hand needs no account, and asking for one is noise. */}
          {form.payment_mode !== 'Cash' && (
            <>
              <label>
                Bank
                <input
                  value={form.bank_name}
                  onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                />
              </label>
              <label>
                Account number
                <input
                  value={form.bank_account}
                  onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                />
              </label>
              <label>
                IFSC
                <input
                  placeholder="SBIN0001234"
                  value={form.ifsc}
                  onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
                />
              </label>
            </>
          )}
          <label title="Decides which festivals are a paid holiday for this person">
            Religion
            <input
              list="religion-list"
              placeholder="optional"
              value={form.religion}
              onChange={(e) => setForm({ ...form, religion: e.target.value })}
            />
          </label>
          <button className="primary" type="submit">Add</button>
        </form>

        {/*
         * The breakup, on the same form. It is worth saying out loud that it
         * changes nothing about what this person is paid: Basic, HRA and the
         * rest are a division of the salary already typed above, and gross,
         * net, PT and every deduction come out identical with or without
         * them. What it buys is a payslip that shows lines, and PF charged on
         * Basic rather than on the whole gross.
         *
         * Blank is a real answer. Most people will leave it and split later,
         * or in bulk further down the page.
         */}
        <div className="split-add">
          <div className="row">
            <strong className="small">Salary structure</strong>
            <button
              type="button"
              className="ghost tiny"
              disabled={!(Number(form.monthly_salary) > 0)}
              title={`Basic ${DEFAULT_TEMPLATE.basicPercent}%, HRA ${DEFAULT_TEMPLATE.hraPercentOfBasic}% of Basic, conveyance ${DEFAULT_TEMPLATE.conveyance}, medical ${DEFAULT_TEMPLATE.medical}`}
              onClick={() => setForm({ ...form, ...applyTemplate(Number(form.monthly_salary)) })}
            >
              Use the usual split
            </button>
            {(form.basic || form.hra || form.conveyance || form.medical) && (
              <button
                type="button"
                className="ghost tiny"
                onClick={() =>
                  setForm({ ...form, basic: '', hra: '', conveyance: '', medical: '' })
                }
              >
                clear it
              </button>
            )}
          </div>
          <div className="form-grid">
            <label>
              Basic
              <input
                inputMode="decimal"
                value={form.basic}
                onChange={(e) => setForm({ ...form, basic: e.target.value })}
              />
            </label>
            <label>
              HRA
              <input
                inputMode="decimal"
                value={form.hra}
                onChange={(e) => setForm({ ...form, hra: e.target.value })}
              />
            </label>
            <label>
              Conveyance
              <input
                inputMode="decimal"
                value={form.conveyance}
                onChange={(e) => setForm({ ...form, conveyance: e.target.value })}
              />
            </label>
            <label>
              Medical
              <input
                inputMode="decimal"
                value={form.medical}
                onChange={(e) => setForm({ ...form, medical: e.target.value })}
              />
            </label>
            <label title="Whatever is left of the salary. Never typed, so the parts cannot drift from the total.">
              Special allowance
              <input value={addSplit.set ? rupees(addSplit.special) : ''} readOnly disabled />
            </label>
          </div>
          {addSplit.over ? (
            <p className="error">
              The parts come to {rupees(addSplit.named)}, which is {rupees(addSplit.overBy)} more
              than the salary. Lower one of them.
            </p>
          ) : (
            <p className="muted small">
              Optional, and it does <strong>not</strong> change what they are paid — it only
              divides the salary above into lines on the payslip. Leave it blank and the payslip
              shows one figure.
            </p>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <p className="muted small">
          <strong>Religion</strong> decides which festivals count as a paid holiday for someone.
          Set it once and the <strong>Festivals</strong> panel on the attendance grid does the
          rest — Eid marks the Muslim staff paid, Diwali the Hindu staff, and everyone else works
          that day as normal. To fill it in for a lot of people at once, tick them in the list
          below and use <strong>Set religion to</strong>. The box takes anything you type; the
          suggestions are only suggestions.
        </p>
        <p className="muted small">
          <strong>Documents</strong> — PAN card, Aadhaar, photograph, cancelled cheque — attach to
          the person, so their record opens the moment you press <strong>Add</strong> and the
          upload box is waiting there. The rest of the joining form is on the same screen.
        </p>
        <p className="muted small">
          A new employee joins the open month the next time it is refreshed - salary, PF and ESI carry
          across, and anything already typed into that month stays put.
        </p>
      </div>

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
