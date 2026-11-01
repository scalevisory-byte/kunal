import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';

const KINDS = ['Laptop', 'Desktop', 'Mobile', 'SIM card', 'ID card', 'Access card', 'Vehicle', 'Tools', 'Furniture', 'Other'];
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The asset register: laptops, ID cards, SIMs, tools.
 *
 * An asset with nobody against it is **in the office**, which is not the same
 * as lost - the list says so rather than leaving a blank to be read either way.
 * What is out and with whom is the one question this exists to answer, so those
 * rows sort to the top and the exit settlement reads the same list.
 */
export default function Assets({ employees, companies, onError }) {
  const [assets, setAssets] = useState([]);
  const [outOnly, setOutOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    company_id: '',
    kind: 'Laptop',
    label: '',
    identifier: '',
    value: '',
    employee_id: '',
    issued_on: today(),
  });

  const load = async (out = outOnly) => {
    try {
      const { assets: list } = await api.get(`/people/assets${out ? '?out=true' : ''}`);
      setAssets(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(outOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOnly]);

  const save = async () => {
    if (!draft.label.trim()) return;
    try {
      await api.post('/people/assets', draft);
      setDraft({ ...draft, label: '', identifier: '', value: '' });
      setAdding(false);
      load();
    } catch (err) {
      onError(err);
    }
  };

  const issue = async (asset, employeeId) => {
    if (!employeeId) return;
    try {
      await api.post(`/people/assets/${asset.id}/issue`, { employee_id: Number(employeeId) });
      load();
    } catch (err) {
      onError(err);
    }
  };

  const back = async (asset) => {
    const condition = window.prompt(
      `${asset.label} back from ${asset.employee_name}. What condition is it in? (leave empty for fine)`,
      ''
    );
    if (condition === null) return;
    try {
      await api.post(`/people/assets/${asset.id}/return`, { condition: condition || undefined });
      load();
    } catch (err) {
      onError(err);
    }
  };

  const remove = async (asset) => {
    if (!window.confirm(`Remove ${asset.label} from the register?`)) return;
    try {
      await api.del(`/people/assets/${asset.id}`);
      load();
    } catch (err) {
      onError(err);
    }
  };

  const out = assets.filter((a) => a.employee_id && !a.returned_on);
  const outValue = out.reduce((sum, a) => sum + (Number(a.value) || 0), 0);

  return (
    <section className="stack">
      <div className="figures">
        <div className="figure">
          <span className="k">On the register</span>
          <span className="n">{assets.length}</span>
        </div>
        <div className="figure">
          <span className="k">Out with staff</span>
          <span className="n">{out.length}</span>
        </div>
        <div className="figure">
          <span className="k">Worth</span>
          <span className="n">{rupees(outValue)}</span>
        </div>
      </div>

      <div className="toolbar">
        <label className="inline">
          <input type="checkbox" checked={outOnly} onChange={(e) => setOutOnly(e.target.checked)} /> Only what is out
        </label>
        <button className="ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Add an asset'}
        </button>
      </div>

      {adding && (
        <div className="card">
          <div className="form-grid">
            <label>
              What
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Which one
              <input
                type="text"
                value={draft.label}
                placeholder="Dell Latitude 3420"
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            <label>
              Serial / number
              <input
                type="text"
                value={draft.identifier}
                placeholder="serial, IMEI, SIM number"
                onChange={(e) => setDraft({ ...draft, identifier: e.target.value })}
              />
            </label>
            <label>
              Worth
              <input
                type="number"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
            </label>
            <label>
              Company
              <select
                value={draft.company_id}
                onChange={(e) => setDraft({ ...draft, company_id: e.target.value })}
              >
                <option value="">—</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Issue it to
              <select
                value={draft.employee_id}
                onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}
              >
                <option value="">Nobody yet — keep it in the office</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button onClick={save} disabled={!draft.label.trim()}>
            Add it
          </button>
        </div>
      )}

      {!assets.length ? (
        <p className="muted small">Nothing on the register yet.</p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>What</th>
              <th>Which</th>
              <th>Serial</th>
              <th className="num">Worth</th>
              <th>Where it is</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const isOut = asset.employee_id && !asset.returned_on;
              return (
                <tr key={asset.id}>
                  <td>{asset.kind}</td>
                  <td className="sticky-name">{asset.label}</td>
                  <td className="muted small">{asset.identifier || '—'}</td>
                  <td className="num">{asset.value ? rupees(asset.value) : '—'}</td>
                  <td>
                    {isOut ? (
                      <strong>{asset.employee_name}</strong>
                    ) : (
                      <span className="muted">
                        in the office
                        {asset.returned_on ? ` since ${asset.returned_on}` : ''}
                        {asset.condition ? ` — ${asset.condition}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="muted small">{isOut ? asset.issued_on || '—' : '—'}</td>
                  <td>
                    {isOut ? (
                      <button className="ghost small" onClick={() => back(asset)}>
                        take it back
                      </button>
                    ) : (
                      <select value="" onChange={(e) => issue(asset, e.target.value)}>
                        <option value="">issue to…</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    )}{' '}
                    <button className="ghost small" onClick={() => remove(asset)}>
                      remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
