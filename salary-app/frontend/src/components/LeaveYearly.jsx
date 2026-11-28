import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { col, num, printReport } from '../printReport.js';
import { days } from '../format.js';

/**
 * THE YEAR'S LEAVE, ONE BALANCE (v2.38.0).
 *
 * Dinesh: *"need only 2 leaves / casual leave / sick leave / both are unpaid"*
 * and *"20 unpaid leave me se kitni leave le li he"*. So the register is one
 * figure per person - casual and sick together, against the yearly limit -
 * not three quotas nobody had set. Taken is counted off the attendance grid,
 * only on months that charge it.
 *
 * Both kinds are UNPAID: each day already came off that month's salary. The
 * limit is not a quota to be paid out; it is where applications stop.
 */
export default function LeaveYearly({ rows, year, policy, loading, onOpen, onPolicy, canChange }) {
  const [query, setQuery] = useState('');
  const [onlyNear, setOnlyNear] = useState(false);
  const [limit, setLimit] = useState(policy.yearly_limit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => !onlyNear || r.yearly.left <= 3)
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          (r.company_name || '').toLowerCase().includes(q) ||
          (r.department || '').toLowerCase().includes(q)
      );
  }, [rows, query, onlyNear]);

  const used = filtered.reduce((s, r) => s + r.yearly.used, 0);
  const fromLabel = (() => {
    const [y, m] = String(policy.from || '').split('-').map(Number);
    return y && m ? new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : policy.from;
  })();
  const done = rows.filter((r) => r.yearly.left <= 0).length;
  const oldPaid = rows.filter((r) => r.taken?.PL > 0).length;

  const saveLimit = async () => {
    const value = Math.round(Number(limit));
    if (!value || value < 1 || value === policy.yearly_limit) return;
    setBusy(true);
    setError('');
    try {
      const got = await api.put('/leave/policy', { ...policy, yearly_limit: value });
      onPolicy(got.policy);
    } catch (err) {
      setError(err.message);
      setLimit(policy.yearly_limit);
    } finally {
      setBusy(false);
    }
  };

  const print = () =>
    printReport({
      title: 'Leave register',
      subtitle: `${year} · casual and sick leave, unpaid, against ${policy.yearly_limit} days`,
      meta: [`${filtered.length} people`, `${days(used)} days taken`, `${done} at or past the limit`],
      columns: [
        col('#', (_r, i) => i + 1, '4%'),
        col('Employee', (r) => r.name),
        col('Company / department', (r) => r.department || r.company_name || ''),
        num('CL taken', (r) => days(r.yearly.CL)),
        num('SL taken', (r) => days(r.yearly.SL)),
        num('Used', (r) => days(r.yearly.used)),
        num('Left', (r) => days(r.yearly.left)),
      ],
      rows: filtered,
      totals: { label: `Total (${filtered.length})`, Used: days(used) },
      footer:
        'Casual and sick leave are both unpaid: each day came off that month\'s salary. Once the yearly limit is used, no more leave can be applied for.',
    });

  return (
    <div className="card">
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search employee, company or department"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={onlyNear} onChange={(e) => setOnlyNear(e.target.checked)} />
          Only 3 days or fewer left
        </label>
        <button className="ghost" onClick={print} disabled={!filtered.length}>
          Print the leave register
        </button>
        <span className="grow" />
        <label className="inline-num" title="Casual and sick leave together, per calendar year">
          Yearly limit
          <input
            className="cell-input narrow"
            inputMode="numeric"
            value={limit}
            disabled={!canChange || busy}
            onChange={(e) => setLimit(e.target.value)}
            onBlur={saveLimit}
          />
          days
        </label>
        {loading && <span className="pill saving">Loading…</span>}
        {done > 0 && <span className="pill locked">{done} at or past the limit</span>}
      </div>
      {error && <p className="error">{error}</p>}

      <p className="muted small">
        Only <strong>casual (CL)</strong> and <strong>sick (SL)</strong> leave are given, and{' '}
        <strong>both are unpaid</strong> — each day costs a day's salary, from {fromLabel}. Together
        they may come to {policy.yearly_limit} days in a calendar year; after that an application is
        refused. Privilege leave is no longer given; days already marked PL keep their mark.
      </p>

      <div className="table-wrap unboxed">
        <table className="sheet leave-register leave-yearly">
          <thead>
            <tr>
              <th className="sticky-name">Employee</th>
              <th>Company / department</th>
              <th className="num">CL taken</th>
              <th className="num">SL taken</th>
              <th className="num">Used</th>
              <th className="num">Left of {policy.yearly_limit}</th>
              <th className="leave-bar-col">Of the year</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const y = row.yearly;
              const share = Math.min(100, Math.round((y.used / y.limit) * 100));
              return (
                <tr key={row.employee_id}>
                  <td className="sticky-name">
                    <button
                      type="button"
                      className="link name-link"
                      onClick={() => onOpen(row.employee_id)}
                      title={`${row.name} — their leave ledger`}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="muted">{row.department || row.company_name}</td>
                  <td className="num">{y.CL ? days(y.CL) : '-'}</td>
                  <td className="num">{y.SL ? days(y.SL) : '-'}</td>
                  <td className="num strong">{days(y.used)}</td>
                  <td className={`num strong${y.left <= 0 ? ' deduct' : ''}`}>{days(y.left)}</td>
                  <td className="leave-bar-col">
                    <span className="leave-bar" title={`${y.used} of ${y.limit}`}>
                      <i style={{ width: `${share}%` }} className={y.left <= 0 ? 'full' : share >= 85 ? 'near' : ''} />
                    </span>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="empty">{onlyNear ? 'Nobody is close to the limit.' : 'Nobody on the list yet.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {oldPaid ? (
        <p className="muted small">
          {oldPaid} {oldPaid === 1 ? 'person has' : 'people have'} privilege leave marked earlier in {year}.
          Those days were paid under the old rule and are not part of this limit.
        </p>
      ) : null}
    </div>
  );
}
