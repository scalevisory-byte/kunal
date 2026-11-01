import { useEffect, useState } from 'react';
import { api } from '../../api.js';

/**
 * Branches, beneath a company.
 *
 * The salary already runs across three or four separate companies, so a branch
 * is a place inside one of them — Vadodara, Surat. Nobody has to be in a
 * branch: everybody starts with none and nothing breaks.
 *
 * Removing a branch never removes its people. They go branchless and stay on
 * their company's payroll, because a mistyped name must not be able to take
 * fourteen employees with it.
 */
export default function Branches({ companies, onError, onReload }) {
  const [branches, setBranches] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [draft, setDraft] = useState({ company_id: '', name: '', city: '' });
  const [said, setSaid] = useState('');

  const load = async (all = showClosed) => {
    try {
      const { branches: list } = await api.get(`/companies/branches${all ? '?all=true' : ''}`);
      setBranches(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(showClosed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClosed]);

  const add = async () => {
    try {
      await api.post('/companies/branches', draft);
      setDraft({ ...draft, name: '', city: '' });
      setSaid('');
      load();
      onReload?.();
    } catch (err) {
      setSaid(err.message);
    }
  };

  const patch = async (branch, body) => {
    try {
      await api.patch(`/companies/branches/${branch.id}`, body);
      setSaid('');
      load();
      onReload?.();
    } catch (err) {
      setSaid(err.message);
    }
  };

  const remove = async (branch) => {
    const warning = branch.people
      ? `${branch.name} has ${branch.people} ${branch.people === 1 ? 'person' : 'people'} in it. ` +
        `They stay on ${branch.company_name}'s payroll and simply stop being in a branch. Remove it?`
      : `Remove ${branch.name}?`;
    if (!window.confirm(warning)) return;
    try {
      await api.del(`/companies/branches/${branch.id}`);
      load();
      onReload?.();
    } catch (err) {
      setSaid(err.message);
    }
  };

  const byCompany = new Map();
  for (const branch of branches) {
    if (!byCompany.has(branch.company_name)) byCompany.set(branch.company_name, []);
    byCompany.get(branch.company_name).push(branch);
  }

  return (
    <section className="stack">
      <div className="card">
        <h3>Add a branch</h3>
        <div className="form-grid">
          <label>
            Company
            <select value={draft.company_id} onChange={(e) => setDraft({ ...draft, company_id: e.target.value })}>
              <option value="">Pick a company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <input
              value={draft.name}
              placeholder="Vadodara"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            City
            <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          </label>
        </div>
        <button onClick={add} disabled={!draft.company_id || !draft.name.trim()}>
          Add it
        </button>
        <p className="muted small">
          Two companies can each have a Vadodara. One company cannot have two.
        </p>
      </div>

      {said && <p className="error">{said}</p>}

      <label className="inline">
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show
        closed branches too
      </label>

      {!branches.length ? (
        <p className="muted small">
          No branches yet. Nobody needs one — this is only useful if a company has more than one
          place.
        </p>
      ) : (
        [...byCompany.entries()].map(([company, list]) => (
          <div className="card" key={company}>
            <h4>{company}</h4>
            <table className="sheet">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>City</th>
                  <th className="num">People</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((branch) => (
                  <tr key={branch.id}>
                    <td className="sticky-name">
                      <input
                        defaultValue={branch.name}
                        key={`n-${branch.name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== branch.name) patch(branch, { name: v });
                        }}
                      />
                      {!branch.active && <span className="pill">closed</span>}
                    </td>
                    <td>
                      <input
                        defaultValue={branch.city || ''}
                        key={`c-${branch.city}`}
                        onBlur={(e) => {
                          if (e.target.value !== (branch.city || '')) patch(branch, { city: e.target.value });
                        }}
                      />
                    </td>
                    <td className="num">{branch.people}</td>
                    <td>
                      <button className="ghost small" onClick={() => patch(branch, { active: !branch.active })}>
                        {branch.active ? 'close' : 'reopen'}
                      </button>{' '}
                      <button className="ghost small" onClick={() => remove(branch)}>
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}
