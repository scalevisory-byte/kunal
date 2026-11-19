import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api, download, openPage } from '../../api.js';
import AssetDashboard from './AssetDashboard.jsx';
import AssetMasters from './AssetMasters.jsx';
import AssetPrefixes, { Renumber } from './AssetPrefixes.jsx';
import { ASSET_STATES, allocationProblem, assetStatus, statusLabel } from '../../../../shared/assetStatus.js';
import { isOut, whereItIs } from '../../../../shared/assetReport.js';
import { matchesFilter } from '../../../../shared/assetDashboard.js';
import { groupLabel, groupOf, groupTally } from '../../../../shared/assetGroups.js';
import { assetAlerts, nameSome } from '../../../../shared/assetAlerts.js';
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
/**
 * A CELL YOU CAN TYPE IN, the way the salary sheet has one.
 *
 * Dinesh: the register should work like Excel — "सीधे sheet में edit", the
 * name, the serial, the cost and the warranty date changed in place without
 * opening anything.
 *
 * Three things it insists on, each of which cost somebody a bug elsewhere in
 * this app:
 *
 *   **It saves only what CHANGED.** Tabbing across a row of twelve cells must
 *   not send twelve patches, and a patch that re-sends the value already
 *   stored would fill the audit trail with changes nobody made.
 *
 *   **It is keyed on the stored value**, so a reload under a row already on
 *   screen re-renders the box instead of leaving a stale figure showing — the
 *   trap the employee table hit after a bulk edit.
 *
 *   **A refusal puts the old value back** and says so, rather than leaving
 *   what was typed sitting in a cell that was never saved.
 */
function SheetCell({ asset, field, type = 'text', align, list, placeholder, onSave }) {
  const stored = asset[field] === null || asset[field] === undefined ? '' : String(asset[field]);
  const [draft, setDraft] = useState(stored);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(stored);
  }, [stored, focused]);

  return (
    <input
      className={`cell-input${align === 'num' ? ' num' : ''}`}
      type={type === 'date' ? 'date' : 'text'}
      inputMode={type === 'number' ? 'decimal' : undefined}
      list={list}
      value={draft}
      placeholder={placeholder}
      disabled={busy}
      onFocus={(e) => {
        setFocused(true);
        if (type !== 'date') e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        setFocused(false);
        const typed = draft.trim();
        if (typed === stored) return;              // nothing changed: send nothing.
        if (type === 'number' && typed !== '' && !Number.isFinite(Number(typed))) {
          setDraft(stored);
          return;
        }
        setBusy(true);
        try {
          await onSave(asset, field, typed === '' ? null : type === 'number' ? Number(typed) : typed);
        } catch {
          setDraft(stored);                        // refused: put it back.
        } finally {
          setBusy(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') {
          setDraft(stored);
          e.target.blur();
        }
      }}
    />
  );
}

/**
 * One line of "this is running out", in the licence register's shape.
 *
 * It NAMES a few rather than only counting them: "6 out of warranty" sends
 * somebody off to find which six, and a list of codes does not. Clicking it
 * narrows the register to exactly the assets the line counted — held as ids,
 * so the list and the figure cannot disagree.
 */
function AlertLine({ tone, assets, onOpen, label, lead, tail, field = 'warranty_until' }) {
  return (
    <p className={`lic-alert ${tone}`}>
      <button
        className="link"
        onClick={() => onOpen({ label, ids: new Set(assets.map((a) => a.id)) })}
        title="Show these on the register"
      >
        <strong>{lead}</strong>
      </button>{' '}
      — {nameSome(assets, 5, field)}
      {tail ? ` ${tail}` : '.'}
    </p>
  );
}

export default function Assets({ employees, companies, scanned, onScanned, onError }) {
  const [assets, setAssets] = useState([]);
  const [totals, setTotals] = useState({});
  const [view, setView] = useState('dashboard');
  /*
   * What the dashboard asked the register to show, so the two agree.
   *
   * It was SET and never READ. The dashboard narrows by company, branch,
   * category and financial year, and all four were thrown away the moment a
   * card was clicked - so "2 Laptops registered" opened a list of every asset
   * there is. Dead state, which is why nobody noticed.
   *
   * The status half is already turned into a chip by `onOpen`, so only the
   * four dropdowns are kept here; applying both would narrow twice.
   */
  const [from, setFrom] = useState(null);
  const narrowed = useMemo(() => {
    const { company_id, branch_id, category, department, year } = from || {};
    // Department too, or choosing one on the dashboard and clicking a figure
    // opens a list that quietly ignores it.
    const kept = { company_id, branch_id, category, department, year };
    return Object.values(kept).some(Boolean) ? kept : null;
  }, [from]);
  const [allBranches, setAllBranches] = useState([]);
  const [filter, setFilter] = useState('all');
  /*
   * Computer / Furniture / Mobile - Dinesh asked for these by name. One
   * group at a time, blank for all of them.
   */
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  /*
   * The alert line somebody clicked, as { label, ids }.
   *
   * A line that names six codes and cannot show them is half an answer - the
   * licence tiles open their list, and this does the same. Held as ids so the
   * narrowing is exactly the assets the line counted, never a second filter
   * that could disagree with it.
   */
  const [dateFocus, setDateFocus] = useState(null);
  /*
   * The three dropdowns Dinesh asked for on the register itself.
   *
   * They existed on the asset DASHBOARD and were carried across when a card
   * was clicked - which is no use to somebody who is already standing on the
   * register. Held here, applied in `shown` with everything else.
   */
  const [pick, setPick] = useState({ company_id: '', department: '', kind: '' });
  const [codes, setCodes] = useState(false);
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
    brand: '',
    model: '',
    description: '',
    department: '',
    location: '',
    floor_room: '',
    warranty_from: '',
    warranty_provider: '',
    amc_until: '',
    amc_vendor: '',
    amc_cost: '',
    purchase_remarks: '',
  });
  const [branches, setBranches] = useState([]);
  /* The lists behind the pickers. Suggestions only - typing anything works. */
  const [masters, setMasters] = useState([]);

  /*
   * What goes in the "What" picker.
   *
   * It was a hard-coded list of ten, and the Lists tab said it held "the four
   * lists behind the pickers" - but only Brands and Vendors were behind one.
   * A Type added there ("Printer", "Desk") appeared NOWHERE, and a Category
   * appeared nowhere at all. Two of the four lists took typing and did
   * nothing with it.
   *
   * So the picker is the built-in ten PLUS whatever Types have been added,
   * grouped under their category. The built-ins are kept rather than replaced
   * because nothing here is a gate: a kind that could be picked yesterday has
   * to be pickable today, and an asset stores its kind as TEXT anyway.
   */
  const kindGroups = useMemo(() => {
    const types = masters.filter((m) => m.kind === 'type' && m.name);
    const groups = new Map();
    for (const t of types) {
      const label = t.parent_name || 'Your list';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(t.name);
    }
    const taken = new Set(types.map((t) => t.name.toLowerCase()));
    return {
      added: [...groups.entries()],
      builtIn: KINDS.filter((k) => !taken.has(k.toLowerCase())),
    };
  }, [masters]);

  /*
   * Every branch, for the dashboard's filter. The add form loads one
   * company's branches on demand; this is the whole list, once.
   */
  useEffect(() => {
    api
      .get('/people/asset-masters')
      .then(({ masters: list }) => setMasters(list || []))
      .catch(() => setMasters([]));
    api
      .get('/companies/branches')
      .then(({ branches }) => setAllBranches(branches || []))
      // A company with no branches at all is normal, not a failure worth a
      // banner on a dashboard.
      .catch(() => setAllBranches([]));
  }, []);

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

  /*
   * What is running out. Worked out from the register the browser already
   * holds, with the same module the dashboard and the maintenance panel use -
   * so a line here, a line there and the digest cannot disagree.
   */
  const dates = useMemo(() => assetAlerts(assets), [assets]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter === 'out' && !isOut(a)) return false;
      if (filter === 'office' && (isOut(a) || a.written_off_on)) return false;
      /*
       * `?written_off=true` means "INCLUDE the written-off ones", not "only
       * them" - so this filter was fetching the whole register and narrowing
       * it by nothing. Clicking "Written off" to see what had been scrapped
       * listed every live asset too, which reads as if they all had been.
       * The dashboard's written-off card opens this same filter, so its count
       * and this list disagreed by the size of the register.
       */
      if (filter === 'gone' && !a.written_off_on) return false;
      if (filter === 'maintenance' && assetStatus(a) !== 'maintenance') return false;
      /*
       * The group is WORKED OUT from the kind, never read off a column - so
       * narrowing by it cannot disagree with what the row says it is.
       */
      if (group && groupOf(a.kind, a.label) !== group) return false;
      /* The dashboard's own filter, applied by the dashboard's own code. */
      if (narrowed && !matchesFilter(a, narrowed)) return false;
      /* An alert line that was clicked: exactly the assets it counted. */
      if (dateFocus && !dateFocus.ids.has(a.id)) return false;
      if (pick.company_id && Number(a.company_id) !== Number(pick.company_id)) return false;
      // Folded case-insensitively: Accounts and ACCOUNTS are one room.
      if (pick.department && String(a.department || '').toLowerCase() !== pick.department.toLowerCase()) return false;
      if (pick.kind && a.kind !== pick.kind) return false;
      if (!q) return true;
      // The old code too: his stickers still read BNF-Assets-2456, and
      // somebody holding the mouse has only the sticker.
      return [a.code, a.old_code, a.label, a.identifier, a.employee_name, a.vendor, a.branch_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [assets, filter, query, narrowed, group, dateFocus, pick]);

  /*
   * What the dropdowns offer: what the register actually holds, not a master
   * list. Offering a department no asset carries gives an empty list and no
   * reason why - the same rule the dashboard's pickers follow.
   */
  const choices = useMemo(() => {
    const departments = new Map();
    const kinds = new Set();
    const companyIds = new Set();
    for (const a of assets) {
      const d = String(a.department || '').trim();
      if (d) departments.set(d.toLowerCase(), d);
      if (a.kind) kinds.add(a.kind);
      if (a.company_id) companyIds.add(Number(a.company_id));
    }
    return {
      departments: [...departments.values()].sort((a, b) => a.localeCompare(b)),
      kinds: [...kinds].sort(),
      companies: companies.filter((c) => companyIds.has(Number(c.id))),
    };
  }, [assets, companies]);

  /*
   * The count on each group button.
   *
   * Taken BEFORE the group filter and after every other one, which is what
   * makes the buttons useful: "Furniture 369" is a reason to press it, and
   * counting only what is already on screen would make every button read as
   * the whole list. The same rule the test-results filter follows.
   */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = assets.filter((a) => {
      if (filter === 'out' && !isOut(a)) return false;
      if (filter === 'office' && (isOut(a) || a.written_off_on)) return false;
      if (filter === 'gone' && !a.written_off_on) return false;
      if (filter === 'maintenance' && assetStatus(a) !== 'maintenance') return false;
      if (narrowed && !matchesFilter(a, narrowed)) return false;
      if (!q) return true;
      // The old code too: his stickers still read BNF-Assets-2456, and
      // somebody holding the mouse has only the sticker.
      return [a.code, a.old_code, a.label, a.identifier, a.employee_name, a.vendor, a.branch_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    return groupTally(base);
  }, [assets, filter, query, narrowed]);

  /*
   * The code the next asset would get, for the form to show.
   *
   * Re-asked whenever the company changes, and again after anything is
   * added, because by then the number has moved on.
   */
  const [nextCode, setNextCode] = useState('');
  useEffect(() => {
    if (STANDALONE || !adding) return;
    const company = Number(draft.company_id) || 0;
    if (!company) { setNextCode(''); return; }
    let alive = true;
    api
      .get(`/people/assets/next-code?company_id=${company}`)
      .then((r) => { if (alive) setNextCode(r.code || ''); })
      .catch(() => { if (alive) setNextCode(''); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, draft.company_id, assets.length]);

  /*
   * One cell, saved.
   *
   * The row is replaced in state from the server's echo rather than the whole
   * register being re-fetched: a thousand rows reloaded on every keystroke-out
   * is a second of blank table each time, and the scroll position goes with
   * it. Errors are re-thrown so the cell can put the old value back.
   */
  const saveCell = async (asset, field, value) => {
    try {
      const after = await api.patch(`/people/assets/${asset.id}`, { [field]: value });
      setAssets((list) => list.map((a) => (a.id === asset.id ? { ...a, ...after } : a)));
      setSaid('');
    } catch (err) {
      setSaid(err.message);
      throw err;
    }
  };

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

  /*
   * Under maintenance, damaged, missing, disposed - or back in use.
   *
   * `statusLabel` was imported and never used, and nothing anywhere in the
   * app could set one of the four: the dashboard counted "Under maintenance",
   * the API had a route for it and the single file had none. A laptop at the
   * repair shop could not be said to be at the repair shop.
   *
   * A note is asked for but not required - "missing" with no word about where
   * it was last seen is still worth recording the day somebody notices.
   */
  const setState = (asset, state) => {
    if (state && state !== 'available') {
      const label = statusLabel(state);
      const note = window.prompt(
        `${asset.code} ${asset.label} — ${label}.\n\nA note? (where it is, who took it, what happened)`,
        ''
      );
      if (note === null) return undefined;
      return act(() => api.post(`/people/assets/${asset.id}/state`, { state, note }));
    }
    return act(() => api.post(`/people/assets/${asset.id}/state`, { state: '' }));
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

  /*
   * The dashboard opens the register with the filter the card carried, so a
   * figure and the rows behind it can never disagree.
   */
  if (view === 'dashboard') {
    return (
      <section className="stack">
        <Tabs view={view} setView={setView} />
        <AssetDashboard
          companies={companies}
          branches={allBranches}
          onError={onError}
          onAdd={() => { setImporting(false); setAdding(true); setView('register'); }}
          onImport={() => { setAdding(false); setImporting(true); setView('register'); }}
          onOpen={(f) => {
            setFrom(f);
            /*
             * The card's status, in the register's own words. 'available'
             * used to map to 'in', which NO filter knows about - so the
             * Available card opened with no chip lit and nothing narrowed,
             * showing the whole register under a card that said 2. And
             * "Under maintenance" had no filter at all, so it fell through
             * to Everything.
             */
            setFilter(
              f.status === 'assigned' ? 'out'
                : f.status === 'written_off' ? 'gone'
                  : f.status === 'available' ? 'office'
                    : f.status === 'maintenance' ? 'maintenance'
                      : 'all'
            );
            setView('register');
          }}
        />
      </section>
    );
  }

  if (view === 'masters') {
    return (
      <section className="stack">
        <Tabs view={view} setView={setView} />
        {/*
          * The prefixes sit ABOVE the four name lists, not below them.
          *
          * They decide what every future sticker reads, which is a setting;
          * the lists below are typing conveniences. Putting the consequential
          * one under four others is how somebody reports it as missing.
          */}
        <AssetPrefixes onError={onError} onToast={setSaid} />
        <AssetMasters onError={onError} onChanged={setMasters} />
      </section>
    );
  }

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

      {(dates.count > 0 || dates.warranty_long_gone.length > 0 || dates.no_warranty_date.length > 0) && (
        <div className="card">
          {dates.warranty_just_gone.length > 0 && (
            <AlertLine
              tone="bad"
              assets={dates.warranty_just_gone}
              onOpen={setDateFocus}
              label="out of warranty"
              lead={`${dates.warranty_just_gone.length} ${
                dates.warranty_just_gone.length === 1 ? 'warranty has' : 'warranties have'
              } just run out`}
              tail={`— within the last ${dates.recent_days} days, so extending cover or putting it on an AMC is still a live decision.`}
            />
          )}
          {dates.warranty_soon.length > 0 && (
            <AlertLine
              tone="warn"
              assets={dates.warranty_soon}
              onOpen={setDateFocus}
              label="warranty running out"
              lead={`${dates.warranty_soon.length} ${
                dates.warranty_soon.length === 1 ? 'warranty runs' : 'warranties run'
              } out within ${dates.soon} days`}
            />
          )}
          {dates.amc_just_gone.length > 0 && (
            <AlertLine
              tone="bad"
              assets={dates.amc_just_gone}
              onOpen={setDateFocus}
              field="amc_until"
              label="AMC lapsed"
              lead={`${dates.amc_just_gone.length} AMC${dates.amc_just_gone.length === 1 ? ' has' : 's have'} lapsed`}
              tail="— a contract, not a warranty: that is money committed for the year and nobody is covered until it is renewed."
            />
          )}
          {dates.amc_soon.length > 0 && (
            <AlertLine
              tone="warn"
              assets={dates.amc_soon}
              onOpen={setDateFocus}
              field="amc_until"
              label="AMC due"
              lead={`${dates.amc_soon.length} AMC${dates.amc_soon.length === 1 ? '' : 's'} to renew within ${dates.soon} days`}
            />
          )}

          {/*
            * The two that are NOT deadlines, and are said quietly so they do
            * not drown the ones that are.
            */}
          {dates.warranty_long_gone.length > 0 && (
            <p className="lic-alert muted small">
              <button
                className="link"
                onClick={() =>
                  setDateFocus({
                    label: `out of warranty for more than ${dates.recent_days} days`,
                    ids: new Set(dates.warranty_long_gone.map((a) => a.id)),
                  })
                }
              >
                {dates.warranty_long_gone.length} out of warranty for longer
              </button>{' '}
              — old kit, not news; it is here to be counted rather than chased.
            </p>
          )}
          {dates.no_warranty_date.length > 0 && (
            <p className="lic-alert muted small">
              <button
                className="link"
                onClick={() =>
                  setDateFocus({
                    label: 'with no warranty date recorded',
                    ids: new Set(dates.no_warranty_date.map((a) => a.id)),
                  })
                }
              >
                {dates.no_warranty_date.length} with no warranty date recorded
              </button>{' '}
              — <strong>not the same as expired</strong>: nobody has said. The invoice has it.
            </p>
          )}
        </div>
      )}

      {dateFocus && (
        <p className="muted small">
          Showing the {shown.length} {dateFocus.label}.{' '}
          <button className="link" onClick={() => setDateFocus(null)}>
            Show everything
          </button>
        </p>
      )}

      <div className="toolbar">
        <div className="sub-tabs toolbar">
          {[['all', 'Everything'], ['out', 'Out with staff'], ['office', 'In the office'],
            ['maintenance', 'Being repaired'], ['gone', 'Written off']].map(
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
        {choices.companies.length > 1 && (
          <select value={pick.company_id} onChange={(e) => setPick({ ...pick, company_id: e.target.value })}>
            <option value="">All companies</option>
            {choices.companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {choices.departments.length > 0 && (
          <select value={pick.department} onChange={(e) => setPick({ ...pick, department: e.target.value })}>
            <option value="">All departments</option>
            {choices.departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        {choices.kinds.length > 1 && (
          <select value={pick.kind} onChange={(e) => setPick({ ...pick, kind: e.target.value })}>
            <option value="">All kinds</option>
            {choices.kinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        )}
        {/* Same weight as on the dashboard, so the way in looks the same on
            both screens. */}
        <button className={adding ? 'ghost' : undefined} onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Add an asset'}
        </button>
        <button className="ghost" onClick={() => setImporting((v) => !v)}>
          {importing ? 'Cancel' : 'Import from Excel'}
        </button>
        {/*
          * Generating codes lived under Lists, which is three clicks from
          * here and reads as settings. Anybody who can see a register full
          * of spreadsheet IDs is standing right here - the fifth time a
          * feature has had to be moved to where the person already is.
          */}
        <button className="ghost" onClick={() => setCodes((v) => !v)}>
          {codes ? 'Cancel' : 'Generate codes'}
        </button>
        {/*
          * Fetched rather than linked, so the download carries whatever
          * identifies this browser - a link works on a session cookie and
          * 401s for somebody here on the API key.
          */}
        {/* The three ways OUT, as one block at the far end: loose, they wrap
            one at a time and leave "Handovers (CSV)" alone on its own line. */}
        <span className="push-right">
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
        </span>
      </div>

      {codes && (
        <div className="card">
          <h3>Give assets a code from their company’s series</h3>
          <p className="muted small">
            The same generator as under <strong>Lists → Asset code prefixes</strong>, put here
            because this is where you can see which rows still wear their spreadsheet’s ID. It
            counts first, keeps the old code on every row, and leaves written-off assets alone.
          </p>
          <Renumber
            onError={onError}
            onToast={setSaid}
            onDone={() => {
              setCodes(false);
              load();
            }}
          />
        </div>
      )}

      {/*
        * COMPUTER, FURNITURE, MOBILE - asked for by name.
        *
        * Each button carries its own count, because that is what makes it
        * worth pressing. The group is worked out from the kind every time it
        * is needed and stored nowhere, so it cannot come to disagree with
        * what the row says it is.
        *
        * Shown only once there is more than one group to choose between: a
        * register of four laptops does not need a filter saying "Computer 4".
        */}
      {groups.length > 1 && (
        <div className="sub-tabs toolbar group-chips">
          <button className={group ? undefined : 'active'} onClick={() => setGroup('')}>
            All groups
          </button>
          {groups.map((g) => (
            <button
              key={g.group}
              className={group === g.group ? 'active' : undefined}
              onClick={() => setGroup(group === g.group ? '' : g.group)}
              title={g.kinds.join(', ')}
            >
              {g.label} <span className="muted">{g.count}</span>
            </button>
          ))}
        </div>
      )}

      {/*
        * Say what is being hidden. A register silently showing a subset is how
        * somebody concludes a row has gone missing.
        */}
      {narrowed && (
        <p className="muted small">
          Narrowed to{' '}
          {[
            narrowed.company_id &&
              (companies.find((c) => Number(c.id) === Number(narrowed.company_id))?.name || 'one company'),
            narrowed.branch_id &&
              (allBranches.find((b) => Number(b.id) === Number(narrowed.branch_id))?.name || 'one branch'),
            narrowed.category,
            narrowed.department,
            narrowed.year,
          ]
            .filter(Boolean)
            .join(' · ')}
          , from the dashboard.{' '}
          <button className="link" onClick={() => setFrom(null)}>
            Show everything
          </button>
        </p>
      )}

      {importing && (
        <AssetImport companies={companies} onDone={load} onError={(err) => setSaid(err.message)} />
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
                {kindGroups.added.map(([category, names]) => (
                  <optgroup key={category} label={category}>
                    {names.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {kindGroups.builtIn.length > 0 &&
                  (kindGroups.added.length ? (
                    <optgroup label="The usual ones">
                      {kindGroups.builtIn.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    kindGroups.builtIn.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))
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
                list="asset-vendors"
                placeholder="vendor"
                onChange={(e) => setDraft({ ...draft, vendor: e.target.value })}
              />
            </label>
            <datalist id="asset-vendors">
              {masters.filter((m) => m.kind === 'vendor').map((m) => (
                <option key={m.id} value={m.name} />
              ))}
            </datalist>
            <label>
              Invoice
              <input value={draft.invoice_no} onChange={(e) => setDraft({ ...draft, invoice_no: e.target.value })} />
              {/*
                * Where the PDF goes, said differently in the two builds -
                * "attaches from the register" is simply untrue in the single
                * file, where there is nowhere to put one, and that sentence
                * is what sent Dinesh looking for a button that cannot exist.
                */}
              <span className="hint">
                {STANDALONE
                  ? 'the number — attaching the PDF needs the server version'
                  : 'the number; attach the PDF from the register once it is added'}
              </span>
            </label>
            <label>
              Warranty until
              <input
                type="date"
                value={draft.warranty_until}
                onChange={(e) => setDraft({ ...draft, warranty_until: e.target.value })}
              />
            </label>
            {/*
              * THE CODE IS SHOWN, NOT TYPED.
              *
              * Dinesh asked for it read-only, and that is the right call: a
              * code somebody edits is a code that collides with a sticker
              * already on a desk, and the series it was drawn from stops
              * meaning anything.
              *
              * What is shown is a PREVIEW and reserves nothing. Two people
              * with the form open see the same number; the first to save
              * keeps it and the second is quietly given the next one, which
              * is what the server does on its own.
              */}
            <label>
              Code
              <input
                value={nextCode || 'pick a company first'}
                readOnly
                className="code-preview"
                title="Generated from the company's own series. It cannot be edited, and it is not taken until this asset is saved."
              />
              <span className="hint">
                {nextCode
                  ? 'the next one in this company’s series — saved with the asset'
                  : 'choose the company above and it appears here'}
              </span>
            </label>
          </div>

          {/*
            * Folded away, because the four boxes above are what somebody
            * types in a hurry and these are what they fill in afterwards -
            * and a form that opens with twenty boxes does not get used.
            */}
          <details className="fold" style={{ marginTop: '0.6rem' }}>
            <summary>More about it — brand, where it lives, warranty and AMC</summary>
            <div className="grid" style={{ marginTop: '0.6rem' }}>
              <label>
                Brand
                <input
                  list="asset-brands"
                  value={draft.brand}
                  placeholder="Dell"
                  onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                />
                <datalist id="asset-brands">
                  {masters.filter((m) => m.kind === 'brand').map((m) => (
                    <option key={m.id} value={m.name} />
                  ))}
                </datalist>
              </label>
              <label>
                Model
                <input
                  value={draft.model}
                  placeholder="3420"
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                />
              </label>
              <label>
                Department
                <input
                  value={draft.department}
                  onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                />
              </label>
              <label>
                Where it is
                <input
                  value={draft.location}
                  placeholder="Alkapuri office"
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                />
              </label>
              <label>
                Floor / room
                <input
                  value={draft.floor_room}
                  onChange={(e) => setDraft({ ...draft, floor_room: e.target.value })}
                />
              </label>
              <label>
                Warranty from
                <input
                  type="date"
                  value={draft.warranty_from}
                  onChange={(e) => setDraft({ ...draft, warranty_from: e.target.value })}
                />
              </label>
              <label>
                Warranty by
                <input
                  value={draft.warranty_provider}
                  placeholder="who honours it"
                  onChange={(e) => setDraft({ ...draft, warranty_provider: e.target.value })}
                />
              </label>
              {/*
                * The AMC. It was stored, reported beside repairs, and alerted
                * on when it lapsed - on this page's own Maintenance tab and on
                * the main dashboard - with no box anywhere in the app to type
                * it into. It is also set HERE only once; renewing it every year
                * is done from Maintenance, which is where somebody is standing
                * when they think about it.
                */}
              <label>
                AMC until
                <input
                  type="date"
                  value={draft.amc_until}
                  onChange={(e) => setDraft({ ...draft, amc_until: e.target.value })}
                />
              </label>
              <label>
                AMC by
                <input
                  value={draft.amc_vendor}
                  placeholder="who holds the contract"
                  onChange={(e) => setDraft({ ...draft, amc_vendor: e.target.value })}
                />
              </label>
              <label>
                AMC a year
                <input
                  type="number"
                  value={draft.amc_cost}
                  placeholder="what the contract costs"
                  onChange={(e) => setDraft({ ...draft, amc_cost: e.target.value })}
                />
              </label>
            </div>
            <label className="block" style={{ marginTop: '0.6rem' }}>
              What it is
              <textarea
                rows="2"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label className="block">
              Purchase remarks
              <textarea
                rows="2"
                value={draft.purchase_remarks}
                onChange={(e) => setDraft({ ...draft, purchase_remarks: e.target.value })}
              />
            </label>
          </details>
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
          {/* The suggestions behind the two typed cells. Suggestions only —
              anything typed still saves, the same as the Add form. */}
          <datalist id="asset-kind-list">
            {choices.kinds.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <datalist id="asset-dept-list">
            {choices.departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        <table className="sheet numbered asset-sheet">
          <thead>
            <tr>
              {/* A serial down the left, as on his mock-up and on the salary
                  sheet. It numbers what is ON SCREEN, so it follows the
                  filters rather than claiming to be the asset's own number -
                  that is the code beside it. */}
              <th className="row-no">#</th>
              <th>Code</th>
              <th>Kind</th>
              <th>What</th>
              <th>Serial</th>
              <th>Department</th>
              <th className="num">Cost</th>
              <th>Where it is</th>
              <th>Since</th>
              <th>Warranty</th>
              <th>Invoice</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((asset, at) => {
              const out = isOut(asset);
              return (
                <tr key={asset.id}>
                  <td className="row-no">{at + 1}</td>
                  <td>
                    <button className="link" onClick={() => setHistory(asset)}>
                      {asset.code || '—'}
                    </button>
                    {/* What the sticker on the desk still reads. */}
                    {asset.old_code && asset.old_code !== asset.code ? (
                      <div className="muted small" title="the code it came in with — still on the label">
                        was {asset.old_code}
                      </div>
                    ) : null}
                  </td>
                  {/*
                    * EDITABLE IN PLACE, like a spreadsheet.
                    *
                    * The group under the name is still worked out from the
                    * kind every time, so correcting the kind here moves the
                    * row's group on the next keystroke-out - it cannot come
                    * to disagree with the cell beside it.
                    */}
                  <td className="kind-cell">
                    <SheetCell asset={asset} field="kind" list="asset-kind-list" onSave={saveCell} placeholder="Laptop" />
                    <div className="muted small">{groupLabel(groupOf(asset.kind, asset.label))}</div>
                  </td>
                  <td className="sticky-name">
                    <SheetCell asset={asset} field="label" onSave={saveCell} placeholder="Dell Latitude 3420" />
                    {asset.branch_name ? <div className="muted small">{asset.branch_name}</div> : null}
                  </td>
                  <td>
                    <SheetCell asset={asset} field="identifier" onSave={saveCell} placeholder="serial" />
                  </td>
                  <td>
                    <SheetCell asset={asset} field="department" list="asset-dept-list" onSave={saveCell} placeholder="—" />
                  </td>
                  <td className="num">
                    <SheetCell asset={asset} field="purchase_cost" type="number" align="num" onSave={saveCell} placeholder="0" />
                  </td>
                  <td>
                    {out ? <strong>{asset.employee_name}</strong> : <span className="muted">{whereItIs(asset)}</span>}
                    {asset.condition && !out && <div className="muted small">{asset.condition}</div>}
                  </td>
                  <td className="muted small">{out ? asset.issued_on || '—' : asset.returned_on || '—'}</td>
                  <td className={asset.warranty_left_days < 0 ? 'overdue' : undefined}>
                    <SheetCell asset={asset} field="warranty_until" type="date" onSave={saveCell} />
                  </td>
                  {/*
                    * The paperwork, ON the register.
                    *
                    * Attaching the invoice has been possible since the asset's
                    * own page existed, and nobody found it: the only way in was
                    * clicking the CODE, which reads as a code. Dinesh reported
                    * the upload as missing when it had been there all along. So
                    * the count is a column, and the column is the way in.
                    */}
                  <td className="small">
                    <button
                      className="link"
                      title={
                        asset.documents
                          ? `${asset.documents} attached — open the asset to read or add one`
                          : 'Attach the invoice, the warranty card, the delivery note'
                      }
                      onClick={() => setHistory({ ...asset, open: 'papers' })}
                    >
                      {asset.documents ? `📎 ${asset.documents}` : 'attach'}
                    </button>
                    {asset.invoice_no ? (
                      <div className="muted small">{asset.invoice_no}</div>
                    ) : null}
                  </td>
                  <td>
                    {/*
                      * What state it is in, when it is one somebody set. The
                      * three derived ones (available / assigned / written off)
                      * are already said by the rest of this row, so repeating
                      * them would be noise.
                      */}
                    {!asset.written_off_on && ASSET_STATES.some(([k]) => k === asset.state) && (
                      <div className="muted small">
                        {statusLabel(asset.state)}
                        {asset.state_since ? ` since ${asset.state_since}` : ''}{' '}
                        <button className="link" onClick={() => setState(asset, '')}>
                          back in use
                        </button>
                      </div>
                    )}
                    {asset.written_off_on ? (
                      <span className="muted small">written off {asset.written_off_on}</span>
                    ) : out ? (
                      <>
                        <button className="ghost small" onClick={() => back(asset)}>
                          take it back
                        </button>{' '}
                      </>
                    ) : (
                      /*
                       * `allocationProblem` exists to answer exactly this and
                       * nothing used it: a laptop marked as away at the repair
                       * shop still offered "issue to…", so it could be handed
                       * to somebody from the screen that says where it is.
                       * Disabled with the reason on it, not hidden - "no"
                       * without a reason sends people hunting.
                       */
                      <select
                        value=""
                        disabled={Boolean(allocationProblem(asset))}
                        title={allocationProblem(asset) || undefined}
                        onChange={(e) => issue(asset, e.target.value)}
                      >
                        <option value="">
                          {allocationProblem(asset) ? statusLabel(assetStatus(asset)) : 'issue to…'}
                        </option>
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
                    {!asset.written_off_on && !asset.state && (
                      <select value="" onChange={(e) => e.target.value && setState(asset, e.target.value)}>
                        <option value="">mark it…</option>
                        {ASSET_STATES.map(([key, label, hint]) => (
                          <option key={key} value={key} title={hint}>
                            {label}
                          </option>
                        ))}
                      </select>
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
      {/*
        * Reload on the way out: attaching an invoice or a photograph changes
        * the register's own counts, and without this the row still read
        * "attach" after one had just been attached.
        */}
      {history && (
        <AssetHistory
          asset={history}
          onClose={() => {
            setHistory(null);
            load();
          }}
          onError={onError}
        />
      )}
    </section>
  );
}

function Tabs({ view, setView }) {
  return (
    <div className="sub-tabs toolbar">
      {/* Maintenance is a fourth view rather than a tab above these three:
          two rows of tabs over one table is one row too many. */}
      {[
        ['dashboard', 'Dashboard'],
        ['register', 'Register'],
        ['slips', 'Who holds what'],
        ['stock', 'Stock take'],
        ['maintenance', 'Maintenance'],
        ['masters', 'Lists'],
      ].map(([key, text]) => (
        <button key={key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}
