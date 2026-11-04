import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { rupees } from '../../format.js';

const KINDS = ['Travel', 'Food', 'Petrol', 'Lodging', 'Phone', 'Other'];
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Expense claims: travel, food, petrol.
 *
 * Three steps, kept apart on purpose. Raising it records what was spent and
 * changes nobody's pay. **Approving** says it is a real expense. **Paying** says
 * which month it comes out of, and posts it as an addition on that person's row
 * on the salary sheet - on top of whatever addition is already there, never
 * replacing it. A claim cannot be paid without being approved, and paying it
 * twice is refused, so a double click cannot pay a petrol bill twice.
 */
export default function Claims({ employees, period, onError, onReload, only = null }) {
  const [claims, setClaims] = useState([]);
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  /*
   * On one person's file the picker is already answered - there is nobody
   * else on the screen to choose. It is still a picker in the Everyone view.
   */
  const [draft, setDraft] = useState({
    employee_id: only?.id || '',
    kind: 'Petrol',
    spent_on: today(),
    amount: '',
    detail: '',
  });

  const load = async (filter = status) => {
    try {
      const { claims: list } = await api.get(
        `/people/claims${filter ? `?status=${filter}` : ''}${only ? `${filter ? '&' : '?'}employee_id=${only.id}` : ''}`
      );
      setClaims(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const save = async () => {
    if (!draft.employee_id || !(Number(draft.amount) > 0)) return;
    try {
      await api.post('/people/claims', draft);
      setDraft({ ...draft, amount: '', detail: '' });
      setAdding(false);
      load();
    } catch (err) {
      onError(err);
    }
  };

  const decide = async (claim, approve) => {
    const note = approve
      ? undefined
      : window.prompt(`Why is ${claim.employee_name}'s ${claim.kind.toLowerCase()} claim rejected?`, '');
    if (!approve && note === null) return;
    try {
      await api.post(`/people/claims/${claim.id}/decide`, {
        status: approve ? 'approved' : 'rejected',
        note: note || undefined,
      });
      load();
    } catch (err) {
      onError(err);
    }
  };

  const pay = async (claim) => {
    if (!period) {
      onError(new Error('open a month first — a claim is paid out of one'));
      return;
    }
    if (
      !window.confirm(
        `Pay ${rupees(claim.amount)} to ${claim.employee_name} through ${period.label}?\n\n` +
          `It goes on their salary sheet row as an addition, so it reaches them with that month's pay.`
      )
    )
      return;
    try {
      await api.post(`/people/claims/${claim.id}/pay`, { period_id: period.id });
      await load();
      onReload?.();
    } catch (err) {
      onError(err);
    }
  };

  const pending = claims.filter((c) => c.status === 'pending');
  const approved = claims.filter((c) => c.status === 'approved');

  return (
    <section className="stack">
      <div className="figures">
        <div className="figure">
          <span className="k">Waiting</span>
          <span className="n">{pending.length}</span>
        </div>
        <div className="figure">
          <span className="k">Approved, not paid</span>
          <span className="n">{rupees(approved.reduce((s, c) => s + Number(c.amount), 0))}</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="sub-tabs toolbar">
          {[['', 'Everything'], ['pending', 'Waiting'], ['approved', 'Approved'], ['paid', 'Paid'], ['rejected', 'Rejected']].map(
            ([value, label]) => (
              <button key={value} className={status === value ? 'active' : undefined} onClick={() => setStatus(value)}>
                {label}
              </button>
            )
          )}
        </div>
        <button className="ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Raise a claim'}
        </button>
      </div>

      {adding && (
        <div className="card">
          <div className="form-grid">
            <label>
              Who spent it
              <select
                value={draft.employee_id}
                onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}
              >
                <option value="">Pick somebody</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              On what
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label>
              When
              <input
                type="date"
                value={draft.spent_on}
                onChange={(e) => setDraft({ ...draft, spent_on: e.target.value })}
              />
            </label>
            <label>
              How much
              <input
                type="number"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            What for
            <input
              type="text"
              value={draft.detail}
              placeholder="Vadodara to Surat, client visit"
              onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
            />
          </label>
          <button onClick={save} disabled={!draft.employee_id || !(Number(draft.amount) > 0)}>
            Raise it
          </button>
        </div>
      )}

      {!claims.length ? (
        <p className="muted small">No claims.</p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Spent</th>
              <th>Who</th>
              <th>On</th>
              <th className="num">How much</th>
              <th>What for</th>
              <th>Where it stands</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.id}>
                <td>{claim.spent_on}</td>
                <td className="sticky-name">{claim.employee_name}</td>
                <td>{claim.kind}</td>
                <td className="num">{rupees(claim.amount)}</td>
                <td>
                  {claim.detail || '—'}
                  {claim.decision_note && <div className="muted small">{claim.decision_note}</div>}
                </td>
                <td>
                  <span className={`pill ${claim.status}`}>{claim.status}</span>
                  {claim.decided_by && <div className="muted small">by {claim.decided_by}</div>}
                </td>
                <td>
                  {claim.status === 'pending' && (
                    <>
                      <button onClick={() => decide(claim, true)}>Approve</button>{' '}
                      <button className="ghost small" onClick={() => decide(claim, false)}>
                        reject
                      </button>
                    </>
                  )}
                  {claim.status === 'approved' && (
                    <button onClick={() => pay(claim)}>
                      Pay through {period ? period.label : 'a month'}
                    </button>
                  )}
                  {claim.status === 'paid' && (
                    <span className="muted small">paid {String(claim.paid_at || '').slice(0, 10)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
