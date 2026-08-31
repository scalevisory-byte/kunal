import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { LEAVE_TYPES } from '../../../shared/calc.js';
import { days } from '../format.js';

/**
 * The leave register for a calendar year.
 *
 * Nothing is entered here. What somebody has taken is counted from the CL, SL
 * and PL marks on the attendance grid across every month of the year, so the
 * register and the grid can never disagree. Entitlement is set per employee;
 * anyone over it is flagged, because those days should have been unpaid.
 */
export default function Leave({ periods, employees, onPatch }) {
  const [year, setYear] = useState(() => periods[0]?.year || new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [onlyOver, setOnlyOver] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const years = useMemo(() => {
    const set = new Set(periods.map((p) => p.year));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [periods]);

  const load = async (forYear) => {
    setLoading(true);
    setError('');
    try {
      const { rows: list } = await api.get(`/leave?year=${forYear}`);
      setRows(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(year);
    // Reloading whenever the year or the staff list changes is the whole thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, employees]);

  const over = (row) => LEAVE_TYPES.filter((t) => row.taken[t.code] > row.quotas[t.code]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!onlyOver || over(r).length > 0) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          (r.company_name || '').toLowerCase().includes(q) ||
          (r.department || '').toLowerCase().includes(q))
    );
  }, [rows, query, onlyOver]);

  const totals = filtered.reduce(
    (acc, r) => {
      for (const t of LEAVE_TYPES) {
        acc.quota[t.code] += r.quotas[t.code];
        acc.taken[t.code] += r.taken[t.code];
      }
      acc.unpaid += r.taken.UL;
      return acc;
    },
    { quota: { CL: 0, SL: 0, PL: 0 }, taken: { CL: 0, SL: 0, PL: 0 }, unpaid: 0 }
  );

  const overCount = rows.filter((r) => over(r).length > 0).length;

  return (
    <section className="stack">
      <div className="card">
        <div className="toolbar">
          <label className="inline-num">
            Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <input
            className="search"
            placeholder="Search employee, company or department"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="check">
            <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} />
            Only over their entitlement
          </label>
          <span className="grow" />
          {loading && <span className="pill saving">Loading…</span>}
          {overCount > 0 && (
            <span className="pill locked">{overCount} over entitlement</span>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name" rowSpan={2}>Employee</th>
                <th rowSpan={2}>Company</th>
                {LEAVE_TYPES.map((t) => (
                  <th key={t.code} colSpan={3} className="leave-group">
                    {t.label} ({t.code})
                  </th>
                ))}
                <th rowSpan={2} title="Leave with no balance behind it - a day of salary each">
                  Unpaid
                </th>
              </tr>
              <tr>
                {LEAVE_TYPES.map((t) => [
                  <th key={`${t.code}-q`} title="Set on the employee's record">Due</th>,
                  <th key={`${t.code}-t`}>Taken</th>,
                  <th key={`${t.code}-b`}>Left</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.employee_id}>
                  <td className="sticky-name">{row.name}</td>
                  <td className="muted">{row.department || row.company_name}</td>
                  {LEAVE_TYPES.map((t) => {
                    const left = row.quotas[t.code] - row.taken[t.code];
                    return [
                      <td key={`${t.code}-q`} className="num">
                        <input
                          key={`${row.employee_id}-${t.quotaField}-${row.quotas[t.code]}`}
                          className="cell-input narrow"
                          inputMode="decimal"
                          defaultValue={row.quotas[t.code]}
                          onBlur={(e) => {
                            const value = Number(e.target.value) || 0;
                            if (value !== row.quotas[t.code]) {
                              onPatch(row.employee_id, { [t.quotaField]: value }).then(() => load(year));
                            }
                          }}
                        />
                      </td>,
                      <td key={`${t.code}-t`} className="num">{days(row.taken[t.code]) === '0' ? '-' : days(row.taken[t.code])}</td>,
                      <td key={`${t.code}-b`} className={`num strong${left < 0 ? ' deduct' : ''}`}>
                        {days(left)}
                      </td>,
                    ];
                  })}
                  <td className={`num${row.taken.UL ? ' deduct' : ''}`}>
                    {row.taken.UL ? days(row.taken.UL) : '-'}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={12} className="empty">
                    {onlyOver ? 'Nobody is over their entitlement.' : 'Nobody on the list yet.'}
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr>
                  <td className="sticky-name">Total ({filtered.length})</td>
                  <td />
                  {LEAVE_TYPES.map((t) => [
                    <td key={`${t.code}-q`} className="num">{days(totals.quota[t.code])}</td>,
                    <td key={`${t.code}-t`} className="num">{days(totals.taken[t.code])}</td>,
                    <td key={`${t.code}-b`} className="num">{days(totals.quota[t.code] - totals.taken[t.code])}</td>,
                  ])}
                  <td className="num">{days(totals.unpaid)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="muted small">
          <strong>Taken</strong> is counted from the CL, SL and PL marks on the attendance grid
          across every month of {year} — there is nothing to keep in step by hand. Change{' '}
          <strong>Due</strong> right here, or on the employee's own record.
        </p>
        <p className="muted small">
          A negative <strong>Left</strong> means more paid leave was taken than was due. Those days
          are still being paid — mark them <strong>Unpaid Leave</strong> on the grid instead if they
          should not be. <strong>Unpaid</strong> counts the UL marks, which already cost a day each.
        </p>
      </div>
    </section>
  );
}
