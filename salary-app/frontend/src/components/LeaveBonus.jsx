import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  BONUS_COLUMNS,
  BONUS_KINDS,
  BREAKABLE,
  normaliseRule,
} from '../../../shared/leaveBonus.js';
import { ATTENDANCE_CODES } from '../../../shared/calc.js';
import { rupees } from '../format.js';
import { col, num, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';

/**
 * The leave bonus — paid for a month somebody took no time off in.
 *
 * Two things this screen is careful about, and says out loud:
 *
 *   **Looking does not pay.** The figures are what the month WOULD pay; the
 *   money reaches a payslip only through the button, which names the month
 *   it goes onto — the same split as an expense claim and a penalty.
 *
 *   **Nothing marked is not a clean month.** Somebody with no marks at all
 *   is never eligible; they are listed apart with the reason, because
 *   otherwise one unfilled grid pays the whole staff a bonus.
 */
export default function LeaveBonus({ period, companyId, onReload }) {
  const [data, setData] = useState(null);
  const [rule, setRule] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');

  const load = async (tryRule) => {
    if (!period) return;
    setError('');
    try {
      const q = [
        companyId ? `company_id=${companyId}` : '',
        tryRule ? `rule=${encodeURIComponent(JSON.stringify(tryRule))}` : '',
      ]
        .filter(Boolean)
        .join('&');
      const out = await api.get(`/leave/bonus/${period.id}${q ? `?${q}` : ''}`);
      setData(out);
      setRule((r) => r || out.saved_rule);
    } catch (err) {
      setError(err.message);
      setData(null);
    }
  };

  useEffect(() => {
    setRule(null);
    load();
  }, [period?.id, companyId]);

  if (!period) return <p className="muted small">Pehle ek mahina kholiye.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data || !rule) return <p className="muted small">Loading…</p>;

  const t = data.totals;
  const change = (patch) => {
    const next = normaliseRule({ ...rule, ...patch });
    setRule(next);
    setSaid('');
    load(next);
  };
  const toggleBreak = (code) => {
    const has = rule.breaks.includes(code);
    /* The last one cannot be unticked: with nothing disqualifying, everybody
       qualifies every month, which is a flat allowance and not a bonus for
       taking no leave. */
    if (has && rule.breaks.length === 1) return;
    change({ breaks: has ? rule.breaks.filter((c) => c !== code) : [...rule.breaks, code] });
  };

  const saveRule = async () => {
    setBusy(true);
    try {
      await api.put('/leave/bonus/rule', rule);
      setSaid('Rule saved — it is the office’s, not this browser’s.');
      await load(rule);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    const lines = data.lines.filter((l) => l.eligible && !l.already_paid);
    if (!lines.length) return;
    if (
      !window.confirm(
        `Pay ${rupees(t.amount)} to ${lines.length} people as an addition on ${period.label}?\n\n` +
          'It goes onto the salary sheet and shows on the payslip. Nothing else changes.'
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const out = await api.post(`/leave/bonus/${period.id}/pay`, {
        lines: lines.map((l) => ({
          employee_id: l.employee_id,
          amount: l.amount,
          days_off: l.days_off,
        })),
        note: 'leave bonus',
      });
      setSaid(out.note);
      await load(rule);
      onReload?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const takeBack = async (payment) => {
    if (!window.confirm(`Take ${payment.employee_name}'s ${rupees(payment.amount)} back off ${period.label}?`)) return;
    setBusy(true);
    try {
      await api.del(`/leave/bonus/payment/${payment.id}`);
      await load(rule);
      onReload?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const print = () =>
    printReport({
      title: 'Leave bonus',
      subtitle: period.label,
      meta: [
        `${t.eligible} of ${t.people} qualify · ${rupees(t.amount)} to pay`,
        `Rule: ${BONUS_KINDS.find(([k]) => k === rule.kind)?.[1]} · ${rupees(rule.amount)}${
          rule.kind === 'graded' ? ` less ${rupees(rule.cut_per_day)} a day` : ''
        }`,
        t.unknown
          ? `${t.unknown} people have nothing marked this month and are NOT counted as clean.`
          : null,
      ].filter(Boolean),
      columns: [
        col('Name', (r) => r.name),
        col('Department', (r) => r.department, '13%'),
        num('Days off', (r) => r.days_off || '', '8%'),
        col('What', (r) => r.why, '34%'),
        num('Bonus', (r) => (r.amount ? rupees(r.amount) : ''), '10%'),
      ],
      rows: data.lines,
      totals: { label: `${t.eligible} qualify`, Bonus: rupees(t.amount + t.paid_amount) },
      empty: 'Nobody in this month.',
      footer:
        'Counted off the same attendance marks the salary sheet is paid from. Working it out pays nobody — the money goes on only through the button that names the month.',
    });

  const clean = data.lines.filter((l) => l.eligible);
  const missed = data.lines.filter((l) => !l.eligible && !l.unknown);
  const unknown = data.lines.filter((l) => l.unknown);

  return (
    <div className="stack">
      <div className="card">
        <h3>The rule</h3>
        <div className="form-grid">
          <label>
            How it pays
            <select value={rule.kind} onChange={(e) => change({ kind: e.target.value })}>
              {BONUS_KINDS.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <span className="muted small">
              {BONUS_KINDS.find(([k]) => k === rule.kind)?.[2]}
            </span>
          </label>
          <label>
            Amount
            <input
              inputMode="numeric"
              value={rule.amount}
              onChange={(e) => change({ amount: e.target.value })}
            />
            <span className="muted small">for a month with nothing against them</span>
          </label>
          {rule.kind === 'graded' ? (
            <label>
              Less, per day off
              <input
                inputMode="numeric"
                value={rule.cut_per_day}
                onChange={(e) => change({ cut_per_day: e.target.value })}
              />
              <span className="muted small">never below zero</span>
            </label>
          ) : null}
        </div>

        <p className="muted small" style={{ marginTop: '0.6rem' }}>
          <strong>Which days cost it.</strong> Paid leave is still a day away, so CL/SL/PL
          count by default — untick any your office pays the bonus through anyway.
        </p>
        <div className="chips">
          {BREAKABLE.map((code) => (
            <button
              key={code}
              className={`chip ${rule.breaks.includes(code) ? 'active' : ''}`}
              disabled={rule.breaks.length === 1 && rule.breaks.includes(code)}
              title={
                rule.breaks.length === 1 && rule.breaks.includes(code)
                  ? 'At least one has to cost the bonus, or everybody qualifies every month'
                  : undefined
              }
              onClick={() => toggleBreak(code)}
            >
              {ATTENDANCE_CODES[code]?.label || code}
            </button>
          ))}
        </div>
        <label className="inline" style={{ marginTop: '0.5rem' }}>
          <input
            type="checkbox"
            checked={rule.half_counts_half}
            onChange={(e) => change({ half_counts_half: e.target.checked })}
          />{' '}
          A half day counts as half a day off
        </label>

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button disabled={busy} onClick={saveRule}>Save this rule</button>
          <span className="muted small">
            {said || 'Changing it above only re-prices the month — nothing is saved until you press Save.'}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="late-head">
          <div>
            <h2>Leave bonus — {period.label}</h2>
            <p className="muted small">
              What this month <strong>would</strong> pay. Working it out pays nobody — the
              money reaches a payslip only through the button below, which puts it on the
              salary sheet as an addition with a note.
            </p>
          </div>
          <span className="grow" />
          <button onClick={print}>Print</button>
          <button
            className="ghost"
            onClick={() => saveCsv(`Leave-bonus-${period.label}.csv`, BONUS_COLUMNS, data.lines)}
          >
            CSV
          </button>
        </div>

        <div className="stat-row">
          <Fig label="Qualify" value={t.eligible} strong />
          <Money label="To pay" value={t.amount} strong />
          <Fig label="Missed it" value={missed.length} />
          <Fig label="Nothing marked" value={t.unknown} />
          {t.already_paid ? <Money label="Already paid" value={t.paid_amount} /> : null}
        </div>

        {t.unknown ? (
          <p className="warn small">
            <strong>{t.unknown} people have nothing marked this month</strong>, so they are not
            counted as having taken no leave — an unfilled grid would otherwise pay the whole
            staff. Mark the month first, then run this again.
          </p>
        ) : null}

        <div className="row">
          <button className="primary" disabled={busy || !t.to_pay || data.locked} onClick={pay}>
            {data.locked
              ? `${period.label} is closed`
              : t.to_pay
                ? `Pay ${rupees(t.amount)} to ${t.to_pay} people`
                : 'Nothing left to pay'}
          </button>
          {t.already_paid ? (
            <span className="muted small">
              {t.already_paid} already paid this month and will not be paid again.
            </span>
          ) : null}
        </div>

        <table className="sheet">
          <thead>
            <tr>
              <th>Name</th>
              <th>Department</th>
              <th className="num">Days off</th>
              <th>What</th>
              <th className="num">Bonus</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...clean, ...missed, ...unknown].map((l) => {
              const payment = data.payments.find((p) => p.employee_id === l.employee_id);
              return (
                <tr key={l.employee_id} className={l.unknown ? 'r3' : undefined}>
                  <td>
                    {l.name}
                    {l.code ? <span className="muted small"> · {l.code}</span> : null}
                  </td>
                  <td className="small">{l.department}</td>
                  <td className="num">{l.days_off || ''}</td>
                  <td className="small">{l.why}</td>
                  <td className="num strong">{l.amount ? rupees(l.amount) : ''}</td>
                  <td>
                    {payment ? (
                      <>
                        <span className="muted small">paid</span>{' '}
                        <button className="ghost tiny" disabled={busy} onClick={() => takeBack(payment)}>
                          take back
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!data.lines.length && (
              <tr><td colSpan={6} className="empty">Nobody in this month.</td></tr>
            )}
          </tbody>
        </table>

        <p className="muted small">
          Counted off the <strong>same attendance marks the salary sheet is paid from</strong>,
          so this and the payslip cannot disagree about who was in. Unused leave is a different
          thing — pay that from <strong>Balances → Encash days</strong>.
        </p>
      </div>
    </div>
  );
}

function Fig({ label, value, strong }) {
  return (
    <div className="stat plain">
      <span className={`value${strong ? ' strong' : ''}`}>{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

function Money({ label, value, strong }) {
  return (
    <div className="stat plain">
      <span className={`value${strong ? ' strong' : ''}`}>{rupees(value)}</span>
      <span className="label">{label}</span>
    </div>
  );
}
