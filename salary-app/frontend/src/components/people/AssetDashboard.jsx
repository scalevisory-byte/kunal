import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';
import Glyph from '../../icons.jsx';

/*
 * The asset dashboard.
 *
 * Every figure is counted from the same register the Asset Register screen
 * shows, filtered the same way, and every card and alert carries the filter
 * that produced it - so clicking one opens exactly the rows behind it, and a
 * card saying 14 beside a list of 13 cannot happen.
 *
 * It computes nothing of its own: `shared/assetDashboard.js` does the
 * counting, on the server and in the single file alike.
 */

/**
 * The four at the top, in the order of his mock-up.
 *
 * Each reads its figure OUT of the same dashboard the row below it uses, so
 * a tile and the hairline figure under it can never disagree - they are the
 * same number drawn twice, not two counts of the same thing.
 */
const card = (data, key) => data.cards.find((c) => c.key === key) || { n: 0, filter: {} };
const TILES = [
  {
    key: 'total',
    label: 'Total assets',
    icon: 'box',
    from: (d) => ({ shown: card(d, 'all').n, filter: card(d, 'all').filter, hint: 'On the register — not the ones written off' }),
  },
  {
    key: 'out',
    label: 'Out with staff',
    icon: 'building',
    from: (d) => ({ shown: card(d, 'assigned').n, filter: card(d, 'assigned').filter, hint: 'Issued and not yet back' }),
  },
  {
    key: 'out_value',
    label: 'Work in use (at site)',
    icon: 'wrench',
    from: (d) => ({
      shown: rupees(d.out_value),
      filter: card(d, 'assigned').filter,
      hint: 'What those assets cost to buy — not what they are worth today, which needs a depreciation rule nobody has set',
    }),
  },
  {
    key: 'spent',
    label: 'Buy price value',
    icon: 'bars',
    from: (d) => ({ shown: rupees(d.spent), filter: {}, hint: 'Everything ever bought, written-off included' }),
  },
];

export default function AssetDashboard({ companies, branches = [], onOpen, onAdd, onImport, onError }) {
  const [filter, setFilter] = useState({ company_id: '', branch_id: '', category: '', year: '' });
  const [data, setData] = useState(null);

  useEffect(() => {
    let dropped = false;
    const load = async () => {
      try {
        const q = new URLSearchParams(
          Object.entries(filter).filter(([, v]) => v)
        ).toString();
        const found = await api.get(`/people/assets/dashboard${q ? `?${q}` : ''}`);
        if (!dropped) setData(found);
      } catch (err) {
        if (!dropped) onError(err);
      }
    };
    load();
    return () => {
      dropped = true;
    };
  }, [filter.company_id, filter.branch_id, filter.category, filter.year]);

  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));
  const go = (extra) => onOpen?.({ ...filter, ...extra });

  const forCompany = filter.company_id
    ? branches.filter((b) => Number(b.company_id) === Number(filter.company_id))
    : branches;

  return (
    <div className="stack">
      <div className="card">
        <div className="pf-find-row">
          <label className="field inline">
            Company
            <select value={filter.company_id} onChange={(e) => set({ company_id: e.target.value, branch_id: '' })}>
              <option value="">All</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="field inline">
            Branch
            <select value={filter.branch_id} onChange={(e) => set({ branch_id: e.target.value })}>
              <option value="">All</option>
              {forCompany.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label className="field inline">
            Category
            <select value={filter.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All</option>
              {(data?.categories || []).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          {/*
            * Department, which he asked for by name. Shown only when the
            * register has any: a picker with one empty option is a question
            * somebody cannot answer and will report as broken.
            */}
          {(data?.departments || []).length > 0 && (
            <label className="field inline">
              Department
              <select value={filter.department || ''} onChange={(e) => set({ department: e.target.value })}>
                <option value="">All</option>
                {data.departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field inline" title="April to March, the way a purchase register is written">
            Financial year
            <select value={filter.year} onChange={(e) => set({ year: e.target.value })}>
              <option value="">All</option>
              {(data?.years || []).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          {/*
            * The way in, on the screen the tab opens on.
            *
            * "Add an asset" lived only on the Register tab, and the empty
            * dashboard said "Add an asset, or import the list you already
            * keep in Excel" as grey text with no button anywhere on it -
            * which is how the first question about this screen came to be
            * "new asset add ka option kaha he". A sentence that names an
            * action has to be the action. Both open the Register with the
            * right panel already unfolded, so there is still only one form.
            */}
          <span className="push-right">
            {/* Bordered, not ghost: on an empty register this IS the screen's
                point, and a ghost button beside a ghost button reads as two
                captions. */}
            <button onClick={() => onAdd?.()}>Add an asset</button>
            <button className="ghost" onClick={() => onImport?.()}>Import from Excel</button>
          </span>
        </div>
      </div>

      {!data ? (
        <p className="loading">Counting…</p>
      ) : (
        <>
          {/*
            * THE FOUR FIGURES, as tiles with an icon — Dinesh's mock-up.
            *
            * The rest stay as the hairline row below them. Nine tiles would
            * be two rows of boxes before a single asset, and the four here
            * are the ones his own mock put at the top: how many there are,
            * how many are out, what is out in money, and what the lot cost.
            */}
          <div className="asset-tiles">
            {TILES.map(({ key, label, icon, from }) => (
              <button
                key={key}
                className="asset-tile"
                onClick={() => go(from(data).filter)}
                title={from(data).hint}
              >
                <span className="asset-tile-icon">
                  <Glyph name={icon} size={20} />
                </span>
                <span className="asset-tile-text">
                  <span className="k">{label}</span>
                  <span className="n">{from(data).shown}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="card">
            <div className="figures">
              {data.cards.map((c) => (
                <div className="figure" key={c.key}>
                  <button className="n" onClick={() => go(c.filter)}>{c.n}</button>
                  <span className="k">{c.label}</span>
                </div>
              ))}
              <div className="figure">
                {/* Not a link: "what we have spent" is not a list of rows. */}
                <span className="n">{rupees(data.spent)}</span>
                <span className="k">Bought, in all</span>
              </div>
            </div>
            {!data.counted ? (
              <p className="muted small">
                Nothing on the register yet for this filter.{' '}
                <button className="link" onClick={() => onAdd?.()}>Add an asset</button>, or{' '}
                <button className="link" onClick={() => onImport?.()}>import the list</button>{' '}
                you already keep in Excel.
              </p>
            ) : null}
          </div>

          <div className="card">
            <h3>Needs attention</h3>
            {!data.alerts.length ? (
              <p className="muted small">
                Nothing waiting — no warranty running out, nothing overdue back, no service due.
              </p>
            ) : (
              <div className="lines">
                {data.alerts.map((a) => (
                  <div key={a.key}>
                    <span className="what">
                      <span className={`pf-dot ${a.tone === 'bad' ? 'now' : a.tone === 'muted' ? '' : 'soon'}`} />
                      {a.label}
                      <strong className="num"> {a.n}</strong>
                      {/*
                        * The first few names, because a count alone tells
                        * nobody what to do next.
                        */}
                      <span className="muted small">
                        {' '}
                        — {a.rows.slice(0, 3).map(name).filter(Boolean).join(', ')}
                        {a.rows.length > 3 ? ` and ${a.rows.length - 3} more` : ''}
                      </span>
                    </span>
                    <button className="link" onClick={() => go(a.filter)}>open</button>
                  </div>
                ))}
              </div>
            )}
            {data.round ? (
              <p className="muted small">
                Stock take figures are for <strong>{data.round}</strong>. “Not checked” is not
                “missing” — an asset nobody has looked at yet is not a loss.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** An alert row is an asset, a handover or a service; each names itself. */
function name(row) {
  if (row.code && row.label) return `${row.code} ${row.label}`;
  if (row.employee_name) return `${row.code || row.label || 'one'} — ${row.employee_name}`;
  return row.code || row.label || '';
}
