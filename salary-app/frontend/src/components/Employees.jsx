import { useMemo, useState } from 'react';
import EmployeeProfile from './EmployeeProfile.jsx';
import { rupees } from '../format.js';

const BLANK = { name: '', company_id: '', monthly_salary: '', pf: '', esi: '', payment_mode: 'Bank', code: '', designation: '', religion: '' };

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
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState('');
  // Setting a religion one row at a time is fine for three people and hopeless
  // for seventy, so rows can be ticked and given one in a single go.
  const [picked, setPicked] = useState(() => new Set());
  const [bulkReligion, setBulkReligion] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileFor, setProfileFor] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(
      (e) =>
        (showInactive || e.active) &&
        (!companyId || e.company_id === companyId) &&
        (!q || e.name.toLowerCase().includes(q) || (e.company_name || '').toLowerCase().includes(q))
    );
  }, [employees, query, showInactive, companyId]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onCreate({
        ...form,
        company_id: Number(form.company_id),
        monthly_salary: Number(form.monthly_salary) || 0,
        pf: Number(form.pf) || 0,
        esi: Number(form.esi) || 0,
      });
      setForm({ ...BLANK, company_id: form.company_id });
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

  // Whatever is already in use, plus the usual ones, as suggestions only -
  // the box takes anything typed into it.
  const religions = useMemo(() => {
    const inUse = employees.map((e) => e.religion).filter(Boolean);
    const common = ['Hindu', 'Muslim', 'Jain', 'Christian', 'Sikh', 'Buddhist', 'Parsi'];
    return [...new Set([...inUse, ...common])].sort();
  }, [employees]);

  return (
    <section className="stack">
      <datalist id="religion-list">
        {religions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

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

      <div className="card">
        <div className="toolbar">
          <input className="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <span className="grow" />
          <span className="muted small">{filtered.length} employees</span>
        </div>

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
            <span className="grow" />
            <button className="ghost" onClick={() => setPicked(new Set())}>Deselect</button>
          </div>
        )}

        <div className="table-wrap">
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
                <th title="Decides which festivals are a paid holiday">Religion</th>
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
                    <button
                      className="link"
                      title="Open the full record — bank, PAN, UAN, ESIC, contact"
                      onClick={() => setProfileFor(emp.id)}
                    >
                      {emp.name}
                    </button>
                    {!emp.bank_account && <span className="pill todo" title="No bank details yet">bank?</span>}
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
                <tr><td colSpan={10} className="empty">No employees yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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

      {profileFor && (() => {
        const employee = employees.find((e) => e.id === profileFor);
        if (!employee) return null;
        return (
          <EmployeeProfile
            employee={employee}
            companies={companies}
            onPatch={onPatch}
            onClose={() => setProfileFor(null)}
          />
        );
      })()}
    </section>
  );
}
