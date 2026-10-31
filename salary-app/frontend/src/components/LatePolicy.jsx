import { useMemo, useState } from 'react';
import { DEFAULT_LATE_RULES, POLICY } from '../../../shared/lateEarly.js';
import { formatDuration } from '../../../shared/timesheet.js';
import { rupees as money } from '../format.js';

/**
 * The month's late/early policy, and what switching it would cost.
 *
 * Dinesh's own rule: "300-minute monthly late/early concession". Every minute
 * late in and every minute left early is counted, pooled for the month, the
 * first 300 are free, and the excess comes off the pay at the minute rate.
 *
 * It is **off** until somebody turns it on, and this panel exists so that the
 * decision is taken with the number in front of it: the rows already carry
 * `late_computed`, which is what the rule would charge whether or not it is
 * being applied, so the preview is the real figure for this month and not an
 * estimate. Held per month, so turning it on in November never rewrites a
 * payslip already paid in October.
 */
export default function LatePolicy({ period, rows, onPatch, locked }) {
  const [open, setOpen] = useState(false);
  const on = String(period.late_policy || POLICY.hours) === POLICY.concession;

  const preview = useMemo(() => {
    const out = { people: [], charge: 0, minutes: 0, judged: 0, unknown: 0 };
    for (const row of rows) {
      if (row.late_total_minutes > 0 || row.late_days || row.early_days) {
        out.minutes += row.late_total_minutes || 0;
      }
      if (row.judged_days === 0) out.unknown++;
      const amount = Number(row.late_computed) || 0;
      if (amount > 0) {
        out.people.push(row);
        out.charge += amount;
      }
    }
    out.people.sort((a, b) => (b.late_computed || 0) - (a.late_computed || 0));
    return out;
  }, [rows]);

  const set = (patch) => {
    if (locked) return;
    onPatch(patch);
  };

  return (
    <section className="card">
      <div className="late-head">
        <div>
          <h3>Late and early</h3>
          <p className="muted small">
            {on ? (
              <>
                Charged: every minute late in or left early is pooled for the month,{' '}
                {formatDuration(period.late_concession_minutes ?? DEFAULT_LATE_RULES.concession_minutes)} free,
                the rest off the pay.
              </>
            ) : (
              <>
                Counted but not charged. Lateness only costs money today if it made the day short
                of its hours.
              </>
            )}
          </p>
        </div>
        <button type="button" className="ghost" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Set the rule'}
        </button>
      </div>

      <div className="figures">
        <div className="figure">
          <span className="k">This month, late or early</span>
          <span className="n">{formatDuration(preview.minutes) || '0m'}</span>
        </div>
        <div className="figure">
          <span className="k">Over the concession</span>
          <span className="n">{preview.people.length} {preview.people.length === 1 ? 'person' : 'people'}</span>
        </div>
        <div className="figure">
          <span className="k">{on ? 'Charged' : 'Would be charged'}</span>
          <span className="n">{money(preview.charge)}</span>
        </div>
      </div>

      {open && (
        <>
          <div className="form-grid">
            <label>
              Rule
              <select
                value={on ? POLICY.concession : POLICY.hours}
                disabled={locked}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === POLICY.concession && preview.charge > 0) {
                    const ok = window.confirm(
                      `This charges ${money(preview.charge)} across ${preview.people.length} ` +
                        `${preview.people.length === 1 ? 'person' : 'people'} this month. Turn it on?`
                    );
                    if (!ok) return;
                  }
                  set({ late_policy: next });
                }}
              >
                <option value={POLICY.hours}>Hours only — lateness is not charged as such</option>
                <option value={POLICY.concession}>
                  Pool late and early minutes, charge past the concession
                </option>
              </select>
            </label>
            <label>
              Day starts
              <input
                type="text"
                defaultValue={period.shift_in || DEFAULT_LATE_RULES.shift_in}
                key={`in-${period.shift_in}`}
                disabled={locked}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== period.shift_in) set({ shift_in: v });
                }}
              />
            </label>
            <label>
              Day ends
              <input
                type="text"
                defaultValue={period.shift_out || DEFAULT_LATE_RULES.shift_out}
                key={`out-${period.shift_out}`}
                disabled={locked}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== period.shift_out) set({ shift_out: v });
                }}
              />
            </label>
            <label>
              Concession, minutes a month
              <input
                type="number"
                min="0"
                defaultValue={period.late_concession_minutes ?? DEFAULT_LATE_RULES.concession_minutes}
                key={`c-${period.late_concession_minutes}`}
                disabled={locked}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== Number(period.late_concession_minutes))
                    set({ late_concession_minutes: Math.max(0, v) });
                }}
              />
            </label>
            <label>
              Grace a day, minutes
              <input
                type="number"
                min="0"
                defaultValue={period.late_grace_minutes ?? 0}
                key={`g-${period.late_grace_minutes}`}
                disabled={locked}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== Number(period.late_grace_minutes))
                    set({ late_grace_minutes: Math.max(0, v) });
                }}
              />
            </label>
          </div>

          <p className="muted small">
            A grace on top of the monthly pool gives the same minutes away twice, so it is zero
            unless you set it. Somebody who works other hours can carry their own shift on their
            employee record — a night shift judged against{' '}
            {period.shift_in || DEFAULT_LATE_RULES.shift_in} would read as late every single day.
            Nothing is charged for a day with no clock time on it: that is <em>not known</em>, not
            <em> on time</em>.
            {preview.unknown > 0 && (
              <>
                {' '}
                {preview.unknown} of {rows.length} have no clock times this month at all.
              </>
            )}
          </p>

          {preview.people.length > 0 && (
            <table className="sheet">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Late</th>
                  <th className="num">Early</th>
                  <th className="num">Free</th>
                  <th className="num">Charged</th>
                  <th className="num">{on ? 'Deducted' : 'Would deduct'}</th>
                </tr>
              </thead>
              <tbody>
                {preview.people.map((row) => (
                  <tr key={row.employee_id}>
                    <td className="sticky-name">{row.employee_name}</td>
                    <td className="num">{formatDuration(row.late_minutes) || '—'}</td>
                    <td className="num">{formatDuration(row.early_minutes) || '—'}</td>
                    <td className="num">{formatDuration(row.late_concession_minutes)}</td>
                    <td className="num">{formatDuration(row.late_chargeable_minutes)}</td>
                    <td className="num">{money(row.late_computed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
