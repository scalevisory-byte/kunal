import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { onStaff } from '../../onStaff.js';
import { COURIER_STATUSES, courierKpis } from '../../../../shared/frontOffice.js';
import { col, printReport } from '../../printReport.js';

/**
 * THE COURIER REGISTER.
 *
 * What arrived, who it is for, and - the half this never had - **who
 * actually took it**. "It came on Tuesday" is not the question anybody asks
 * a week later; "where is it now" is.
 *
 * WRITING A HANDOVER IS WHAT MAKES IT DELIVERED. The status is not a box
 * somebody ticks: it follows from the record of the parcel changing hands,
 * so a register cannot say Delivered with nothing behind it.
 */

const BLANK = { direction: 'Inward' };

export default function CourierDesk({ day, employees = [], companyId, onError, onToast }) {
  const [form, setForm] = useState(BLANK);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('day');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState('');
  const [open, setOpen] = useState(null);

  const staff = useMemo(() => onStaff(employees), [employees]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = async () => {
    const q = new URLSearchParams({ limit: '100' });
    /* The drawer does not empty itself at midnight: "everything pending"
       has to be readable from whatever day is on screen. */
    if (scope === 'day') q.set('day', day);
    if (status) q.set('status', status);
    if (query.trim()) q.set('q', query.trim());
    if (who) q.set('employee_id', who);
    if (companyId) q.set('company_id', companyId);
    try {
      const [got, still] = await Promise.all([
        api.get(`/front-office/courier?${q}`),
        api.get('/front-office/courier/pending'),
      ]);
      setRows(got.rows || []);
      setTotal(got.total || 0);
      setPending(still.rows || []);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, scope, status, query, who, companyId]);

  const kpis = useMemo(() => courierKpis(rows), [rows]);

  const act = async (run, said) => {
    setBusy(true);
    try {
      await run();
      await load();
      if (said) onToast(said);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    act(async () => {
      const saved = await api.post('/front-office/courier', { ...form, day });
      setForm({ direction: form.direction });
      onToast(saved.inward_no ? `Logged — ${saved.inward_no}` : 'Logged');
    });

  const COLUMNS = [
    col('Inward no.', (c) => c.inward_no || ''),
    col('Date', (c) => c.day),
    col('Time', (c) => c.at_time || ''),
    col('In / Out', (c) => c.direction),
    col('Courier', (c) => c.company || ''),
    col('AWB / Ref', (c) => c.ref_no || ''),
    col('From / To', (c) => c.party || ''),
    col('For', (c) => c.recipient_name || ''),
    col('Department', (c) => c.department || ''),
    col('Description', (c) => c.description || ''),
    col('Received by', (c) => c.handler || ''),
    col('Handed over', (c) => (c.handed_on ? `${c.handed_on} · ${c.handed_to || ''}` : '')),
    col('Status', (c) => c.status || ''),
  ];

  const printRegister = () =>
    printReport({
      title: 'Courier register',
      subtitle: scope === 'day' ? day : 'Every entry',
      meta: [
        `${kpis.total} entr${kpis.total === 1 ? 'y' : 'ies'} · ${kpis.inward} in · ${kpis.outward} out`,
        `${kpis.pending} still to be handed over`,
      ],
      landscape: true,
      columns: [col('#', (_c, i) => i + 1, '3%'), ...COLUMNS],
      rows,
      empty: 'Nothing in or out.',
      footer:
        'A parcel counts as delivered only once a handover has been written against it — the status follows the record, not the other way round.',
    });

  return (
    <>
      <div className="card">
        <h3>Log a courier</h3>
        <div className="iv-grid">
          <label className="field">
            In or out
            <select value={form.direction} onChange={(e) => set('direction', e.target.value)}>
              <option value="Inward">Inward (received)</option>
              <option value="Outward">Outward (sent)</option>
            </select>
          </label>
          <label className="field">
            Courier company
            <input value={form.company ?? ''} onChange={(e) => set('company', e.target.value)} />
          </label>
          <label className="field">
            AWB / tracking no.
            <input value={form.ref_no ?? ''} onChange={(e) => set('ref_no', e.target.value)} />
          </label>
          <label className="field">
            {form.direction === 'Inward' ? 'Received from' : 'Sent to'}
            <input value={form.party ?? ''} onChange={(e) => set('party', e.target.value)} />
          </label>
          <label className="field">
            {form.direction === 'Inward' ? 'For (employee)' : 'Sent by (employee)'}
            <select
              value={form.recipient_employee_id ?? ''}
              onChange={(e) => set('recipient_employee_id', e.target.value)}
            >
              <option value="">— nobody in particular —</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.department ? ` · ${e.department}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Department
            <input value={form.department ?? ''} onChange={(e) => set('department', e.target.value)} />
          </label>
          <label className="field wide">
            Parcel / document
            <input value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label className="field">
            {form.direction === 'Inward' ? 'Received by' : 'Sent by'}
            <input value={form.handler ?? ''} onChange={(e) => set('handler', e.target.value)} />
          </label>
          <label className="field">
            Remark
            <input value={form.remark ?? ''} onChange={(e) => set('remark', e.target.value)} />
          </label>
        </div>
        <div className="row">
          <span className="muted small">
            A courier company or a from/to name — one of the two at least. An inward parcel gets
            its own number, and stays <strong>pending</strong> until somebody takes it.
          </span>
          <span className="grow" />
          <button className="primary" disabled={busy} onClick={add}>Add entry</button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="card">
          {/*
            * The alert this register exists for. It ignores the date on
            * screen on purpose: a parcel from Tuesday is still undelivered
            * on Friday, and a list that empties at midnight is a list that
            * never gets worked.
            */}
          <div className="row">
            <h3>Still in the drawer</h3>
            <span className="pill bad">{pending.length}</span>
            <span className="grow" />
            <button className="ghost tiny" onClick={() => { setScope('all'); setStatus('Pending handover'); }}>
              show them all
            </button>
          </div>
          <p className="muted small">
            {pending.slice(0, 6).map((c) => (
              <span key={c.id}>
                {c.inward_no} · {c.recipient_name || c.party || c.company} ({c.day}){' '}
              </span>
            ))}
            {pending.length > 6 ? `and ${pending.length - 6} more` : ''}
          </p>
        </div>
      )}

      <div className="card">
        <div className="fo-figures">
          <div><b>{kpis.inward}</b><span>received</span></div>
          <div><b>{kpis.outward}</b><span>sent</span></div>
          <div className={kpis.pending ? 'bad' : undefined}><b>{kpis.pending}</b><span>pending handover</span></div>
          <div><b>{kpis.delivered}</b><span>delivered</span></div>
          <div><b>{kpis.returned}</b><span>returned</span></div>
        </div>

        <div className="toolbar">
          <div className="chips">
            <button className={`chip ${scope === 'day' ? 'active' : ''}`} onClick={() => setScope('day')}>
              This date
            </button>
            <button className={`chip ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')}>
              Everything
            </button>
          </div>
          <input
            className="search"
            placeholder="Courier, AWB, from/to"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {COURIER_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Anybody</option>
            {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <span className="grow" />
          <button className="ghost" onClick={printRegister} disabled={!rows.length}>
            Print the register
          </button>
        </div>

        <div className="scroll">
          <table className="sheet numbered fo-table">
            <thead>
              <tr>
                <th className="row-no">#</th>
                <th>Inward no.</th><th>Date</th><th>In / Out</th><th>Courier</th><th>AWB</th>
                <th className="grow">From / To</th><th>For</th><th>Description</th>
                <th>Received by</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} className={c.status === 'Pending handover' ? 'fo-in' : undefined}>
                  <td className="row-no">{i + 1}</td>
                  <td className="fo-tel small">
                    <button className="link" onClick={() => setOpen(c)}>{c.inward_no || '—'}</button>
                  </td>
                  <td className="fo-tel small">{c.day}</td>
                  <td><span className={`tag ${c.direction === 'Inward' ? 'open' : ''}`}>{c.direction}</span></td>
                  <td className="small">{c.company}</td>
                  <td className="small fo-tel">{c.ref_no}</td>
                  <td className="small">{c.party}</td>
                  <td className="small">{c.recipient_name}</td>
                  <td className="small">{c.description}</td>
                  <td className="small">{c.handler}</td>
                  <td className="small">
                    <span className={`tag ${c.status === 'Pending handover' ? 'warn' : ''}`}>{c.status}</span>
                  </td>
                  <td className="right nowrap">
                    {c.direction === 'Inward' && c.status !== 'Delivered' ? (
                      <button className="tiny" onClick={() => setOpen(c)}>Hand over</button>
                    ) : (
                      <button className="icon-x" title="Open" onClick={() => setOpen(c)}>⋯</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="empty fo-empty">Nothing in or out for this date.</p> : null}
          {total > rows.length ? (
            <p className="muted small">Showing {rows.length} of {total} — narrow it with the boxes above.</p>
          ) : null}
        </div>
      </div>

      {open && (
        <CourierPanel
          courier={open}
          staff={staff}
          busy={busy}
          onClose={() => setOpen(null)}
          onHandOver={(body) =>
            act(async () => {
              const saved = await api.post(`/front-office/courier/${open.id}/handover`, body);
              setOpen(saved);
            }, 'Handed over')
          }
          onStatus={(value) =>
            act(async () => {
              const saved = await api.patch(`/front-office/courier/${open.id}`, { status: value });
              setOpen(saved);
            })
          }
          onArchive={() => {
            if (!window.confirm('Archive this entry? It leaves the register and stays on the record.')) return;
            act(async () => {
              await api.del(`/front-office/courier/${open.id}`);
              setOpen(null);
            }, 'Archived');
          }}
        />
      )}
    </>
  );
}

/** One parcel: what it is, and the record of it changing hands. */
function CourierPanel({ courier, staff, busy, onClose, onHandOver, onStatus, onArchive }) {
  const [handovers, setHandovers] = useState([]);
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [ack, setAck] = useState(true);
  const [remark, setRemark] = useState('');

  useEffect(() => {
    api
      .get(`/front-office/courier/${courier.id}`)
      .then(({ handovers: list }) => setHandovers(list || []))
      .catch(() => setHandovers([]));
  }, [courier.id, courier.status]);

  const line = (label, value) =>
    value ? (
      <div className="scr-line unknown">
        <span className="scr-mark">·</span>
        <span className="scr-label">{label}</span>
        <span className="scr-said">{value}</span>
      </div>
    ) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="payslip-head">
          <div>
            <h2>{courier.inward_no || courier.direction}</h2>
            <p className="muted">
              {courier.company || '—'} · {courier.status}
            </p>
          </div>
          <div className="no-print"><button onClick={onClose}>Close</button></div>
        </div>

        <div className="scr-lines">
          {line('Received on', `${courier.day} ${courier.at_time || ''}`)}
          {line('AWB / tracking', courier.ref_no)}
          {line(courier.direction === 'Inward' ? 'From' : 'To', courier.party)}
          {line('For', courier.recipient_name)}
          {line('Department', courier.department)}
          {line('Parcel / document', courier.description)}
          {line('Received by', courier.handler)}
          {line('Remark', courier.remark)}
        </div>

        {courier.direction === 'Inward' && (
          <>
            <h3>Hand it over</h3>
            <div className="iv-grid">
              <label className="field">
                Handed to
                <select value={to} onChange={(e) => { setTo(e.target.value); setName(''); }}>
                  <option value="">— somebody —</option>
                  {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
              <label className="field">
                …or a name
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                Remark
                <input value={remark} onChange={(e) => setRemark(e.target.value)} />
              </label>
              <label className="check">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                They acknowledged it
              </label>
            </div>
            <div className="row">
              <span className="muted small">
                Writing this is what marks the parcel delivered — the date and time are now.
              </span>
              <span className="grow" />
              <button
                className="primary"
                disabled={busy || (!to && !name.trim())}
                onClick={() =>
                  onHandOver({
                    to_employee_id: to || undefined,
                    to_name: name.trim() || undefined,
                    acknowledged: ack,
                    remark: remark.trim() || undefined,
                  })
                }
              >
                Hand over
              </button>
            </div>
          </>
        )}

        {handovers.length > 0 && (
          <>
            <h3>What happened to it</h3>
            <table className="sheet fo-table">
              <thead>
                <tr><th>Date</th><th>Time</th><th className="grow">Taken by</th><th>By</th><th>Acknowledged</th><th>Remark</th></tr>
              </thead>
              <tbody>
                {handovers.map((h) => (
                  <tr key={h.id}>
                    <td className="fo-tel">{h.handed_on}</td>
                    <td className="fo-tel">{h.handed_at}</td>
                    <td>{h.employee_name || h.to_name}</td>
                    <td className="small">{h.handed_by}</td>
                    <td className="small">{h.acknowledged ? 'yes' : ''}</td>
                    <td className="small">{h.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <label className="field">
            Status
            <select value={courier.status || ''} onChange={(e) => onStatus(e.target.value)}>
              {COURIER_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <span className="muted small">
            Use <strong>Returned</strong> when it went back to the courier. Delivered is written by
            the handover above.
          </span>
          <span className="grow" />
          <button className="ghost danger" disabled={busy} onClick={onArchive}>Archive</button>
        </div>
      </div>
    </div>
  );
}
