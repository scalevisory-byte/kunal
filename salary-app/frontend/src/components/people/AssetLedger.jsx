import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api, download } from '../../api.js';
import { col, num, printReport } from '../../printReport.js';
import { rupees } from '../../format.js';

/**
 * ONE PERSON'S ASSET LEDGER — read like a party ledger in Tally.
 *
 * Dinesh: *"konse employee ke paas kya-kya asset he, uska ledger nikalna
 * he"*, and then a full brief: a profile header, summary figures, the current
 * register, a chronological movement ledger with a running balance, handover
 * documents and a maintenance history, under tabs.
 *
 * WHAT IT WILL NOT DO, and these are the brief's own audit rules kept honestly:
 *
 *   **A returned asset is never in current custody**, and nothing is counted
 *   twice: the holding list comes from open handovers plus anything standing
 *   against them on the register that no open handover covers.
 *
 *   **"Held with no slip on file" is its own state** — not "never issued",
 *   not hidden. It is a slip to go and get signed.
 *
 *   **No date, value or signature is invented.** A movement this app cannot
 *   see is not written down: a return is called a TRANSFER only where
 *   somebody else's handover of the same asset starts the day it ends.
 *
 *   **The figure is what it cost to buy**, said and never deducted. There is
 *   no depreciation in this app, so there is no "current valuation" to show
 *   beside it, and inventing one would be a wrong number that looks right.
 */
const TABS = [
  ['overview', 'Overview'],
  ['current', 'Current assets'],
  ['ledger', 'Asset ledger'],
  ['papers', 'Handover documents'],
  ['service', 'Maintenance history'],
];

const today = () => new Date().toISOString().slice(0, 10);

export default function AssetLedger({ employeeId, name, onClose, onError, onReload, onOpenEmployee }) {
  const [ledger, setLedger] = useState(null);
  const [neighbours, setNeighbours] = useState({ all: [], previous: null, next: null });
  const [people, setPeople] = useState([]);
  const [tab, setTab] = useState('overview');

  /* the movement ledger's own window and search */
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [find, setFind] = useState('');

  /*
   * Taking things back: which ones, on what date, in what condition.
   *
   * Everything they hold is ticked to start with, because the normal case on
   * somebody's last day is that it ALL comes back — and the ones that do not
   * are the exception somebody unticks deliberately, with the register then
   * still saying they are out.
   */
  /*
   * MOVING things is the same panel with a different ending - Dinesh:
   * *"ledger me se direct asset transfer karne ka option do"*. 'take' sends
   * it back to the office, 'move' hands it straight to somebody else, and
   * the tick boxes, the date and the condition are shared because they are
   * the same three questions either way.
   */
  const [mode, setMode] = useState('');
  const taking = mode !== '';
  const [toWhom, setToWhom] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [on, setOn] = useState(today);
  const [condition, setCondition] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const load = async () => {
    try {
      const query = [from ? `from=${from}` : '', to ? `to=${to}` : ''].filter(Boolean).join('&');
      const data = await api.get(`/people/assets/ledger/${employeeId}${query ? `?${query}` : ''}`);
      setLedger(data.ledger);
      setNeighbours(data.neighbours || { all: [], previous: null, next: null });
      setPeople(data.people || []);
      setPicked(new Set(data.ledger.holding.map((l) => l.asset_id)));
      return data.ledger;
    } catch (err) {
      onError?.(err);
      return null;
    }
  };

  useEffect(() => {
    if (STANDALONE || !employeeId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, from, to]);

  /** Take back what is ticked. Nothing else is touched, and nothing is written off. */
  const takeBack = async () => {
    setBusy(true);
    try {
      const done = await api.post('/people/assets/return-many', {
        asset_ids: [...picked],
        returned_on: on,
        condition: condition.trim() || undefined,
      });
      const after = await load();
      setMode('');
      setCondition('');
      const left = after?.totals.out ?? 0;
      setSaid(
        `${done.returned.length} taken back on ${done.returned_on}.` +
          (left ? ` ${left} still with them.` : ' Nothing left with them.')
      );
      await onReload?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hand what is ticked straight to somebody else.
   *
   * ONE DATE FOR BOTH SIDES: it comes off this person and goes onto the
   * other on the same day, which is what makes both ledgers read
   * "Transferred" rather than a return on Tuesday and an issue on Friday
   * with the thing belonging to nobody in between.
   *
   * The server is told who it is coming FROM, so a page left open while
   * somebody else moved the laptop cannot move it again - it comes back
   * refused by name instead.
   */
  const moveIt = async () => {
    setBusy(true);
    try {
      const done = await api.post('/people/assets/transfer', {
        asset_ids: [...picked],
        from_employee_id: employeeId,
        to_employee_id: Number(toWhom),
        on,
        condition: condition.trim() || undefined,
        note: note.trim() || undefined,
      });
      const after = await load();
      setMode('');
      setCondition('');
      setNote('');
      setToWhom('');
      const left = after?.totals.out ?? 0;
      setSaid(
        `${done.moved.length} handed to ${done.to.name} on ${done.on}.` +
          (done.refused?.length ? ` ${done.refused.length} not moved: ${done.refused.map((r) => r.why).join('; ')}.` : '') +
          (left ? ` ${left} still with them.` : ' Nothing left with them.')
      );
      await onReload?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  const book = ledger?.book;

  /*
   * The ledger's search narrows the LINES, never the balance: a running
   * balance that only counted the rows you searched for would be a different
   * number from the one on the page above it.
   */
  const rows = useMemo(() => {
    if (!book) return [];
    const q = find.trim().toLowerCase();
    if (!q) return book.rows;
    return book.rows.filter((r) =>
      [r.code, r.label, r.kind, r.particulars, r.type].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [book, find]);

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>Asset ledger</h3>
        <p className="muted small">The handover log lives on the server, so this one needs the server copy.</p>
      </div>
    );
  }

  if (!ledger) return <p className="muted small">Reading the handover log…</p>;

  const { employee, holding, returned, totals, services = [] } = ledger;

  /**
   * ONE PERSON'S LEDGER AS A DOCUMENT — what they hold, what came back, and
   * every movement with the running balance.
   *
   * It is built rather than printed off the screen, so it carries all three
   * whichever tab is open. Printing the page used to give whatever tab you
   * were on: from Overview, six figures and no list of what the person
   * actually holds, which is the one thing a ledger is handed over for.
   */
  const printIt = () => {
    const assetColumns = [
      col('#', (_r, i) => i + 1, '3%'),
      col('Code', (l) => l.code || '—'),
      col('Asset', (l) => `${l.kind} — ${l.label}${l.identifier ? ` (${l.identifier})` : ''}`),
      col('Issued', (l) => l.issued_on || 'not recorded'),
      col('Returned', (l) => l.returned_on || 'still with them'),
      num('Days', (l) => (l.days === null ? '—' : l.days)),
      num('Cost to buy', (l) => (l.value ? rupees(l.value) : '—')),
      col('Signed for', (l) => (l.no_slip ? 'no slip on file' : l.acknowledged_on ? `signed ${l.acknowledged_on}` : 'not acknowledged')),
      col('Condition', (l) =>
        [l.condition_out && `out: ${l.condition_out}`, l.condition_in && `back: ${l.condition_in}`]
          .filter(Boolean)
          .join(' · ')
      ),
    ];
    printReport({
      title: `Asset ledger — ${employee?.name || name || ''}`,
      subtitle: [employee?.employee_code, employee?.designation, employee?.company_name].filter(Boolean).join(' · '),
      meta: [
        `${totals.ever} ever issued · ${totals.out} with them now · ${rupees(totals.out_value)} at cost`,
        `${totals.returned} given back · ${totals.unsigned} with nothing signed for it`,
      ],
      landscape: true,
      sections: [
        {
          heading: 'Assets with them now',
          columns: assetColumns,
          rows: holding,
          empty: 'Nothing with them at the moment.',
          totals: { label: `${holding.length} with them`, 'Cost to buy': rupees(totals.out_value) },
        },
        ...(returned.length
          ? [{ heading: 'Given back', columns: assetColumns, rows: returned }]
          : []),
        ...(book
          ? [
              {
                heading: 'Every movement',
                columns: [
                  col('Date', (r) => r.on || ''),
                  // The asset's name beside the movement: on screen it is a
                  // second line under it, and a bare "Issued" says nothing.
                  col('Particulars', (r) =>
                    [r.particulars, r.label && `${r.kind ? `${r.kind} — ` : ''}${r.label}`]
                      .filter(Boolean)
                      .join(' · ')
                  ),
                  col('Asset code', (r) => r.code || ''),
                  col('Transaction', (r) => r.type || ''),
                  num('Issued', (r) => r.in ?? ''),
                  num('Returned', (r) => r.out ?? ''),
                  num('Balance', (r) => r.balance ?? ''),
                  num('Value', (r) => (r.value ? rupees(r.value) : '')),
                ],
                rows: book.rows,
                totals: {
                  label: 'Closing balance',
                  Balance: book.closing?.qty ?? '',
                  Value: rupees(book.closing?.value || 0),
                },
              },
            ]
          : []),
      ],
      /* Said on the paper too: the figure is reported, never deducted. */
      footer:
        'The figure is what these cost to buy. It is said, never deducted — an unreturned asset is named and valued, not docked.',
    });
  };
  const underService = holding.filter((l) => ['maintenance', 'damaged'].includes(l.state || '')).length;

  /*
   * `tickable` is passed explicitly at every call site, never by handing this
   * straight to `.map`.
   *
   * It was, once: `returned.map(line)` fed the ARRAY INDEX in as the flag, so
   * the first returned row rendered a literal "0" (`0 && …` in JSX prints the
   * zero) and every later row grew a tick box, shifting the whole table out
   * of line with its own header. Found by looking at the page.
   */
  const line = (l, tickable = false, at = 0) => (
    <tr key={l.id}>
      {tickable ? (
        <td className="row-no">
          <input
            type="checkbox"
            checked={picked.has(l.asset_id)}
            onChange={(e) => {
              const next = new Set(picked);
              if (e.target.checked) next.add(l.asset_id);
              else next.delete(l.asset_id);
              setPicked(next);
            }}
          />
        </td>
      ) : null}
      <td className="row-no">{at + 1}</td>
      <td>{l.code || <span className="muted">—</span>}</td>
      <td className="sticky-name">
        {l.kind} — {l.label}
        {l.identifier && <div className="muted small">{l.identifier}</div>}
      </td>
      <td className="small">{l.issued_on || <span className="muted">not recorded</span>}</td>
      <td className="small">{l.returned_on || <span className="muted">still with them</span>}</td>
      <td className="num">{l.days === null ? <span className="muted">—</span> : l.days}</td>
      <td className="num">{l.value ? rupees(l.value) : <span className="muted">—</span>}</td>
      <td className="small">
        {l.no_slip ? (
          <span className="pill due-soon" title="On the register against them with no handover row">
            no slip on file
          </span>
        ) : l.acknowledged_on ? (
          `signed ${l.acknowledged_on}`
        ) : (
          <span className="muted">not acknowledged</span>
        )}
      </td>
      <td className="small">
        {[l.condition_out && `out: ${l.condition_out}`, l.condition_in && `back: ${l.condition_in}`]
          .filter(Boolean)
          .join(' · ') || <span className="muted">—</span>}
      </td>
    </tr>
  );

  const head = (tickable) => (
    <tr>
      {tickable ? <th className="row-no" /> : null}
      <th className="row-no">#</th>
      <th>Code</th>
      <th>Asset</th>
      <th>Issued</th>
      <th>Returned</th>
      <th className="num">Days</th>
      <th className="num">Cost to buy</th>
      <th>Signed for</th>
      <th>Condition</th>
    </tr>
  );

  return (
    <section className="stack ledger-page">
      <div className="toolbar no-print">
        {onClose && (
          <button className="ghost" onClick={onClose}>
            ‹ Who holds what
          </button>
        )}
        <button
          className="ghost"
          disabled={!neighbours.previous}
          onClick={() => onOpenEmployee?.(neighbours.previous)}
          title={neighbours.previous?.name || 'nobody before them'}
        >
          ‹ Previous
        </button>
        <button
          className="ghost"
          disabled={!neighbours.next}
          onClick={() => onOpenEmployee?.(neighbours.next)}
          title={neighbours.next?.name || 'nobody after them'}
        >
          Next ›
        </button>
        {neighbours.all.length > 1 && (
          <select
            value={employeeId}
            onChange={(e) => onOpenEmployee?.(neighbours.all.find((h) => String(h.id) === e.target.value))}
            title="Somebody else holding something"
          >
            {neighbours.all.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
        <span className="push-right">
          {totals.out > 0 && (
            <>
              <button
                className={mode === 'take' ? 'active' : 'primary'}
                onClick={() => {
                  // Taking back starts with everything ticked: on somebody's
                  // last day it all comes back, and the exceptions are
                  // unticked deliberately.
                  setPicked(new Set(holding.map((l) => l.asset_id)));
                  setMode((m) => (m === 'take' ? '' : 'take'));
                  setTab('current');
                }}
              >
                {mode === 'take' ? 'Cancel take-back' : 'Take it back'}
              </button>
              <button
                className={mode === 'move' ? 'active' : undefined}
                onClick={() => {
                  /*
                   * A TRANSFER STARTS WITH NOTHING TICKED, deliberately
                   * unlike taking back. Handing over one laptop is the
                   * ordinary case; a page that arrived with all five ticked
                   * would move the lot on one click, and a transfer is
                   * somebody else's name on four more assets.
                   */
                  setPicked(new Set());
                  setMode((m) => (m === 'move' ? '' : 'move'));
                  setTab('current');
                }}
              >
                {mode === 'move' ? 'Cancel transfer' : 'Transfer to…'}
              </button>
            </>
          )}
          <button className="ghost" onClick={printIt}>
            Print
          </button>
          <button
            className="ghost"
            onClick={() =>
              download(
                `/people/assets/ledger/${employeeId}.csv`,
                `${(employee?.name || 'employee').replace(/[^A-Za-z0-9]+/g, '-')}-assets.csv`
              ).catch((err) => onError?.(err))
            }
          >
            Assets (CSV)
          </button>
          <button
            className="ghost"
            onClick={() =>
              download(
                `/people/assets/ledger/${employeeId}/transactions.csv${from || to ? `?from=${from}&to=${to}` : ''}`,
                `${(employee?.name || 'employee').replace(/[^A-Za-z0-9]+/g, '-')}-asset-ledger.csv`
              ).catch((err) => onError?.(err))
            }
          >
            Ledger (CSV)
          </button>
        </span>
      </div>

      {/* ---------------- who this is ---------------- */}
      <div className="card ledger-head">
        <div>
          <h3>{employee?.name || name}</h3>
          <p className="muted small">
            {[
              employee?.code,
              employee?.designation,
              employee?.department,
              employee?.company_name,
              employee?.branch_name,
            ]
              .filter(Boolean)
              .join(' · ') || 'no other details recorded'}
          </p>
        </div>
        <span className={`pill ${employee?.active === 0 ? 'paid' : 'approved'}`}>
          {employee?.active === 0 ? 'Left' : 'Working'}
        </span>
      </div>

      <div className="figures">
        <div className="figure">
          <span className="k">Ever issued</span>
          <span className="n">{totals.ever}</span>
        </div>
        <div className="figure">
          <span className="k">With them now</span>
          <span className="n">{totals.out}</span>
        </div>
        <div className="figure">
          <span className="k">What it cost to buy</span>
          <span className="n">{rupees(totals.out_value)}</span>
        </div>
        <div className="figure">
          <span className="k">Given back</span>
          <span className="n">{totals.returned}</span>
        </div>
        <div className="figure">
          <span className="k">Nothing signed for it</span>
          <span className="n">{totals.unsigned}</span>
        </div>
        <div className="figure">
          <span className="k">Being repaired</span>
          <span className="n">{underService}</span>
        </div>
      </div>

      {said && (
        <p className="alerts no-print" onClick={() => setSaid('')}>
          {said}
        </p>
      )}

      <div className="sub-tabs toolbar no-print">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* ---------------- overview ---------------- */}
      {tab === 'overview' && (
        <div className="card">
          {totals.no_slip > 0 && (
            <p className="lic-alert warn">
              <strong>
                {totals.no_slip} {totals.no_slip === 1 ? 'asset stands' : 'assets stand'} against them with no
                handover slip
              </strong>{' '}
              — issued before the log existed, or imported with a holder. That is a slip to get signed, not a
              missing asset.
            </p>
          )}
          <p className="muted small">
            The figure is what these cost to buy. It is <strong>said, never deducted</strong> — the full and
            final follows the same rule, because a laptop docked and then found in a drawer cannot be undone.
            There is no depreciation in this app, so there is no second valuation beside it.
            {totals.oldest_out ? ` The longest-standing one has been out since ${totals.oldest_out}.` : ''}
          </p>
          <table className="sheet clearance-table">
            <tbody>
              <tr>
                <td className="sticky-name">Assets with them now</td>
                <td className="num">{totals.out}</td>
                <td className="num">{rupees(totals.out_value)}</td>
              </tr>
              <tr>
                <td className="sticky-name">Ever issued · given back</td>
                <td className="num">{totals.ever}</td>
                <td className="num">{totals.returned} back</td>
              </tr>
              <tr>
                <td className="sticky-name">Repairs while it was with them</td>
                <td className="num">{book?.totals.maintenance ?? 0}</td>
                <td className="num">{rupees(book?.totals.maintenance_cost ?? 0)}</td>
              </tr>
              <tr>
                <td className="sticky-name">Waiting on a signature</td>
                <td className="num">{totals.unsigned}</td>
                <td className="small muted">
                  {totals.unsigned ? 'print the slip under Handover documents' : 'nothing pending'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- what they hold now ---------------- */}
      {/*
        * ON PAPER, THE WHOLE LEDGER — not whichever tab happens to be open.
        *
        * Printing from Overview gave a sheet with six figures and no list of
        * what the person actually holds, which is the one thing a ledger is
        * handed over for. So Current assets and the movement ledger are
        * always rendered; off their own tab they are hidden on screen and
        * shown on paper. The other two tabs (papers, repairs) print only
        * when somebody is looking at them — a slip and a repair history are
        * separate documents.
        */}
      <div className={tab === 'current' ? undefined : 'print-only'}>
        <div className="card">
          {/* On screen the tab button above says this; on paper nothing does. */}
          <h4 className="print-only">Assets with them now</h4>
          {mode === 'take' && (
            <div className="card" style={{ marginBottom: '0.6rem' }}>
              <h4>Take it back</h4>
              <p className="muted small">
                Everything they hold is ticked. Untick anything that is <strong>not</strong> coming back — the
                register will still say it is with them, which is the truth until it is in your hand.{' '}
                <strong>Nothing is written off and nothing is deducted</strong>: not returned is not the same
                as lost.
              </p>
              <div className="form-grid">
                <label>
                  Came back on
                  <input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
                </label>
                <label>
                  Condition
                  <input
                    value={condition}
                    placeholder="leave empty for fine"
                    onChange={(e) => setCondition(e.target.value)}
                  />
                </label>
              </div>
              <div className="row">
                <button className="primary" disabled={busy || !picked.size} onClick={takeBack}>
                  {busy ? 'Taking it back…' : `Take back ${picked.size} of ${totals.out}`}
                </button>
                <button className="ghost" disabled={busy} onClick={() => setMode('')}>
                  Not now
                </button>
              </div>
            </div>
          )}

          {mode === 'move' && (
            <div className="card" style={{ marginBottom: '0.6rem' }}>
              <h4>Transfer to somebody else</h4>
              <p className="muted small">
                Straight from one person to the next, without coming back to the office first. Both ledgers
                read <strong>Transferred</strong> on the same date — it leaves this one and lands on theirs
                the same day, so nothing belongs to nobody in between.{' '}
                <strong>Tick what is going</strong> — nothing is ticked to start with, because handing over
                one thing is the usual case.
              </p>
              <div className="form-grid">
                <label>
                  Hand it to
                  <select value={toWhom} onChange={(e) => setToWhom(e.target.value)}>
                    <option value="">pick somebody…</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.code ? ` (${p.code})` : ''}
                        {p.company_name ? ` — ${p.company_name}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Handed over on
                  <input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
                </label>
                <label>
                  Condition it went in
                  <input
                    value={condition}
                    placeholder="leave empty for fine"
                    onChange={(e) => setCondition(e.target.value)}
                  />
                </label>
                <label>
                  Why, if it is worth saying
                  <input value={note} placeholder="e.g. moved to the Surat desk" onChange={(e) => setNote(e.target.value)} />
                </label>
              </div>
              <div className="row">
                <button className="primary" disabled={busy || !picked.size || !toWhom} onClick={moveIt}>
                  {busy
                    ? 'Handing it over…'
                    : `Transfer ${picked.size} of ${totals.out}${
                        toWhom ? ` to ${people.find((p) => String(p.id) === String(toWhom))?.name || ''}` : ''
                      }`}
                </button>
                <button className="ghost" disabled={busy} onClick={() => setMode('')}>
                  Not now
                </button>
              </div>
              {!toWhom && <p className="muted small">Pick who it is going to — nothing moves until there is a name.</p>}
            </div>
          )}

          {!holding.length ? (
            <p className="muted small">Nothing with them at the moment.</p>
          ) : (
            <div className="table-wrap">
              <table className="sheet">
                <thead>{head(taking)}</thead>
                <tbody>{holding.map((l, i) => line(l, taking, i))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- the movement ledger ---------------- */}
      <div className={tab === 'ledger' ? undefined : 'print-only'}>
        <div className="card">
          <h4 className="print-only">Asset ledger — every movement</h4>
          <div className="toolbar no-print">
            <label className="pick">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="pick">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <input
              className="search"
              placeholder="Asset code or name"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
            {(from || to || find) && (
              <button
                className="ghost"
                onClick={() => {
                  setFrom('');
                  setTo('');
                  setFind('');
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div className="table-wrap">
            <table className="sheet ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th>Asset code</th>
                  <th>Transaction</th>
                  <th className="num">Issued</th>
                  <th className="num">Returned</th>
                  <th className="num">Balance</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="ledger-balance">
                  <td className="small">{book?.from || ''}</td>
                  <td className="sticky-name">
                    <strong>Opening balance</strong>
                  </td>
                  <td />
                  <td className="small">Opening Balance</td>
                  <td className="num" />
                  <td className="num" />
                  <td className="num">
                    <strong>{book?.opening.qty ?? 0}</strong>
                  </td>
                  <td className="num">{rupees(book?.opening.value ?? 0)}</td>
                </tr>

                {!rows.length ? (
                  <tr>
                    <td className="empty" colSpan={8}>
                      {find ? 'Nothing matching that.' : 'No movements recorded in this window.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, i) => (
                    <tr key={`${row.code}-${row.on}-${row.type}-${i}`}>
                      <td className="small">{row.on || <span className="muted">no date</span>}</td>
                      <td className="sticky-name">
                        {row.particulars}
                        <div className="muted small">
                          {row.kind} — {row.label}
                          {row.note ? ` · ${row.note}` : ''}
                        </div>
                      </td>
                      <td className="small">{row.code || <span className="muted">—</span>}</td>
                      <td className="small">{row.type}</td>
                      <td className="num">{row.in || ''}</td>
                      <td className="num">{row.out || ''}</td>
                      <td className="num">{row.balance}</td>
                      <td className="num">{row.value ? rupees(row.value) : ''}</td>
                    </tr>
                  ))
                )}

                <tr className="ledger-balance">
                  <td className="small">{book?.to || ''}</td>
                  <td className="sticky-name">
                    <strong>Closing balance</strong>
                  </td>
                  <td />
                  <td className="small">Closing Balance</td>
                  <td className="num">{book?.totals.issued ?? 0}</td>
                  <td className="num">{book?.totals.returned ?? 0}</td>
                  <td className="num">
                    <strong>{book?.closing.qty ?? 0}</strong>
                  </td>
                  <td className="num">
                    <strong>{rupees(book?.closing.value ?? 0)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="muted small">
            A <strong>transfer</strong> is only called one where somebody else’s handover of the same asset
            starts the day this one ends — otherwise a return is just a return. <strong>Maintenance</strong>{' '}
            lines carry a cost and move no quantity. The balance is the count of assets with them, and it
            follows the lines above it; searching narrows the lines and never the balance.
          </p>
        </div>
      </div>

      {/* ---------------- the paperwork ---------------- */}
      {tab === 'papers' && (
        <div className="card">
          <h4>Handover documents</h4>
          <p className="muted small">
            The slip lists only what they <strong>still</strong> have and carries the undertaking above the
            signature. Signed or not is what the record actually says — nothing here is assumed.
          </p>
          <div className="row no-print">
            <button
              onClick={() =>
                window.open(`/api/people/assets/slip/${employeeId}`, '_blank', 'noopener')
              }
              title="Opens the slip's own data; print it from Who holds what for the signature block"
            >
              Slip data
            </button>
            <button className="ghost" onClick={printIt}>
              Print this statement
            </button>
          </div>
          <table className="sheet">
            <thead>
              <tr>
                <th>Code</th>
                <th>Asset</th>
                <th>Issued</th>
                <th>Signed for</th>
                <th>Condition out</th>
              </tr>
            </thead>
            <tbody>
              {holding.concat(returned).map((l) => (
                <tr key={`p${l.id}`}>
                  <td>{l.code || <span className="muted">—</span>}</td>
                  <td className="sticky-name">
                    {l.kind} — {l.label}
                  </td>
                  <td className="small">{l.issued_on || <span className="muted">not recorded</span>}</td>
                  <td className="small">
                    {l.no_slip ? (
                      <span className="pill due-soon">no slip on file</span>
                    ) : l.acknowledged_on ? (
                      `signed ${l.acknowledged_on}`
                    ) : (
                      <span className="muted">not acknowledged</span>
                    )}
                  </td>
                  <td className="small">{l.condition_out || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- repairs ---------------- */}
      {tab === 'service' && (
        <div className="card">
          <h4>
            Maintenance history{' '}
            <span className="muted small">
              {book?.totals.maintenance ?? 0} while it was with them · {rupees(book?.totals.maintenance_cost ?? 0)}
            </span>
          </h4>
          {!services.length ? (
            <p className="muted small">No repairs recorded on any of their assets.</p>
          ) : (
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Asset</th>
                    <th>Kind</th>
                    <th>What was done</th>
                    <th>Vendor</th>
                    <th className="num">Cost</th>
                    <th>Next service</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.id}>
                      <td className="small">{s.serviced_on}</td>
                      <td className="sticky-name">
                        {s.code} — {s.label}
                      </td>
                      <td className="small">{s.kind}</td>
                      <td className="small">{s.work || <span className="muted">—</span>}</td>
                      <td className="small">{s.vendor || <span className="muted">—</span>}</td>
                      <td className="num">
                        {s.cost ? rupees(s.cost) : <span className="muted" title="under warranty, or free">0</span>}
                      </td>
                      <td className="small">{s.next_service_on || <span className="muted">not scheduled</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">
            Every repair on an asset they have held, whenever it happened. The ledger tab counts only those
            that fall inside the time it was <strong>with them</strong>.
          </p>
        </div>
      )}

      {/* The returned list stays on the page under Current assets, so the
          printed statement carries the whole story. */}
      {tab === 'current' && returned.length > 0 && (
        <div className="card">
          <h4>
            Given back <span className="muted small">{returned.length}</span>
          </h4>
          <div className="table-wrap">
            <table className="sheet">
              <thead>{head(false)}</thead>
              <tbody>{returned.map((l, i) => line(l, false, i))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
