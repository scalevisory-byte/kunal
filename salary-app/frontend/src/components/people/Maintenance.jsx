import { useEffect, useMemo, useState } from 'react';
import { api, download } from '../../api.js';
import { SERVICE_KINDS } from '../../../../shared/maintenance.js';
import { rupees } from '../../format.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * What has been done to each asset, what it cost, and what is due.
 *
 * Two things this screen is built around.
 *
 * **A duplicate is caught when it is typed.** The same service entered twice —
 * same asset, same date, same amount — is the commonest way a running cost comes
 * out wrong, and finding it in a report means a month has already been closed on
 * the wrong figure. So the server answers 409 with the row it resembles, and
 * this asks. It **asks** rather than refuses: two identical repairs on one day
 * do happen, and a system that will not record the truth gets worked around.
 *
 * **Cost of ownership keeps its parts.** "This laptop has cost ₹49,300" and
 * "₹42,000 of that was buying it" are different sentences and both get asked.
 */
export default function Maintenance({ companies, onError }) {
  const [assets, setAssets] = useState([]);
  const [totals, setTotals] = useState({});
  const [alerts, setAlerts] = useState({});
  const [spend, setSpend] = useState(null);
  // 'all' or a four-digit year. Held here rather than in the URL because this
  // is a question somebody asks and then moves on from.
  const [year, setYear] = useState('all');
  const [view, setView] = useState('due');
  const [query, setQuery] = useState('');
  const [logging, setLogging] = useState(null);
  const [said, setSaid] = useState('');

  const load = async (forYear = year) => {
    try {
      const body = await api.get(`/people/maintenance?year=${encodeURIComponent(forYear)}`);
      setAssets(body.assets);
      setTotals(body.totals);
      setAlerts(body.alerts);
      setSpend(body.spend);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = assets;
    if (view === 'due') list = assets.filter((a) => a.ownership.service_due || a.ownership.service_soon);
    if (view === 'serviced') list = assets.filter((a) => a.ownership.times > 0);
    if (view === 'expensive') list = [...assets].sort((a, b) => b.ownership.service - a.ownership.service);
    if (!q) return list;
    return list.filter((a) =>
      [a.code, a.label, a.kind].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [assets, view, query]);

  return (
    <section className="stack">
      <div className="figures">
        <div className="figure">
          <span className="k">Bought</span>
          <span className="n">{rupees(totals.purchase || 0)}</span>
        </div>
        <div className="figure">
          <span className="k">Spent keeping them</span>
          <span className="n">{rupees(totals.service || 0)}</span>
        </div>
        <div className="figure">
          <span className="k">In all, so far</span>
          <span className="n">{rupees(totals.total || 0)}</span>
        </div>
        <div className="figure">
          <span className="k">Services recorded</span>
          <span className="n">{totals.services || 0}</span>
        </div>
      </div>

      {spend && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>
            What it is costing
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              style={{ marginLeft: '0.6rem' }}
            >
              <option value="all">Since the beginning</option>
              {spend.years.map((y) => (
                <option key={y.year} value={y.year}>
                  {y.year}
                </option>
              ))}
            </select>
          </h3>

          {/*
           * The office's own kit on its own line. "General asset" means exactly
           * this: nobody is holding it, so nobody is responsible for it, and
           * what it costs to keep is a running office expense rather than
           * something that belongs to a person.
           */}
          <div className="figures">
            <div className="figure">
              <span className="k">Office kit, nobody holding it</span>
              <span className="n">{spend.office.assets}</span>
            </div>
            <div className="figure">
              <span className="k">Repairs on it</span>
              <span className="n">{rupees(spend.office.service)}</span>
            </div>
            <div className="figure">
              <span className="k">AMC on it</span>
              <span className="n">{rupees(spend.office.amc)}</span>
            </div>
            <div className="figure">
              <span className="k">Costing in all</span>
              <span className="n">{rupees(spend.office.upkeep)}</span>
            </div>
          </div>

          {spend.years.length > 1 && (
            <table className="sheet" style={{ marginTop: '0.8rem' }}>
              <thead>
                <tr>
                  <th className="sticky-name">Year</th>
                  <th>Services</th>
                  <th>Spent</th>
                </tr>
              </thead>
              <tbody>
                {spend.years.map((y) => (
                  <tr key={y.year}>
                    <td className="sticky-name">{y.year}</td>
                    <td className="num">{y.times}</td>
                    <td className="num">{rupees(y.cost)}</td>
                  </tr>
                ))}
                {spend.undated > 0 && (
                  <tr>
                    <td className="sticky-name muted">No date on the bill</td>
                    <td className="num muted">—</td>
                    <td className="num muted">{rupees(spend.undated)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          <table className="sheet" style={{ marginTop: '0.8rem' }}>
            <thead>
              <tr>
                <th className="sticky-name">What</th>
                <th>Where it is</th>
                <th>Bought for</th>
                <th>Repairs</th>
                <th>AMC</th>
                <th>Upkeep</th>
                <th title="Upkeep as a share of what it cost to buy">Share</th>
              </tr>
            </thead>
            <tbody>
              {spend.items
                .filter((r) => r.upkeep > 0)
                .map((r) => (
                  <tr key={r.id}>
                    <td className="sticky-name">
                      {r.code}
                      <div className="muted small">
                        {r.kind}
                        {r.label ? ` — ${r.label}` : ''}
                      </div>
                    </td>
                    <td className={r.general ? 'muted' : undefined}>
                      {r.general ? 'in the office' : r.holder}
                    </td>
                    <td className="num muted">{r.purchase ? rupees(r.purchase) : '—'}</td>
                    <td className="num">
                      {r.service ? rupees(r.service) : '—'}
                      {r.times > 0 && <span className="muted small"> ×{r.times}</span>}
                    </td>
                    <td className="num muted">{r.amc ? rupees(r.amc) : '—'}</td>
                    <td className="num grand">{rupees(r.upkeep)}</td>
                    <td className={`num${r.share !== null && r.share >= 100 ? ' bad' : ''}`}>
                      {r.share === null ? '—' : `${r.share}%`}
                    </td>
                  </tr>
                ))}
              {!spend.items.some((r) => r.upkeep > 0) && (
                <tr>
                  <td colSpan={7} className="empty">
                    Nothing has been spent on keeping anything
                    {year === 'all' ? ' yet' : ` in ${year}`}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="muted small">
            <strong>AMC is counted beside repairs, never inside them.</strong> A contract is
            money committed for the year whether or not anything breaks; a repair bill is money
            already gone. A share at or over 100% means keeping it has cost more than buying it
            did — usually the moment to replace rather than repair again.
          </p>
        </div>
      )}

      {(alerts.overdue?.length || alerts.soon?.length || alerts.amc_gone?.length || totals.costing_more_than_bought?.length) > 0 && (
        <ul className="alerts">
          {alerts.overdue?.length > 0 && (
            <li>
              <strong>{alerts.overdue.length} overdue a service</strong> —{' '}
              {alerts.overdue.slice(0, 5).map((a) => `${a.code} (${a.ownership.next_service_on})`).join(', ')}
            </li>
          )}
          {alerts.soon?.length > 0 && (
            <li>
              {alerts.soon.length} due within a month —{' '}
              {alerts.soon.slice(0, 5).map((a) => `${a.code} (${a.ownership.next_service_on})`).join(', ')}
            </li>
          )}
          {alerts.amc_gone?.length > 0 && (
            <li>
              {alerts.amc_gone.length} with a lapsed AMC —{' '}
              {alerts.amc_gone.slice(0, 5).map((a) => `${a.code} (${a.ownership.amc_until})`).join(', ')}
            </li>
          )}
          {totals.costing_more_than_bought?.length > 0 && (
            <li>
              {totals.costing_more_than_bought.length} ha{totals.costing_more_than_bought.length === 1 ? 's' : 've'}{' '}
              cost more to keep than to buy —{' '}
              {totals.costing_more_than_bought.slice(0, 5).map((a) => a.code).join(', ')}. Usually the
              moment to replace rather than repair again.
            </li>
          )}
        </ul>
      )}

      <div className="toolbar">
        <div className="sub-tabs toolbar">
          {[
            ['due', 'Due or overdue'],
            ['all', 'Everything'],
            ['serviced', 'Has been serviced'],
            ['expensive', 'Costliest to keep'],
          ].map(([key, text]) => (
            <button key={key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
              {text}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="Code or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="ghost"
          onClick={() => download('/people/maintenance/services.csv', 'asset-services.csv').catch((e) => setSaid(e.message))}
        >
          Services (CSV)
        </button>
        <button
          className="ghost"
          onClick={() =>
            download('/people/maintenance/ownership.csv', 'asset-cost-of-ownership.csv').catch((e) => setSaid(e.message))
          }
        >
          Cost of ownership (CSV)
        </button>
      </div>

      {said && <p className="error">{said}</p>}

      {!shown.length ? (
        <p className="muted small">
          {view === 'due' ? 'Nothing is due. Nothing is overdue either.' : 'Nothing here.'}
        </p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Code</th>
              <th>What</th>
              <th className="num">To buy</th>
              <th className="num">To keep</th>
              <th className="num">Total</th>
              <th className="num">Times</th>
              <th>Last</th>
              <th>Next</th>
              <th>Cover</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((asset) => {
              const own = asset.ownership;
              return (
                <tr key={asset.id}>
                  <td>{asset.code || '—'}</td>
                  <td className="sticky-name">
                    {asset.kind} — {asset.label}
                    {asset.employee_name && <div className="muted small">with {asset.employee_name}</div>}
                  </td>
                  <td className="num">{own.purchase ? rupees(own.purchase) : '—'}</td>
                  <td className="num">{own.service ? rupees(own.service) : '—'}</td>
                  <td className="num">
                    {rupees(own.total)}
                    {own.service_share !== null && own.service_share > 0 && (
                      <div className="muted small">{own.service_share}% to keep</div>
                    )}
                  </td>
                  <td className="num">{own.times || '—'}</td>
                  <td className="muted small">{own.last_service_on || '—'}</td>
                  <td className={own.service_due ? 'overdue' : undefined}>
                    {own.next_service_on || <span className="muted">not set</span>}
                  </td>
                  <td className="muted small">
                    {own.under_amc ? `AMC to ${own.amc_until}` : own.under_warranty ? `warranty to ${own.warranty_until}` : '—'}
                  </td>
                  <td>
                    <button className="ghost small" onClick={() => setLogging(asset)}>
                      log a service
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {logging && (
        <ServiceForm
          asset={logging}
          onClose={() => setLogging(null)}
          onDone={async () => {
            setLogging(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

/**
 * Logging one service.
 *
 * The duplicate check lives here rather than in a report. A 409 from the server
 * carries the row it resembles, which is shown, and the same button then says
 * "add it anyway" — asking, not refusing.
 */
function ServiceForm({ asset, onClose, onDone }) {
  const own = asset.ownership;
  const [form, setForm] = useState({
    serviced_on: today(),
    kind: 'Service',
    work: '',
    vendor: '',
    invoice_no: '',
    cost: '',
    under_warranty: own.under_warranty || own.under_amc,
    next_service_on: '',
    note: '',
  });
  const [twin, setTwin] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (force) => {
    setBusy(true);
    setProblem('');
    try {
      await api.post(`/people/assets/${asset.id}/services`, { ...form, force });
      onDone();
    } catch (err) {
      // 409 is the duplicate check. The server sent back the row it resembles.
      if (err.duplicate) {
        setTwin(err.duplicate);
        setProblem(err.message);
      } else {
        setProblem(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const set = (patch) => {
    setForm({ ...form, ...patch });
    // Changing anything means this is no longer the thing that was flagged.
    setTwin(null);
    setProblem('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="late-head">
          <div>
            <h3>
              {asset.code} — {asset.kind} {asset.label}
            </h3>
            <p className="muted small">
              {own.times ? `${own.times} services so far, ${rupees(own.service)}.` : 'Nothing done to it yet.'}
              {own.under_amc
                ? ` Under AMC until ${own.amc_until}.`
                : own.under_warranty
                  ? ` Under warranty until ${own.warranty_until}.`
                  : ''}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="form-grid">
          <label>
            When
            <input type="date" value={form.serviced_on} onChange={(e) => set({ serviced_on: e.target.value })} />
          </label>
          <label>
            What kind
            <select value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
              {SERVICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            What it cost
            <input type="number" value={form.cost} onChange={(e) => set({ cost: e.target.value })} />
          </label>
          <label>
            Who did it
            <input value={form.vendor} onChange={(e) => set({ vendor: e.target.value })} />
          </label>
          <label>
            Invoice
            <input value={form.invoice_no} onChange={(e) => set({ invoice_no: e.target.value })} />
          </label>
          <label>
            Service it again on
            <input
              type="date"
              value={form.next_service_on}
              onChange={(e) => set({ next_service_on: e.target.value })}
            />
          </label>
        </div>

        <label className="block">
          What was done
          <input
            value={form.work}
            placeholder="Keyboard replaced"
            onChange={(e) => set({ work: e.target.value })}
          />
        </label>

        <label className="inline">
          <input
            type="checkbox"
            checked={form.under_warranty}
            onChange={(e) => set({ under_warranty: e.target.checked })}
          />{' '}
          Done under warranty or the AMC
        </label>
        <p className="muted small">
          Free work still goes on the record at what it actually cost — an asset serviced four
          times for nothing is still an asset serviced four times. Leave &ldquo;service it again
          on&rdquo; empty if nobody said: a date this app invented would produce reminders nobody
          asked for.
        </p>

        {problem && <p className="error">{problem}</p>}
        {twin && (
          <div className="card">
            <h4>Already on the record</h4>
            <p className="muted small">
              {twin.serviced_on} · {twin.kind} · {rupees(twin.cost)}
              {twin.work ? ` · ${twin.work}` : ''}
              {twin.vendor ? ` · ${twin.vendor}` : ''}
            </p>
            <p className="muted small">
              If this is a second, genuine bill on the same day, add it anyway. If it is the same
              one, close this.
            </p>
          </div>
        )}

        <button onClick={() => save(Boolean(twin))} disabled={busy}>
          {busy ? 'Saving…' : twin ? 'Add it anyway' : 'Record it'}
        </button>
      </div>
    </div>
  );
}
