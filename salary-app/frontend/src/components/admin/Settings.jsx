import { useState } from 'react';
import { DEFAULT_LATE_RULES, POLICY } from '../../../../shared/lateEarly.js';
import { STANDARD_WORKING_DAYS } from '../../../../shared/calc.js';
import { rupees } from '../../format.js';

import { formatDuration, timesToDay } from '../../../../shared/timesheet.js';
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

  /* What the usual day comes to, against the day this month is paid on. */
  const usual = timesToDay(
    {
      in_time: period.shift_in,
      lunch_out: period.shift_lunch_out,
      lunch_in: period.shift_lunch_in,
      out_time: period.shift_out,
    },
    { hoursPerDay: period.hours_per_day, deductLunch: !period.lunch_paid },
  );

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
          {/*
            * The lunch question belongs NEXT TO "hours in a day", because
            * the two together are what a day is worth. It is on the Time tab
            * as well, where somebody typing hours stands - but somebody
            * looking for a setting comes here, and a setting that is only on
            * the screen that uses it is a setting nobody finds.
            */}
          <label className="field inline">
            <input
              type="checkbox"
              checked={!!period.lunch_paid}
              disabled={locked}
              onChange={(e) => set({ lunch_paid: e.target.checked ? 1 : 0 })}
            />
            Lunch is inside the day
            <span className="muted small">
              {period.lunch_paid
                ? 'Lunch times are recorded and not taken off the hours worked.'
                : 'Lunch times are taken off the hours worked.'}
            </span>
          </label>
        </div>
        <p className="muted small">
          <strong>&ldquo;9 hrs including lunch&rdquo;</strong> means this box is ticked: the break is
          recorded on the day but the hours are not reduced by it. Untick it for an office that stops
          the clock for lunch. Held per month, so changing it in December cannot rewrite October, and
          a day already saved is only recomputed when it is saved again.
        </p>
        <p className="muted small">
          26 working days is a constant in the code, not a setting: a 30-day month and a 31-day
          month both divide by 26, so a salary&rsquo;s day rate never moves from one month to the
          next. The API refuses a different number if one is sent.
        </p>
      </div>

      {/*
        * The office's usual day, as a SETTING.
        *
        * The lunch halves used to live in localStorage only, so the usual
        * day was whatever each PC remembered: two people filling the same
        * month on two machines worked to two different days, and neither
        * could see or change it here. Dinesh asked for every configuration
        * to be settable in one place, and this was the one that was not.
        */}
      <div className="card">
        <h4>The usual day</h4>
        <div className="form-grid">
          {box('shift_in', 'Comes in', 'text', 'Only a starting point for "Fill the usual timings".')}
          {box('shift_lunch_out', 'Lunch from', 'text', 'Leave both blank if lunch is not timed.')}
          {box('shift_lunch_in', 'Lunch to', 'text')}
          {box('shift_out', 'Goes home', 'text')}
        </div>
        <p className={usual.minutes === 0 ? 'muted small' : 'small warn-text'}>
          That is <strong>{formatDuration(usual.worked || 0)}</strong> of work
          {period.lunch_paid ? ' (the lunch is inside it, not deducted)' : ' after the lunch is taken off'}
          {usual.minutes === 0
            ? `, which is exactly the ${formatDuration(usual.expected)} day.`
            : usual.minutes < 0
              ? ` — ${formatDuration(-usual.minutes)} SHORT of the ${formatDuration(usual.expected)} day, so every day filled from it is docked that much.`
              : ` — ${formatDuration(usual.minutes)} OVER the ${formatDuration(usual.expected)} day, so every day filled from it is paid that as overtime.`}{' '}
          Nobody is judged by WHEN they came in: short hours are worked out from how long they
          stayed, so 08:00 to 17:00 and 11:00 to 20:00 both complete the day.
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

      <div className="card">
        <h4>What is deliberately not a setting</h4>
        <ul className="muted small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
          <li>
            <strong>26 working days.</strong> A constant in the code, so a 30-day month and a
            31-day month divide by the same number and a day rate never moves. The API refuses a
            different figure.
          </li>
          <li>
            <strong>The half-day line.</strong> Half of the hours above, worked out rather than
            typed, so the two cannot disagree. Change the hours and it follows.
          </li>
          <li>
            <strong>Sunday pay.</strong> Settled on its own register at a day rate, never added
            into the salary, so there is nothing to configure.
          </li>
          <li>
            <strong>PF, ESI and PT rules.</strong> Per employee, on the Salary structure and
            Contributions panels, because one person can be on a fixed figure while another is on
            the computed rule.
          </li>
          <li>
            <strong>Weekly off, leave quotas and festivals.</strong> Under Leave and on the
            attendance grid — they are per company or per person, not per month.
          </li>
        </ul>
      </div>

      {said && <p className="muted small">{said}</p>}
    </section>
  );
}
