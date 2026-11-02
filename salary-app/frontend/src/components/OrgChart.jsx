import { useMemo } from 'react';
import { orgChart } from '../../../shared/orgChart.js';

/**
 * Who reports to whom, as one indented list.
 *
 * Indented rather than drawn as boxes and lines: eighty-five people in boxes
 * is a wall chart nobody opens on a phone, and the thing somebody actually
 * wants from it - who does this person answer to, and who answers to them -
 * reads straight off an indent.
 *
 * It honours the company filter like every other screen, which is why the
 * people whose manager is in another company are named rather than dropped:
 * their line leaves the page, and a chart that quietly hides that looks
 * complete when it is not.
 */
export default function OrgChart({ employees, onOpen }) {
  const chart = useMemo(() => orgChart(employees), [employees]);

  if (!employees.length) {
    return <p className="muted small">Nobody on the list.</p>;
  }

  // Nobody has a manager set: say so plainly instead of drawing eighty-five
  // roots and calling it a hierarchy.
  if (chart.managers === 0) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>No reporting line yet</h3>
        <p className="muted small">
          Nobody has a manager set, so there is nothing to draw — all{' '}
          {employees.length} are shown as their own top. Open somebody's record and set{' '}
          <strong>Reports to</strong>; the chart builds itself from that. It is a link to another
          employee rather than a name typed in, so it cannot go stale the day somebody leaves.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="figures">
        <div className="figure">
          <span className="k">At the top</span>
          <span className="n">{chart.roots}</span>
        </div>
        <div className="figure">
          <span className="k">Managers</span>
          <span className="n">{chart.managers}</span>
        </div>
        <div className="figure">
          <span className="k">Levels deep</span>
          <span className="n">{chart.deepest + 1}</span>
        </div>
        <div className="figure">
          <span className="k">No manager set</span>
          <span className="n">{chart.unassigned}</span>
        </div>
      </div>

      {chart.looped.length > 0 && (
        <p className="banner bad">
          {chart.looped.length} {chart.looped.length === 1 ? 'person reports' : 'people report'} in
          a circle — {chart.looped.map((p) => p.name).join(', ')}. The chart is cut there. Fix it
          on their record.
        </p>
      )}

      <ol className="org">
        {chart.rows.map((row) => (
          <li key={row.id} style={{ paddingLeft: `${row.depth * 1.5}rem` }} className={row.depth ? '' : 'top'}>
            <button className="link" onClick={() => onOpen?.(row.person)}>
              {row.name}
            </button>
            {row.designation && <span className="muted small"> {row.designation}</span>}
            {row.reports > 0 && (
              <span className="pill" title={`${row.below} in all, down the line`}>
                {row.reports} direct{row.below > row.reports ? ` · ${row.below} below` : ''}
              </span>
            )}
          </li>
        ))}
      </ol>

      {chart.orphans.length > 0 && (
        <p className="muted small">
          Not on the chart: {chart.orphans.map((p) => p.name).join(', ')} — their manager is not in
          this list. Usually somebody who has left, or a company filter hiding the line above them.
        </p>
      )}
    </div>
  );
}
