import { useEffect, useState } from 'react';
import { STANDALONE, api, download } from '../../api.js';
import { rupees } from '../../format.js';

/**
 * ONE PERSON'S ASSET LEDGER — everything they have ever been given.
 *
 * Dinesh: *"konse employee ke paas kya-kya asset he, uska ledger nikalna he"*.
 *
 * Two screens already existed and neither answered it: **Who holds what**
 * lists what somebody STILL has and prints a slip to sign, and an asset's own
 * page shows that ASSET's history. This is the third question — one person,
 * everything, on one page — which is what gets asked when somebody leaves or
 * when something cannot be found.
 *
 * What it insists on saying:
 *
 *   **Held with no slip on file** is its own state. An asset standing against
 *   somebody on the register with no handover row is not "never issued" and is
 *   not hidden: it is a slip to go and get signed, and it is counted.
 *
 *   **The worth is what is still out, and it is reported, not deducted.** The
 *   same rule the full and final follows — a laptop docked and then found in a
 *   drawer cannot be undone.
 */
export default function AssetLedger({ employeeId, name, onClose, onError, onReload }) {
  const [ledger, setLedger] = useState(null);
  /*
   * Taking things back: which ones, on what date, in what condition.
   *
   * Everything they hold is ticked to start with, because the normal case on
   * somebody's last day is that it ALL comes back - and the ones that do not
   * are the exception somebody unticks deliberately, with the register then
   * still saying they are out.
   */
  const [taking, setTaking] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [condition, setCondition] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const load = async () => {
    try {
      const data = await api.get(`/people/assets/ledger/${employeeId}`);
      setLedger(data.ledger);
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
  }, [employeeId]);

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
      setTaking(false);
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

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>Asset ledger</h3>
        <p className="muted small">
          The handover log lives on the server, so this one needs the server copy.
        </p>
      </div>
    );
  }

  if (!ledger) return <p className="muted small">Reading the handover log…</p>;

  const { employee, holding, returned, totals } = ledger;

  /*
   * `tickable` is passed explicitly at every call site, never by handing this
   * straight to `.map`.
   *
   * It was, once: `returned.map(line)` fed the ARRAY INDEX in as the flag, so
   * the first returned row rendered a literal "0" (`0 && …` in JSX prints the
   * zero) and every later row grew a tick box, shifting the whole table out
   * of line with its own header. Found by looking at the page.
   */
  const line = (l, tickable = false) => (
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

  return (
    <section className="stack">
      <div className="toolbar no-print">
        {onClose && (
          <button className="ghost" onClick={onClose}>
            Back
          </button>
        )}
        <strong>
          {employee?.name || name} {employee?.code ? <span className="muted small">{employee.code}</span> : null}
        </strong>
        <span className="push-right">
          {totals.out > 0 && (
            <button className={taking ? 'active' : 'primary'} onClick={() => setTaking((v) => !v)}>
              {taking ? 'Cancel' : 'Take it back'}
            </button>
          )}
          <button className="ghost" onClick={() => window.print()}>
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
            CSV
          </button>
        </span>
      </div>

      <div className="card">
        <h3>
          Assets with {employee?.name || name}
          {employee?.company_name ? <span className="muted small"> · {employee.company_name}</span> : null}
        </h3>

        <div className="figures">
          <div className="figure">
            <span className="k">With them now</span>
            <span className="n">{totals.out}</span>
          </div>
          <div className="figure">
            <span className="k">What it cost to buy</span>
            <span className="n">{rupees(totals.out_value)}</span>
          </div>
          <div className="figure">
            <span className="k">Ever held</span>
            <span className="n">{totals.ever}</span>
          </div>
          <div className="figure">
            <span className="k">Nothing signed for it</span>
            <span className="n">{totals.unsigned}</span>
          </div>
        </div>

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
          {totals.oldest_out ? ` The longest-standing one has been out since ${totals.oldest_out}.` : ''}
        </p>

        {said && (
          <p className="alerts" onClick={() => setSaid('')}>
            {said}
          </p>
        )}

        {taking && (
          <div className="card" style={{ marginTop: '0.6rem' }}>
            <h4>Take it back</h4>
            <p className="muted small">
              Everything they hold is ticked. Untick anything that is <strong>not</strong> coming
              back — the register will still say it is with them, which is the truth until it is in
              your hand. <strong>Nothing is written off and nothing is deducted</strong>: not
              returned is not the same as lost, and that is a decision somebody makes.
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
                <span className="muted small">written against each one taken back</span>
              </label>
            </div>
            <div className="row">
              <button className="primary" disabled={busy || !picked.size} onClick={takeBack}>
                {busy ? 'Taking it back…' : `Take back ${picked.size} of ${totals.out}`}
              </button>
              <button className="ghost" disabled={busy} onClick={() => setTaking(false)}>
                Not now
              </button>
            </div>
          </div>
        )}

        {!holding.length ? (
          <p className="muted small">Nothing with them at the moment.</p>
        ) : (
          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  {taking && <th className="row-no" />}
                  <th>Code</th>
                  <th>What</th>
                  <th>Issued</th>
                  <th>Returned</th>
                  <th className="num">Days</th>
                  <th className="num">Cost</th>
                  <th>Signed for</th>
                  <th>Condition</th>
                </tr>
              </thead>
              <tbody>{holding.map((l) => line(l, taking))}</tbody>
            </table>
          </div>
        )}

        {returned.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>
              Given back <span className="muted small">{returned.length}</span>
            </h3>
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>What</th>
                    <th>Issued</th>
                    <th>Returned</th>
                    <th className="num">Days</th>
                    <th className="num">Cost</th>
                    <th>Signed for</th>
                    <th>Condition</th>
                  </tr>
                </thead>
                <tbody>{returned.map((l) => line(l))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
