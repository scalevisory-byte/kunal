import Leaving from './people/Leaving.jsx';

/**
 * LEAVING, FROM WHERE SOMEBODY IS STANDING.
 *
 * Dinesh's HR, looking at the employee master: *"exit employee ka nhi hai
 * option"*. It was not true that the app could not do it - the resignation,
 * the notice, the clearance list and the full and final have been in People →
 * Leaving all along. It was true that from the screen where somebody actually
 * sits with a resignation letter in their hand, the only control that looked
 * like a way out of the payroll was a red **Delete** - which takes every
 * month that person was ever paid in with it.
 *
 * So this is the SAME panel, opened on one person from their row. Nothing
 * here records anything itself: a second resignation form owned by the
 * Employees tab is the copy that stops matching the first one the week a line
 * is added to the settlement.
 */
export default function ExitEmployee({ employee, companies = [], onClose, onError, onReload }) {
  if (!employee) return null;
  const company = companies.find((c) => c.id === employee.company_id);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="modal profile wide" onClick={(e) => e.stopPropagation()}>
        <div className="payslip-head">
          <div>
            <h2>{employee.name}</h2>
            <p className="muted small">
              {[employee.code && `#${employee.code}`, company?.name, employee.designation]
                .filter(Boolean)
                .join(' · ')}
              {employee.joined_on ? ` · joined ${employee.joined_on}` : ''}
              {employee.left_on ? ` · last day ${employee.left_on}` : ''}
              {!employee.active && !employee.left_on ? ' · off the active list, no date' : ''}
            </p>
          </div>
          <div className="no-print row">
            <button className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>

        {/*
          * The rest is said by the panel itself, beside the date it is about.
          * The one thing worth saying here is the one this screen could be
          * mistaken for: the red button two inches behind this modal.
          */}
        <p className="muted small">
          Their past months stay exactly as they are — an exit is a record, not a deletion.
        </p>

        <Leaving
          employees={[employee]}
          only={employee}
          onError={onError}
          onReload={onReload}
        />
      </div>
    </div>
  );
}
