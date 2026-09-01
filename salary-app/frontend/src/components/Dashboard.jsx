import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { LEAVE_TYPES, calculateRow, totalRows } from '../../../shared/calc.js';
import { statutoryReport } from '../../../shared/statutory.js';
import { formatDuration, monthTotals } from '../../../shared/timesheet.js';
import { days, daysInMonth, rupees } from '../format.js';

/**
 * The month at a glance, on one screen.
 *
 * Nothing is entered here and nothing is calculated here that is not calculated
 * somewhere else - it reads the same rows the salary sheet does, through the
 * same engine, and puts the numbers Dinesh actually asks for in front of him:
 * what the month costs, what is still to pay, who is missing from attendance,
 * and what would stop a return from being filed.
 *
 * Every figure links to the tab it came from, so a number that looks wrong is
 * one click from the place it can be fixed.
 */
export default function Dashboard({ period, payroll, employees, companyName, onGo }) {
  const [leave, setLeave] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!period) return undefined;
    api
      .get(`/leave?year=${period.year}`)
      .then(({ rows }) => !cancelled && setLeave(rows || []))
      // The leave register is a nice-to-have here; the rest of the page stands
      // on its own if it cannot be read.
      .catch(() => !cancelled && setLeave([]));
    return () => {
      cancelled = true;
    };
  }, [period?.id, period?.year]);

  const rows = useMemo(
    () =>
      (payroll?.rows || []).map((row) => ({
        ...row,
        ...calculateRow(row, payroll.period, row.attendance),
      })),
    [payroll]
  );

  const totals = useMemo(() => totalRows(rows), [rows]);

  const money = useMemo(() => {
    const paid = rows.filter((r) => r.status === 'paid');
    const hold = rows.filter((r) => r.status === 'hold');
    return {
      paid: paid.reduce((s, r) => s + r.final_payable, 0),
      paidCount: paid.length,
      hold: hold.reduce((s, r) => s + r.final_payable, 0),
      holdCount: hold.length,
      pending: rows
        .filter((r) => r.status !== 'paid' && r.status !== 'hold')
        .reduce((s, r) => s + r.final_payable, 0),
      pendingCount: rows.filter((r) => r.status !== 'paid' && r.status !== 'hold').length,
      deductions: totals.pt + totals.esi + totals.pf + totals.loan_deduction + totals.deduction,
    };
  }, [rows, totals]);

  const sunday = useMemo(() => {
    const worked = rows.filter((r) => r.sundays_worked > 0);
    const unpaid = worked.filter((r) => r.sunday_status !== 'paid');
    return {
      people: worked.length,
      amount: worked.reduce((s, r) => s + r.sunday_salary, 0),
      unpaid: unpaid.reduce((s, r) => s + r.sunday_salary, 0),
      unpaidCount: unpaid.length,
    };
  }, [rows]);

  /* Attendance, counted off the marks rather than the payroll columns, so an
     unmarked day shows as unmarked instead of quietly counting as present. */
  const attendance = useMemo(() => {
    if (!period) return null;
    const total = daysInMonth(period.year, period.month);
    const acc = { present: 0, absent: 0, leave: 0, holiday: 0, sunday: 0, blank: 0, expected: 0 };
    const hours = { worked: 0, expected: 0, short: 0, overtime: 0, days: 0 };
    for (const row of rows) {
      const marks = row.attendance || {};
      acc.expected += total;
      for (let d = 1; d <= total; d++) {
        const entry = marks[d];
        const code = (typeof entry === 'object' ? entry?.code : entry) || '';
        if (!code) acc.blank++;
        else if (code === 'A' || code === 'AD' || code === 'UL') acc.absent++;
        else if (code === 'CL' || code === 'SL' || code === 'PL') acc.leave++;
        else if (code === 'PH') acc.holiday++;
        else if (code === 'S') acc.sunday++;
        else acc.present++;
      }
      const month = monthTotals(Object.values(marks), { hoursPerDay: period.hours_per_day });
      hours.days += month.days;
      hours.worked += month.worked;
      hours.expected += month.expected;
      hours.short += month.short;
      hours.overtime += month.overtime;
    }
    return { ...acc, hours };
  }, [rows, period]);

  // The register sends quotas and days taken; the balance is the difference,
  // worked out the same way the Leave tab does.
  const overLeave = useMemo(
    () => leave.filter((r) => LEAVE_TYPES.some((t) => (r.taken?.[t.code] || 0) > (r.quotas?.[t.code] || 0))),
    [leave]
  );

  const statutory = useMemo(() => {
    if (!payroll) return null;
    try {
      return statutoryReport({ period: payroll.period, rows });
    } catch {
      // A register that cannot be built is not worth taking the page down for.
      return null;
    }
  }, [payroll, rows]);

  /* Grouped from the rows on screen rather than from payroll.companies, so a
     company filter narrows this table the way it narrows every other tab. */
  const companies = useMemo(() => {
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.company_id)) {
        groups.set(row.company_id, { id: row.company_id, name: row.company_name, rows: [] });
      }
      groups.get(row.company_id).rows.push(row);
    }
    return [...groups.values()].map((group) => ({ ...group, totals: totalRows(group.rows) }));
  }, [rows]);

  const loans = useMemo(
    () => ({
      thisMonth: totals.loan_deduction,
      people: rows.filter((r) => r.loan_deduction > 0).length,
    }),
    [rows, totals]
  );

  if (!period || !payroll) {
    return (
      <p className="card muted">
        No month is open yet. Use <strong>New month</strong> above to start one.
      </p>
    );
  }

  const alerts = [
    money.pendingCount > 0 && {
      key: 'pending',
      tone: 'warn',
      text: `${money.pendingCount} salaries still to pay — ${rupees(money.pending)}`,
      go: 'sheet',
    },
    sunday.unpaidCount > 0 && {
      key: 'sunday',
      tone: 'warn',
      text: `${sunday.unpaidCount} Sunday payments still to make — ${rupees(sunday.unpaid)}`,
      go: 'sunday',
    },
    attendance?.blank > 0 && {
      key: 'blank',
      tone: 'warn',
      text: `${attendance.blank} days across the month have no mark`,
      go: 'attendance',
    },
    overLeave.length > 0 && {
      key: 'leave',
      tone: 'bad',
      text: `${overLeave.length} over their leave entitlement — those days should be unpaid`,
      go: 'leave',
    },
    statutory?.pf.missing > 0 && {
      key: 'uan',
      tone: 'bad',
      text: `${statutory.pf.missing} on PF have no UAN — the return cannot go up without one`,
      go: 'reports',
    },
    statutory?.esi.missing > 0 && {
      key: 'esic',
      tone: 'bad',
      text: `${statutory.esi.missing} on ESI have no ESIC number`,
      go: 'reports',
    },
    money.holdCount > 0 && {
      key: 'hold',
      tone: 'warn',
      text: `${money.holdCount} on hold — ${rupees(money.hold)}`,
      go: 'sheet',
    },
  ].filter(Boolean);

  return (
    <section className="stack dashboard">
      <div className="card">
        <h2>
          {period.label}
          {companyName && <span className="muted"> · {companyName}</span>}
          {period.locked ? <span className="pill locked"> Locked</span> : null}
        </h2>

        <div className="stat-row">
          <Stat label="Staff" value={rows.length} plain go={onGo} to="employees" />
          <Stat label="Gross" value={totals.gross_salary} go={onGo} to="sheet" />
          <Stat label="Deductions" value={money.deductions} go={onGo} to="sheet" />
          <Stat label="Net payable" value={totals.net_salary} strong go={onGo} to="sheet" />
          <Stat label="Paid" value={money.paid} sub={`${money.paidCount} of ${rows.length}`} go={onGo} to="sheet" />
          <Stat
            label="Still to pay"
            value={money.pending}
            sub={`${money.pendingCount} people`}
            go={onGo}
            to="sheet"
          />
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="card">
          <h2>Needs attention</h2>
          <ul className="alerts">
            {alerts.map((alert) => (
              <li key={alert.key} className={alert.tone}>
                <span>{alert.text}</span>
                <button className="ghost tiny" onClick={() => onGo(alert.go)}>
                  open
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dash-grid">
        <div className="card">
          <h2>
            Attendance <button className="ghost tiny" onClick={() => onGo('attendance')}>open</button>
          </h2>
          <div className="stat-row">
            <Stat label="Present" value={attendance.present} plain />
            <Stat label="Absent" value={attendance.absent} plain />
            <Stat label="Leave" value={attendance.leave} plain />
            <Stat label="Not marked" value={attendance.blank} plain />
          </div>
          <p className="muted small">
            Day counts across all {rows.length} people for the whole month. Paid holidays{' '}
            {attendance.holiday}, Sundays off {attendance.sunday}.
          </p>
        </div>

        <div className="card">
          <h2>
            Hours <button className="ghost tiny" onClick={() => onGo('time')}>open</button>
          </h2>
          {attendance.hours.days ? (
            <>
              <div className="stat-row">
                <Stat label="Worked" value={formatDuration(attendance.hours.worked)} plain />
                <Stat label="Expected" value={formatDuration(attendance.hours.expected)} plain />
                <Stat label="Short" value={`${attendance.hours.short}m`} plain />
                <Stat label="Overtime" value={`${attendance.hours.overtime}m`} plain />
              </div>
              <p className="muted small">
                From {attendance.hours.days} day{attendance.hours.days === 1 ? '' : 's'} with in
                and out times, at {days(period.hours_per_day)} hours a day.
              </p>
            </>
          ) : (
            <p className="muted small">
              No in/out times yet this month. Type them on the <strong>Time</strong> tab, or import
              the punch machine's file from <strong>Reports</strong>.
            </p>
          )}
        </div>

        <div className="card">
          <h2>
            Sunday duty <button className="ghost tiny" onClick={() => onGo('sunday')}>open</button>
          </h2>
          <div className="stat-row">
            <Stat label="People" value={sunday.people} plain />
            <Stat label="Amount" value={sunday.amount} />
            <Stat label="Still to pay" value={sunday.unpaid} sub={`${sunday.unpaidCount} people`} />
          </div>
          <p className="muted small">Paid on its own register, apart from the month's salary.</p>
        </div>

        <div className="card">
          <h2>
            Statutory <button className="ghost tiny" onClick={() => onGo('reports')}>open</button>
          </h2>
          <div className="stat-row">
            <Stat label="PF" value={totals.pf} sub={`${statutory?.pf.rows.length || 0} people`} />
            <Stat label="ESI" value={totals.esi} sub={`${statutory?.esi.rows.length || 0} people`} />
            <Stat label="PT" value={totals.pt} sub={`${statutory?.pt.exempt || 0} under the slab`} />
            <Stat label="Loans" value={loans.thisMonth} sub={`${loans.people} people`} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>By company</h2>
        <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th className="sticky-name">Company</th>
                <th>Staff</th>
                <th>Gross</th>
                <th>Deductions</th>
                <th>Net payable</th>
                <th>Paid</th>
                <th>Still to pay</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const paid = company.rows.filter((r) => r.status === 'paid');
                const outstanding = company.rows.filter((r) => r.status !== 'paid');
                const t = company.totals;
                return (
                  <tr key={company.id}>
                    <td className="sticky-name">{company.name}</td>
                    <td className="num">{t.count}</td>
                    <td className="num">{rupees(t.gross_salary)}</td>
                    <td className="num">
                      {rupees(t.pt + t.esi + t.pf + t.loan_deduction + t.deduction)}
                    </td>
                    <td className="num grand">{rupees(t.net_salary)}</td>
                    <td className="num muted">
                      {paid.length} · {rupees(paid.reduce((s, r) => s + r.final_payable, 0))}
                    </td>
                    <td className="num">
                      {outstanding.length} · {rupees(outstanding.reduce((s, r) => s + r.final_payable, 0))}
                    </td>
                  </tr>
                );
              })}
              {!companies.length && (
                <tr>
                  <td colSpan={7} className="empty">
                    No companies yet — add one under <strong>Employees</strong>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          {employees.filter((e) => e.active).length} active on the master
          {employees.length !== employees.filter((e) => e.active).length &&
            `, ${employees.length - employees.filter((e) => e.active).length} left`}
          . Working days are fixed at 26.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, sub, strong, plain, go, to }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{plain ? value : rupees(value)}</span>
      {sub && <span className="stat-sub muted small">{sub}</span>}
    </>
  );
  if (go && to) {
    return (
      <button className={`stat stat-link${strong ? ' strong' : ''}`} onClick={() => go(to)}>
        {body}
      </button>
    );
  }
  return <div className={`stat${strong ? ' strong' : ''}`}>{body}</div>;
}
