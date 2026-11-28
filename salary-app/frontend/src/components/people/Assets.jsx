import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api, download, openPage } from '../../api.js';
import AssetDashboard from './AssetDashboard.jsx';
import AssetMasters from './AssetMasters.jsx';
import AssetPrefixes, { Renumber } from './AssetPrefixes.jsx';
import { ASSET_STATES, allocationProblem, assetStatus, statusLabel } from '../../../../shared/assetStatus.js';
import { isOut, registerTotals, whereItIs } from '../../../../shared/assetReport.js';
import { onRegister } from '../../../../shared/assetStatus.js';
import { matchesFilter } from '../../../../shared/assetDashboard.js';
import { groupLabel, groupOf, groupTally, setOwnGroups } from '../../../../shared/assetGroups.js';
import { NATURES, matchesNature, natureLabel, natureOf, natureTally } from '../../../../shared/assetNature.js';
import AssetClaims from './AssetClaims.jsx';
import { assetAlerts, nameSome } from '../../../../shared/assetAlerts.js';
import { rupees } from '../../format.js';
import AssetHistory from './AssetHistory.jsx';
import AssetImport from './AssetImport.jsx';
import AssetStatement from './AssetStatement.jsx';
import { col, num, printReport } from '../../printReport.js';
import AssetExport from './AssetExport.jsx';
import HandoverSlips from './HandoverSlips.jsx';
import Maintenance from './Maintenance.jsx';
import StockTake from './StockTake.jsx';
import WarrantyAmc from './WarrantyAmc.jsx';
import PurchaseRequests from './PurchaseRequests.jsx';
import { onStaff } from '../../onStaff.js';
import { todayIso } from '../../../../shared/today.js';

const KINDS = ['Laptop', 'Desktop', 'Mobile', 'SIM card', 'ID card', 'Access card', 'Vehicle', 'Tools', 'Furniture', 'Other'];
const today = () => todayIso();

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
/**
 * Fixed or movable, on the row.
 *
 * A select dressed as text. The first option hands the answer back to the
 * kind, and says what the kind would answer - so "decide from the kind" is
 * never a blind choice. A guess wears a question mark until somebody says.
 */
function NaturePick({ asset, onSave }) {
  const { nature, guessed } = natureOf(asset);
  const fromKind = natureOf({ kind: asset.kind, label: asset.label }).nature;
  if (STANDALONE) return <span>{natureLabel(nature) || 'not said'}</span>;
  return (
    <select
      className={`nature-pick${guessed ? ' guessed' : ''}${nature ? '' : ' unsaid'}`}
      value={asset.nature || ''}
      title={guessed ? 'Worked out from the kind - nobody has said' : nature ? 'Somebody said so' : 'Not said'}
      onChange={(e) => onSave(asset, 'nature', e.target.value).catch(() => {})}
    >
      <option value="">{fromKind ? `${natureLabel(fromKind)} ?` : 'not said'}</option>
      {NATURES.map(([key, label]) => (
        <option key={key} value={key}>{label}</option>
      ))}
    </select>
  );
}

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
  const [pick, setPick] = useState({ company_id: '', department: '', kind: '', employee_id: '' });
  /*
   * Fixed / Movable - "different group", one level above Computer and
   * Furniture. '' is everything; 'unsaid' is the pile nobody has decided.
   */
  const [nature, setNature] = useState('');
  const [codes, setCodes] = useState(false);
  const [exporting, setExporting] = useState(false);
  /*
   * Rows ticked for a sheet of QR labels.
   *
   * Dinesh: *"QR code bulk me nikalne wala option bhi do — selected item ka
   * ya group wise"*. Group-wise already worked, because the sheet prints
   * whatever is on screen and the group buttons narrow that; what there was
   * no way to say was "these four".
   */
  const [ticked, setTicked] = useState(() => new Set());
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
      .then(({ masters: list }) => {
        /*
         * THE OFFICE'S OWN CATEGORIES BECOME GROUPS.
         *
         * Dinesh: *"ASSET ME NEW GROP KAHA SE ADD HOTA HE"* - and the
         * answer was nowhere, although Lists → Categories had existed all
         * along and reclassified nothing. Handing the lists to the engine
         * is the whole join: a Category is a group, the Types under it are
         * its kinds, and the buttons below come out of the register itself.
         */
        setOwnGroups(
          (list || []).filter((m) => m.kind === 'category'),
          (list || []).filter((m) => m.kind === 'type')
        );
        setMasters(list || []);
      })
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
      if (filter === 'out' && assetStatus(a) !== 'assigned') return false;
      if (filter === 'office' && assetStatus(a) !== 'available') return false;
      /*
       * `?written_off=true` means "INCLUDE the written-off ones", not "only
       * them" - so this filter was fetching the whole register and narrowing
       * it by nothing. Clicking "Written off" to see what had been scrapped
       * listed every live asset too, which reads as if they all had been.
       * The dashboard's written-off card opens this same filter, so its count
       * and this list disagreed by the size of the register.
       */
      if (filter === 'gone' && onRegister(a)) return false;
      // Off the register (written off OR disposed) shows only under its own chip.
      if (filter !== 'gone' && !onRegister(a)) return false;
      if (['maintenance', 'damaged', 'missing'].includes(filter) && assetStatus(a) !== filter) return false;
      /*
       * The group is WORKED OUT from the kind, never read off a column - so
       * narrowing by it cannot disagree with what the row says it is.
       */
      if (group && groupOf(a.kind, a.label) !== group) return false;
      if (!matchesNature(a, nature)) return false;
      /* One person's things: who HAS it now, never who once had it. */
      if (pick.employee_id && !(isOut(a) && Number(a.employee_id) === Number(pick.employee_id))) return false;
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
  }, [assets, filter, query, narrowed, group, nature, dateFocus, pick]);
  /*
   * v2.39.0: SORT, PAGE AND CHOOSE COLUMNS - on what is already filtered.
   *
   * None of it changes WHICH assets are shown, only their order and how many
   * at a time, so every figure above the list (counted off `shown`) is the
   * same whichever page is open. The page size and the hidden columns are a
   * convenience for the person at this desk, kept in this browser only.
   */
  const [sort, setSort] = useState({ key: 'code', dir: 1 });
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem('salary-app-asset-page')) || 50;
    } catch {
      return 50;
    }
  });
  const [page, setPage] = useState(1);
  const [hiddenCols, setHiddenCols] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('salary-app-asset-cols') || '[]'));
    } catch {
      return new Set();
    }
  });
  const toggleCol = (key) => {
    const next = new Set(hiddenCols);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHiddenCols(next);
    try {
      localStorage.setItem('salary-app-asset-cols', JSON.stringify([...next]));
    } catch {
      /* a private window: the choice lasts until the page closes */
    }
  };
  const show = (key) => !hiddenCols.has(key);
  const sorted = useMemo(() => {
    const value = SORTS[sort.key] || SORTS.code;
    return [...shown].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === y) return a.id - b.id;
      // Blanks last, whichever way round.
      if (x === null || x === '') return 1;
      if (y === null || y === '') return -1;
      return (x > y ? 1 : -1) * sort.dir;
    });
  }, [shown, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => setPage(1), [shown.length, filter, query, sort, pageSize]);
  const paged = useMemo(
    () => sorted.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize),
    [sorted, page, pages, pageSize]
  );
  const offset = (Math.min(page, pages) - 1) * pageSize;
  const sortBy = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const Th = ({ k, children, className }) => (
    <th className={`sortable${className ? ` ${className}` : ''}`} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => sortBy(k)}>
        {children}
        <span className="th-arrow">{sort.key === k ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );

  // The figures above the list, counted off the list itself (see the note there).
  const shownTotals = useMemo(() => {
    const t = registerTotals(shown);
    // On the Written off view everything listed IS written off, which the
    // live count leaves out - so count what is listed.
    if (filter === 'gone') return { ...t, count: shown.length, narrowed: false };
    return { ...t, narrowed: shown.length !== assets.filter(onRegister).length };
  }, [shown, assets, filter]);

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
      if (filter === 'out' && assetStatus(a) !== 'assigned') return false;
      if (filter === 'office' && assetStatus(a) !== 'available') return false;
      if (filter === 'gone' && onRegister(a)) return false;
      // Off the register (written off OR disposed) shows only under its own chip.
      if (filter !== 'gone' && !onRegister(a)) return false;
      if (['maintenance', 'damaged', 'missing'].includes(filter) && assetStatus(a) !== filter) return false;
      if (narrowed && !matchesFilter(a, narrowed)) return false;
      if (!q) return true;
      // The old code too: his stickers still read BNF-Assets-2456, and
      // somebody holding the mouse has only the sticker.
      return [a.code, a.old_code, a.label, a.identifier, a.employee_name, a.vendor, a.branch_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    return groupTally(base.filter((a) => matchesNature(a, nature)));
    /* `masters` is in here because the office's own categories decide what
       the groups ARE - adding one has to redraw these buttons. */
  }, [assets, filter, query, narrowed, masters, nature]);

  /*
   * Fixed / Movable / not said, counted the same way and for the same
   * reason: before its own filter, after every other one.
   */
  const natures = useMemo(() => {
    const q = query.trim().toLowerCase();
    return natureTally(
      assets.filter((a) => {
        if (filter === 'out' && assetStatus(a) !== 'assigned') return false;
        if (filter === 'office' && assetStatus(a) !== 'available') return false;
        if (filter === 'gone' && onRegister(a)) return false;
      // Off the register (written off OR disposed) shows only under its own chip.
      if (filter !== 'gone' && !onRegister(a)) return false;
        if (['maintenance', 'damaged', 'missing'].includes(filter) && assetStatus(a) !== filter) return false;
        if (narrowed && !matchesFilter(a, narrowed)) return false;
        if (group && groupOf(a.kind, a.label) !== group) return false;
        if (!q) return true;
        return [a.code, a.old_code, a.label, a.identifier, a.employee_name, a.vendor, a.branch_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
    );
  }, [assets, filter, query, narrowed, group, masters]);

  /* Who is holding something, for the "whose" dropdown: only people who are. */
  const holders = useMemo(() => {
    const seen = new Map();
    for (const a of assets) {
      if (!isOut(a) || !a.employee_id) continue;
      const row = seen.get(a.employee_id) || { id: a.employee_id, name: a.employee_name || '', count: 0 };
      row.count += 1;
      seen.set(a.employee_id, row);
    }
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [assets]);

  /**
   * Fixed or movable for everything on screen (or everything ticked).
   *
   * It writes the ids it was SHOWN, and it says the count before it acts -
   * a thousand imported rows are settled a kind at a time, not a cell at a
   * time, and not by a second run of a filter that could have moved.
   */
  const setNatureFor = (value) => {
    const picked = shown.filter((a) => ticked.has(a.id));
    const rows = picked.length ? picked : shown;
    if (!rows.length) return;
    const word = value ? natureLabel(value).toLowerCase() : 'decided from the kind again';
    if (
      !window.confirm(
        `Mark ${rows.length} asset${rows.length === 1 ? '' : 's'} ${picked.length ? '(the ticked ones)' : '(everything on screen)'} as ${word}?\n\n` +
          'This only changes which group they are listed under. Nothing is issued, moved or revalued.'
      )
    )
      return;
    act(() => api.post('/people/assets/nature', { ids: rows.map((a) => a.id), nature: value }));
  };

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
      await api.post('/people/assets', {
        ...draft,
        // Added FOR somebody: it goes out in their name today, and that is a
        // handover on the log like any other.
        employee_id: draft.employee_id ? Number(draft.employee_id) : undefined,
        issued_on: draft.employee_id ? today() : undefined,
      });
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
  /*
   * Ticked rows if any are ticked, otherwise everything on screen - which is
   * what the group buttons and the filters have already narrowed. The button
   * says which it is about to do, so nobody prints 1,004 stickers by
   * accident.
   */
  const forLabels = () => {
    const picked = shown.filter((a) => ticked.has(a.id) && a.code);
    return picked.length ? picked : shown.filter((a) => a.code);
  };

  /** The register on screen, as a document somebody can file. */
  const printRegister = () => {
    // Named only when every line really is one company's, never assumed.
    const names = [...new Set(shown.map((a) => a.company_name).filter(Boolean))];
    const onlyCompany = names.length === 1 ? names[0] : 'All companies';
    const narrowed = [
      filter === 'out' && 'out with staff',
      filter === 'office' && 'in the office',
      filter === 'gone' && 'written off or disposed',
      filter === 'maintenance' && 'away being repaired',
      group && groupLabel(group),
      query.trim() && `matching “${query.trim()}”`,
    ].filter(Boolean);
    printReport({
      title: 'Asset register',
      subtitle: [onlyCompany, ...narrowed].filter(Boolean).join(' · '),
      meta: [`${shown.length} of ${assets.length} on the register`],
      landscape: true,
      columns: [
        col('#', (_row, i) => i + 1, '3%'),
        col('Code', (a) => a.code || '—'),
        col('Kind', (a) => a.kind || ''),
        col('What it is', (a) => a.label || ''),
        col('Serial', (a) => a.identifier || ''),
        col('Group', (a) => groupLabel(groupOf(a.kind, a.label))),
        col('Fixed / movable', (a) => natureLabel(natureOf(a).nature) || 'not said'),
        col('Company', (a) => a.company_name || ''),
        col('Where it is', (a) => (isOut(a) ? a.employee_name || 'with staff' : a.location || 'in the office')),
        col('Bought', (a) => String(a.purchase_date || '').slice(0, 10)),
        num('Cost', (a) => (Number(a.purchase_cost) ? rupees(a.purchase_cost) : '—')),
        col('Warranty to', (a) => String(a.warranty_until || '').slice(0, 10)),
      ],
      rows: shown,
      totals: {
        label: `Total (${shown.length})`,
        Cost: rupees(shown.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0)),
      },
      /*
       * Said on the paper, because a register at cost handed to somebody who
       * reads it as a valuation is how a number gets quoted wrongly.
       */
      footer: 'Every figure is what it cost to buy — there is no depreciation in this app, so this is a register at cost, not a book value.',
    });
  };

  const labelSheet = (as = '') => {
    const ids = forLabels().map((a) => a.id).join(',');
    if (!ids) return;
    openPage(`/people/assets/labels.html?ids=${ids}${as ? `&as=${as}` : ''}`).catch(onError);
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
          onView={setView}
          onAsset={(a) => setHistory(assets.find((x) => x.id === a.id) || a)}
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
                : f.status === 'written_off' || f.status === 'disposed' ? 'gone'
                  : f.status === 'available' ? 'office'
                    : ['maintenance', 'damaged', 'missing'].includes(f.status) ? f.status
                      : 'all'
            );
            setView('register');
          }}
        />
        {history && (
          <AssetHistory asset={history} onClose={() => { setHistory(null); load(); }} onError={onError} />
        )}
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
        {/* Adding a Category here adds a GROUP, so the engine is told at
            the same moment rather than on the next page load. */}
        <AssetMasters
          onError={onError}
          onChanged={(list) => {
            setOwnGroups(
              (list || []).filter((m) => m.kind === 'category'),
              (list || []).filter((m) => m.kind === 'type')
            );
            setMasters(list || []);
          }}
        />
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

  if (view === 'statement') {
    return (
      <section className="stack">
        <Tabs view={view} setView={setView} />
        {/* Reports: the downloads that lived on the register's toolbar, in
            one place, above the full statement. */}
        <div className="card">
          <h3>Asset reports</h3>
          <p className="muted small">
            Each downloads as CSV and opens in Excel. For a register with only the columns you want,
            use <strong>Export</strong> on the Asset Register — it remembers the columns.
          </p>
          <div className="toolbar asset-report-links">
            <button onClick={() => download('/people/assets/register.csv', 'asset-register.csv').catch(onError)}>
              Asset register
            </button>
            <button onClick={() => download('/people/assets/handovers.csv', 'asset-handovers.csv').catch(onError)}>
              Handovers, returns and transfers
            </button>
            <button onClick={() => download('/people/assets/statement.csv', 'asset-statement.csv').catch(onError)}>
              Full statement
            </button>
            <button onClick={() => setView('maintenance')}>Maintenance cost →</button>
            <button onClick={() => setView('warranty')}>Warranty expiry →</button>
            <button onClick={() => setView('stock')}>Stock audit →</button>
          </div>
        </div>
        <AssetStatement companies={companies} onError={onError} />
      </section>
    );
  }

  if (view === 'warranty') {
    return (
      <section className="stack">
        <Tabs view={view} setView={setView} />
        <WarrantyAmc assets={assets.filter(onRegister)} onOpen={(a) => setHistory(a)} />
        {history && (
          <AssetHistory asset={history} onClose={() => { setHistory(null); load(); }} onError={onError} />
        )}
      </section>
    );
  }

  if (view === 'purchases') {
    return (
      <section className="stack">
        <Tabs view={view} setView={setView} />
        <PurchaseRequests
          companies={companies}
          employees={employees}
          onError={onError}
          onRegister={(r) => {
            /* Register it: the ordinary Add asset form, filled in with what
               the request already says. The code series and the checks are
               the register's own. */
            setDraft((d) => ({
              ...d,
              kind: r.kind || d.kind,
              label: r.description ? `${r.kind} ${r.description}`.trim() : r.kind || '',
              company_id: r.company_id ? String(r.company_id) : d.company_id,
              department: r.department || '',
              vendor: r.vendor || '',
              purchase_cost:
                r.estimated_cost && r.quantity ? String(Math.round(r.estimated_cost / r.quantity)) : '',
              purchase_remarks: `Purchase request ${r.number}`,
            }));
            setImporting(false);
            setAdding(true);
            setView('register');
          }}
        />
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

      {/*
        * WHERE THE FOUR FIGURES COME FROM, said under each one.
        *
        * Dinesh: *"figures kaha se aa rahe nahi pata chal raha"*. They were
        * worked out over the WHOLE register while the list below was narrowed
        * by every chip and dropdown on the page, so 968 sat above a list of 64
        * and nothing said why. They are counted off the list below now, and
        * each says what it counts.
        */}
      <div className="figures asset-figures">
        <div className="figure">
          <span className="k">{shownTotals.narrowed ? 'Listed below' : 'On the register'}</span>
          <span className="n">{shownTotals.count}</span>
          <span className="muted small">not written off or disposed{shownTotals.narrowed ? ` · ${totals.count || 0} on the whole register` : ''}</span>
        </div>
        <div className="figure">
          <span className="k">Out with staff</span>
          <span className="n">{shownTotals.out}</span>
          <span className="muted small">
            issued and in use{shownTotals.held > shownTotals.out ? ` · ${shownTotals.held - shownTotals.out} more held but being repaired, damaged or missing` : ''}
          </span>
        </div>
        <div className="figure">
          <span className="k">Worth, out with staff</span>
          <span className="n">{rupees(shownTotals.out_value)}</span>
          <span className="muted small">what those cost to buy</span>
        </div>
        <div className="figure">
          <span className="k">Cost, on the register</span>
          <span className="n">{rupees(shownTotals.cost)}</span>
          <span className="muted small">what these cost to buy — no depreciation</span>
        </div>
      </div>
      {/* How the first figure is made up, so two screens can be checked
          against each other line by line (v2.36.0 - they disagreed by four). */}
      {filter !== 'gone' ? (
        <p className="muted small asset-sum">
          {shownTotals.out} out with staff + {shownTotals.in_office} in the office
          {shownTotals.maintenance ? ` + ${shownTotals.maintenance} being repaired` : ''}
          {shownTotals.damaged ? ` + ${shownTotals.damaged} damaged` : ''}
          {shownTotals.missing ? ` + ${shownTotals.missing} missing` : ''} = <b>{shownTotals.count}</b>
          {totals.disposed ? ` · ${totals.disposed} disposed, under Written off / disposed` : ''}
        </p>
      ) : null}

      {/*
        * WARRANTY AND AMC, AS A TABLE.
        *
        * Dinesh: *"warranty wala proper list dikhao, ek line me mat dikhavo"*.
        * It was five sentences with the codes run together after a dash. One
        * row per kind of date now: how many, the first few with their date,
        * and a button that lists exactly those on the register below.
        */}
      {(dates.count > 0 || dates.warranty_long_gone.length > 0 || dates.no_warranty_date.length > 0) && (
        <div className="card">
          <h3>Warranty and AMC</h3>
          <div className="table-wrap">
            <table className="sheet warranty-table">
              <thead>
                <tr>
                  <th>What</th>
                  <th className="num">Assets</th>
                  <th>Which — first few, with the date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[
                  ['bad', dates.warranty_just_gone, 'warranty_until', 'out of warranty',
                    `Warranty ran out in the last ${dates.recent_days} days`,
                    'extending cover or an AMC is still a live decision'],
                  ['warn', dates.warranty_soon, 'warranty_until', 'warranty running out',
                    `Warranty runs out within ${dates.soon} days`, ''],
                  ['bad', dates.amc_just_gone, 'amc_until', 'AMC lapsed', 'AMC has lapsed',
                    'nobody is covered until it is renewed'],
                  ['warn', dates.amc_soon, 'amc_until', 'AMC due', `AMC to renew within ${dates.soon} days`, ''],
                  ['', dates.warranty_long_gone, 'warranty_until',
                    `out of warranty for more than ${dates.recent_days} days`,
                    'Out of warranty for longer', 'old kit — counted, not chased'],
                  ['', dates.no_warranty_date, 'warranty_until', 'with no warranty date recorded',
                    'No warranty date recorded', 'not the same as expired — the invoice has it'],
                ]
                  .filter(([, list]) => list.length > 0)
                  .map(([tone, list, field, label, what, why]) => (
                    <tr key={label} className={tone ? `warranty-${tone}` : undefined}>
                      <td>
                        <strong>{what}</strong>
                        {why ? <div className="muted small">{why}</div> : null}
                      </td>
                      <td className="num">{list.length}</td>
                      <td className="small">
                        {field && list[0]?.[field] !== undefined && label !== 'with no warranty date recorded'
                          ? nameSome(list, 5, field)
                          : nameSome(list, 5)}
                      </td>
                      <td>
                        <button
                          className="ghost tiny"
                          onClick={() => setDateFocus({ label, ids: new Set(list.map((a) => a.id)) })}
                        >
                          list them
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
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
          {[['all', 'On the register'], ['out', 'Out with staff'], ['office', 'In the office'],
            ['maintenance', 'Being repaired'],
            // Only offered when there is one: an empty chip is a question nobody asked.
            ...(totals.damaged || filter === 'damaged' ? [['damaged', 'Damaged']] : []),
            ...(totals.missing || filter === 'missing' ? [['missing', 'Missing']] : []),
            ['gone', 'Written off / disposed']].map(
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
        {/*
          * EMPLOYEE-WISE. "asset add karne ka option employee wise": pick the
          * person and the register is their things, and the Add button beside
          * it adds one straight into their name.
          */}
        {holders.length > 0 && (
          <select
            value={pick.employee_id}
            onChange={(e) => setPick({ ...pick, employee_id: e.target.value })}
            title="Only what this person is holding now"
          >
            <option value="">Anybody’s</option>
            {holders.map((h) => (
              <option key={h.id} value={h.id}>{h.name} ({h.count})</option>
            ))}
          </select>
        )}
        {/* Same weight as on the dashboard, so the way in looks the same on
            both screens. */}
        <button
          className={adding ? 'ghost' : undefined}
          onClick={() => {
            if (!adding && pick.employee_id) setDraft((d) => ({ ...d, employee_id: String(pick.employee_id) }));
            setAdding(!adding);
          }}
        >
          {adding
            ? 'Cancel'
            : pick.employee_id
              ? `Add an asset for ${holders.find((h) => String(h.id) === String(pick.employee_id))?.name || 'them'}`
              : 'Add an asset'}
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
          {/*
            * PRINT THE REPORT, NOT THE SCREEN.
            *
            * Dinesh: *"PURA SCREEN PRINT NAHI KARNA HE, REPORT PRINT KARNA
            * HOTA HE"*. Ctrl+P on this tab gave the working grid - filters,
            * tick boxes, and every cell an input. This builds a document
            * from the rows ON SCREEN, filters and search already applied.
            */}
          {/* v2.39.0: one primary way out (Export) and the rest behind one
              menu, rather than seven buttons in a row. Every action is the
              one that was here; only where it sits has changed. */}
          <button className={exporting ? 'active' : undefined} onClick={() => setExporting((v) => !v)}>
            {exporting ? 'Close export' : 'Export'}
          </button>
          <details className="menu-more" onClick={(e) => { if (e.target.closest('button')) e.currentTarget.open = false; }}>
            <summary className="ghost">More actions ▾</summary>
            <div className="menu-more-list" role="menu">
              <button role="menuitem" onClick={printRegister} disabled={!shown.length}>
                Print the register ({shown.length})
              </button>
              <button
                role="menuitem"
                onClick={() => labelSheet()}
                disabled={!shown.some((a) => a.code)}
                title={ticked.size ? 'A page of QR stickers for the ticked rows' : 'A page of QR stickers for everything this filter shows'}
              >
                {ticked.size ? `QR labels for ${forLabels().length} ticked` : `QR labels for ${shown.filter((a) => a.code).length}`}
              </button>
              <button role="menuitem" onClick={() => labelSheet('patti')} disabled={!shown.some((a) => a.code)}>
                Description stickers (no QR)
              </button>
              <button role="menuitem" onClick={() => download('/people/assets/register.csv', 'asset-register.csv').catch((err) => setSaid(err.message))}>
                Register (CSV)
              </button>
              <button role="menuitem" onClick={() => download('/people/assets/handovers.csv', 'asset-handovers.csv').catch((err) => setSaid(err.message))}>
                Handovers (CSV)
              </button>
            </div>
          </details>
        </span>
      </div>

      {exporting && (
        <AssetExport
          shown={shown}
          total={assets.length}
          onError={(err) => setSaid(err.message)}
          onDone={() => setExporting(false)}
        />
      )}

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
      {assets.length > 0 && (
        <div className="sub-tabs toolbar group-chips nature-chips">
          <button className={nature ? undefined : 'active'} onClick={() => setNature('')}>
            Fixed and movable
          </button>
          {NATURES.map(([key, label, why]) => (
            <button
              key={key}
              className={nature === key ? 'active' : undefined}
              onClick={() => setNature(nature === key ? '' : key)}
              title={why}
            >
              {label} <span className="muted">{natures[key]}</span>
            </button>
          ))}
          {natures.unsaid > 0 && (
            <button
              className={nature === 'unsaid' ? 'active' : undefined}
              onClick={() => setNature(nature === 'unsaid' ? '' : 'unsaid')}
              title="Nobody has said, and the kind does not say either"
            >
              Not said <span className="muted">{natures.unsaid}</span>
            </button>
          )}
          {/* The bulk answer, only once the list has been narrowed to
              something - marking the whole register in one press is never
              what anybody means. */}
          {(nature || group || pick.kind || ticked.size > 0) && shown.length > 0 && !STANDALONE ? (
            <span className="nature-bulk muted small">
              Mark {ticked.size ? `${shown.filter((a) => ticked.has(a.id)).length} ticked` : `these ${shown.length}`} as{' '}
              <button className="link" onClick={() => setNatureFor('fixed')}>fixed</button>
              {' · '}
              <button className="link" onClick={() => setNatureFor('movable')}>movable</button>
            </span>
          ) : null}
        </div>
      )}
      {natures.guessed > 0 && nature && nature !== 'unsaid' ? (
        <p className="muted small">
          A <em>?</em> beside the word means it was worked out from the kind and nobody has said. Change it
          on the row, or mark the whole list above.
        </p>
      ) : null}

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
          {/*
            * THE WAY IN, where somebody is already looking at the groups.
            * Dinesh asked where a new group is added; the answer is Lists →
            * Categories, which nothing on this strip said.
            */}
          <button className="link" onClick={() => setView('masters')} title="Groups come from Lists → Categories">
            + group
          </button>
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
              Fixed or movable
              <select value={draft.nature || ''} onChange={(e) => setDraft({ ...draft, nature: e.target.value })}>
                <option value="">
                  {natureOf({ kind: draft.kind, label: draft.label }).nature
                    ? `From the kind — ${natureLabel(natureOf({ kind: draft.kind, label: draft.label }).nature)}`
                    : 'Not said'}
                </option>
                {NATURES.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Give it to
              <select
                value={draft.employee_id || ''}
                onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}
              >
                <option value="">Nobody — it stays in the office</option>
                {onStaff(employees).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
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

      {!STANDALONE && <AssetClaims assets={assets} companies={companies} onDone={load} />}
      {said && <p className="error">{said}</p>}

      {/*
       * The register is wide, and it needs a scroller of its own. Without one
       * it widens the whole page, and on a phone Chrome then lays the entire
       * app out at the table's width - which is how a scanned sticker came to
       * open a panel running off the side of the screen.
       */}
      {/* Show / hide columns. Kept in this browser; nothing about an asset changes. */}
      {shown.length ? (
        <details className="asset-cols">
          <summary>Columns{hiddenCols.size ? ` (${hiddenCols.size} hidden)` : ''}</summary>
          <div className="asset-cols-list">
            {OPTIONAL_ASSET_COLUMNS.map(([key, label]) => (
              <label key={key} className="check">
                <input type="checkbox" checked={show(key)} onChange={() => toggleCol(key)} />
                {label}
              </label>
            ))}
          </div>
        </details>
      ) : null}

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
              <th className="row-no">
                {/* All on screen, or none. The group buttons and the filters
                    decide what "on screen" means. */}
                <input
                  type="checkbox"
                  title="Tick every asset this filter shows, on every page"
                  checked={shown.length > 0 && shown.every((a) => ticked.has(a.id))}
                  onChange={(e) =>
                    setTicked(e.target.checked ? new Set(shown.map((a) => a.id)) : new Set())
                  }
                />
              </th>
              <th className="row-no">#</th>
              <Th k="code">Asset code</Th>
              {show('kind') && <Th k="kind">Category / type</Th>}
              <Th k="label">Asset name</Th>
              {show('brand') && <Th k="brand">Brand / model</Th>}
              {show('serial') && <Th k="serial">Serial no.</Th>}
              {show('department') && <Th k="department">Department</Th>}
              {show('location') && <Th k="location">Location</Th>}
              {show('cost') && <Th k="cost" className="num">Purchase cost</Th>}
              {show('bought') && <Th k="bought">Purchase date</Th>}
              <Th k="holder">Assigned to</Th>
              {show('since') && <Th k="since">Since</Th>}
              {show('warranty') && <Th k="warranty">Warranty</Th>}
              <Th k="status">Status</Th>
              {show('invoice') && <th>Invoice</th>}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((asset, at) => {
              const out = isOut(asset);
              return (
                <tr key={asset.id}>
                  <td className="row-no">
                    <input
                      type="checkbox"
                      checked={ticked.has(asset.id)}
                      onChange={(e) => {
                        const next = new Set(ticked);
                        if (e.target.checked) next.add(asset.id);
                        else next.delete(asset.id);
                        setTicked(next);
                      }}
                    />
                  </td>
                  <td className="row-no">{offset + at + 1}</td>
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
                  {show('kind') && <td className="kind-cell">
                    <SheetCell asset={asset} field="kind" list="asset-kind-list" onSave={saveCell} placeholder="Laptop" />
                    <div className="muted small">
                      {groupLabel(groupOf(asset.kind, asset.label))}
                      {' · '}
                      <NaturePick asset={asset} onSave={saveCell} />
                    </div>
                  </td>}
                  <td className="sticky-name">
                    <SheetCell asset={asset} field="label" onSave={saveCell} placeholder="Dell Latitude 3420" />
                    {asset.branch_name ? <div className="muted small">{asset.branch_name}</div> : null}
                  </td>
                  {show('brand') && (
                    <td>
                      <SheetCell asset={asset} field="brand" onSave={saveCell} placeholder="brand" />
                      <SheetCell asset={asset} field="model" onSave={saveCell} placeholder="model" />
                    </td>
                  )}
                  {show('serial') && <td>
                    <SheetCell asset={asset} field="identifier" onSave={saveCell} placeholder="serial" />
                  </td>}
                  {show('department') && <td>
                    <SheetCell asset={asset} field="department" list="asset-dept-list" onSave={saveCell} placeholder="—" />
                  </td>}
                  {show('location') && (
                    <td>
                      <SheetCell asset={asset} field="location" onSave={saveCell} placeholder="—" />
                    </td>
                  )}
                  {show('cost') && <td className="num">
                    <SheetCell asset={asset} field="purchase_cost" type="number" align="num" onSave={saveCell} placeholder="0" />
                  </td>}
                  {show('bought') && (
                    <td>
                      <SheetCell asset={asset} field="purchase_date" type="date" onSave={saveCell} />
                    </td>
                  )}
                  <td>
                    {out ? <strong>{asset.employee_name}</strong> : <span className="muted">{whereItIs(asset)}</span>}
                    {asset.condition && !out && <div className="muted small">{asset.condition}</div>}
                  </td>
                  {show('since') && <td className="muted small">{out ? asset.issued_on || '—' : asset.returned_on || '—'}</td>}
                  {show('warranty') && <td className={asset.warranty_left_days < 0 ? 'overdue' : undefined}>
                    <SheetCell asset={asset} field="warranty_until" type="date" onSave={saveCell} />
                  </td>}
                  <td>
                    <span className={`pill as-${assetStatus(asset)}`}>{statusLabel(assetStatus(asset))}</span>
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
                  {show('invoice') && <td className="small">
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
                  </td>}
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
                        {onStaff(employees).map((e) => (
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

      {shown.length ? (
        <div className="asset-pager">
          <span className="muted small">
            Showing {offset + 1}–{Math.min(offset + pageSize, sorted.length)} of {sorted.length}
            {ticked.size ? ` · ${ticked.size} ticked` : ''}
          </span>
          <span className="grow" />
          <button className="ghost small" disabled={page <= 1} onClick={() => setPage(1)} aria-label="First page">«</button>
          <button className="ghost small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">‹</button>
          <span className="small">Page {Math.min(page, pages)} of {pages}</span>
          <button className="ghost small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">›</button>
          <button className="ghost small" disabled={page >= pages} onClick={() => setPage(pages)} aria-label="Last page">»</button>
          <select
            value={pageSize}
            aria-label="Rows per page"
            onChange={(e) => {
              const n = Number(e.target.value);
              setPageSize(n);
              try {
                localStorage.setItem('salary-app-asset-page', String(n));
              } catch {
                /* private window */
              }
            }}
          >
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      ) : null}

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

/* What each sortable column sorts by. Text is compared lower-case. */
const lower = (v) => (v === null || v === undefined ? '' : String(v).toLowerCase());
const SORTS = {
  code: (a) => lower(a.code),
  kind: (a) => lower(a.kind),
  label: (a) => lower(a.label),
  brand: (a) => lower([a.brand, a.model].filter(Boolean).join(' ')),
  serial: (a) => lower(a.identifier),
  department: (a) => lower(a.department),
  location: (a) => lower(a.location),
  cost: (a) => (a.purchase_cost === null || a.purchase_cost === undefined || a.purchase_cost === '' ? null : Number(a.purchase_cost)),
  bought: (a) => a.purchase_date || '',
  holder: (a) => lower(isOut(a) ? a.employee_name : ''),
  since: (a) => (isOut(a) ? a.issued_on : a.returned_on) || '',
  warranty: (a) => a.warranty_until || '',
  status: (a) => assetStatus(a),
};

/* The columns that may be hidden. Code, name, holder, status and actions
   always show: without them a row cannot be told apart or acted on. */
export const OPTIONAL_ASSET_COLUMNS = [
  ['kind', 'Category / type'],
  ['brand', 'Brand / model'],
  ['serial', 'Serial no.'],
  ['department', 'Department'],
  ['location', 'Location'],
  ['cost', 'Purchase cost'],
  ['bought', 'Purchase date'],
  ['since', 'Since'],
  ['warranty', 'Warranty'],
  ['invoice', 'Invoice'],
];

export const ASSET_SECTIONS = [
  ['dashboard', 'Overview'],
  ['register', 'Asset Register'],
  ['slips', 'Assignments'],
  ['stock', 'Stock Audit'],
  ['maintenance', 'Maintenance & Repairs'],
  ['warranty', 'Warranty & AMC'],
  ['purchases', 'Purchase Requests'],
  ['statement', 'Reports'],
  ['masters', 'Settings'],
];

function Tabs({ view, setView }) {
  return (
    <div className="sub-tabs toolbar asset-sections">
      {/* Maintenance is a fourth view rather than a tab above these three:
          two rows of tabs over one table is one row too many. */}
      {/*
        * v2.39.0: the nine sections the redesign brief names, in its order.
        * The keys are the old views, so every screen behind them is the one
        * that was there - only the way in is renamed:
        *   Dashboard -> Overview, Register -> Asset Register,
        *   Who holds what -> Assignments, Stock take -> Stock Audit,
        *   Maintenance -> Maintenance & Repairs, Full register -> Reports,
        *   Lists -> Settings; Warranty & AMC and Purchase Requests are new.
        */}
      {ASSET_SECTIONS.map(([key, text]) => (
        <button key={key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}
