import { useState } from 'react';
import { DEFAULT_POLICY, WEEKDAYS, describePolicy, readPolicy, writePolicy } from '../../../shared/weeklyOff.js';

/**
 * Which day of the week is the day off.
 *
 * The app assumed Sunday everywhere, which is right for most of the staff and
 * wrong for the rest — a driver off on Thursday, an office on alternate
 * Saturdays. A company sets the house rule and a person can carry their own.
 *
 * **It cannot move money by itself.** `S` still means the weekly off and `SP`
 * still means it was worked, which is what the Sunday register pays from; all
 * that changes is which squares the grid treats as off days — so "Mark everyone
 * Present" puts S on the right days, and a fortnight-off range skips the right
 * ones. The salary engine counts marks and never asks what day of the week it
 * is, so nothing already marked moves.
 */
function PolicyEditor({ value, onChange, disabled }) {
  const policy = readPolicy(value);
  const alt = policy.alternate;

  const toggleDay = (day) => {
    const days = policy.days.includes(day) ? policy.days.filter((d) => d !== day) : [...policy.days, day];
    onChange(writePolicy({ ...policy, days }));
  };

  const setAlternate = (day, weeks) => {
    onChange(writePolicy({ ...policy, alternate: day === null ? null : { day, weeks } }));
  };

  return (
    <div className="stack">
      <div className="religion-picks">
        {WEEKDAYS.map((w) => (
          <button
            key={w.day}
            type="button"
            disabled={disabled}
            className={policy.days.includes(w.day) ? 'active' : undefined}
            onClick={() => toggleDay(w.day)}
          >
            {w.short}
          </button>
        ))}
      </div>

      <label className="inline">
        <input
          type="checkbox"
          disabled={disabled}
          checked={Boolean(alt)}
          onChange={(e) => setAlternate(e.target.checked ? 6 : null, [2, 4])}
        />{' '}
        and some Saturdays only
      </label>

      {alt && (
        <div className="toolbar">
          <label>
            Which day
            <select
              value={alt.day}
              disabled={disabled}
              onChange={(e) => setAlternate(Number(e.target.value), alt.weeks)}
            >
              {WEEKDAYS.map((w) => (
                <option key={w.day} value={w.day}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <div className="religion-picks">
            {[1, 2, 3, 4, 5].map((week) => (
              <button
                key={week}
                type="button"
                disabled={disabled}
                className={alt.weeks.includes(week) ? 'active' : undefined}
                onClick={() =>
                  setAlternate(
                    alt.day,
                    alt.weeks.includes(week) ? alt.weeks.filter((w) => w !== week) : [...alt.weeks, week]
                  )
                }
              >
                {week}
                {['st', 'nd', 'rd', 'th', 'th'][week - 1]}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="muted small">{describePolicy(policy)}</p>
    </div>
  );
}

export default function WeeklyOff({ companies, employees, onPatchCompany, onPatchEmployee, locked }) {
  const [who, setWho] = useState('');

  const exceptions = employees.filter((e) => e.weekly_off);

  return (
    <section className="stack">
      <div className="card">
        <h3>The day off, per company</h3>
        <p className="muted small">
          Only which days the grid treats as off days moves. <code>S</code> still means the weekly
          off and <code>SP</code> still means it was worked, which is what the Sunday register pays
          from — so nothing already marked changes value, and the salary engine never asks what day
          of the week it is.
        </p>
        {companies.map((company) => (
          <div key={company.id} className="card">
            <strong>{company.name}</strong>
            <PolicyEditor
              value={company.weekly_off || DEFAULT_POLICY}
              disabled={locked}
              onChange={(weekly_off) => onPatchCompany(company.id, { weekly_off })}
            />
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Anybody on different days</h3>
        <p className="muted small">
          A driver off on Thursday, somebody on a six-day week in a five-day office. Leave this
          alone for everybody else — blank means &ldquo;the company&rsquo;s day off&rdquo;.
        </p>
        <label className="block">
          Who
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Pick somebody</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.weekly_off ? ' ·' : ''}
              </option>
            ))}
          </select>
        </label>
        {who && (
          <>
            <PolicyEditor
              value={employees.find((e) => String(e.id) === who)?.weekly_off || DEFAULT_POLICY}
              disabled={locked}
              onChange={(weekly_off) => onPatchEmployee(Number(who), { weekly_off })}
            />
            <button className="ghost" onClick={() => onPatchEmployee(Number(who), { weekly_off: '' })}>
              Back to the company&rsquo;s day off
            </button>
          </>
        )}

        {exceptions.length > 0 && (
          <table className="sheet">
            <thead>
              <tr>
                <th>Who</th>
                <th>Company</th>
                <th>Off on</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((e) => (
                <tr key={e.id}>
                  <td className="sticky-name">
                    <button className="ghost small" onClick={() => setWho(String(e.id))}>
                      {e.name}
                    </button>
                  </td>
                  <td>{e.company_name}</td>
                  <td className="muted small">{describePolicy(readPolicy(e.weekly_off))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
