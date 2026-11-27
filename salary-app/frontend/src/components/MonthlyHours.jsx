import { useMemo, useState } from 'react';
import { POLICY } from '../../../shared/lateEarly.js';
import { onMonthlyHours } from '../../../shared/monthlyHours.js';
import { formatDuration } from '../../../shared/timesheet.js';
import { rupees as money } from '../format.js';

/**
 * THE MONTH'S HOURS, AS ONE ACCOUNT PER PERSON.
 *
 * Dinesh: *"monthly hour full salary k liye 9*26 hone chiaye / agar monthly
 * 234 hour nhi ho raha he to salry dedct hoga"*.
 *
 * It shows the figure whether or not the month is set to charge on it - the
 * rows carry `monthly_hours_*` on every policy, exactly as the late/early
 * line does, so a switch can be priced before it is made rather than
 * discovered on a payslip.
 *
 * THE TOTAL IS NOT A FLAT 234. It is nine hours times the days that were
 * actually owed: somebody absent two days owes 24 × 9, because those two
 * days have already come off as absences. A flat target would dock them
 * twice for one absence.
 */

const hm = (minutes) => formatDuration(Math.abs(Math.round(Number(minutes) || 0)));

export default function MonthlyHours({ period, rows, locked, onPatch }) {
  const [open, setOpen] = useState(false);
  const on = onMonthlyHours(period);

  const lines = useMemo(() => {
    const out = rows
      .filter((r) => r.monthly_hours_judged)
      .map((r) => ({
        id: r.employee_id,
        name: r.employee_name || r.name,
        days: r.monthly_hours_days || 0,
        owed: r.monthly_hours_expected || 0,
        worked: r.monthly_hours_worked || 0,
        diff: r.monthly_hours_diff || 0,
        charged: r.monthly_hours_chargeable || 0,
        amount: Math.abs(Number(r.monthly_hours_amount) || 0),
      }));
    out.sort((a, b) => a.diff - b.diff);
    return out;
  }, [rows]);

  const short = lines.filter((l) => l.charged < 0);
  const over = lines.filter((l) => l.diff > 0);
  const charge = short.reduce((t, l) => t + l.amount, 0);
  /* Nobody clocked them at all - "not known", which is not "did no hours". */
  const unknown = rows.length - lines.length;

  /*
   * Priced before it is switched, like the concession beside it. This really
   * does move money, so the figure goes in front of the decision rather than
   * being discovered on a payslip.
   */
  const turnOn = () => {
    if (locked) return;
    const ok = window.confirm(
      short.length
        ? `${short.length} ${short.length === 1 ? 'person is' : 'people are'} short of their total ` +
          `this month, which comes to ${money(charge)}.\n\nCharge this month on the monthly-hours rule?`
        : 'Nobody is short of their total this month, so nothing comes off.\n\n' +
          'Charge this month on the monthly-hours rule?'
    );
    if (ok) onPatch?.({ late_policy: POLICY.monthly });
  };

  return (
    <section className={`card late-card${open ? ' open' : ''}`}>
      <div className="late-head">
        <div>
          <h3>
            The month&rsquo;s hours
            <span className={`late-state ${on ? 'on' : 'off'}`}>
              {on ? 'charged' : 'counted only'}
            </span>
          </h3>
        </div>
        <div className="row">
          {/*
            * THE WAY IN WHERE SOMEBODY IS ALREADY LOOKING.
            *
            * Switching the rule lives in a select on the panel above, which
            * is right for choosing between three - and wrong for the one
            * thing the office actually comes here to do. The figure it costs
            * is on THIS screen, so the button that acts on it is too.
            */}
          {!on && !locked && (
            <button className="primary" onClick={turnOn}>
              Charge this month on it
            </button>
          )}
          <button className="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Shown when the panel is open. Closed, these two cards are one line
          each: they were 302px of a 1,200px window between them, which is
          what Dinesh meant by *"ye part bahut space kha raha he"*. */}
      <p className="muted small late-why">
        Nine hours a day for the days each person was due &mdash; a day short and a day long
        cancel, and only what is missing from the <strong>total</strong> comes off.{' '}
        {on
          ? 'This month is charged on it.'
          : 'This month is not charged on it; the figures below are what it would come to.'}
      </p>

      {/* The same figure row the panel above uses - value first, then what it
          is. A label-then-value pair with no class behind it ran the two
          together: "Short of their total1". */}
      <div className="late-figs">
        <span>
          <b>{short.length}</b>
          <em>{short.length === 1 ? 'person short of their total' : 'people short of their total'}</em>
        </span>
        <span>
          <b>{over.length}</b>
          <em>{over.length === 1 ? 'person over it' : 'people over it'}</em>
        </span>
        <span className={charge > 0 ? 'charge' : undefined}>
          <b>{money(charge)}</b>
          <em>{on ? 'deducted' : 'would be deducted'}</em>
        </span>
        {unknown > 0 && (
          /* The figure carries its own explanation on hover. Dinesh: "ye part
             bahut jyada space kha raha he" - the sentence under the strip only
             said the same thing as this figure, on a line of its own. */
          <span
            title={`${unknown} ${unknown === 1 ? 'person has' : 'people have'} no clock times this month, so nothing is judged for them — not known is not "did no hours". Type the times on this tab or import the punch file.`}
          >
            <b>{unknown}</b>
            <em>with no clock times</em>
          </span>
        )}
      </div>

      {open && unknown > 0 && (
        <p className="muted small">
          {unknown} {unknown === 1 ? 'person has' : 'people have'} no clock times this month, so
          nothing is judged for them &mdash; not known is not &ldquo;did no hours&rdquo;. Type the
          times on this tab or import the punch file.
        </p>
      )}

      {open && (
        <>
          {!on && !locked && (
            <p className="muted small">
              <strong>Charge this month on it</strong> above switches this month onto the rule.
              Every month opened from now starts on it already; a month already run keeps the
              rule it was run on, so no payslip already paid can move.
            </p>
          )}
          <div className="table-wrap unboxed">
            <table className="sheet wide">
              <thead>
                <tr>
                  <th className="grow">Who</th>
                  <th>Days counted</th>
                  <th>Owed</th>
                  <th>Worked</th>
                  <th>Short / over</th>
                  <th>{on ? 'Deducted' : 'Would be'}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="sticky-name">{l.name}</td>
                    <td className="num">{l.days}</td>
                    <td className="num">{hm(l.owed)}</td>
                    <td className="num">{hm(l.worked)}</td>
                    <td className={`num${l.diff < 0 ? ' warn' : ''}`}>
                      {l.diff === 0 ? '—' : `${l.diff > 0 ? '+' : '−'}${hm(l.diff)}`}
                    </td>
                    <td className="num">{l.amount > 0 ? money(l.amount) : '—'}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Nothing is clocked this month yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            A day nobody clocked counts on <strong>neither</strong> side &mdash; it adds no hours to
            what is owed and none to what was worked. An absence, a leave, a holiday, a weekly off
            and a half day add nothing to the total either: those are already settled by the day
            count, and counting them here would take the same day twice.
          </p>
        </>
      )}
    </section>
  );
}

export { POLICY };
