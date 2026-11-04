import { useState } from 'react';
import { STANDALONE } from '../../api.js';
import Appraisals from './Appraisals.jsx';
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
 * led to, expense claims, office tasks, the helpdesk, leaving and the full and
 * final, and who changed what.
 *
 * This used to be switched off entirely in the single-file build, on the
 * grounds that a record has to outlive one browser and be seen by more than
 * one person. The first half was never true - this file already holds 115
 * people, a year of attendance and every payslip, and it backs up to a file.
 * The second half IS true, and it is one sentence, not a reason to hide eight
 * panels: there is nobody else here. The banner below says that instead.
 */
export default function People({ employees, companies, period, me, onError, onReload }) {
  const [panel, setPanel] = useState('records');

  const props = { employees, companies, period, me, onError, onReload };

  return (
    <section className="stack">
      {/*
        * Said once, at the top, rather than switching the tab off: what is
        * missing offline is a second person, not the records.
        */}
      {STANDALONE && (
        <p className="muted small">
          All of this works in this file. What it cannot do is involve anybody else: you raise a
          claim and you approve it, an employee cannot open the helpdesk themselves, and the
          trail’s “who” is a name typed on a form — which is true of the server version too,
          since there is one shared password.
        </p>
      )}
      <div className="sub-tabs toolbar">
        {PANELS.map(([key, label]) => (
          <button key={key} className={panel === key ? 'active' : undefined} onClick={() => setPanel(key)}>
            {label}
          </button>
        ))}
      </div>

      {panel === 'records' && <Records {...props} />}
      {panel === 'appraisals' && <Appraisals {...props} />}
      {panel === 'claims' && <Claims {...props} />}
      {panel === 'tasks' && <Tasks {...props} />}
      {panel === 'helpdesk' && <Helpdesk {...props} />}
      {panel === 'leaving' && <Leaving {...props} />}
      {panel === 'reminders' && <Reminders {...props} />}
      {panel === 'trail' && <Trail {...props} />}
    </section>
  );
}
