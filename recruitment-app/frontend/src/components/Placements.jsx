import { useState } from 'react';
import { api } from '../api.js';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * Step 7, the only place money appears. The candidate pays nothing, ever -
 * this is what the hiring company owes once somebody actually starts.
 */
export default function Placements({ placements, defaults, joinable, onReload, onExport, onError, onToast }) {
  const [draft, setDraft] = useState({ application_id: '', ctc: '', joined_on: '', fee_percent: '' });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post('/placements', {
        application_id: Number(draft.application_id),
        ctc: Number(draft.ctc) || 0,
        joined_on: draft.joined_on || undefined,
        fee_percent: draft.fee_percent === '' ? undefined : Number(draft.fee_percent),
      });
      setDraft({ application_id: '', ctc: '', joined_on: '', fee_percent: '' });
      onToast('Placement recorded');
      onReload();
    } catch (err) {
      onError(err);
    }
  };

  const set = async (id, body) => {
    try {
      await api.patch(`/placements/${id}`, body);
      onReload();
    } catch (err) {
      onError(err);
    }
  };

  const earned = placements.reduce((s, p) => s + (p.fee_amount || 0), 0);
  const received = placements
    .filter((p) => p.invoice_status === 'paid')
    .reduce((s, p) => s + (p.fee_amount || 0), 0);

  return (
    <>
      <div className="card">
        <div className="figures">
          <div className="figure">
            <span className="n">{placements.length}</span>
            <span className="k">Placed</span>
          </div>
          <div className="figure">
            <span className="n">{inr(earned)}</span>
            <span className="k">Fee earned</span>
          </div>
          <div className="figure">
            <span className="n">{inr(received)}</span>
            <span className="k">Received</span>
          </div>
          <div className="figure">
            <span className="n">{inr(earned - received)}</span>
            <span className="k">To collect</span>
          </div>
        </div>
      </div>

      <form className="card" onSubmit={save}>
        <h3>Record a placement</h3>
        {!joinable.length ? (
          <p className="muted small">
            Nobody has reached Selected or Joined yet. Move somebody there first — a fee is
            earned when a person actually starts.
          </p>
        ) : (
          <>
            <div className="grid">
              <label className="field">
                Who
                <select
                  value={draft.application_id}
                  required
                  onChange={(e) => setDraft({ ...draft, application_id: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {joinable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.candidate_name} — {a.job_title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Annual CTC
                <input
                  type="number"
                  value={draft.ctc}
                  required
                  placeholder="264000"
                  onChange={(e) => setDraft({ ...draft, ctc: e.target.value })}
                />
              </label>
              <label className="field">
                Joined on
                <input
                  type="date"
                  value={draft.joined_on}
                  onChange={(e) => setDraft({ ...draft, joined_on: e.target.value })}
                />
              </label>
              <label className="field">
                Fee %
                <input
                  type="number"
                  step="0.01"
                  value={draft.fee_percent}
                  placeholder={String(defaults?.fee_percent ?? '')}
                  onChange={(e) => setDraft({ ...draft, fee_percent: e.target.value })}
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: '0.7rem' }}>
              <button className="primary" type="submit">
                Save
              </button>
              <span className="muted small">
                {defaults?.fee_percent}% of {defaults?.fee_basis === 'monthly' ? "one month's salary" : 'annual CTC'},
                {' '}plus {defaults?.gst_percent}% GST, with a {defaults?.replacement_days}-day replacement window.
              </span>
            </div>
          </>
        )}
      </form>

      <div className="card scroll">
        <div className="row" style={{ marginBottom: '0.6rem' }}>
          <h2 style={{ margin: 0 }}>Placed</h2>
          <span className="spacer" />
          <button onClick={onExport}>Export CSV</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Job</th>
              <th>Client</th>
              <th>Joined</th>
              <th className="num">CTC</th>
              <th className="num">Fee</th>
              <th className="num">GST</th>
              <th>Invoice</th>
              <th>Replacement until</th>
            </tr>
          </thead>
          <tbody>
            {placements.map((p) => (
              <tr key={p.id}>
                <td className="name-cell">{p.candidate_name}</td>
                <td className="small">{p.job_title}</td>
                <td className="small">{p.client_company || '—'}</td>
                <td className="num small">{p.joined_on || '—'}</td>
                <td className="num">{inr(p.ctc)}</td>
                <td className="num">{inr(p.fee_amount)}</td>
                <td className="num">{inr(p.gst_amount)}</td>
                <td>
                  <select
                    value={p.invoice_status}
                    onChange={(e) => set(p.id, { invoice_status: e.target.value })}
                  >
                    {['not raised', 'raised', 'paid', 'written off'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="num small">{p.replacement_until || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!placements.length ? <p className="empty">No placements yet.</p> : null}
      </div>
    </>
  );
}
