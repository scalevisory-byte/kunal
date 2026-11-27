import { useMemo, useState } from 'react';
import { entriesToDouble, unapprovedLeave } from '../../../shared/unapprovedLeave.js';
import { rupees } from '../format.js';

/**
 * Leave taken without approval: one day costs two.
 *
 * The rule is Dinesh's - "1 leave to 2 leave deduct, 2 to 4 leave", and a
 * sudden leave with no proof is treated the same. This screen FINDS those
 * days, says what doubling them takes from each person, and does it on a
 * press. It is not a switch: the rule turns on whether somebody approved the
 * day, and that is a thing a person records on the roll call.
 */
export default function UnapprovedLeave({ period, rows, onSave, locked, onGo }) {
  const [countUndecided, setCountUndecided] = useState(false);
  const [status, setStatus] = useState('');

  const upTo = useMemo(() => {
    const now = new Date();
    return now.getFullYear() === Number(period.year) && now.getMonth() + 1 === Number(period.month) ? now.getDate() : 0;
  }, [period.year, period.month]);

  const report = useMemo(
    () => unapprovedLeave(rows, period, { countUndecided, upTo }),
    [rows, period, countUndecided, upTo]
  );

  const apply = async () => {
    const entries = entriesToDouble(report);
    if (!entries.length) return;
    if (
      !window.confirm(
        `Double ${entries.length} unapproved ${entries.length === 1 ? 'absence' : 'absences'} across ` +
          `${report.people.length} ${report.people.length === 1 ? 'person' : 'people'}?\n\n` +
          `Each day goes from costing one day’s pay to costing two. That takes ${rupees(report.amount)} more ` +
          `off this month.\n\nIt can be undone by marking those days Absent again on the attendance grid.`
      )
    )
      return;
    setStatus('Marking…');
    try {
      await onSave(entries);
      setStatus(`Marked ${entries.length} ${entries.length === 1 ? 'day' : 'days'} as double.`);
    } catch (err) {
      setStatus(err.message);
    }
  };

  return (
    <section className="card">
      <h3>Leave taken without approval</h3>
      <p className="muted small">
        An absence that was not approved costs double — one day off, two days deducted; two days off, four.
        A sudden leave with proof stays single: tick it <strong>Approved</strong> on the dashboard’s roll
        call or in the day’s menu on the attendance grid, with the reason. Nothing is doubled until you
        press the button.
      </p>

      <div className="figures">
        <div className="figure">
          <span className="k">Not approved</span>
          <span className="n">{report.refused}</span>
        </div>
        <div className="figure">
          <span className="k">Nobody has decided</span>
          <span className="n">{report.undecided}</span>
        </div>
        <div className="figure">
          <span className="k">Approved, stay single</span>
          <span className="n">{report.approved}</span>
        </div>
        <div className="figure">
          <span className="k">Already doubled</span>
          <span className="n">{report.already}</span>
        </div>
        <div className="figure">
          <span className="k">Doubling would take</span>
          <span className="n">{rupees(report.amount)}</span>
        </div>
      </div>

      <label className="inline">
        <input type="checkbox" checked={countUndecided} onChange={(e) => setCountUndecided(e.target.checked)} />{' '}
        Treat an absence nobody has decided as not approved
      </label>
      <p className="muted small">
        Off by default: a day nobody has looked at is not a day somebody refused. Decide them first where
        you can{onGo ? (
          <>
            {' '}— <button className="link" onClick={() => onGo('dashboard')}>open the roll call</button>
          </>
        ) : null}
        . Only plain absence (A) and unpaid leave (UL) are looked at; paid leave and half days are not.
      </p>

      {!countUndecided && report.waiting.length > 0 && (
        <details className="fold">
          <summary>
            {report.undecided} absence{report.undecided === 1 ? '' : 's'} nobody has decided —{' '}
            {report.waiting.length} {report.waiting.length === 1 ? 'person' : 'people'}
          </summary>
          <p className="muted small">
            {report.waiting.map((w) => `${w.employee_name} (${w.days.join(', ')})`).join(' · ')}
          </p>
        </details>
      )}

      {!report.people.length ? (
        <p className="muted small">
          {report.refused + report.undecided === 0
            ? 'No unapproved absence this month.'
            : 'Nothing marked “not approved” this month.'}
        </p>
      ) : (
        <>
          <table className="sheet wide">
            <thead>
              <tr>
                <th>Who</th>
                <th>Days taken without approval</th>
                <th className="num">Days off</th>
                <th className="num">Deducted after</th>
                <th className="num">Takes this much more</th>
              </tr>
            </thead>
            <tbody>
              {report.people.map((person) => (
                <tr key={person.employee_id}>
                  <td className="sticky-name">{person.employee_name}</td>
                  <td className="muted small">
                    {person.days
                      .map((d) => `${d.day}${d.standing === 'undecided' ? ' (not decided)' : ''}${d.reason ? ` — ${d.reason}` : ''}`)
                      .join('; ')}
                  </td>
                  <td className="num">{person.days.length}</td>
                  <td className="num">{person.days.length * 2}</td>
                  <td className="num">{rupees(person.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={apply} disabled={locked}>
            Double {report.days} {report.days === 1 ? 'day' : 'days'} — {rupees(report.amount)} more
          </button>
          {status && <span className="pill">{status}</span>}
          <p className="muted small">
            Marked as <strong>AD</strong> (absent, two days). The reason and the “not approved” on the day
            are kept, which is the record of why it cost two.
          </p>
        </>
      )}
    </section>
  );
}
