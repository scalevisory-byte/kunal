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

export default function AssetDashboard({ companies, branches = [], onOpen, onAdd, onImport, onError, onView, onAsset }) {
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
            * v2.39.0: THE NINE FIGURES THE REDESIGN BRIEF NAMES, each a way in.
            *
            * Every count is the one `assetCounts` gives the register, so a
            * card and the list it opens cannot disagree. "Available" and "In
            * the office" are ONE figure here, not two: on this register an
            * asset nobody holds is in the office, and showing both would be
            * one number printed twice under two names.
            */}
          <div className="ao-kpis">
            {(() => {
              const c = data.counts || { by: {}, cost: {} };
              const tl = data.overview?.warranty_timeline || {};
              return [
                ['box', 'Total assets', c.live ?? card(data, 'all').n, 'On the register', { live: true }, 'navy'],
                ['person', 'Assigned', c.by?.assigned ?? 0, 'Issued to staff', { status: 'assigned' }, 'blue'],
                ['building', 'Available', c.by?.available ?? 0, 'In the office, nobody holding it', { status: 'available' }, 'green'],
                ['wrench', 'Under repair', c.by?.maintenance ?? 0, 'Being serviced', { status: 'maintenance' }, 'orange'],
                ['alert', 'Damaged', c.by?.damaged ?? 0, 'Needs attention', { status: 'damaged' }, 'red'],
                ['help', 'Missing', c.by?.missing ?? 0, 'Said missing by somebody', { status: 'missing' }, 'red'],
                ['calendar', 'Warranty expiring', tl.d30 ?? 0, 'Within 30 days', null, 'orange', 'warranty'],
                ['rupee', 'Purchase value', rupees(c.cost?.live ?? data.spent), 'Cost of what is on the register', { live: true }, 'navy'],
                ['bars', 'Repair spend', rupees(data.overview?.repair_cost || 0), `${data.overview?.repairs || 0} service records`, null, 'grey', 'maintenance'],
              ].map(([icon, label, n, hint, filter, tone, view]) => (
                <button
                  key={label}
                  type="button"
                  className={`ao-kpi tone-${tone}`}
                  onClick={() => (view ? onView?.(view) : go(filter))}
                  title={`${hint} — open the list`}
                >
                  <span className="ao-kpi-icon"><Glyph name={icon} size={18} /></span>
                  <span className="ao-kpi-text">
                    <span className="k">{label}</span>
                    <span className="n">{n}</span>
                    <span className="h">{hint}</span>
                  </span>
                </button>
              ));
            })()}
          </div>

          {!data.counted ? (
            <div className="card">
              <p className="muted small">
                Nothing on the register yet for this filter.{' '}
                <button className="link" onClick={() => onAdd?.()}>Add an asset</button>, or{' '}
                <button className="link" onClick={() => onImport?.()}>import the list</button>{' '}
                you already keep in Excel.
              </p>
            </div>
          ) : null}

          {data.overview && data.counted ? (
            <Overview data={data} go={go} onView={onView} onAsset={onAsset} />
          ) : null}

          <div className="card">
            <h3>Smart alerts — needs attention</h3>
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

          {data.counts ? <HowItAddsUp counts={data.counts} oddities={data.oddities || []} onGo={go} /> : null}
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

/*
 * HOW THE FIGURES ADD UP.
 *
 * Dinesh's brief: reconcile the totals, and do not hardcode or bend a record
 * to make them meet. So this is the sum, from the one count every asset
 * screen reads (shared/assetStatus.js assetCounts), with the check shown; and
 * underneath, the records worth a person's look because two facts on them
 * pull different ways. Each is still counted in exactly one place above.
 */
function HowItAddsUp({ counts, oddities, onGo }) {
  const [open, setOpen] = useState(false);
  const b = counts.by;
  const rows = [
    ['Out with staff', b.assigned, { status: 'assigned' }],
    ['In the office', b.available, { status: 'available' }],
    ['Being repaired', b.maintenance, { status: 'maintenance' }],
    ['Damaged', b.damaged, { status: 'damaged' }],
    ['Missing', b.missing, { status: 'missing' }],
  ];
  const offRows = [
    ['Written off', b.written_off, { status: 'written_off' }],
    ['Disposed', b.disposed, { status: 'disposed' }],
  ];
  const line = ([label, n, filter]) => (
    <tr key={label}>
      <td>{label}</td>
      <td className="num">
        {n ? <button className="link" onClick={() => onGo(filter)}>{n}</button> : 0}
      </td>
      <td className="num">{rupees(counts.cost.by[filter.status] || 0)}</td>
    </tr>
  );
  return (
    <div className="card">
      <div className="row-between">
        <h3>How the figures add up</h3>
        <span className={`pill ${counts.check ? 'ok' : 'bad'}`}>
          {counts.check ? `${counts.live} + ${counts.gone} = ${counts.total} — adds up` : 'does not add up'}
        </span>
      </div>
      <table className="sheet asset-sum-table">
        <thead>
          <tr><th>On the register</th><th className="num">Assets</th><th className="num">Cost</th></tr>
        </thead>
        <tbody>
          {rows.map(line)}
          <tr className="total"><td>On the register</td><td className="num">{counts.live}</td><td className="num">{rupees(counts.cost.live)}</td></tr>
          {offRows.map(line)}
          <tr className="total"><td>Ever bought</td><td className="num">{counts.total}</td><td className="num">{rupees(counts.cost.all)}</td></tr>
        </tbody>
      </table>
      <p className="muted small">
        Every asset is in exactly one line. <strong>{counts.held}</strong> are in somebody&rsquo;s name — that
        is the out-with-staff line plus any held one that is being repaired, damaged or missing, which are
        counted on their own line. Cost is what it cost to buy; there is no depreciation.
      </p>
      {oddities.length ? (
        <>
          <button className="ghost small" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'} {oddities.reduce((n, g) => n + g.rows.length, 0)} records worth a look
          </button>
          {open ? (
            <div className="lines">
              {oddities.map((g) => (
                <div key={g.key} className="oddity">
                  <span className="what">
                    <strong>{g.label}</strong> <span className="num">{g.rows.length}</span>
                    <span className="muted small"> — {g.why}</span>
                    <br />
                    <span className="small">
                      {g.rows.slice(0, 8).map((r) => `${r.code}${r.employee_name ? ` (${r.employee_name})` : ''}`).join(', ')}
                      {g.rows.length > 8 ? ` and ${g.rows.length - 8} more` : ''}
                    </span>
                  </span>
                </div>
              ))}
              <p className="muted small">Nothing here is changed for you. Open the asset and correct what is wrong; the figures follow.</p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/*
 * v2.39.0: THE OVERVIEW'S BREAKDOWNS AND SHORT LISTS.
 *
 * Bars drawn by hand - no charting library, as everywhere else in this app -
 * and every one off the same live set as the cards. A bar for a company or a
 * category opens the register narrowed to it; department and location are
 * free text on an asset, so they open it narrowed the same way the register's
 * own pickers do.
 */
const LIMIT = 7;

function Bars({ title, rows = [], onPick, money = false }) {
  const top = rows.slice(0, LIMIT);
  const rest = rows.slice(LIMIT);
  const restN = rest.reduce((s, r) => s + r.n, 0);
  const max = Math.max(1, ...top.map((r) => r.n), restN);
  return (
    <div className="card ao-chart">
      <h4>{title}</h4>
      {!rows.length ? (
        <p className="muted small">Nothing to show.</p>
      ) : (
        <ul className="ao-bars">
          {top.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                className="ao-bar-row"
                disabled={!onPick || r.key === '—'}
                onClick={() => onPick?.(r)}
                title={`${r.n} on the register, ${r.assigned} with staff — ${rupees(r.cost)}`}
              >
                <span className="ao-bar-label">{r.key === '—' ? 'Not said' : r.key}</span>
                <span className="ao-bar-track"><i style={{ width: `${(r.n / max) * 100}%` }} /></span>
                <span className="ao-bar-n">{money ? rupees(r.cost) : r.n}</span>
              </button>
            </li>
          ))}
          {rest.length ? (
            <li>
              <span className="ao-bar-row static">
                <span className="ao-bar-label muted">{rest.length} more</span>
                <span className="ao-bar-track"><i className="muted" style={{ width: `${(restN / max) * 100}%` }} /></span>
                <span className="ao-bar-n">{restN}</span>
              </span>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function ListCard({ title, rows = [], empty, onAsset, right, action }) {
  return (
    <div className="card ao-list">
      <div className="row-between">
        <h4>{title}</h4>
        {action}
      </div>
      {!rows.length ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul>
          {rows.map((r, i) => (
            <li key={`${r.id}-${i}`}>
              <button type="button" className="link name-link" onClick={() => onAsset?.(r)}>
                {r.code || `#${r.id}`}
              </button>
              <span className="ao-list-what">
                {r.label}
                {r.employee_name ? <span className="muted"> · {r.employee_name}</span> : null}
              </span>
              <span className="ao-list-right">{right(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const shortDate = (iso) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
const inDays = (n) => (n === 0 ? 'today' : n < 0 ? `${-n}d late` : `in ${n}d`);

function Overview({ data, go, onView, onAsset }) {
  const o = data.overview;
  const by = data.counts?.by || {};
  const live = data.counts?.live || 0;
  const share = (n) => (live ? Math.round((n / live) * 100) : 0);
  const pending = (data.pending?.purchases || 0) + (data.pending?.claims || 0);
  return (
    <>
      <div className="ao-grid">
        <Bars title="Assets by category" rows={o.by_category} onPick={(r) => go({ category: r.key })} />
        <Bars title="Assets by company" rows={o.by_company} onPick={(r) => r.company_id && go({ company_id: String(r.company_id) })} />
        <Bars title="Assets by department" rows={o.by_department} onPick={(r) => go({ department: r.key })} />
        <Bars title="Assets by location" rows={o.by_location} />
        <div className="card ao-chart">
          <h4>Assigned vs available</h4>
          <div className="ao-split" title={`${by.assigned || 0} with staff, ${by.available || 0} in the office`}>
            <i className="assigned" style={{ width: `${share(by.assigned || 0)}%` }} />
            <i className="available" style={{ width: `${share(by.available || 0)}%` }} />
            <i className="other" style={{ width: `${share((by.maintenance || 0) + (by.damaged || 0) + (by.missing || 0))}%` }} />
          </div>
          <ul className="ao-legend">
            <li><b className="assigned" />With staff <strong>{by.assigned || 0}</strong> <span className="muted">{share(by.assigned || 0)}%</span></li>
            <li><b className="available" />In the office <strong>{by.available || 0}</strong> <span className="muted">{share(by.available || 0)}%</span></li>
            <li><b className="other" />Repair, damaged or missing <strong>{(by.maintenance || 0) + (by.damaged || 0) + (by.missing || 0)}</strong></li>
          </ul>
        </div>
        <Bars title="Purchase value by category" rows={[...o.by_category].sort((a, b) => b.cost - a.cost)} money onPick={(r) => go({ category: r.key })} />
        <div className="card ao-chart">
          <h4>Warranty expiring</h4>
          <div className="ao-columns">
            {[['Next 30 days', o.warranty_timeline.d30], ['Next 60 days', o.warranty_timeline.d60], ['Next 90 days', o.warranty_timeline.d90]].map(([label, n]) => {
              const max = Math.max(1, o.warranty_timeline.d90);
              return (
                <button key={label} type="button" className="ao-col" onClick={() => onView?.('warranty')}>
                  <span className="ao-col-n">{n}</span>
                  <span className="ao-col-bar"><i style={{ height: `${(n / max) * 100}%` }} /></span>
                  <span className="ao-col-label">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="ao-grid lists">
        <ListCard
          title="Upcoming warranty expirations"
          rows={o.upcoming_warranty}
          empty="Nothing runs out in the next 90 days."
          onAsset={onAsset}
          right={(r) => <span className={`pill ${r.left <= 30 ? 'pr-warn' : 'pr-info'}`}>{shortDate(r.until)} · {inDays(r.left)}</span>}
          action={<button className="link" onClick={() => onView?.('warranty')}>View all →</button>}
        />
        <ListCard
          title="Upcoming maintenance"
          rows={o.upcoming_service}
          empty="No service is due — a next service date is only what whoever did the work said."
          onAsset={onAsset}
          right={(r) => <span className={`pill ${r.left < 0 ? 'pr-bad' : 'pr-warn'}`}>{r.left < 0 ? 'Overdue' : 'Due'} · {shortDate(r.on)}</span>}
          action={<button className="link" onClick={() => onView?.('maintenance')}>View all →</button>}
        />
        <ListCard
          title="Recently added"
          rows={o.recently_added}
          empty="Nothing added yet."
          onAsset={onAsset}
          right={(r) => <span className="muted small">{shortDate(r.on)}</span>}
        />
        <ListCard
          title="Recently assigned"
          rows={o.recently_assigned}
          empty="Nothing handed over yet."
          onAsset={onAsset}
          right={(r) => <span className="muted small">{shortDate(r.on)}{r.returned_on ? ' · back' : ''}</span>}
          action={<button className="link" onClick={() => onView?.('slips')}>Assignments →</button>}
        />
        <ListCard
          title="Damaged"
          rows={o.damaged}
          empty="Nothing marked damaged."
          onAsset={onAsset}
          right={() => <span className="pill pr-bad">Damaged</span>}
        />
        <ListCard
          title="Missing"
          rows={o.missing}
          empty="Nothing marked missing. (Not checked in a stock audit is not missing.)"
          onAsset={onAsset}
          right={() => <span className="pill pr-bad">Missing</span>}
        />
        <div className="card ao-list">
          <h4>Pending approvals</h4>
          {!pending ? (
            <p className="muted small">Nothing waiting for a decision.</p>
          ) : (
            <ul>
              {data.pending.purchases ? (
                <li>
                  <button type="button" className="link" onClick={() => onView?.('purchases')}>
                    {data.pending.purchases} purchase request{data.pending.purchases === 1 ? '' : 's'} waiting for approval →
                  </button>
                </li>
              ) : null}
              {data.pending.claims ? (
                <li>
                  <button type="button" className="link" onClick={() => onView?.('register')}>
                    {data.pending.claims} asset{data.pending.claims === 1 ? '' : 's'} declared by staff to check →
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
