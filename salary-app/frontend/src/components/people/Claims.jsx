import { useEffect, useMemo, useState } from 'react';
import { col, num, printReport } from '../../printReport.js';
import { STANDALONE, api, download } from '../../api.js';
import { rupees } from '../../format.js';
import { onStaff } from '../../onStaff.js';
import { todayIso } from '../../../../shared/today.js';

const KINDS = ['Travel', 'Food', 'Petrol', 'Lodging', 'Phone', 'Other'];
const today = () => todayIso();

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
  // The category being looked at. Stored as typed - older rows say "petrol",
  // newer ones "Petrol" - so they are grouped without regard to case.
  const [cat, setCat] = useState('');
  const [adding, setAdding] = useState(false);
  // The bill behind it, chosen on the form and attached once the claim exists.
  const [voucher, setVoucher] = useState(null);
  const [fileKey, setFileKey] = useState(0);
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
      const made = await api.post('/people/claims', draft);
      // A file needs a row to hang on, so it goes on once the claim is made.
      if (voucher && made?.id) await attach(made, voucher, { quiet: true });
      setDraft({ ...draft, amount: '', detail: '' });
      setVoucher(null);
      setFileKey((k) => k + 1);
      setAdding(false);
      load();
    } catch (err) {
      onError(err);
    }
  };

  /* The bill behind a claim - a petrol slip, a hotel invoice. Dinesh:
     "yaha pe voucher attach karne ka option do". */
  const attach = async (claim, file, { quiet = false } = {}) => {
    const form = new FormData();
    form.append('file', file);
    try {
      await api.upload(`/people/claims/${claim.id}/voucher`, form);
      if (!quiet) load();
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

  /**
   * THE CLAIMS REGISTER.
   *
   * What was spent, who decided, and — the column that matters at month end
   * — **which month it was actually paid through**. A claim approved is not
   * a claim paid; the money reaches somebody only through a named month, as
   * an addition on that row, which is the rule the panel is built on.
   */
  const printIt = () => {
    const names = [...new Set(claims.map((c) => c.company_name).filter(Boolean))];
    const sum = (list) => list.reduce((t, c) => t + (Number(c.amount) || 0), 0);
    const paid = claims.filter((c) => c.status === 'paid');
    printReport({
      title: 'Expense claims',
      subtitle: [
        names.length === 1 ? names[0] : 'All companies',
        status ? `only ${status}` : 'every status',
      ].join(' · '),
      meta: [
        `${claims.length} ${claims.length === 1 ? 'claim' : 'claims'} · ${rupees(sum(claims))}`,
        `${pending.length} waiting · ${rupees(sum(approved))} approved and not yet paid`,
        paid.length ? `${rupees(sum(paid))} paid` : '',
      ].filter(Boolean),
      landscape: true,
      columns: [
        col('#', (_c, i) => i + 1, '3%'),
        col('Spent on', (c) => c.spent_on || ''),
        col('Who', (c) => c.employee_name),
        col('What for', (c) => c.kind || ''),
        col('Detail', (c) => c.detail || ''),
        num('How much', (c) => rupees(c.amount)),
        col('Where it stands', (c) => c.status),
        col('Decided by', (c) => c.decided_by || ''),
        col('Note on the decision', (c) => c.decision_note || ''),
        col('Paid through', (c) => c.paid_period_label || (c.paid_at ? String(c.paid_at).slice(0, 10) : '')),
      ],
      rows: claims,
      totals: { label: `Total (${claims.length})`, 'How much': rupees(sum(claims)) },
      footer:
        'An approved claim is not a paid claim: money reaches somebody only when it is paid through a named month, as an addition on that month’s row. A claim cannot be paid twice, and a rejected one is recorded with its reason rather than deleted.',
    });
  };

  const catKey = (k) => String(k || 'other').trim().toLowerCase();
  const byCategory = useMemo(() => {
    const m = new Map();
    for (const c of claims) {
      const key = catKey(c.kind);
      const at = m.get(key) || { key, label: key.charAt(0).toUpperCase() + key.slice(1), amount: 0, count: 0 };
      at.amount += Number(c.amount || 0);
      at.count += 1;
      m.set(key, at);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [claims]);
  const shownClaims = cat ? claims.filter((c) => catKey(c.kind) === cat) : claims;

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

      {byCategory.length > 1 && (
        <div className="cl-cats" role="group" aria-label="By category">
          <button type="button" className={!cat ? 'on' : undefined} onClick={() => setCat('')}>
            <span>All categories</span>
            <b>{rupees(claims.reduce((t, c) => t + Number(c.amount || 0), 0))}</b>
            <em>{claims.length}</em>
          </button>
          {byCategory.map((c) => (
            <button type="button" key={c.key} className={cat === c.key ? 'on' : undefined} onClick={() => setCat(cat === c.key ? '' : c.key)}>
              <span>{c.label}</span>
              <b>{rupees(c.amount)}</b>
              <em>{c.count}</em>
            </button>
          ))}
        </div>
      )}

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
        <button className="ghost" onClick={printIt} disabled={!claims.length}>
          Print {claims.length}
        </button>
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
                {onStaff(employees).map((e) => (
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
          {!STANDALONE ? (
            <label className="block">
              Voucher <span className="muted small">— the bill or receipt, a PDF or a photo (optional)</span>
              <input
                key={fileKey}
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setVoucher(e.target.files?.[0] || null)}
              />
            </label>
          ) : null}
          <button onClick={save} disabled={!draft.employee_id || !(Number(draft.amount) > 0)}>
            Raise it
          </button>
        </div>
      )}

      {!shownClaims.length ? (
        <p className="muted small">{claims.length ? 'None in that category.' : 'No claims.'}</p>
      ) : (
        <table className="sheet">
          <thead>
            <tr>
              <th>Spent</th>
              <th>Who</th>
              <th>On</th>
              <th className="num">How much</th>
              <th>What for</th>
              <th>Voucher</th>
              <th>Where it stands</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shownClaims.map((claim) => (
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
                  {claim.has_voucher ? (
                    <button
                      className="link"
                      onClick={() =>
                        download(`/people/claims/${claim.id}/voucher`, claim.voucher_name || 'voucher').catch(onError)
                      }
                    >
                      📎 {claim.voucher_name || 'voucher'}
                    </button>
                  ) : STANDALONE ? (
                    <span className="muted small">—</span>
                  ) : (
                    <label className="linkish small">
                      attach
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => e.target.files?.[0] && attach(claim, e.target.files[0])}
                      />
                    </label>
                  )}
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
