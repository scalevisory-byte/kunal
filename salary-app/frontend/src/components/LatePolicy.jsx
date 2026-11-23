import { useMemo, useState } from 'react';
import { DEFAULT_LATE_RULES, POLICY, POLICY_CHOICES } from '../../../shared/lateEarly.js';
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
  const policy = String(period.late_policy || POLICY.hours);
  /* Lateness is charged on BOTH the concession policy and the combined one. */
  const on = policy === POLICY.concession || policy === POLICY.monthlyLate;

  const preview = useMemo(() => {
    const out = { people: [], charge: 0, absorbed: 0, bothCharge: 0, minutes: 0, judged: 0,
      unknown: 0, each: [], monthlyPeople: [], monthlyCharge: 0, monthlyMinutes: 0,
      nowCharged: 0, nowPaid: 0 };
    for (const row of rows) {
      /*
       * What this month is ACTUALLY taking and paying for hours right now,
       * whatever rule it is on - so switching to "only the days" can be
       * priced the way every other switch here is. Deliberately read off
       * `ot_salary` and `late_salary`, the figures the payslip prints, and
       * never recomputed from a rule: it has to be what is really happening.
       */
      const ot = Number(row.ot_salary) || 0;
      out.nowCharged += Math.max(0, -ot) + (Number(row.late_salary) || 0);
      out.nowPaid += Math.max(0, ot);
      if (row.late_total_minutes > 0 || row.late_days || row.early_days) {
        out.minutes += row.late_total_minutes || 0;
        // The summary is of EVERYBODY who was late or early, not only those
        // past the concession - "who is coming in late" is the question a
        // month is read for, and most of them never reach the charge.
        out.each.push(row);
      }
      if (row.judged_days === 0) out.unknown++;
      /* What the monthly-hours rule would take off this person, worked out on
         every policy so a switch can be priced before it is made. */
      const monthlyCut = Number(row.monthly_hours_chargeable) || 0;
      if (monthlyCut < 0) {
        out.monthlyMinutes += monthlyCut;
        out.monthlyCharge += Math.abs(Number(row.monthly_hours_amount) || 0);
        out.monthlyPeople.push(row);
      }
      /*
       * `late_computed` is what the rule WOULD charge; `late_salary` is what
       * the month actually takes. The same figure on every policy except the
       * combined one, where lateness nobody made up is already inside the
       * month's shortfall and only the part beyond it is charged on top.
       *
       * Summing the first there overstated the month: this panel read
       * "2,741 charged" against payslips that took 1,370, so anybody adding
       * it to the hours panel below got a total the salary sheet disagreed
       * with. Found by reading both panels on one screen.
       */
      const would = Number(row.late_computed) || 0;
      const taken = Number(row.late_salary) || 0;
      if (would > 0) {
        out.people.push(row);
        out.charge += on ? taken : would;
        out.absorbed += Math.max(0, would - taken);
      }
      /*
       * What BOTH rules together would take off this one person: the greater
       * of the two, never the sum.
       *
       * PER PERSON, then added up. Taking the greater of the two TOTALS is a
       * different and wrong number - it read "at most 2,741" for a month that
       * actually takes 3,296, because the person the monthly rule bites and
       * the person the concession bites are not the same person.
       */
      out.bothCharge += Math.max(Math.abs(Number(row.monthly_hours_amount) || 0), would);
    }
    out.people.sort((a, b) => (b.late_computed || 0) - (a.late_computed || 0));
    out.each.sort((a, b) => (b.late_total_minutes || 0) - (a.late_total_minutes || 0));
    return out;
  }, [rows, on]);

  const set = (patch) => {
    if (locked) return;
    onPatch(patch);
  };

  return (
    <section className="card late-card">
      <div className="late-head">
        <div>
          <h3>
            Late and early
            <span className={`late-state ${on ? 'on' : 'off'}`}>
              {/* What LATENESS is doing. The monthly-hours rule has its own
                  panel and its own badge; saying "monthly hours" here read as
                  if this panel were about that. */}
              {on ? 'charged' : 'counted only'}
            </span>
          </h3>
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

      {/*
        * Three figures on one line, not three stacked blocks.
        *
        * Dinesh: *"use compact summary statistics... keep the card short and
        * professional"*. They were big enough to be the page's headline,
        * over a raw table of everybody - half a screen before the grid the
        * tab exists for.
        */}
      <div className="late-figs">
        <span>
          <b>{formatDuration(preview.minutes) || '0m'}</b>
          <em>late or early this month</em>
        </span>
        <span>
          <b>{preview.people.length}</b>
          <em>{preview.people.length === 1 ? 'person over the concession' : 'people over the concession'}</em>
        </span>
        <span className={preview.charge > 0 ? 'charge' : undefined}>
          <b>{money(preview.charge)}</b>
          <em>{on ? 'charged' : 'would be charged'}</em>
        </span>
      </div>
      {on && preview.absorbed > 0 && (
        <p className="muted small">
          A further <strong>{money(preview.absorbed)}</strong> of lateness is <strong>not</strong>{' '}
          charged on top: those minutes are already missing from the month&rsquo;s hours below, and
          the same minutes are never taken twice.
        </p>
      )}

      {preview.each.length > 0 ? (
        /* The per-person breakdown is DETAIL, so it folds. The three
           figures above are the answer; this is the working behind them. */
        <details className="late-detail">
          <summary>
            Who, person by person ({preview.each.length})
          </summary>
          <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name">Name</th>
                <th className="num">Late days</th>
                <th className="num">Late by</th>
                <th className="num">Early days</th>
                <th className="num">Early by</th>
                <th className="num">In all</th>
                <th className="num">{on ? 'Charged' : 'Would cost'}</th>
              </tr>
            </thead>
            <tbody>
              {preview.each.map((r) => (
                <tr key={r.employee_id}>
                  <td className="sticky-name">{r.employee_name}</td>
                  <td className="num">{r.late_days || <span className="muted">—</span>}</td>
                  <td className="num">{r.late_minutes ? formatDuration(r.late_minutes) : <span className="muted">—</span>}</td>
                  <td className="num">{r.early_days || <span className="muted">—</span>}</td>
                  <td className="num">{r.early_minutes ? formatDuration(r.early_minutes) : <span className="muted">—</span>}</td>
                  <td className="num">{formatDuration(r.late_total_minutes)}</td>
                  <td className="num">
                    {/* Nought here is not "free by accident" - it is inside
                        the concession, which is what the concession is for. */}
                    {r.late_computed > 0 ? money(r.late_computed) : <span className="muted">within it</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </details>
      ) : (
        <p className="muted small">
          {preview.unknown === rows.length
            ? 'No clock times this month, so nobody can be called late — that is "not known", not "on time".'
            : 'Nobody came in late or left early this month.'}
        </p>
      )}

      {open && (
        <>
          <div className="form-grid">
            <label>
              Rule
              <select
                value={policy}
                disabled={locked}
                onChange={(e) => {
                  const next = e.target.value;
                  /*
                   * Priced before it is switched, both ways. These rules
                   * really do move money - unlike the salary split, which
                   * cannot - so the figure goes in front of the decision.
                   */
                  if (next === POLICY.concession && preview.charge > 0) {
                    const ok = window.confirm(
                      `This charges ${money(preview.charge)} across ${preview.people.length} ` +
                        `${preview.people.length === 1 ? 'person' : 'people'} this month. Turn it on?`
                    );
                    if (!ok) return;
                  }
                  if (next === POLICY.monthlyLate) {
                    /*
                     * The one thing somebody must understand before pressing
                     * it: the two are NOT added. A late minute nobody made up
                     * is already inside the month's shortfall.
                     */
                    const ok = window.confirm(
                      'BOTH rules together.\n\n' +
                        'The month’s total is charged, and only the lateness that goes BEYOND ' +
                        'it is charged on top — never the two added, because a late minute ' +
                        'nobody made up is already in the shortfall.\n\n' +
                        `On this month that comes to ${money(preview.bothCharge)}. Turn both on?`
                    );
                    if (!ok) return;
                  }
                  /*
                   * Turning the hours OFF moves money just as much as
                   * turning one on, so it is priced the same way. Both sides
                   * are named: somebody is also losing their overtime.
                   */
                  if (next === POLICY.none && (preview.nowCharged > 0 || preview.nowPaid > 0)) {
                    const ok = window.confirm(
                      'Only the days will decide the pay.\n\n' +
                        'Nothing is charged or paid for hours any more \u2014 Present, Absent and ' +
                        'Half day alone. The hours are still counted and shown on the salary ' +
                        'sheet, and you can still type a figure into OT min for anybody.\n\n' +
                        `On this month that stops ${money(preview.nowCharged)} being deducted ` +
                        `and ${money(preview.nowPaid)} being paid as overtime. Switch?`
                    );
                    if (!ok) return;
                  }
                  if (next === POLICY.monthly && preview.monthlyCharge > 0) {
                    const ok = window.confirm(
                      `The month owes each person nine hours a day for the days they were due.\n\n` +
                        `${preview.monthlyPeople.length} ` +
                        `${preview.monthlyPeople.length === 1 ? 'person is' : 'people are'} short of their total, ` +
                        `which comes to ${money(preview.monthlyCharge)} this month. Turn it on?`
                    );
                    if (!ok) return;
                  }
                  set({ late_policy: next });
                }}
              >
                {/* From the one list, so a rule added later cannot go
                    missing off this screen. See POLICY_CHOICES. */}
                {POLICY_CHOICES.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {choice.label}
                  </option>
                ))}
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
