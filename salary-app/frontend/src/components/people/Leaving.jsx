import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { EXIT_TYPES } from '../../../../shared/settlement.js';
import { rupees } from '../../format.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Leaving: the resignation, the notice, and the full and final.
 *
 * The settlement on this page is **assembled, not stored**: the final month's
 * net is the figure the payslip prints, the leave balance is counted off the
 * marks, the loan outstanding comes off the ledger. So it cannot drift from
 * what was actually paid, and it changes if the month does.
 *
 * Two things it will not do. It never deducts an unreturned asset - that is
 * named with its value and somebody decides, because a laptop docked off a
 * final payment and then found in a drawer cannot be undone. And once the
 * settlement is marked paid, the dates behind it stop moving.
 */
export default function Leaving({ employees, onError, onReload }) {
  const [exits, setExits] = useState([]);
  const [picked, setPicked] = useState(null);
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState(null);

  const loadList = async () => {
    try {
      const { exits: list } = await api.get('/people/exits');
      setExits(list);
    } catch (err) {
      onError(err);
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (employeeId) => {
    setPicked(employeeId);
    setDetail(null);
    if (!employeeId) return;
    try {
      const found = await api.get(`/people/exits/${employeeId}`);
      setDetail(found);
      setDraft(null);
    } catch (err) {
      if (err.status === 404) {
        // Nothing recorded yet: start a blank resignation rather than an error.
        setDetail(null);
        setDraft({
          type: 'resigned',
          resigned_on: today(),
          notice_days: 30,
          last_working_day: '',
          reason: '',
        });
      } else {
        onError(err);
      }
    }
  };

  const save = async (patch) => {
    try {
      const saved = await api.put(`/people/exits/${picked}`, patch);
      setDetail(saved);
      setDraft(null);
      await loadList();
      onReload?.();
    } catch (err) {
      onError(err);
    }
  };

  const settle = async () => {
    const net = detail?.settlement?.net ?? 0;
    if (
      !window.confirm(
        `Mark ${detail.employee.name}'s full and final as paid at ${rupees(net)}?\n\n` +
          'After this the dates behind the settlement are fixed.'
      )
    )
      return;
    try {
      const saved = await api.post(`/people/exits/${picked}/settle`, { amount: net });
      setDetail(saved);
      await loadList();
    } catch (err) {
      onError(err);
    }
  };

  const s = detail?.settlement;
  const exit = detail?.exit;
  const paid = Boolean(exit?.settled_on);

  return (
    <section className="stack">
      <div className="toolbar">
        <label>
          Somebody leaving
          <select value={picked || ''} onChange={(e) => open(Number(e.target.value) || null)}>
            <option value="">Pick somebody</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.left_on ? ` — left ${e.left_on}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {draft && (
        <div className="card">
          <h3>Record the resignation</h3>
          <div className="form-grid">
            <label>
              How
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                {EXIT_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Told us on
              <input
                type="date"
                value={draft.resigned_on}
                onChange={(e) => setDraft({ ...draft, resigned_on: e.target.value })}
              />
            </label>
            <label>
              Notice asked for, days
              <input
                type="number"
                value={draft.notice_days}
                onChange={(e) => setDraft({ ...draft, notice_days: e.target.value })}
              />
            </label>
            <label>
              Last working day
              <input
                type="date"
                value={draft.last_working_day}
                onChange={(e) => setDraft({ ...draft, last_working_day: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            Why
            <input
              type="text"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </label>
          <p className="muted small">
            Setting a last working day also takes them off the active list, so next month opens
            without them. It is not the same as paying them — the settlement below is a separate
            step.
          </p>
          <button onClick={() => save(draft)}>Record it</button>
        </div>
      )}

      {detail && s && (
        <>
          <div className="card">
            <div className="late-head">
              <div>
                <h3>{detail.employee.name}</h3>
                <p className="muted small">
                  {exit.type} · told us {exit.resigned_on || '—'} · last day {exit.last_working_day || '—'}
                  {exit.reason ? ` · ${exit.reason}` : ''}
                </p>
              </div>
              {!paid && (
                <button className="ghost" onClick={() => setDraft({ ...exit })}>
                  Change the dates
                </button>
              )}
            </div>

            <div className="figures">
              <div className="figure">
                <span className="k">Service</span>
                <span className="n">
                  {s.service.known ? `${s.service.years}y ${s.service.months}m` : '—'}
                </span>
              </div>
              <div className="figure">
                <span className="k">Notice</span>
                <span className="n">
                  {s.notice.known ? `${s.notice.served}/${s.notice.required}` : '—'}
                </span>
              </div>
              <div className="figure">
                <span className="k">Payable</span>
                <span className="n">{rupees(s.payable)}</span>
              </div>
              <div className="figure">
                <span className="k">To recover</span>
                <span className="n">{rupees(s.recoverable)}</span>
              </div>
              <div className="figure">
                <span className="k">{paid ? 'Paid' : 'Full and final'}</span>
                <span className="n">{rupees(paid ? exit.settled_amount : s.net)}</span>
              </div>
            </div>

            {s.open.length > 0 && (
              <ul className="alerts">
                {s.open.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="two-up">
            <div className="card">
              <h4>To pay</h4>
              <table className="sheet">
                <tbody>
                  {s.pays.map((line) => (
                    <tr key={line.label}>
                      <td>{line.label}</td>
                      <td className="num">{line.missing ? '—' : rupees(line.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td className="num">
                      <strong>{rupees(s.payable)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="card">
              <h4>To recover</h4>
              {s.recovers.length ? (
                <table className="sheet">
                  <tbody>
                    {s.recovers.map((line) => (
                      <tr key={line.label}>
                        <td>{line.label}</td>
                        <td className="num">{rupees(line.amount)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>Total</strong>
                      </td>
                      <td className="num">
                        <strong>{rupees(s.recoverable)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="muted small">Nothing to recover.</p>
              )}
            </div>
          </div>

          <div className="card">
            <h4>Leave encashed</h4>
            <table className="sheet">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th className="num">Quota</th>
                  <th className="num">Taken</th>
                  <th className="num">Left</th>
                  <th className="num">Paid out</th>
                </tr>
              </thead>
              <tbody>
                {s.encashment.lines.map((line) => (
                  <tr key={line.code}>
                    <td>{line.code}</td>
                    <td className="num">{line.quota}</td>
                    <td className="num">{line.taken}</td>
                    <td className="num">{line.left}</td>
                    <td className="num">{line.paid ? line.encashed : <span className="muted">lapses</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Only privilege leave is paid out — casual and sick leave lapse at the end of the year,
              and paying them would hand over days nobody had a claim to. Valued at{' '}
              {rupees(s.per_day)} a day. Gratuity: {s.gratuity.note}
              {s.gratuity.eligible
                ? `, on ${s.gratuity.on} of ${rupees(s.gratuity.wages)} — ${rupees(s.gratuity.amount)}.`
                : '.'}
            </p>
          </div>

          {s.assets_out.length > 0 && (
            <div className="card">
              <h4>Still to come back</h4>
              <table className="sheet">
                <tbody>
                  {s.assets_out.map((asset) => (
                    <tr key={asset.label}>
                      <td>{asset.label}</td>
                      <td className="num">{rupees(asset.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Not deducted. Take it off by hand if you decide to — an asset docked and then found
                in a drawer cannot be undone once the payment has gone.
              </p>
            </div>
          )}

          {!paid ? (
            <button onClick={settle}>Mark the full and final paid at {rupees(s.net)}</button>
          ) : (
            <p className="muted small">
              Paid {exit.settled_on} at {rupees(exit.settled_amount)}.
            </p>
          )}
        </>
      )}

      {exits.length > 0 && (
        <div className="card">
          <h4>Everyone who has left</h4>
          <table className="sheet">
            <thead>
              <tr>
                <th>Last day</th>
                <th>Who</th>
                <th>Company</th>
                <th>How</th>
                <th>Full and final</th>
              </tr>
            </thead>
            <tbody>
              {exits.map((row) => (
                <tr key={row.id}>
                  <td>{row.last_working_day || '—'}</td>
                  <td className="sticky-name">
                    <button className="ghost small" onClick={() => open(row.employee_id)}>
                      {row.employee_name}
                    </button>
                  </td>
                  <td>{row.company_name || '—'}</td>
                  <td>{row.type}</td>
                  <td>
                    {row.settled_on ? (
                      `${rupees(row.settled_amount)} on ${row.settled_on}`
                    ) : (
                      <span className="muted">not settled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
