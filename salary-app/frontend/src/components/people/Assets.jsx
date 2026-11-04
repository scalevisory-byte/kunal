import { useEffect, useMemo, useState } from 'react';
import { api, download, openPage } from '../../api.js';
import { isOut, whereItIs } from '../../../../shared/assetReport.js';
import { rupees } from '../../format.js';
import AssetHistory from './AssetHistory.jsx';
import AssetImport from './AssetImport.jsx';
import HandoverSlips from './HandoverSlips.jsx';
import Maintenance from './Maintenance.jsx';
import StockTake from './StockTake.jsx';

const KINDS = ['Laptop', 'Desktop', 'Mobile', 'SIM card', 'ID card', 'Access card', 'Vehicle', 'Tools', 'Furniture', 'Other'];
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The asset register: laptops, ID cards, SIMs, tools.
 *
 * Two things the page insists on saying in words rather than leaving blank. An
 * asset with nobody against it is **in the office** — not lost. And what is
 * **out of the building** gets its own figure, because an asset in the office is
 * somewhere you can go and look.
 */
export default function Assets({ employees, companies, scanned, onScanned, onError }) {
  const [assets, setAssets] = useState([]);
  const [totals, setTotals] = useState({});
  const [view, setView] = useState('register');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState(null);
  const [notFound, setNotFound] = useState('');
  const [said, setSaid] = useState('');
  const [draft, setDraft] = useState({
    company_id: '',
    branch_id: '',
    kind: 'Laptop',
    label: '',
    identifier: '',
    purchase_cost: '',
    purchase_date: today(),
    vendor: '',
    invoice_no: '',
    warranty_until: '',
    code: '',
  });
  const [branches, setBranches] = useState([]);

  const load = async () => {
    try {
      const body = await api.get(`/people/assets${filter === 'gone' ? '?written_off=true' : ''}`);
      setAssets(body.assets);
      setTotals(body.totals);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    (async () => {
      if (!draft.company_id) return setBranches([]);
      try {
        const { branches: list } = await api.get(`/companies/branches?company_id=${draft.company_id}`);
        setBranches(list);
      } catch {
        setBranches([]);
      }
    })();
  }, [draft.company_id]);

  /*
   * A sticker was scanned and the app has landed here. The code is looked up
   * on its own rather than searched for in whatever is on screen: the register
   * may be filtered to one company, or to "in the office", and a scan should
   * find the thing wherever it is - including something written off, which is
   * exactly when somebody scans a label to ask what happened to it.
   */
  useEffect(() => {
    if (!scanned) return;
    let dropped = false;
    (async () => {
      try {
        const asset = await api.get(`/people/assets/by-code/${encodeURIComponent(scanned)}`);
        if (!dropped) setHistory(asset);
      } catch (err) {
        // 404 here is not an error to shout about: it is a sticker for
        // something that has been removed, or a code typed by hand.
        if (!dropped) setNotFound(err.status === 404 ? scanned : '');
        if (err.status !== 404) onError(err);
      } finally {
        onScanned?.();
      }
    })();
    return () => {
      dropped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter === 'out' && !isOut(a)) return false;
      if (filter === 'office' && (isOut(a) || a.written_off_on)) return false;
      if (!q) return true;
      return [a.code, a.label, a.identifier, a.employee_name, a.vendor, a.branch_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [assets, filter, query]);

  const act = async (call) => {
    try {
      await call();
      setSaid('');
      load();
    } catch (err) {
      setSaid(err.message);
    }
  };

  const add = () =>
    act(async () => {
      await api.post('/people/assets', draft);
      setDraft({ ...draft, label: '', identifier: '', purchase_cost: '', invoice_no: '', code: '' });
      setAdding(false);
    });

  const issue = (asset, employeeId) =>
    employeeId && act(() => api.post(`/people/assets/${asset.id}/issue`, { employee_id: Number(employeeId) }));

  const back = (asset) => {
    const condition = window.prompt(
      `${asset.code} ${asset.label} back from ${asset.employee_name}. What condition is it in? (leave empty for fine)`,
      ''
    );
    if (condition === null) return;
    return act(() => api.post(`/people/assets/${asset.id}/return`, { condition: condition || undefined }));
  };

  const writeOff = (asset) => {
    const why = window.prompt(
      `Write off ${asset.code} ${asset.label}? It keeps its code and its history, and leaves the register.\n\nWhy?`,
      ''
    );
    if (!why) return;
    return act(() => api.post(`/people/assets/${asset.id}/write-off`, { why }));
  };

  const remove = (asset) =>
    window.confirm(`Remove ${asset.code} ${asset.label} from the register?`) &&
    act(() => api.del(`/people/assets/${asset.id}`));

  /*
   * One sticker. QR by default - a phone camera reads it, and nobody in the
   * office has a laser scanner in their pocket. The Code 128 is still there
   * behind ?as=bar for a scanner that wants it.
   */
  const label = (asset) => openPage(`/people/assets/${asset.id}/label.svg?as=qr`).catch(onError);

  /*
   * The voucher accounts needs before it will release the money. Printed from
   * the register rather than filled in: it cannot exist unless the asset does,
   * which is the whole rule.
   */
  const voucher = (asset) =>
    openPage(`/people/assets/${asset.id}/voucher.html`).catch(onError);

  /* A page of them, because nobody labels one asset at a time. */
  const labelSheet = () => {
    const ids = shown.map((a) => a.id).join(',');
    openPage(`/people/assets/labels.html?ids=${ids}`).catch(onError);
  };

  if (view === 'stock') {
    return (
      <section className="stack">
        <Tabs view={view} setView={setView} />
        <StockTake onError={onError} />
      </section>
    );
  }

  if (view === 'slips') {
    return (
      <section className="stack">
        <Tabs view={view} setView={setView} />
        <HandoverSlips onError={onError} />
      </section>
    );
  }

  if (view === 'maintenance') {
    return (
      <section className="stack">
        <Tabs view={view} setView={setView} />
        <Maintenance employees={employees} companies={companies} onError={onError} />
      </section>
    );
  }

  return (
    <section className="stack">
      <Tabs view={view} setView={setView} />

      <div className="figures">
        <div className="figure">
          <span className="k">On the register</span>
          <span className="n">{totals.count || 0}</span>
        </div>
        <div className="figure">
          <span className="k">Out with staff</span>
          <span className="n">{totals.out || 0}</span>
        </div>
        <div className="figure">
          <span className="k">Worth, out of the building</span>
          <span className="n">{rupees(totals.out_value || 0)}</span>
        </div>
        <div className="figure">
          <span className="k">Bought, in all</span>
          <span className="n">{rupees(totals.cost || 0)}</span>
        </div>
      </div>

      {(totals.warranty_gone?.length > 0 || totals.warranty_soon?.length > 0) && (
        <ul className="alerts">
          {totals.warranty_soon?.length > 0 && (
            <li>
              {totals.warranty_soon.length} warrant{totals.warranty_soon.length === 1 ? 'y runs' : 'ies run'} out
              within a month: {totals.warranty_soon.map((a) => a.code).join(', ')}
            </li>
          )}
          {totals.warranty_gone?.length > 0 && (
            <li>
              {totals.warranty_gone.length} out of warranty: {totals.warranty_gone.slice(0, 6).map((a) => a.code).join(', ')}
              {totals.warranty_gone.length > 6 ? ' and more' : ''}
            </li>
          )}
        </ul>
      )}

      <div className="toolbar">
        <div className="sub-tabs toolbar">
          {[['all', 'Everything'], ['out', 'Out with staff'], ['office', 'In the office'], ['gone', 'Written off']].map(
            ([key, text]) => (
              <button key={key} className={filter === key ? 'active' : undefined} onClick={() => setFilter(key)}>
                {text}
              </button>
            )
          )}
        </div>
        <input
          className="search"
          placeholder="Code, name, serial, who has it"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Add an asset'}
        </button>
        <button className="ghost" onClick={() => setImporting((v) => !v)}>
          {importing ? 'Cancel' : 'Import from Excel'}
        </button>
        {/*
          * Fetched rather than linked, so the download carries whatever
          * identifies this browser - a link works on a session cookie and
          * 401s for somebody here on the API key.
          */}
        <button
          className="ghost"
          onClick={labelSheet}
          disabled={!shown.some((a) => a.code)}
          title="A page of QR stickers for everything on screen, to print and cut"
        >
          Labels to print
        </button>
        <button
          className="ghost"
          onClick={() => download('/people/assets/register.csv', 'asset-register.csv').catch((err) => setSaid(err.message))}
        >
          Register (CSV)
        </button>
        <button
          className="ghost"
          onClick={() => download('/people/assets/handovers.csv', 'asset-handovers.csv').catch((err) => setSaid(err.message))}
        >
          Handovers (CSV)
        </button>
      </div>

      {importing && (
        <AssetImport onDone={load} onError={(err) => setSaid(err.message)} />
      )}

      {adding && (
        <div className="card">
          <div className="form-grid">
            <label>
              Company
              <select value={draft.company_id} onChange={(e) => setDraft({ ...draft, company_id: e.target.value, branch_id: '' })}>
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
              <select value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}>
                <option value="">{branches.length ? 'Not in a branch' : 'No branches'}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
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
                value={draft.label}
                placeholder="Dell Latitude 3420"
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            <label>
              Serial / number
              <input value={draft.identifier} onChange={(e) => setDraft({ ...draft, identifier: e.target.value })} />
            </label>
            <label>
              What it cost
              <input
                type="number"
                value={draft.purchase_cost}
                onChange={(e) => setDraft({ ...draft, purchase_cost: e.target.value })}
              />
            </label>
            <label>
              Bought on
              <input
                type="date"
                value={draft.purchase_date}
                onChange={(e) => setDraft({ ...draft, purchase_date: e.target.value })}
              />
            </label>
            <label>
              From
              <input
                value={draft.vendor}
                placeholder="vendor"
                onChange={(e) => setDraft({ ...draft, vendor: e.target.value })}
              />
            </label>
            <label>
              Invoice
              <input value={draft.invoice_no} onChange={(e) => setDraft({ ...draft, invoice_no: e.target.value })} />
            </label>
            <label>
              Warranty until
              <input
                type="date"
                value={draft.warranty_until}
                onChange={(e) => setDraft({ ...draft, warranty_until: e.target.value })}
              />
            </label>
            <label>
              Code
              <input
                value={draft.code}
                placeholder="worked out for you"
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              />
            </label>
          </div>
          <p className="muted small">
            Leave the code empty and it is worked out — <code>BPL-LAP-014</code>, which is whose it
            is, what it is and which one. Type one if the sticker is already on it.
          </p>
          <button onClick={add} disabled={!draft.label.trim()}>
            Add it
          </button>
        </div>
      )}

      {said && <p className="error">{said}</p>}

      {/*
       * The register is wide, and it needs a scroller of its own. Without one
       * it widens the whole page, and on a phone Chrome then lays the entire
       * app out at the table's width - which is how a scanned sticker came to
       * open a panel running off the side of the screen.
       */}
      {!shown.length ? (
        <p className="muted small">Nothing here.</p>
      ) : (
        <div className="table-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th>Code</th>
              <th>What</th>
              <th>Serial</th>
              <th className="num">Cost</th>
              <th>Where it is</th>
              <th>Since</th>
              <th>Warranty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((asset) => {
              const out = isOut(asset);
              return (
                <tr key={asset.id}>
                  <td>
                    <button className="link" onClick={() => setHistory(asset)}>
                      {asset.code || '—'}
                    </button>
                  </td>
                  <td className="sticky-name">
                    {asset.kind} — {asset.label}
                    {asset.branch_name && <div className="muted small">{asset.branch_name}</div>}
                  </td>
                  <td className="muted small">{asset.identifier || '—'}</td>
                  <td className="num">{asset.purchase_cost ? rupees(asset.purchase_cost) : '—'}</td>
                  <td>
                    {out ? <strong>{asset.employee_name}</strong> : <span className="muted">{whereItIs(asset)}</span>}
                    {asset.condition && !out && <div className="muted small">{asset.condition}</div>}
                  </td>
                  <td className="muted small">{out ? asset.issued_on || '—' : asset.returned_on || '—'}</td>
                  <td className="muted small">
                    {asset.warranty_until ? (
                      <span className={asset.warranty_left_days < 0 ? 'overdue' : undefined}>
                        {asset.warranty_until}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {asset.written_off_on ? (
                      <span className="muted small">written off {asset.written_off_on}</span>
                    ) : out ? (
                      <>
                        <button className="ghost small" onClick={() => back(asset)}>
                          take it back
                        </button>{' '}
                      </>
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
                    {asset.code && !asset.written_off_on && (
                      <button className="ghost small" onClick={() => label(asset)}>
                        label
                      </button>
                    )}{' '}
                    {!asset.written_off_on && (
                      <button
                        className="ghost small"
                        onClick={() => voucher(asset)}
                        title="The purchase voucher, to hand to accounts"
                      >
                        voucher
                      </button>
                    )}{' '}
                    {!asset.written_off_on &&
                      (asset.handovers ? (
                        <button className="ghost small" onClick={() => writeOff(asset)}>
                          write off
                        </button>
                      ) : (
                        <button className="ghost small" onClick={() => remove(asset)}>
                          remove
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {notFound && (
        <p className="banner bad">
          Nothing on the register with the code <strong>{notFound}</strong>. The sticker may be
          for something that has been removed.
          <button className="ghost tiny" onClick={() => setNotFound('')}>dismiss</button>
        </p>
      )}
      {history && <AssetHistory asset={history} onClose={() => setHistory(null)} onError={onError} />}
    </section>
  );
}

function Tabs({ view, setView }) {
  return (
    <div className="sub-tabs toolbar">
      {/* Maintenance is a fourth view rather than a tab above these three:
          two rows of tabs over one table is one row too many. */}
      {[
        ['register', 'Register'],
        ['slips', 'Who holds what'],
        ['stock', 'Stock take'],
        ['maintenance', 'Maintenance'],
      ].map(([key, text]) => (
        <button key={key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}
