import { useState } from 'react';
import {
  DEFAULT_LATE_RULES,
  POLICY,
  POLICY_CHOICES,
  policyWhy,
} from '../../../../shared/lateEarly.js';
import { onMonthlyHours } from '../../../../shared/monthlyHours.js';
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
export default function Settings({ period, locked, onPatch, onGo }) {
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

  /*
   * THE REAL POLICY, not a two-way guess.
   *
   * This read `=== POLICY.concession` and the select below offered exactly
   * two options. Two releases later there were four, so a month running on
   * `monthly_late` rendered as "concession" and touching the box would have
   * switched the month's hours target OFF without a word. Both the value and
   * the options now come from the one list.
   */
  const policy = String(period.late_policy || POLICY.hours);
  const concessionCharged = policy === POLICY.concession || policy === POLICY.monthlyLate;
  const monthlyCharged = onMonthlyHours(period);
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
          <label className="block">
            Rule
            <select
              value={policy}
              disabled={locked}
              onChange={(e) => set({ late_policy: e.target.value })}
            >
              {/* From the one list, so a rule added later cannot go missing
                  off this screen - which is exactly what happened here. */}
              {POLICY_CHOICES.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </select>
            <span className="muted small">{policyWhy(policy)}</span>
          </label>
        </div>
        <div className="form-grid">
          {box('shift_in', 'Day starts', 'text', 'Blank on a person\u2019s record means this.')}
          {box('shift_out', 'Day ends', 'text')}
          {box('late_concession_minutes', 'Free late minutes a month', 'number',
            `${period.late_concession_minutes ?? DEFAULT_LATE_RULES.concession_minutes} now. Only counts while lateness is charged.`)}
          {box('late_grace_minutes', 'Grace a day, minutes', 'number',
            'Zero on purpose: a monthly pool plus a daily allowance gives the same minutes away twice.')}
          {box('monthly_hours_grace', 'The month may fall short by, minutes', 'number',
            'Zero on purpose, for the same reason. Only counts while the month\u2019s total is charged.')}
        </div>
        <p className="muted small">
          <strong>Right now: </strong>
          {monthlyCharged
            ? 'the month owes nine hours for every day each person was due'
            : 'the month\u2019s total is not charged'}
          {' \u00b7 '}
          {concessionCharged ? 'lateness is charged past the concession' : 'lateness is counted only'}.
        </p>
        <p className="muted small">
          <strong>THE SAME MINUTES ARE NEVER CHARGED TWICE.</strong> &ldquo;Each day on its own&rdquo;
          and &ldquo;the month owes a total&rdquo; are alternatives &mdash; somebody an hour short on
          Tuesday is already an hour short in the month&rsquo;s total. The month&rsquo;s total and the
          lateness cap DO run together, and when they do the month is charged the{' '}
          <strong>greater of the two, never the sum</strong>. The Time tab prices any switch before
          you make it.
        </p>
      </div>

      {/*
        * "SETTING TAB ME SAB ADJUST KAR SAKE" - Dinesh.
        *
        * The rules above belong to the MONTH and are changed here. Everything
        * else belongs to a company, a person or the whole app, and is changed
        * where it is used - one screen owns each one, because two screens
        * editing one figure is how two answers come to exist. What was
        * missing was the way IN: this list now opens each of them rather
        * than naming them and leaving somebody to hunt.
        */}
      <div className="card">
        <h4>Set elsewhere &mdash; and where</h4>
        <p className="muted small">
          These are not the month&rsquo;s; they belong to a company, a person or the whole app.
          One screen owns each, so a figure can never read two ways. Open it from here.
        </p>
        <div className="toolbar wrap">
          {[
            ['leave', 'Leave quotas \u2014 CL / SL / PL a year', 'Per person, with one button for everybody on screen.'],
            ['leave', 'The day off, and alternate Saturdays', 'Per company, with people who differ listed under it.'],
            ['leave', 'Leave bonus \u2014 the rule and what breaks it', 'App-wide, held on the server and not in one browser.'],
            ['attendance', 'Festivals and paid holidays', 'Per month, per religion, applied onto the grid.'],
            ['employees', 'Shift times, PF / ESI mode, salary breakup', 'Per person: one can be on a fixed figure while another is computed.'],
            ['assets', 'Asset code prefixes', 'Per company, in the asset settings.'],
          ].map(([tab, label, why]) => (
            <button key={label} className="ghost" onClick={() => onGo?.(tab)} title={why}>
              {label} &rarr;
            </button>
          ))}
        </div>
        {!onGo && (
          <p className="muted small">
            (Open the tab named above &mdash; this build cannot jump there for you.)
          </p>
        )}
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
          {/*
            * PF/ESI mode, weekly off, leave quotas and festivals used to be
            * listed here too - and they ARE settings, just not the month's.
            * They are in "Set elsewhere" above, with a button each. Saying
            * one thing in two places is how the two come to disagree.
            */}
        </ul>
      </div>

      {said && <p className="muted small">{said}</p>}
    </section>
  );
}
