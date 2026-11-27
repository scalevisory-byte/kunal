import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import { days, rupees } from '../format.js';
import { col, num, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';
import { DEPARTMENT_COLUMNS, STATUS_COLUMNS } from '../../../shared/leaveReports.js';

/**
 * The two leave reports the catalogue listed and nobody could open.
 *
 * Both are worked out on the SERVER, off the same calculated month and the
 * same approval queue the office decides in — so neither can disagree with
 * the salary sheet or with the list of things waiting to be decided.
 */

/* ------------------------------------------------------------------ */

export function LeaveByDepartment({ period, companyId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!period) return;
    setError('');
    setData(null);
    api
      .get(`/leave/by-department/${period.id}${companyId ? `?company_id=${companyId}` : ''}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [period?.id, companyId]);

  if (!period) return null;
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted small">Loading…</p>;

  const t = data.totals;
  const print = () =>
    printReport({
      title: 'Leave by department',
      subtitle: period.label,
      meta: [
        `${t.people} people · ${t.took} took leave · ${days(t.total_days)} days in all`,
        'Paid leave is already inside the month’s salary; unpaid leave is already deducted from it.',
      ],
      columns: [
        col('Department', (r) => r.department),
        num('People', (r) => r.people, '7%'),
        num('Took leave', (r) => r.took, '8%'),
        num('CL', (r) => days(r.CL), '6%'),
        num('SL', (r) => days(r.SL), '6%'),
        num('PL', (r) => days(r.PL), '6%'),
        num('Unpaid', (r) => days(r.UL), '7%'),
        num('Total days', (r) => days(r.total_days), '8%'),
        num('Per head', (r) => r.per_head, '7%'),
        num('Paid leave cost', (r) => rupees(r.paid_amount), '11%'),
      ],
      rows: data.lines,
      totals: {
        label: 'All departments',
        People: t.people,
        'Took leave': t.took,
        CL: days(t.CL),
        SL: days(t.SL),
        PL: days(t.PL),
        Unpaid: days(t.UL),
        'Total days': days(t.total_days),
        'Per head': t.per_head,
        'Paid leave cost': rupees(t.paid_amount),
      },
      empty: 'Nobody took leave this month.',
      footer:
        'Counted off the same attendance marks the salary sheet is paid from. This report moves no money.',
    });

  return (
    <div className="card">
      <div className="late-head">
        <div>
          <h2>Leave by department — {period.label}</h2>
          <p className="muted small">
            Days per department, and what paid leave cost. <strong>Everybody</strong> is counted
            in the headcount, not only the people who took something — four days across three
            people and four across forty are different months.
          </p>
        </div>
        <span className="grow" />
        <button onClick={print}>Print</button>
        <button
          className="ghost"
          onClick={() => saveCsv(`Leave-by-department-${period.label}.csv`, DEPARTMENT_COLUMNS, data.lines)}
        >
          CSV
        </button>
      </div>

      <table className="sheet">
        <thead>
          <tr>
            <th>Department</th>
            <th className="num">People</th>
            <th className="num">Took leave</th>
            <th className="num">CL</th>
            <th className="num">SL</th>
            <th className="num">PL</th>
            <th className="num">Unpaid</th>
            <th className="num">Total days</th>
            <th className="num">Per head</th>
            <th className="num">Paid leave cost</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((r) => (
            <tr key={r.department}>
              <td>{r.department}</td>
              <td className="num">{r.people}</td>
              <td className="num">{r.took}</td>
              <td className="num">{r.CL || ''}</td>
              <td className="num">{r.SL || ''}</td>
              <td className="num">{r.PL || ''}</td>
              <td className="num">{r.UL || ''}</td>
              <td className="num strong">{days(r.total_days)}</td>
              <td className="num">{r.per_head || ''}</td>
              <td className="num">{r.paid_amount ? rupees(r.paid_amount) : ''}</td>
            </tr>
          ))}
          {!data.lines.length && (
            <tr><td colSpan={10} className="empty">Nobody took leave this month.</td></tr>
          )}
        </tbody>
        {data.lines.length > 1 && (
          <tfoot>
            <tr>
              <th>All departments</th>
              <th className="num">{t.people}</th>
              <th className="num">{t.took}</th>
              <th className="num">{days(t.CL)}</th>
              <th className="num">{days(t.SL)}</th>
              <th className="num">{days(t.PL)}</th>
              <th className="num">{days(t.UL)}</th>
              <th className="num">{days(t.total_days)}</th>
              <th className="num">{t.per_head}</th>
              <th className="num">{rupees(t.paid_amount)}</th>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="muted small">
        Paid leave is already inside the month&rsquo;s salary and unpaid leave is already
        deducted from it. Nothing here re-prices a day.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function LeaveApplications({ period, companyId, onGo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openOnly, setOpenOnly] = useState(true);

  useEffect(() => {
    setError('');
    setData(null);
    const q = [period ? `period_id=${period.id}` : '', companyId ? `company_id=${companyId}` : '']
      .filter(Boolean)
      .join('&');
    api
      .get(`/leave/applications${q ? `?${q}` : ''}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [period?.id, companyId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted small">Loading…</p>;

  const t = data.totals;
  const shown = openOnly ? data.lines.filter((l) => l.open) : data.lines;

  const print = () =>
    printReport({
      title: 'Leave applications — status and ageing',
      subtitle: period ? period.label : 'every month',
      meta: [
        `${t.open} waiting of ${t.all} · ${t.with_manager} with a manager · ${t.with_office} with the office`,
        t.open ? `Longest wait: ${t.oldest} day(s)` : 'Nothing is waiting.',
        'A waiting application has changed nobody’s attendance and nobody’s pay.',
      ],
      columns: [
        col('Name', (r) => r.name),
        col('Department', (r) => r.department, '12%'),
        col('What', (r) => r.kind, '11%'),
        col('Days', (r) => (r.from_day === r.to_day ? `${r.from_day}` : `${r.from_day}–${r.to_day}`), '8%'),
        col('Reason', (r) => r.reason, '16%'),
        col('Raised', (r) => r.raised_on, '9%'),
        col('Status', (r) => r.status, '9%'),
        col('Waiting on', (r) => r.with_whom, '9%'),
        num('Days waiting', (r) => (r.waiting_days == null ? '' : r.waiting_days), '8%'),
      ],
      rows: shown,
      empty: openOnly ? 'Nothing is waiting to be decided.' : 'No applications.',
      footer:
        'A request never writes attendance; the final approval does. Decide these in Reports → Attendance corrections and approvals.',
    });

  return (
    <div className="card">
      <div className="late-head">
        <div>
          <h2>Leave applications — status and ageing</h2>
          <p className="muted small">
            Whose move it is, and how long it has been theirs. A <strong>pending</strong>{' '}
            application is with the <strong>manager</strong> where somebody has one; once they
            have backed it, it is with the <strong>office</strong>. Ageing runs from the last
            thing that happened to it, not from the day it was raised.
          </p>
        </div>
        <span className="grow" />
        <button onClick={print}>Print</button>
        <button
          className="ghost"
          onClick={() => saveCsv('Leave-applications.csv', STATUS_COLUMNS, shown)}
        >
          CSV
        </button>
      </div>

      <div className="stat-row">
        <Fig label="Waiting" value={t.open} strong />
        <Fig label="With a manager" value={t.with_manager} />
        <Fig label="With the office" value={t.with_office} />
        <Fig label="Longest wait" value={t.open ? `${t.oldest}d` : '—'} />
        <Fig label="Approved" value={t.approved} />
        <Fig label="Rejected" value={t.rejected} />
      </div>

      {t.open > 0 && (
        <div className="chips">
          {t.buckets.map((b) => (
            <span key={b.key} className="chip" aria-disabled>
              {b.label} <span className="muted">{b.count}</span>
            </span>
          ))}
        </div>
      )}

      <div className="row">
        <label className="inline">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />{' '}
          Only the ones still waiting
        </label>
        <span className="grow" />
        {onGo ? (
          <button className="ghost" onClick={() => onGo('reports', 'approvals')}>
            Decide them →
          </button>
        ) : null}
      </div>

      <table className="sheet">
        <thead>
          <tr>
            <th>Name</th>
            <th>Department</th>
            <th>What</th>
            <th>Days</th>
            <th>Reason</th>
            <th>Raised</th>
            <th>Status</th>
            <th>Waiting on</th>
            <th className="num">Waiting</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className={r.bucket === 'over-7' ? 'r3' : undefined}>
              <td>
                {r.name}
                {r.code ? <span className="muted small"> · {r.code}</span> : null}
              </td>
              <td className="small">{r.department}</td>
              <td className="small">
                {r.kind}
                {r.mark ? <span className="muted"> · {r.mark}</span> : null}
              </td>
              <td className="small">
                {r.from_day === r.to_day ? r.from_day : `${r.from_day}–${r.to_day}`}
                {r.days > 1 ? <span className="muted"> ({r.days}d)</span> : null}
              </td>
              <td className="small">{r.reason}</td>
              <td className="small">{r.raised_on}</td>
              <td className="small">
                {r.status}
                {r.recommended_by ? (
                  <span className="muted small"> · backed by {r.recommended_by}</span>
                ) : null}
                {r.decided_by ? <span className="muted small"> · by {r.decided_by}</span> : null}
              </td>
              <td className="small">{r.with_whom}</td>
              <td className="num">{r.waiting_days == null ? '' : `${r.waiting_days}d`}</td>
            </tr>
          ))}
          {!shown.length && (
            <tr>
              <td colSpan={9} className="empty">
                {openOnly ? 'Nothing is waiting to be decided.' : 'No applications.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="muted small">
        A waiting application has changed <strong>nobody&rsquo;s attendance and nobody&rsquo;s
        pay</strong>. Only the final approval writes a mark onto the grid.
      </p>
    </div>
  );
}

function Fig({ label, value, strong }) {
  return (
    <div className="stat plain">
      <span className={`value${strong ? ' strong' : ''}`}>{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

/**
 * EVERYBODY'S LEAVE BALANCE, ON ONE PAGE.
 *
 * Dinesh: *"Leave balance report complete"*. It existed as a CSV download and
 * nothing else - no screen, so nobody could look a figure up without opening a
 * spreadsheet. This is the same `/leave/balances` the Leave tab reads, laid
 * out as a report: for each paid leave type what they started the year with,
 * what was added, what was taken and what is left, plus unpaid leave taken.
 *
 * It assembles. Every figure is the ledger's own, so this page, the Leave tab,
 * the employee's portal and the line beside an Approve button are one number.
 */
export function LeaveBalanceReport({ period, companyId, department }) {
  const year = period?.year || new Date().getFullYear();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [onlyOver, setOnlyOver] = useState(false);

  useEffect(() => {
    setError('');
    setData(null);
    api
      .get(`/leave/balances?year=${year}${companyId ? `&company_id=${companyId}` : ''}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [year, companyId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted small">Loading…</p>;

  const paid = (data.types || []).filter((t) => t.paid);
  const q = query.trim().toLowerCase();
  const rows = (data.rows || []).filter(
    (r) =>
      (!department || String(r.department || '') === String(department)) &&
      (!q || r.name.toLowerCase().includes(q) || String(r.code || '').toLowerCase().includes(q)) &&
      (!onlyOver || paid.some((t) => r.types[t.code]?.over))
  );
  const of = (r, code, key) => Number(r.types[code]?.[key]) || 0;
  const sum = (code, key) => rows.reduce((n, r) => n + of(r, code, key), 0);
  const overdrawn = rows.filter((r) => paid.some((t) => r.types[t.code]?.over)).length;
  /* Nobody has been given anything: every Left reads nought, which looks like
     lost data and is really a job nobody has done. Said once, plainly. */
  const nothingSet = rows.length > 0 && rows.every((r) => paid.every((t) => !of(r, t.code, 'opening') && !of(r, t.code, 'credited')));

  const flat = rows.map((r) => {
    const out = { Code: r.code, Employee: r.name, Company: r.company_name, Department: r.department || '' };
    for (const t of paid) {
      out[`${t.code} due`] = of(r, t.code, 'opening') + of(r, t.code, 'credited');
      out[`${t.code} taken`] = of(r, t.code, 'availed');
      out[`${t.code} left`] = of(r, t.code, 'balance');
    }
    out['Unpaid taken'] = of(r, 'UL', 'availed');
    return out;
  });
  const heads = Object.keys(flat[0] || { Code: '', Employee: '', Company: '', Department: '' });

  const print = () =>
    printReport({
      title: 'Employee leave balance',
      subtitle: String(year),
      meta: [
        `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` +
          (overdrawn ? ` · ${overdrawn} have taken more than they had` : ''),
        'Due is what they started the year with plus anything added since. Unpaid leave has no balance: it is docked as it is taken.',
      ],
      landscape: true,
      columns: heads.map((h) => (['Code', 'Employee', 'Company', 'Department'].includes(h) ? col(h, (r) => r[h]) : num(h, (r) => days(r[h]), '6%'))),
      rows: flat,
      totals: {
        label: `Total (${rows.length})`,
        ...Object.fromEntries(
          heads.filter((h) => !['Code', 'Employee', 'Company', 'Department'].includes(h)).map((h) => [h, days(flat.reduce((n, r) => n + (Number(r[h]) || 0), 0))])
        ),
      },
    });

  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder="Search a name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} />
          Only people who have taken more than they had
        </label>
        <span className="grow" />
        <button className="ghost" onClick={print} disabled={!rows.length}>Print</button>
        <button className="ghost" onClick={() => saveCsv(`Leave-balance-${year}.csv`, heads.map((h) => [h, h]), flat)} disabled={!rows.length}>
          Excel (CSV)
        </button>
      </div>

      {nothingSet ? (
        <p className="banner">
          <strong>Nobody on this list has been given a leave entitlement</strong>, so every “left”
          reads nought. The days TAKEN are right — they come off the attendance grid. Set the
          entitlements under <strong>Leave → Balances</strong> and this report fills in.
        </p>
      ) : null}

      <table className="sheet">
        <thead>
          <tr>
            <th rowSpan={2}>Employee</th>
            <th rowSpan={2}>Company / department</th>
            {paid.map((t) => (
              <th key={t.code} colSpan={3}>{t.label}</th>
            ))}
            <th rowSpan={2} title="Unpaid leave has no balance - each day is docked as it is taken">Unpaid taken</th>
          </tr>
          <tr>
            {paid.map((t) => (
              <Fragment key={t.code}>
                <th title="What they started the year with, plus anything added since">Due</th>
                <th>Taken</th>
                <th>Left</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee_id}>
              <td>
                {r.name}
                <div className="muted small">{r.code}</div>
              </td>
              <td className="muted small">{[r.company_name, r.department].filter(Boolean).join(' · ')}</td>
              {paid.map((t) => (
                <Fragment key={t.code}>
                  <td className="num muted">{days(of(r, t.code, 'opening') + of(r, t.code, 'credited'))}</td>
                  <td className="num">{days(of(r, t.code, 'availed'))}</td>
                  {/* Never clamped: somebody who has taken more than they had
                      should read as that, not as a comfortable nought. */}
                  <td className={`num strong${r.types[t.code]?.over ? ' deduct' : ''}`}>{days(of(r, t.code, 'balance'))}</td>
                </Fragment>
              ))}
              <td className="num">{days(of(r, 'UL', 'availed'))}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={3 + paid.length * 3} className="empty">Nobody matches.</td></tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr>
              <td>Total ({rows.length})</td>
              <td />
              {paid.map((t) => (
                <Fragment key={t.code}>
                  <td className="num">{days(sum(t.code, 'opening') + sum(t.code, 'credited'))}</td>
                  <td className="num">{days(sum(t.code, 'availed'))}</td>
                  <td className="num">{days(sum(t.code, 'balance'))}</td>
                </Fragment>
              ))}
              <td className="num">{days(sum('UL', 'availed'))}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="muted small">
        The same figures as <strong>Leave → Balances</strong>, the employee’s own portal and the
        line beside every Approve button. A figure in red has gone below nought: they have taken
        more than they had, which is somebody’s decision to make, not a sum to hide.
      </p>
    </div>
  );
}
