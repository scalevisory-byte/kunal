import { useMemo, useState } from 'react';
import {
  DEFAULT_TRIGGERS,
  LEAVE_TRIGGERS,
  entriesToApply,
  sandwichReport,
} from '../../../shared/sandwich.js';
import { daysInMonth } from '../format.js';
import { rupees } from '../format.js';

/**
 * Sandwich leave: the day off caught between two days of absence.
 *
 * Somebody absent on Saturday and again on Monday was away for three days, and
 * many employers deduct the Sunday in the middle. Dinesh asked for the rule by
 * name.
 *
 * **It is a tool, not a setting.** Nothing is stored and nothing happens on its
 * own: this finds the days and says what each one costs, and marking them is a
 * click. That is deliberate — it is the harshest rule in the app, taking a day's
 * pay for a day nobody was ever due to work, so it is a decision every month
 * rather than a switch somebody left on. The marks it writes are the record.
 */
export default function SandwichLeave({ period, rows, onSave, locked }) {
  const [harsh, setHarsh] = useState(false);
  const [status, setStatus] = useState('');

  const report = useMemo(
    () =>
      sandwichReport(rows, {
        year: period.year,
        month: period.month,
        days_in_month: daysInMonth(period.year, period.month),
        triggers: harsh ? LEAVE_TRIGGERS : DEFAULT_TRIGGERS,
      }),
    [rows, period.year, period.month, harsh]
  );

  const apply = async () => {
    const entries = entriesToApply(report);
    if (!entries.length) return;
    if (
      !window.confirm(
        `Mark ${entries.length} ${entries.length === 1 ? 'day' : 'days'} as unpaid leave across ` +
          `${report.people.length} ${report.people.length === 1 ? 'person' : 'people'}?\n\n` +
          `That costs ${rupees(report.amount)} this month. It can be undone by clearing those days ` +
          `on the attendance grid.`
      )
    )
      return;
    setStatus('Marking…');
    try {
      await onSave(entries);
      setStatus(`Marked ${entries.length} days.`);
    } catch (err) {
      setStatus(err.message);
    }
  };

  return (
    <section className="card">
      <h3>Sandwich leave</h3>
      <p className="muted small">
        A day off with absence on both sides. This finds them and says what they would cost —
        nothing is deducted until you mark them, because it takes a day&rsquo;s pay for a day
        nobody was due to work.
      </p>

      <div className="figures">
        <div className="figure">
          <span className="k">People</span>
          <span className="n">{report.people.length}</span>
        </div>
        <div className="figure">
          <span className="k">Days</span>
          <span className="n">{report.days_lost}</span>
        </div>
        <div className="figure">
          <span className="k">Would cost</span>
          <span className="n">{rupees(report.amount)}</span>
        </div>
      </div>

      <label className="inline">
        <input type="checkbox" checked={harsh} onChange={(e) => setHarsh(e.target.checked)} /> Count
        casual, sick and privilege leave as absence too
      </label>
      <p className="muted small">
        Off by default: docking a Sunday between two days of leave somebody had earned is a
        different decision from docking one between two days of unexplained absence.
        {report.edges > 0 && (
          <>
            {' '}
            {report.edges} day{report.edges === 1 ? '' : 's'} off at the very start or end of the
            month {report.edges === 1 ? 'was' : 'were'} left out — the day on the other side is in
            another month, which this cannot see.
          </>
        )}
      </p>

      {!report.people.length ? (
        <p className="muted small">Nothing sandwiched this month.</p>
      ) : (
        <>
          <table className="sheet">
            <thead>
              <tr>
                <th>Who</th>
                <th>Days off caught</th>
                <th className="num">Days</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {report.people.map((person) => (
                <tr key={person.employee_id}>
                  <td className="sticky-name">{person.employee_name}</td>
                  <td className="muted small">
                    {person.days
                      .map(
                        (d) =>
                          `${d.day} (${d.before_mark || '?'} on ${d.before}, ${
                            d.after_mark || '?'
                          } on ${d.after})`
                      )
                      .join('; ')}
                  </td>
                  <td className="num">{person.days_lost}</td>
                  <td className="num">{rupees(person.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={apply} disabled={locked}>
            Mark {report.days_lost} {report.days_lost === 1 ? 'day' : 'days'} unpaid —{' '}
            {rupees(report.amount)}
          </button>
          {status && <span className="pill">{status}</span>}
          <p className="muted small">
            Marked as <strong>UL</strong> (unpaid leave), not plain absence: it costs the same
            day&rsquo;s pay but is counted apart, so a month&rsquo;s absences are not inflated by
            days this rule docked rather than days somebody failed to turn up.
          </p>
        </>
      )}
    </section>
  );
}
