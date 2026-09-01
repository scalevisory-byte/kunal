import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { LEAVE_TYPES, calculateRow, totalRows } from '../../../shared/calc.js';
import { statutoryReport } from '../../../shared/statutory.js';
import { formatDuration, monthTotals } from '../../../shared/timesheet.js';
import { MONTHS, days, daysInMonth, rupees } from '../format.js';

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
export default function Dashboard({
  period,
  periods = [],
  payroll,
  employees,
  companyId,
  companyName,
  onGo,
  onPeriod,
}) {
  const [leave, setLeave] = useState([]);
  const [history, setHistory] = useState([]); // the last few months, for the trend

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

  /**
   * The months either side of this one, so the trend and the comparison have
   * something to compare against. They are fetched whole and filtered here,
   * because the standalone file answers the payroll path without query
   * parameters - one code path for both builds.
   */
  useEffect(() => {
    let cancelled = false;
    if (!period || !periods.length) return undefined;
    const ordered = [...periods].sort((a, b) => a.year - b.year || a.month - b.month);
    const upto = ordered.filter((p) => p.year * 12 + p.month <= period.year * 12 + period.month);
    const wanted = upto.slice(-6);
    Promise.all(
      wanted.map((p) =>
        api
          // sync=false: this is a read of a month that may be long closed, and
          // looking at it must not pull today's new hires or loan instalments
          // back into it.
          .get(`/periods/${p.id}/payroll?sync=${p.id === period.id}`)
          .then((data) => ({ period: p, rows: data.rows || [] }))
          .catch(() => null)
      )
    ).then((got) => !cancelled && setHistory(got.filter(Boolean)));
    return () => {
      cancelled = true;
    };
  }, [period?.id, periods.length]);

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

  /* Each month in the history, narrowed to the company on screen and run back
     through the engine, so the trend is measuring the same thing the headline
     figures are. */
  const trend = useMemo(
    () =>
      history.map(({ period: p, rows: raw }) => {
        const own = companyId ? raw.filter((r) => r.company_id === companyId) : raw;
        const calculated = own.map((r) => ({ ...r, ...calculateRow(r, p, r.attendance) }));
        const t = totalRows(calculated);
        return {
          period: p,
          label: `${MONTHS[p.month - 1].slice(0, 3)} ${String(p.year).slice(2)}`,
          staff: calculated.length,
          net: t.net_salary,
          gross: t.gross_salary,
          absent: calculated.reduce((sum, r) => sum + r.absent_days, 0),
          sunday: t.sunday_salary,
        };
      }),
    [history, companyId]
  );

  /* Last month, for the "compared with" strip. Only the month immediately
     before this one counts - a gap in the history is not a comparison. */
  const previous = useMemo(() => {
    if (!period || trend.length < 2) return null;
    const before = trend[trend.length - 2];
    const gap = period.year * 12 + period.month - (before.period.year * 12 + before.period.month);
    return gap === 1 ? before : null;
  }, [trend, period]);

  const thisMonth = useMemo(
    () => ({
      staff: rows.length,
      net: totals.net_salary,
      gross: totals.gross_salary,
      absent: rows.reduce((sum, r) => sum + r.absent_days, 0),
    }),
    [rows, totals]
  );

  /* Who came, who left, and whose day it is - all off the master, so it holds
     even for a month nothing has been marked on yet. */
  const people = useMemo(() => {
    if (!period) return null;
    const inMonth = (value) => {
      if (!value) return false;
      const d = new Date(value);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === period.year && d.getMonth() + 1 === period.month;
    };
    const sameMonth = (value) => {
      if (!value) return false;
      const d = new Date(value);
      return !Number.isNaN(d.getTime()) && d.getMonth() + 1 === period.month;
    };
    const mine = companyId ? employees.filter((e) => e.company_id === companyId) : employees;
    const active = mine.filter((e) => e.active);
    return {
      active: active.length,
      inactive: mine.length - active.length,
      joined: active.filter((e) => inMonth(e.joined_on)),
      left: mine.filter((e) => inMonth(e.left_on)),
      birthdays: active
        .filter((e) => sameMonth(e.dob))
        .map((e) => ({ ...e, dayOfMonth: new Date(e.dob).getDate() }))
        .sort((a, b) => a.dayOfMonth - b.dayOfMonth),
      anniversaries: active
        .filter((e) => sameMonth(e.joined_on) && new Date(e.joined_on).getFullYear() < period.year)
        .map((e) => ({
          ...e,
          dayOfMonth: new Date(e.joined_on).getDate(),
          years: period.year - new Date(e.joined_on).getFullYear(),
        }))
        .sort((a, b) => a.dayOfMonth - b.dayOfMonth),
    };
  }, [employees, companyId, period]);

  /* The few rows worth opening: most days lost, and most hours short. */
  const outliers = useMemo(() => {
    const absent = rows
      .filter((r) => r.absent_days > 0)
      .sort((a, b) => b.absent_days - a.absent_days)
      .slice(0, 5);
    const short = rows
      .filter((r) => r.ot_minutes < 0)
      .sort((a, b) => a.ot_minutes - b.ot_minutes)
      .slice(0, 5);
    const over = rows
      .filter((r) => r.ot_minutes > 0)
      .sort((a, b) => b.ot_minutes - a.ot_minutes)
      .slice(0, 5);
    return { absent, short, over };
  }, [rows]);

  /** What is going out by which route, for the person doing the paying. */
  const byMode = useMemo(() => {
    const modes = new Map();
    for (const row of rows) {
      // Modes come in from the sheet however they were typed - Gpay and GPAY
      // are one route, not two - so they are grouped case-insensitively.
      const typed = (row.payment_mode || '').trim();
      const key = typed.toLowerCase() || 'not set';
      const mode = typed || 'Not set';
      const at = modes.get(key) || { mode, count: 0, amount: 0, paid: 0 };
      at.count++;
      at.amount += row.final_payable;
      if (row.status === 'paid') at.paid += row.final_payable;
      modes.set(key, at);
    }
    return [...modes.values()].sort((a, b) => b.amount - a.amount);
  }, [rows]);

  /**
   * What has to be paid over, and roughly when. The dates are the ordinary
   * ones for a Gujarat employer - PF and ESI by the 15th of the following
   * month, Gujarat PT by the 15th - and they are stated as a reminder, not as
   * advice: the note under the list says to check them.
   */
  const filings = useMemo(() => {
    if (!period) return [];
    const next = period.month === 12
      ? { year: period.year + 1, month: 1 }
      : { year: period.year, month: period.month + 1 };
    const by = (day) => `${day} ${MONTHS[next.month - 1].slice(0, 3)} ${next.year}`;
    return [
      {
        label: 'PF',
        note: `employee ${rupees(totals.pf)} + employer share`,
        amount: totals.pf,
        due: by(15),
      },
      { label: 'ESI', note: 'employee + employer share', amount: totals.esi, due: by(15) },
      { label: 'Professional tax', note: 'per company', amount: totals.pt, due: by(15) },
    ];
  }, [period, totals]);

  if (!period || !payroll) {
    return (
      <p className="card muted">
        No month is open yet. Use <strong>New month</strong> above to start one.
      </p>
    );
  }

  /** The first few names behind a count, so the line says who as well as how many. */
  const naming = (list, get = (x) => x.name) => {
    const names = list.slice(0, 3).map(get).filter(Boolean);
    if (!names.length) return '';
    const more = list.length - names.length;
    return ` — ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  };

  const unmarkedPeople = rows.filter((row) => {
    const marked = Object.values(row.attendance || {}).filter(
      (e) => ((typeof e === 'object' ? e?.code : e) || '') !== ''
    ).length;
    return marked === 0;
  });

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
    unmarkedPeople.length > 0 && {
      key: 'unmarked',
      tone: 'warn',
      text: `${unmarkedPeople.length} people have no attendance marked at all${naming(
        unmarkedPeople,
        (r) => r.employee_name
      )}`,
      go: 'attendance',
    },
    attendance?.blank > 0 &&
      unmarkedPeople.length === 0 && {
        key: 'blank',
        tone: 'warn',
        text: `${attendance.blank} days across the month have no mark`,
        go: 'attendance',
      },
    overLeave.length > 0 && {
      key: 'leave',
      tone: 'bad',
      text: `${overLeave.length} over their leave entitlement — those days should be unpaid${naming(overLeave)}`,
      go: 'leave',
    },
    statutory?.pf.missing > 0 && {
      key: 'uan',
      tone: 'bad',
      text: `${statutory.pf.missing} on PF have no UAN — the return cannot go up without one${naming(
        statutory.pf.rows.filter((r) => r.missing?.includes('UAN')),
        (r) => r.name
      )}`,
      go: 'reports',
    },
    statutory?.esi.missing > 0 && {
      key: 'esic',
      tone: 'bad',
      text: `${statutory.esi.missing} on ESI have no ESIC number${naming(
        statutory.esi.rows.filter((r) => r.missing?.length),
        (r) => r.name
      )}`,
      go: 'reports',
    },
    money.holdCount > 0 && {
      key: 'hold',
      tone: 'warn',
      text: `${money.holdCount} on hold — ${rupees(money.hold)}${naming(
        rows.filter((r) => r.status === 'hold'),
        (r) => r.employee_name
      )}`,
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

        {previous ? (
          <p className="compare small">
            <span className="muted">Against {previous.label}:</span>
            <Delta label="net" now={thisMonth.net} was={previous.net} money />
            <Delta label="gross" now={thisMonth.gross} was={previous.gross} money />
            <Delta label="staff" now={thisMonth.staff} was={previous.staff} />
            <Delta label="days lost" now={thisMonth.absent} was={previous.absent} invert />
          </p>
        ) : (
          <p className="muted small">
            Nothing to compare against yet — this is the first month, or the one before it was
            never opened.
          </p>
        )}
      </div>

      {trend.length > 1 && (
        <div className="card">
          <h2>Last {trend.length} months</h2>
          <Trend trend={trend} current={period.id} onPeriod={onPeriod} />
        </div>
      )}

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

      <div className="dash-grid">
        <div className="card">
          <h2>
            People <button className="ghost tiny" onClick={() => onGo('employees')}>open</button>
          </h2>
          <div className="stat-row">
            <Stat label="On the books" value={people.active} plain />
            <Stat label="Joined" value={people.joined.length} plain />
            <Stat label="Left" value={people.left.length} plain />
            <Stat label="Not active" value={people.inactive} plain />
          </div>
          <NameList label="Joined this month" list={people.joined} />
          <NameList label="Left this month" list={people.left} />
          <NameList
            label="Birthdays"
            list={people.birthdays}
            suffix={(e) => `${MONTHS[period.month - 1].slice(0, 3)} ${e.dayOfMonth}`}
          />
          <NameList
            label="Work anniversaries"
            list={people.anniversaries}
            suffix={(e) => `${e.years} year${e.years === 1 ? '' : 's'}`}
          />
          {!people.joined.length &&
            !people.left.length &&
            !people.birthdays.length &&
            !people.anniversaries.length && (
              <p className="muted small">
                Nothing this month. Dates of birth and joining dates are on each employee's
                record — fill them in and they show up here.
              </p>
            )}
        </div>

        <div className="card">
          <h2>
            Worth a look <button className="ghost tiny" onClick={() => onGo('attendance')}>open</button>
          </h2>
          <NameList
            label="Most days lost"
            list={outliers.absent}
            name={(r) => r.employee_name}
            suffix={(r) => `${days(r.absent_days)} day${r.absent_days === 1 ? '' : 's'}`}
          />
          <NameList
            label="Most hours short"
            list={outliers.short}
            name={(r) => r.employee_name}
            suffix={(r) => formatDuration(-r.ot_minutes)}
          />
          <NameList
            label="Most overtime"
            list={outliers.over}
            name={(r) => r.employee_name}
            suffix={(r) => formatDuration(r.ot_minutes)}
          />
          {!outliers.absent.length && !outliers.short.length && !outliers.over.length && (
            <p className="muted small">
              Nobody is absent and nobody is short this month — either it is a clean month or
              the attendance is not marked yet.
            </p>
          )}
        </div>

        <div className="card">
          <h2>
            How it goes out <button className="ghost tiny" onClick={() => onGo('sheet')}>open</button>
          </h2>
          {rows.length ? (
            <table className="sheet">
              <thead>
                <tr>
                  <th className="sticky-name">Mode</th>
                  <th>People</th>
                  <th>Amount</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {byMode.map((mode) => (
                  <tr key={mode.mode}>
                    <td className="sticky-name">{mode.mode}</td>
                    <td className="num">{mode.count}</td>
                    <td className="num">{rupees(mode.amount)}</td>
                    <td className="num muted">{rupees(mode.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">No rows yet.</p>
          )}
          <p className="muted small">
            Sunday duty is not in here — it is paid from its own register, in its own way.
          </p>
        </div>

        <div className="card">
          <h2>
            Filing <button className="ghost tiny" onClick={() => onGo('reports')}>open</button>
          </h2>
          <ul className="due-list">
            {filings.map((filing) => (
              <li key={filing.label}>
                <span className="due-what">
                  {filing.label}
                  <span className="hint">{filing.note}</span>
                </span>
                <span className="num">{rupees(filing.amount)}</span>
                <span className="muted small">by {filing.due}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            The usual dates for a Gujarat employer. Check them against the portal for the year —
            they move, and a state can change its own.
          </p>
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
                <th title="Days marked present, out of the days that carry any mark">Present</th>
                <th>Days lost</th>
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
                    <td className="num">{presentRate(company.rows)}</td>
                    <td className="num">
                      {days(company.rows.reduce((sum, r) => sum + r.absent_days, 0))}
                    </td>
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
                  <td colSpan={9} className="empty">
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

/** Days marked present out of the days that carry any mark at all. */
function presentRate(rows) {
  let marked = 0;
  let present = 0;
  for (const row of rows) {
    for (const entry of Object.values(row.attendance || {})) {
      const code = (typeof entry === 'object' ? entry?.code : entry) || '';
      if (!code) continue;
      marked++;
      if (code !== 'A' && code !== 'AD' && code !== 'UL') present++;
    }
  }
  return marked ? `${Math.round((present / marked) * 100)}%` : '-';
}

/**
 * One month against the one before it. Down is normally the bad direction, so
 * the colour follows the number - except for days lost, where it is the other
 * way round and `invert` says so.
 */
function Delta({ label, now, was, money, invert }) {
  const change = now - was;
  if (!was && !now) return null;
  if (change === 0) {
    return (
      <span className="delta">
        {label} <span className="muted">same</span>
      </span>
    );
  }
  const pct = was ? Math.round((change / Math.abs(was)) * 100) : null;
  const good = invert ? change < 0 : change > 0;
  const show = money ? rupees(Math.abs(change)) : days(Math.abs(change));
  return (
    <span className={`delta${good ? ' up' : ' down'}`}>
      {change > 0 ? '▲' : '▼'} {show}
      {pct !== null && <span className="muted"> ({Math.abs(pct)}%)</span>} {label}
    </span>
  );
}

/** A handful of names with something after each, or nothing at all. */
function NameList({ label, list, name = (e) => e.name, suffix }) {
  if (!list?.length) return null;
  return (
    <p className="name-list small">
      <span className="muted">{label}</span>
      {list.map((item, i) => (
        <span key={item.id ?? item.employee_id ?? i} className="name-item">
          {name(item)}
          {suffix && <span className="muted"> {suffix(item)}</span>}
        </span>
      ))}
    </p>
  );
}

/**
 * Net payable per month as bars, drawn by hand rather than by a charting
 * library - it is one series and a handful of months, and the standalone file
 * has to stay one file.
 */
function Trend({ trend, current, onPeriod }) {
  const top = Math.max(...trend.map((t) => t.net), 1);
  return (
    <div className="trend">
      {trend.map((month) => {
        const height = Math.max(2, Math.round((month.net / top) * 100));
        const isNow = month.period.id === current;
        return (
          <button
            key={month.period.id}
            className={`trend-bar${isNow ? ' now' : ''}`}
            disabled={!onPeriod || isNow}
            title={`${month.period.label} — ${month.staff} staff, gross ${rupees(month.gross)}, ${days(month.absent)} days lost`}
            onClick={() => onPeriod?.(month.period.id)}
          >
            <span className="trend-value">{rupees(month.net)}</span>
            <span className="trend-track">
              <span className="trend-fill" style={{ height: `${height}%` }} />
            </span>
            <span className="trend-label">{month.label}</span>
            <span className="trend-sub muted">{month.staff}</span>
          </button>
        );
      })}
    </div>
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
