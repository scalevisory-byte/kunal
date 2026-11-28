import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import { rupees } from '../../format.js';
import {
  DISPOSAL_STATUSES,
  METHODS_WITH_MONEY,
  approvalEffect,
  disposalActionLabel,
  disposalMethodLabel,
  disposalStatusLabel,
} from '../../../../shared/assetDisposal.js';

/**
 * WRITE-OFF & DISPOSAL (v2.48.0) - every asset taken off the register, and
 * every one somebody has asked to take off.
 *
 * A request changes nothing; Approve is the button that writes the asset
 * off or marks it disposed. Nobody approves their own. An approver doing it
 * directly appears here too, marked "direct", so this list is complete.
 */
const when = (stamp) =>
  stamp ? new Date(`${String(stamp).replace(' ', 'T')}Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const pillOf = (status) => (status === 'cancelled' ? 'dropped' : status);

export default function AssetDisposals({ onError, onOpenAsset, onPurchases }) {
  const [rows, setRows] = useState([]);
  const [figures, setFigures] = useState({});
  const [purchases, setPurchases] = useState(0);
  const [canApprove, setCanApprove] = useState(false);
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState('pending');
  const [query, setQuery] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(0);

  const load = async () => {
    try {
      const got = await api.get('/people/assets/disposals');
      setRows(got.disposals || []);
      setFigures(got.figures || {});
      setPurchases(got.purchases_waiting || 0);
      setCanApprove(Boolean(got.can_approve));
      setMe(got.me);
    } catch (err) {
      onError?.(err);
    }
  };
  useEffect(() => {
    if (!STANDALONE) load();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || [r.number, r.asset_code, r.asset_label, r.reason, r.party, r.raised_by].some((v) => String(v || '').toLowerCase().includes(q)))
    );
  }, [rows, status, query]);

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>Write-off &amp; Disposal</h3>
        <p className="muted">
          Approvals need logins, and this file has none — so here a write-off or a disposal is done
          straight from the asset, with nobody to ask. The server version sends it to a Manager or
          an Admin first.
        </p>
      </div>
    );
  }

  const decide = async (r, decision) => {
    let note = '';
    if (decision === 'approve') {
      if (!window.confirm(`Approve ${r.number}?\n\n${approvalEffect(r, { employee_id: r.holder_id, employee_name: r.holder_name })}`)) return;
    } else {
      note = window.prompt(decision === 'reject' ? `Reject ${r.number} — why?` : `Cancel ${r.number} — why?`, '');
      if (!note) return;
    }
    setBusy(r.id);
    setSaid('');
    try {
      await api.post(`/people/assets/disposals/${r.id}/${decision}`, { note });
      setSaid(`${r.number} ${decision === 'approve' ? 'approved — done' : decision === 'reject' ? 'rejected' : 'cancelled'}.`);
      await load();
    } catch (err) {
      setSaid(err.message);
    } finally {
      setBusy(0);
    }
  };

  const counts = Object.fromEntries(DISPOSAL_STATUSES.map(([k]) => [k, rows.filter((r) => r.status === k).length]));

  return (
    <section className="stack">
      <div className="card">
        <div className="rr-head">
          <h3>Write-off &amp; Disposal</h3>
          {purchases ? (
            <button className="link" onClick={onPurchases}>
              {purchases} purchase request{purchases === 1 ? '' : 's'} waiting too — buying is approved under Purchase Requests
            </button>
          ) : (
            <span className="muted small">Buying is approved under Purchase Requests.</span>
          )}
        </div>
        <p className="muted small">
          Asking changes nothing: the asset stays on the register, in whoever&rsquo;s name it is, until a
          Manager or an Admin approves. Approving writes it off or marks it disposed, there and then.
          Nobody approves their own request. Start one from the asset — <b>Write off</b> or{' '}
          <b>Dispose</b> on the register or the asset&rsquo;s page.
        </p>
        <div className="late-figs">
          <span><b>{figures.waiting || 0}</b><em>waiting for approval</em></span>
          <span><b>{figures.written_off || 0}</b><em>written off</em></span>
          <span><b>{figures.disposed || 0}</b><em>disposed of</em></span>
          <span><b>{rupees(figures.received || 0)}</b><em>received from sales</em></span>
          <span><b>{rupees(figures.book_value_off || 0)}</b><em>purchase cost taken off</em></span>
        </div>
      </div>

      <div className="toolbar wd-filters">
        {[['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['', 'All']].map(([k, label]) => (
          <button key={k || 'all'} className={status === k ? 'chip active' : 'chip'} onClick={() => setStatus(k)}>
            {label} {k ? counts[k] || 0 : rows.length}
          </button>
        ))}
        <input className="search" placeholder="Search number, asset, reason, person" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {said ? <p className="small">{said}</p> : null}

      {shown.length === 0 ? (
        <p className="empty">
          {status === 'pending' ? 'Nothing waiting for approval.' : 'Nothing here.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="sheet wd-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Asset</th>
                <th>What</th>
                <th>Why</th>
                <th>Asked by</th>
                <th>Status</th>
                <th aria-label="Decide" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const mine = me && Number(r.raised_by_user) === Number(me);
                return (
                  <tr key={r.id}>
                    <td>{r.number}</td>
                    <td>
                      <button className="link name-link" onClick={() => onOpenAsset?.(r.asset_id)}>
                        {r.asset_code || '—'}
                      </button>
                      <div className="muted small">{r.asset_label}{r.purchase_cost ? ` · cost ${rupees(r.purchase_cost)}` : ''}</div>
                    </td>
                    <td>
                      <b>{disposalActionLabel(r.action)}</b>
                      {r.action === 'dispose' && (
                        <div className="muted small">
                          {disposalMethodLabel(r.method)}
                          {r.party ? ` to ${r.party}` : ''}
                          {METHODS_WITH_MONEY.has(r.method) ? ` · ${rupees(r.amount || 0)} received` : ''}
                        </div>
                      )}
                    </td>
                    <td className="wd-why">{r.reason}</td>
                    <td>
                      {r.raised_by || 'office'}
                      <div className="muted small">{when(r.created_at)}</div>
                    </td>
                    <td>
                      <span className={`pill ${pillOf(r.status)}`}>{disposalStatusLabel(r.status)}</span>
                      {r.direct ? <span className="muted small"> direct</span> : null}
                      {r.status !== 'pending' && !r.direct && r.decided_by ? (
                        <div className="muted small">by {r.decided_by}, {when(r.decided_at)}</div>
                      ) : null}
                      {r.decision_note && !r.direct ? <div className="muted small">“{r.decision_note}”</div> : null}
                    </td>
                    <td className="wd-decide">
                      {r.status === 'pending' && canApprove && !mine && (
                        <>
                          <button className="primary small" disabled={busy === r.id} onClick={() => decide(r, 'approve')}>Approve</button>{' '}
                          <button className="ghost small" disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Reject</button>{' '}
                        </>
                      )}
                      {r.status === 'pending' && mine && canApprove && (
                        <span className="muted small">yours — somebody else approves it </span>
                      )}
                      {r.status === 'pending' && (mine || canApprove) && (
                        <button className="ghost small" disabled={busy === r.id} onClick={() => decide(r, 'cancel')}>Cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
