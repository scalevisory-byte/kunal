import { useState } from 'react';
import { STANDALONE } from '../../api.js';
import Appraisals from './Appraisals.jsx';
import Assets from './Assets.jsx';
import Claims from './Claims.jsx';
import Helpdesk from './Helpdesk.jsx';
import Leaving from './Leaving.jsx';
import Records from './Records.jsx';
import Reminders from './Reminders.jsx';
import Tasks from './Tasks.jsx';
import Trail from './Trail.jsx';

const PANELS = [
  ['records', 'On the record'],
  ['appraisals', 'Appraisals'],
  ['assets', 'Assets'],
  ['claims', 'Claims'],
  ['tasks', 'Tasks'],
  ['helpdesk', 'Helpdesk'],
  ['leaving', 'Leaving'],
  ['reminders', 'Reminders'],
  ['trail', 'Trail'],
];

/**
 * The People tab: the paper trail around somebody that is not pay and not
 * attendance - warnings and appreciations, appraisals and the increments they
 * led to, the laptop and the SIM, expense claims, leaving and the full and
 * final, and who changed what.
 *
 * All six need the server. A warning on a record, a claim somebody else
 * approves and a trail that outlives one browser are not things a single file
 * on a laptop can hold, and pretending otherwise would lose the record.
 */
export default function People({ employees, companies, period, me, onError, onReload }) {
  const [panel, setPanel] = useState('records');

  if (STANDALONE) {
    return (
      <section className="card">
        <h2>People</h2>
        <p className="muted small">
          Warnings and appreciations, appraisals, the asset register, expense claims, tasks, the
          helpdesk, leaving and the full and final, and the audit trail all need the server
          version. They are records
          that have to outlive one browser and be seen by more than one person — a single file on
          a laptop cannot hold them. Everything to do with pay, attendance and hours works here as
          normal.
        </p>
      </section>
    );
  }

  const props = { employees, companies, period, me, onError, onReload };

  return (
    <section className="stack">
      <div className="sub-tabs toolbar">
        {PANELS.map(([key, label]) => (
          <button key={key} className={panel === key ? 'active' : undefined} onClick={() => setPanel(key)}>
            {label}
          </button>
        ))}
      </div>

      {panel === 'records' && <Records {...props} />}
      {panel === 'appraisals' && <Appraisals {...props} />}
      {panel === 'assets' && <Assets {...props} />}
      {panel === 'claims' && <Claims {...props} />}
      {panel === 'tasks' && <Tasks {...props} />}
      {panel === 'helpdesk' && <Helpdesk {...props} />}
      {panel === 'leaving' && <Leaving {...props} />}
      {panel === 'reminders' && <Reminders {...props} />}
      {panel === 'trail' && <Trail {...props} />}
    </section>
  );
}
