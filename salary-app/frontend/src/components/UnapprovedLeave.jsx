import { useEffect, useMemo, useState } from 'react';
import { autoDoubledReport, entriesToDouble, unapprovedLeave } from '../../../shared/unapprovedLeave.js';
import { STANDALONE, api } from '../api.js';
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
export default function UnapprovedLeave({ period, rows, onSave, locked, onGo, onReload }) {
  const [countUndecided, setCountUndecided] = useState(false);
  const [status, setStatus] = useState('');
  /*
   * THE AUTOMATIC RULE. Dinesh, having seen the button below: "double
   * deduction automatic kar do". It lives on the server - one setting with a
   * date on it - and this screen says whether it is on, since when, what it
   * has done this month and who it is holding back. Null until it has
   * answered: a screen that guessed "off" for a moment would offer a button
   * that turns a rule on twice.
   */
  const [auto, setAuto] = useState(null);
  const [autoSaid, setAutoSaid] = useState('');
  const loadAuto = () =>
    STANDALONE
      ? Promise.resolve()
      : api
          .get(`/leave/auto-double?period_id=${period.id}`)
          .then(setAuto)
          .catch(() => setAuto(null));
  useEffect(() => {
    loadAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.id]);
  const done = useMemo(() => autoDoubledReport(rows, period), [rows, period]);

  const switchAuto = async (on, from) => {
    const firstOfMonth = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    const text = on
      ? from === firstOfMonth
        ? `Turn the rule on from the 1st of this month?\n\nEvery absence this month that nobody approved becomes a double absence now, and so does every one from here on. An approval puts a day back to single.`
        : 'Turn the rule on from today?\n\nFrom today, an absence nobody approved is marked double as soon as it is marked. Earlier days are not touched. An approval puts a day back to single.'
      : 'Turn the rule off?\n\nNew absences will stay single. Days it has already doubled stay doubled until somebody approves them or changes the mark.';
    if (!window.confirm(text)) return;
    try {
      const got = await api.put('/leave/auto-double', { on, from, period_id: period.id });
      setAuto((a) => ({ ...(a || {}), rule: got.rule, doubled: got.doubled, held: got.did?.held || [] }));
      setAutoSaid(
        on && got.did?.doubled
          ? `On. ${got.did.doubled} ${got.did.doubled === 1 ? 'absence was' : 'absences were'} doubled just now.`
          : on
            ? 'On.'
            : 'Off.'
      );
      await onReload?.();
    } catch (err) {
      setAutoSaid(
        /403|forbidden|not allowed|permission/i.test(err.message)
          ? 'Only a Manager or Admin login can switch this rule.'
          : err.message
      );
    }
  };

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

  const ruleOn = Boolean(auto?.rule?.on);
  const firstOfMonth = `${period.year}-${String(period.month).padStart(2, '0')}-01`;

  return (
    <section className="card">
      <h3>Leave taken without approval</h3>
      <p className="muted small">
        An absence that was not approved costs double — one day off, two days deducted; two days off, four.
        A sudden leave with proof stays single: tick it <strong>Approved</strong> on the dashboard’s roll
        call or in the day’s menu on the attendance grid, with the reason.
      </p>

      {!STANDALONE && auto && (
        <div className={`auto-double ${ruleOn ? 'on' : 'off'}`}>
          <div className="row">
            <strong>
              {ruleOn
                ? `Automatic — on, for absences from ${auto.rule.from}`
                : 'Automatic — off'}
            </strong>
            <span className="grow" />
            {ruleOn ? (
              <button className="ghost" onClick={() => switchAuto(false)}>Turn it off</button>
            ) : (
              <>
                <button onClick={() => switchAuto(true, undefined)}>Do it automatically from today</button>
                <button className="ghost" onClick={() => switchAuto(true, firstOfMonth)} disabled={locked}>
                  …from the 1st of this month
                </button>
              </>
            )}
          </div>
          <p className="muted small">
            {ruleOn ? (
              <>
                An absence (A) nobody has approved is marked <strong>AD</strong> — two days — as soon as it
                is marked{auto.rule.by ? `. Switched on by ${auto.rule.by}` : ''}. <strong>To keep one single,
                tick Approved</strong>: the day goes back to one. Unpaid leave is doubled only when it is
                marked not approved. A day that has not happened yet, and a locked month, are never touched.
              </>
            ) : (
              <>Nothing doubles by itself. Use the button below, or turn the rule on.</>
            )}
          </p>
          {autoSaid && <p className="small">{autoSaid}</p>}
          {done.people.length > 0 && (
            <details className="fold" open={done.people.length <= 6}>
              <summary>
                Doubled by the rule this month — {done.days} {done.days === 1 ? 'day' : 'days'},{' '}
                {done.people.length} {done.people.length === 1 ? 'person' : 'people'}, {rupees(done.amount)} more
                than single
              </summary>
              <table className="sheet wide">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>Days doubled</th>
                    <th className="num">Costs them</th>
                    <th className="num">Back if approved</th>
                  </tr>
                </thead>
                <tbody>
                  {done.people.map((person) => (
                    <tr key={person.employee_id}>
                      <td className="sticky-name">{person.employee_name}</td>
                      <td className="muted small">
                        {person.days.map((d) => `${d.day}${d.reason ? ` — ${d.reason}` : ''}`).join('; ')}
                      </td>
                      <td className="num">{person.days.length * 2} days</td>
                      <td className="num">{rupees(person.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {(auto.held || []).length > 0 && (
            <p className="warn small">
              <strong>Held back, not doubled:</strong>{' '}
              {auto.held.map((h) => `${h.employee_name} (${h.days.length} ${h.days.length === 1 ? 'day' : 'days'})`).join(' · ')}{' '}
              — absent on every day marked, with no sign of being at work this month. That is usually somebody
              the punch machine never enrolled, or who has left. Check them; nothing is doubled until they are
              seen at work.
            </p>
          )}
        </div>
      )}

      <h4 className="auto-double-earlier">
        {ruleOn ? 'Absences the rule does not cover' : 'Absences not approved this month'}
      </h4>
      {ruleOn && (
        <p className="muted small">
          Days before {auto.rule.from}, and unpaid leave nobody has decided. Nothing here is doubled until
          you press the button.
        </p>
      )}

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
