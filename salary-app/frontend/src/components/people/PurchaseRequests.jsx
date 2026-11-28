import { useEffect, useMemo, useState } from 'react';
import { STANDALONE, api } from '../../api.js';
import { rupees } from '../../format.js';
import {
  PR_PRIORITIES,
  PR_STATUSES,
  stepsFor,
  statusLabel,
} from '../../../../shared/purchaseRequest.js';

/**
 * PURCHASE REQUESTS (v2.39.0) - asking for an asset before it is bought.
 *
 * Request -> approval (Manager or Admin, never the person who asked) ->
 * ordered -> received -> registered. Registering is the ordinary Add asset
 * form on the register, so the code series and the duplicate checks hold;
 * "Register it" opens that form with what the request already says.
 *
 * Nothing here spends money or creates an asset by itself.
 */
const blank = {
  kind: '',
  description: '',
  quantity: 1,
  estimated_cost: '',
  purpose: '',
  priority: 'normal',
  vendor: '',
  company_id: '',
  department: '',
  employee_id: '',
};

const tone = (status) => PR_STATUSES.find((s) => s.key === status)?.tone || 'muted';
const when = (stamp) =>
  stamp ? new Date(`${String(stamp).replace(' ', 'T')}Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function PurchaseRequests({ companies = [], employees = [], onError, onRegister }) {
  const [list, setList] = useState([]);
  const [canApprove, setCanApprove] = useState(false);
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState('open');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const load = async () => {
    try {
      const got = await api.get('/people/assets/requests');
      setList(got.requests || []);
      setCanApprove(Boolean(got.can_approve));
      setMe(got.me);
    } catch (err) {
      onError?.(err);
    }
  };
  useEffect(() => {
    if (!STANDALONE) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const out = { open: 0 };
    for (const r of list) {
      out[r.status] = (out[r.status] || 0) + 1;
      if (!['completed', 'rejected', 'cancelled'].includes(r.status)) out.open += 1;
    }
    return out;
  }, [list]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((r) =>
        status === 'all'
          ? true
          : status === 'open'
            ? !['completed', 'rejected', 'cancelled'].includes(r.status)
            : r.status === status
      )
      .filter(
        (r) =>
          !q ||
          [r.number, r.kind, r.description, r.purpose, r.department, r.employee_name, r.requested_by, r.vendor]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
      );
  }, [list, status, query]);

  if (STANDALONE) {
    return (
      <div className="card">
        <h3>Purchase requests</h3>
        <p className="muted">
          Purchase requests need the server: an approval has to be somebody signed in, and this file
          has no logins.
        </p>
      </div>
    );
  }

  const save = async (submit) => {
    setBusy(true);
    try {
      await api.post('/people/assets/requests', { ...form, submit });
      setForm(null);
      setSaid(submit ? 'Sent for approval.' : 'Saved as a draft.');
      await load();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  const move = async (request, step) => {
    if (step.needsNote && !note.trim()) {
      onError?.(new Error(`Type why in the box first — a ${step.label.toLowerCase()} needs a reason.`));
      return;
    }
    let asset_codes;
    if (step.key === 'complete') {
      asset_codes = window.prompt('Which asset codes were registered for this request? (optional)', request.asset_codes || '');
      if (asset_codes === null) return;
    }
    setBusy(true);
    try {
      const got = await api.post(`/people/assets/requests/${request.id}/${step.key}`, { note, asset_codes });
      setOpen(got);
      setNote('');
      await load();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, input) => (
    <label className="vf-field">
      <span className="vf-label">{label}</span>
      {input}
    </label>
  );

  return (
    <div className="stack">
      <div className="card">
        <div className="row-between">
          <div>
            <h3>Purchase requests</h3>
            <p className="muted small">
              Ask for an asset before it is bought. A Manager or an Admin approves it — never the person
              who asked — and once it arrives it is registered on the Asset Register like any other.
            </p>
          </div>
          <button className="primary" onClick={() => setForm({ ...blank })}>New request</button>
        </div>
        {said && <p className="ok small">{said}</p>}

        <div className="toolbar pr-filters">
          {[
            ['open', 'Open'],
            ['submitted', 'Pending approval'],
            ['approved', 'Approved'],
            ['ordered', 'Ordered'],
            ['received', 'Received'],
            ['completed', 'Completed'],
            ['rejected', 'Rejected'],
            ['all', 'All'],
          ].map(([key, label]) => (
            <button key={key} className={`chip${status === key ? ' active' : ''}`} onClick={() => setStatus(key)}>
              {label}
              {key === 'all' ? ` ${list.length}` : counts[key] ? ` ${counts[key]}` : ''}
            </button>
          ))}
          <input
            className="search"
            placeholder="Search number, item, department, person"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="table-wrap unboxed">
          <table className="sheet pr-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Estimated</th>
                <th>For</th>
                <th>Priority</th>
                <th>Raised by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => api.get(`/people/assets/requests/${r.id}`).then((g) => setOpen(g.request)).catch(onError)}>
                  <td>
                    <button type="button" className="link name-link">{r.number}</button>
                    <div className="muted small">{when(r.created_at)}</div>
                  </td>
                  <td>
                    <strong>{r.kind}</strong>
                    {r.description ? <div className="muted small">{r.description}</div> : null}
                  </td>
                  <td className="num">{r.quantity}</td>
                  <td className="num">{r.estimated_cost !== null ? rupees(r.estimated_cost) : '—'}</td>
                  <td>
                    {[r.employee_name, r.department, r.company_name].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td><span className={`pill pr-pri-${r.priority}`}>{r.priority}</span></td>
                  <td>{r.requested_by || '—'}</td>
                  <td><span className={`pill pr-${tone(r.status)}`}>{statusLabel(r.status)}</span></td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={8} className="empty">
                    {list.length ? 'Nothing in this list.' : 'No purchase requests yet — “New request” raises the first.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="modal pr-modal" role="dialog" aria-label="New purchase request" onClick={(e) => e.stopPropagation()}>
            <header className="rr-head">
              <h3>New purchase request</h3>
              <button className="ghost" onClick={() => setForm(null)}>×</button>
            </header>
            <div className="vf-grid">
              {field('kind', 'What is to be bought *', (
                <input value={form.kind} placeholder="e.g. Laptop" onChange={(e) => setForm({ ...form, kind: e.target.value })} />
              ))}
              {field('description', 'Details', (
                <input value={form.description} placeholder="e.g. i5, 16 GB, 14 inch" onChange={(e) => setForm({ ...form, description: e.target.value })} />
              ))}
              {field('quantity', 'Quantity *', (
                <input inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              ))}
              {field('estimated_cost', 'Estimated cost, in all (₹)', (
                <input inputMode="decimal" value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })} />
              ))}
              {field('priority', 'Priority', (
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PR_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ))}
              {field('vendor', 'Vendor, if known', (
                <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
              ))}
              {field('company_id', 'Company', (
                <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
                  <option value="">—</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ))}
              {field('department', 'Department', (
                <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              ))}
              {field('employee_id', 'For whom (optional)', (
                <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                  <option value="">—</option>
                  {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              ))}
            </div>
            <label className="vf-field">
              <span className="vf-label">What it is for *</span>
              <textarea rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
            </label>
            <div className="rr-actions">
              <button disabled={busy} onClick={() => save(false)}>Save draft</button>
              <button className="primary" disabled={busy} onClick={() => save(true)}>Send for approval</button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div className="modal pr-modal" role="dialog" aria-label={open.number} onClick={(e) => e.stopPropagation()}>
            <header className="rr-head">
              <h3>
                {open.number} · {open.kind}{' '}
                <span className={`pill pr-${tone(open.status)}`}>{statusLabel(open.status)}</span>
              </h3>
              <button className="ghost" onClick={() => setOpen(null)}>×</button>
            </header>
            <dl className="pr-facts">
              <dt>Quantity</dt><dd>{open.quantity}</dd>
              <dt>Estimated</dt><dd>{open.estimated_cost !== null ? rupees(open.estimated_cost) : '—'}</dd>
              <dt>Purpose</dt><dd>{open.purpose}</dd>
              {open.description ? (<><dt>Details</dt><dd>{open.description}</dd></>) : null}
              <dt>For</dt><dd>{[open.employee_name, open.department, open.company_name].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Vendor</dt><dd>{open.vendor || '—'}</dd>
              <dt>Raised by</dt><dd>{open.requested_by || '—'}</dd>
              {open.decided_by ? (<><dt>Decided by</dt><dd>{open.decided_by}</dd></>) : null}
              {open.asset_codes ? (<><dt>Registered as</dt><dd>{open.asset_codes}</dd></>) : null}
            </dl>

            <h4>History</h4>
            <ol className="pr-history">
              {(open.events || []).map((e) => (
                <li key={e.id}>
                  <strong>{e.action === 'created' ? 'Raised' : e.action === 'edited' ? 'Edited' : statusLabel(e.to_status)}</strong>{' '}
                  <span className="muted small">{when(e.at)} · {e.who || 'office'}</span>
                  {e.note ? <div className="small">{e.note}</div> : null}
                </li>
              ))}
            </ol>

            {(() => {
              const steps = stepsFor(open, { canApprove, isRequester: me && me === open.requested_by_user });
              const waitingOnSomeoneElse =
                open.status === 'submitted' && !steps.some((s) => s.key === 'approve');
              return (
                <>
                  {waitingOnSomeoneElse ? (
                    <p className="muted small">
                      {canApprove
                        ? 'You raised this one, so somebody else approves it.'
                        : 'Waiting for a Manager or an Admin to approve it.'}
                    </p>
                  ) : null}
                  {open.status === 'received' && onRegister ? (
                    <p className="small">
                      Arrived? <button className="link" onClick={() => { onRegister(open); setOpen(null); }}>Register it on the Asset Register →</button>{' '}
                      then mark this completed with the codes it was given.
                    </p>
                  ) : null}
                  {steps.length ? (
                    <>
                      <input
                        placeholder="A note for the history (needed to reject or cancel)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="rr-actions">
                        {steps.map((s) => (
                          <button
                            key={s.key}
                            disabled={busy}
                            className={s.key === 'approve' || s.key === 'submit' ? 'primary' : s.key === 'reject' || s.key === 'cancel' ? 'danger' : undefined}
                            onClick={() => move(open, s)}
                          >
                            {s.label}
                          </button>
                        ))}
                        {open.status === 'draft' ? (
                          <button
                            className="ghost"
                            disabled={busy}
                            onClick={async () => {
                              if (!window.confirm(`Delete draft ${open.number}? A draft that went nowhere leaves no record.`)) return;
                              try {
                                await api.del(`/people/assets/requests/${open.id}`);
                                setOpen(null);
                                await load();
                              } catch (err) {
                                onError?.(err);
                              }
                            }}
                          >
                            Delete draft
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
