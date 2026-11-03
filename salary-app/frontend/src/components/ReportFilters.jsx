import { useMemo } from 'react';

/**
 * The filter bar every report shares.
 *
 * It asks each report what it accepts rather than showing the same six
 * controls everywhere: a salary slip is per employee and not per department, a
 * company summary is neither. A control that would do nothing is not drawn,
 * because a filter that changes no figures is worse than no filter — somebody
 * sets it, the total does not move, and they stop trusting the report.
 *
 * The month is NOT here. It is the picker at the top of every screen, and a
 * second month control on the same page is how two different months end up on
 * one report.
 */
export default function ReportFilters({ report, employees = [], companies = [], value, onChange }) {
  const show = (f) => report?.filters?.includes(f);

  const departments = useMemo(() => {
    const seen = new Map();
    for (const e of employees) {
      const name = String(e.department || '').trim();
      if (!name) continue;
      seen.set(name, (seen.get(name) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [employees]);

  const people = useMemo(
    () =>
      employees
        .filter((e) => !value.company_id || e.company_id === Number(value.company_id))
        .filter((e) => !value.department || String(e.department || '').trim() === value.department)
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [employees, value.company_id, value.department]
  );

  const set = (patch) => onChange({ ...value, ...patch });
  const on = ['company_id', 'branch_id', 'department', 'employee_id', 'from', 'to', 'q'].some(
    (k) => value[k]
  );

  if (!report) return null;

  return (
    <div className="toolbar report-filters">
      {show('company') && (
        <label className="pick">
          Company
          <select
            value={value.company_id || ''}
            onChange={(e) => set({ company_id: e.target.value, employee_id: '' })}
          >
            <option value="">All</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}

      {show('department') && (
        <label className="pick">
          Department
          <select
            value={value.department || ''}
            onChange={(e) => set({ department: e.target.value, employee_id: '' })}
          >
            <option value="">All</option>
            {departments.map(([name, count]) => (
              <option key={name} value={name}>{name} ({count})</option>
            ))}
            {/* Named, because on a real list this is usually the biggest group
                and hiding it is how somebody is left out of a report. */}
            <option value="\u0000none">Not set</option>
          </select>
        </label>
      )}

      {show('employee') && (
        <label className="pick">
          Employee
          <select value={value.employee_id || ''} onChange={(e) => set({ employee_id: e.target.value })}>
            <option value="">Everyone</option>
            {people.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
      )}

      {show('range') && (
        <>
          <label className="pick">
            From
            <input type="date" value={value.from || ''} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="pick">
            To
            <input type="date" value={value.to || ''} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </>
      )}

      {show('search') && (
        <input
          className="search"
          placeholder="Search a name"
          value={value.q || ''}
          onChange={(e) => set({ q: e.target.value })}
        />
      )}

      {on && (
        <button
          className="ghost"
          onClick={() => onChange({ company_id: '', branch_id: '', department: '', employee_id: '', from: '', to: '', q: '' })}
        >
          Clear
        </button>
      )}
    </div>
  );
}
