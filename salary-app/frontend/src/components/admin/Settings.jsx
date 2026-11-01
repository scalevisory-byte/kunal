import { useState } from 'react';
import { DEFAULT_LATE_RULES, POLICY } from '../../../../shared/lateEarly.js';
import { STANDARD_WORKING_DAYS } from '../../../../shared/calc.js';
import { rupees } from '../../format.js';

/**
 * The rules a month is paid on, in one place.
 *
 * They were scattered: the PT slab on the salary sheet, the late/early rule on
 * the Time tab, hours per day nowhere in particular. This is one screen that
 * shows all of them for the open month and says which are fixed.
 *
 * **Every one of these belongs to the month, not to the installation.** That is
 * the whole reason a slab changed in November never rewrites a payslip paid in
 * October, and it is why this screen opens on the open month rather than on
 * "settings" in the abstract.
 */
export default function Settings({ period, locked, onPatch }) {
  const [said, setSaid] = useState('');

  if (!period) {
    return (
      <section className="card">
        <h3>Settings</h3>
        <p className="muted small">
          Open a month first. These are a month&rsquo;s own rules, not the app&rsquo;s — which is
          why changing one never reaches a month already paid.
        </p>
      </section>
    );
  }

  const set = async (patch) => {
    if (locked) return setSaid('That month is closed. Reopen it first.');
    try {
      await onPatch(patch);
      setSaid('Saved.');
    } catch (err) {
      setSaid(err.message);
    }
  };

  const onConcession = String(period.late_policy || POLICY.hours) === POLICY.concession;
  const box = (field, label, type = 'number', hint = '') => (
    <label key={field}>
      {label}
      <input
        type={type}
        defaultValue={period[field] ?? ''}
        key={`${field}-${period[field]}`}
        disabled={locked}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const next = type === 'number' ? Number(raw) : raw;
          if (String(period[field] ?? '') !== String(next)) set({ [field]: next });
        }}
      />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );

  return (
    <section className="stack">
      <div className="card">
        <h3>{period.label}</h3>
        <p className="muted small">
          Every rule here belongs to <strong>this month</strong>. Change one and the months
          already paid keep the rules they were paid on — which is the point.
          {locked && ' This month is closed, so nothing here can be changed until it is reopened.'}
        </p>
      </div>

      <div className="card">
        <h4>The day, and the month</h4>
        <div className="form-grid">
          <label>
            Working days
            <input value={STANDARD_WORKING_DAYS} disabled readOnly />
            <span className="muted small">Fixed. Every month divides by 26.</span>
          </label>
          {box('hours_per_day', 'Hours in a day', 'number', 'Sets the hourly and per-minute rate, and half the half-day line.')}
        </div>
        <p className="muted small">
          26 working days is a constant in the code, not a setting: a 30-day month and a 31-day
          month both divide by 26, so a salary&rsquo;s day rate never moves from one month to the
          next. The API refuses a different number if one is sent.
        </p>
      </div>

      <div className="card">
        <h4>Professional tax</h4>
        <div className="form-grid">
          {box('pt_threshold', 'Charged above', 'number')}
          {box('pt_amount', 'Amount', 'number')}
        </div>
        <p className="muted small">
          Charged on <strong>what the month actually pays</strong> — the gross after absences,
          overtime and adjustments — not on the salary on the master. Sunday duty sits outside it,
          because it is settled on its own register. Currently{' '}
          {rupees(period.pt_amount)} above {rupees(period.pt_threshold)}.
        </p>
      </div>

      <div className="card">
        <h4>Late in and early out</h4>
        <div className="form-grid">
          <label>
            Rule
            <select
              value={onConcession ? POLICY.concession : POLICY.hours}
              disabled={locked}
              onChange={(e) => set({ late_policy: e.target.value })}
            >
              <option value={POLICY.hours}>Hours only — lateness is not charged as such</option>
              <option value={POLICY.concession}>Pool the minutes, charge past the concession</option>
            </select>
          </label>
          {box('shift_in', 'Day starts', 'text')}
          {box('shift_out', 'Day ends', 'text')}
          {box('late_concession_minutes', 'Free minutes a month', 'number')}
          {box('late_grace_minutes', 'Grace a day, minutes', 'number')}
        </div>
        <p className="muted small">
          The two rules are <strong>alternatives, never additions</strong>: somebody half an hour
          late is already half an hour short on the hours rule, so charging the lateness as well
          would take the same half hour twice. The concession is{' '}
          {period.late_concession_minutes ?? DEFAULT_LATE_RULES.concession_minutes} minutes and is{' '}
          {onConcession ? 'being charged' : 'not being charged'} this month. The Time tab prices a
          switch before you make it.
        </p>
      </div>

      {said && <p className="muted small">{said}</p>}
    </section>
  );
}
