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
export default function AssetLedger({ employeeId, name, onClose, onError }) {
  const [ledger, setLedger] = useState(null);

  useEffect(() => {
    if (STANDALONE || !employeeId) return;
    let alive = true;
    api
      .get(`/people/assets/ledger/${employeeId}`)
      .then((data) => alive && setLedger(data.ledger))
      .catch((err) => onError?.(err));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

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

  const line = (l) => (
    <tr key={l.id}>
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

        {!holding.length ? (
          <p className="muted small">Nothing with them at the moment.</p>
        ) : (
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
              <tbody>{holding.map(line)}</tbody>
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
                <tbody>{returned.map(line)}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
