import { useState } from 'react';
import { api } from '../api.js';
import { DEFAULT_RULES } from '../../../shared/leaveYearEnd.js';
import { days } from '../format.js';
import { col, num, printReport } from '../printReport.js';

/**
 * THE END OF A LEAVE YEAR: what carries, what lapses.
 *
 * Dinesh's brief asks for carry-forward with a cap and an expiry.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HAPPENS BY ITSELF. There is no year-end job. Somebody opens this,
 * reads what it would do to every person by name, and presses the button.
 * A balance that moved overnight because the calendar turned is a balance
 * nobody can explain to the person it belongs to.
 * ---------------------------------------------------------------------------
 *
 * A PREVIEW BEFORE IT IS AN ACTION, and the same plan is what gets posted -
 * so what was read is exactly what happens.
 */
export default function LeaveYearEnd({ year, companyId, onDone, onError }) {
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const look = async () => {
    setBusy(true);
    setDone('');
    try {
      setPlan(
        await api.get(
          `/leave/year-end/${year}?rules=${encodeURIComponent(JSON.stringify(rules))}` +
            (companyId ? `&company_id=${companyId}` : '')
        )
      );
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (again = false) => {
    if (
      !window.confirm(
        `Carry ${days(plan.totals.carried)} day(s) into ${Number(year) + 1} and lapse ` +
          `${days(plan.totals.lapsed)}, across ${plan.totals.people} people?\n\n` +
          'Each entry goes on the ledger and can be taken off one at a time, but there is no undo for the run.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const got = await api.post(`/leave/year-end/${year}`, { rules, company_id: companyId, again });
      setDone(`${got.posted} entries posted.`);
      setPlan(got.plan);
      onDone?.();
    } catch (err) {
      /* Already run is a 409 that names how many entries are there. Offered
         as a deliberate second run rather than silently doubling. */
      if (/already been run/.test(err.message) && window.confirm(`${err.message}\n\nRun it again anyway?`)) {
        return apply(true);
      }
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    if (!plan) return;
    printReport({
      title: `Leave carried forward — end of ${year}`,
      meta: [
        `${plan.totals.people} people`,
        `${days(plan.totals.carried)} day(s) carried · ${days(plan.totals.lapsed)} lapsed`,
        plan.totals.owing ? `${plan.totals.owing} with leave taken beyond the entitlement` : null,
      ].filter(Boolean),
      columns: [
        col('Code', (r) => r.code, '9%'),
        col('Name', (r) => r.name, '22%'),
        col('Leave', (r) => r.code, '8%'),
        num('Closing', (r) => days(r.closing), '9%'),
        num('Carried', (r) => days(r.carried), '9%'),
        num('Lapsed', (r) => days(r.lapsed), '9%'),
        col('Why', (r) => r.why),
      ],
      rows: plan.rows,
      footer: 'Taken from each ledger’s own closing balance. Nothing here was worked out twice.',
    });
  };

  return (
    <div className="stack">
      <div className="card narrow">
        <h3>End of {year}</h3>
        <p className="muted small">
          What is left at the end of the year either <strong>carries</strong> into next year, up
          to a cap, or <strong>lapses</strong>. Nothing happens by itself — read what it would do
          and then press the button.
        </p>
        <table className="sheet">
          <thead>
            <tr><th>Leave</th><th>Carries?</th><th className="num">Up to</th><th>Why</th></tr>
          </thead>
          <tbody>
            {Object.entries(rules).map(([code, rule]) => (
              <tr key={code}>
                <td><strong>{code}</strong></td>
                <td>
                  <label className="ef-check">
                    <input
                      type="checkbox"
                      checked={!!rule.carry}
                      onChange={(e) =>
                        setRules({ ...rules, [code]: { ...rule, carry: e.target.checked } })
                      }
                    />
                    <span>{rule.carry ? 'carries' : 'lapses'}</span>
                  </label>
                </td>
                <td className="num">
                  <input
                    style={{ width: '5rem' }}
                    inputMode="decimal"
                    disabled={!rule.carry}
                    value={rule.max ?? ''}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        [code]: { ...rule, max: e.target.value === '' ? null : Number(e.target.value) },
                      })
                    }
                  />
                </td>
                <td className="muted small">{rule.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button className="primary" disabled={busy} onClick={look}>
            {busy ? 'Working it out…' : 'Show me what it would do'}
          </button>
          {done ? <span className="muted small">{done}</span> : null}
        </div>
      </div>

      {plan ? (
        <div className="card">
          <div className="row">
            <h3>What it would do</h3>
            <span className="grow" />
            <button onClick={print}>Print</button>
          </div>
          <div className="stat-row">
            <div className="stat plain"><span className="value">{plan.totals.people}</span><span className="label">People</span></div>
            <div className="stat plain"><span className="value">{days(plan.totals.carried)}</span><span className="label">Days carried</span></div>
            <div className="stat plain"><span className="value">{days(plan.totals.lapsed)}</span><span className="label">Days lapsed</span></div>
            <div className="stat plain">
              <span className="value" style={plan.totals.owing ? { color: 'var(--bad)' } : undefined}>
                {plan.totals.owing}
              </span>
              <span className="label">Taken beyond entitlement</span>
            </div>
          </div>

          <div className="table-wrap">
            <table className="sheet wide">
              <thead>
                <tr>
                  <th className="sticky-name">Name</th>
                  <th>Leave</th>
                  <th className="num">Closing</th>
                  <th className="num">Carries</th>
                  <th className="num">Lapses</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, i) => (
                  <tr key={`${r.employee_id}-${r.code}-${i}`} className={r.skipped ? 'r0' : undefined}>
                    <td className="sticky-name">{r.name}</td>
                    <td>{r.code}</td>
                    <td className="num">{days(r.closing)}</td>
                    <td className="num strong">{r.carried ? days(r.carried) : '—'}</td>
                    <td className={`num${r.lapsed ? ' deduct' : ''}`}>{r.lapsed ? days(r.lapsed) : '—'}</td>
                    <td className="muted small">{r.why}</td>
                  </tr>
                ))}
                {!plan.rows.length && (
                  <tr><td colSpan={6} className="empty">Nothing to carry and nothing to lapse.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button className="primary" disabled={busy || !plan.rows.length} onClick={() => apply(false)}>
              {busy ? 'Posting…' : 'Do it'}
            </button>
          </div>
          <p className="muted small">
            <strong>A negative balance is left alone.</strong> Leave taken beyond the entitlement
            is a debt somebody has to decide about — carrying it as a negative opening would hide
            that decision, and zeroing it would forgive it.
          </p>
        </div>
      ) : null}
    </div>
  );
}
