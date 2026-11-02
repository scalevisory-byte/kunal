import { useMemo, useState } from 'react';
import { departmentGroups, departmentManagerPlan } from '../../../shared/orgChart.js';

const listNames = (people, limit = 4) =>
  people.length > limit
    ? `${people.slice(0, limit).map((p) => p.name).join(', ')} and ${people.length - limit} more`
    : people.map((p) => p.name).join(', ');

/**
 * A manager per department, several departments in one go.
 *
 * Setting the line person by person is hopeless at a hundred and fifteen, and
 * even ticking rows means doing it a department at a time. An office thinks in
 * departments - "Accounts reports to Alpesh, Operations to Arqam" - so that is
 * what this takes.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It does not choose a head. Somebody already managing people inside the
 *    department is listed first as the obvious candidate, and that is all.
 *  - It does not touch a department left blank. Blank means "not this time",
 *    never "take their manager away", because a mis-click must not quietly
 *    flatten a department.
 *  - It does not hide the people with no department set. On a real list that
 *    is usually the biggest group, and hiding it is how somebody ends up with
 *    no manager and nothing saying so.
 */
export default function DepartmentManagers({ employees, onBulkPatch, onError }) {
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => departmentGroups(employees), [employees]);
  // Planned against the WHOLE list: with a company chosen, a manager can
  // legitimately sit in another company, and a loop check on a short list
  // would miss one.
  const plan = useMemo(() => departmentManagerPlan(employees, choices), [employees, choices]);

  const named = groups.filter((g) => g.name);

  const apply = async () => {
    setBusy(true);
    try {
      // One department at a time, each with its own manager - but a single
      // reload at the end, like every other bulk action here.
      for (const row of plan.rows) {
        if (!row.plan.setting.length) continue;
        await onBulkPatch(
          row.plan.setting.map((p) => p.id),
          { reports_to_id: Number(choices[row.department]) }
        );
      }
      setChoices({});
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!named.length) {
    return (
      <div className="structure dept-managers">
        <h3 style={{ margin: '0 0 0.4rem' }}>A manager for each department</h3>
        <p className="muted small">
          Nobody has a department set yet, so there is nothing to go by. Tick people on the
          employee list and use <strong>Set department to</strong> — then come back here and give
          each department its manager in one go.
        </p>
      </div>
    );
  }

  return (
    <div className="structure dept-managers">
      <h3 style={{ margin: '0 0 0.4rem' }}>A manager for each department</h3>
      <p className="muted small">
        Choose a manager beside a department and everybody in it reports to them. A department
        left blank is not touched.
      </p>

      <div className="table-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th>Department</th>
              <th>People</th>
              <th>They all report to</th>
              <th>What this will do</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const row = plan.rows.find((r) => r.department === group.name);
              // Their own people first, because a department head is nearly
              // always inside it - then everybody, because sometimes not.
              const inside = group.inside;
              const rest = employees.filter(
                (e) => e.active && !inside.some((p) => p.id === e.id)
              );
              return (
                <tr key={group.name || '(none)'}>
                  <td>{group.name || <span className="muted">No department set</span>}</td>
                  <td className="num">{group.count}</td>
                  <td>
                    <select
                      value={choices[group.name] || ''}
                      onChange={(e) =>
                        setChoices({ ...choices, [group.name]: e.target.value })
                      }
                    >
                      <option value="">Leave this department alone</option>
                      {inside.length > 0 && (
                        <optgroup label="Already manages people in this department">
                          {inside.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                              {m.designation ? ` — ${m.designation}` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Anybody">
                        {rest.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.designation ? ` — ${m.designation}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </td>
                  <td className="small what">
                    {!row ? (
                      <span className="muted">—</span>
                    ) : (
                      <div className="stack-tight">
                        <span>
                          {row.plan.setting.length} of {group.count} will report to{' '}
                          {row.plan.manager?.name}.
                        </span>
                        {row.plan.replacing.length > 0 && (
                          <span className="muted">
                            {row.plan.replacing.length} already report to somebody else — that
                            link is replaced.
                          </span>
                        )}
                        {row.plan.already.length > 0 && (
                          <span className="muted">
                            {row.plan.already.length} already report to them.
                          </span>
                        )}
                        {row.plan.self.length > 0 && (
                          <span className="warn">
                            {listNames(row.plan.self)} is the manager — left as they are, so
                            whoever they report to is kept.
                          </span>
                        )}
                        {row.plan.circular.length > 0 && (
                          <span className="warn">
                            {listNames(row.plan.circular)} left alone — {row.plan.manager?.name}{' '}
                            already reports to them.
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row">
        <button className="primary" disabled={busy || !plan.setting} onClick={apply}>
          {busy
            ? 'Saving…'
            : plan.setting
              ? `Set ${plan.setting} across ${plan.departments} ${plan.departments === 1 ? 'department' : 'departments'}`
              : 'Nothing chosen yet'}
        </button>
        {plan.setting > 0 && (
          <span className="muted small">
            {plan.replacing > 0 && `${plan.replacing} move from another manager. `}
            {plan.leaving > 0 && `${plan.leaving} left alone, named above. `}
            Nobody&apos;s pay changes.
          </span>
        )}
      </div>
    </div>
  );
}
