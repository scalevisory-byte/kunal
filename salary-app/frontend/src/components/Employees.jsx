import { useMemo, useState } from 'react';
import { rupees } from '../format.js';

const BLANK = { name: '', company_id: '', monthly_salary: '', pf: '', esi: '', payment_mode: 'Bank', code: '', designation: '' };

/** The employee master: who gets paid, and what their monthly salary is. */
export default function Employees({ companies, employees, onCreate, onPatch, onDelete, onCreateCompany }) {
  const [form, setForm] = useState(BLANK);
  const [companyName, setCompanyName] = useState('');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(
      (e) =>
        (showInactive || e.active) &&
        (!q || e.name.toLowerCase().includes(q) || (e.company_name || '').toLowerCase().includes(q))
    );
  }, [employees, query, showInactive]);

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

  return (
    <section className="stack">
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
          <button className="primary" type="submit">Add</button>
        </form>
        {error && <p className="error">{error}</p>}
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
            <li key={c.id} className="chip">
              {c.name} <span className="muted">({c.employee_count})</span>
            </li>
          ))}
        </ul>
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

        <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name">Name</th>
                <th>Company</th>
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
                  <td className="sticky-name">
                    <input
                      className="cell-input wide"
                      defaultValue={emp.name}
                      onBlur={(e) => e.target.value !== emp.name && onPatch(emp.id, { name: e.target.value })}
                    />
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
                <tr><td colSpan={8} className="empty">No employees yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Salary here is the master figure. Changing it does not rewrite a month that already has its
          own number - edit that on the salary sheet.
        </p>
        <p className="muted small">
          Finished with someone? Untick <strong>Active</strong> rather than deleting - that keeps their
          past months intact. Total salary bill: <strong>{rupees(
            filtered.reduce((sum, e) => sum + Number(e.monthly_salary || 0), 0)
          )}</strong> per month.
        </p>
      </div>
    </section>
  );
}
