import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { MONTH_COLUMNS } from '../../../shared/employeeReport.js';
import { toCsv } from '../../../shared/statutory.js';

const inr = (n) => (Number(n) ? `₹${Number(n).toLocaleString('en-IN')}` : '');
const hours = (minutes) => (minutes ? `${Math.floor(minutes / 60).toLocaleString('en-IN')}h` : '');

/**
 * One person, down the months. This is the page that gets printed for a loan
 * application, an appraisal or a resignation, so it reads top to bottom:
 * who they are, what the year came to, their leave, then the months.
 */
export default function EmployeeReport({ employeeId, onClose, onError }) {
  const [data, setData] = useState(null);
  const [year, setYear] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get(`/employees/${employeeId}/report${year ? `?year=${year}` : ''}`)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setLoading(false);
        onError(err);
      });
    return () => {
      alive = false;
    };
  }, [employeeId, year, onError]);

  if (!data && loading) return <div className="picker-backdrop"><div className="modal"><p className="loading">Loading…</p></div></div>;
  if (!data) return null;

  const { employee, months, totals, leave, years } = data;

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="modal profile wide" onClick={(e) => e.stopPropagation()}>
        <div className="payslip-head">
          <div>
            <h2>{employee.name}</h2>
            <p className="muted small">
              {[employee.code && `#${employee.code}`, employee.company_name, employee.designation, employee.department]
                .filter(Boolean)
                .join(' · ')}
              {employee.joined_on ? ` · joined ${employee.joined_on}` : ''}
              {employee.left_on ? ` · left ${employee.left_on}` : ''}
            </p>
          </div>
          <div className="no-print row">
            <select value={year ?? ''} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}>
              <option value="">All months</option>
              {(years || []).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button onClick={() => window.print()}>Print</button>
            <button
              onClick={() =>
                save(
                  toCsv(MONTH_COLUMNS, months),
                  `${employee.name.replace(/\s+/g, '-')}${year ? `-${year}` : ''}.csv`
                )
              }
            >
              CSV
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        {!months.length ? (
          <p className="empty">
            No months to show{year ? ` for ${year}` : ''}. They have no payroll row yet — open a
            month on the Salary sheet first.
          </p>
        ) : (
          <>
            <div className="figures" style={{ marginBottom: '1rem' }}>
              <Fig n={totals.months} k="Months paid" />
              <Fig n={inr(totals.net_salary)} k="Net paid" />
              <Fig n={inr(totals.average_net)} k="Average a month" />
              <Fig n={totals.payable_days} k="Payable days" />
              <Fig n={totals.days_lost} k="Days lost" />
              <Fig
                n={totals.attendance_percent == null ? '—' : `${totals.attendance_percent}%`}
                k="Attendance"
              />
              {totals.sunday_salary ? <Fig n={inr(totals.sunday_salary)} k="Sunday pay" /> : null}
              {totals.worked_minutes ? <Fig n={hours(totals.worked_minutes)} k="Hours worked" /> : null}
            </div>

            <h3>Leave</h3>
            <div className="scroll">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th className="num">Quota (year)</th>
                    <th className="num">Taken</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {[['CL', 'Casual'], ['SL', 'Sick'], ['PL', 'Privilege']].map(([key, label]) => (
                    <tr key={key}>
                      <td>{label} leave</td>
                      <td className="num">{leave.quotas[key] || '—'}</td>
                      <td className="num">{leave.taken[key] || ''}</td>
                      <td
                        className="num"
                        style={{ color: leave.balance[key] < 0 ? 'var(--bad)' : undefined }}
                      >
                        {leave.balance[key]}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>Unpaid leave</td>
                    <td className="num muted">no quota</td>
                    <td className="num">{leave.unpaid || ''}</td>
                    <td className="num muted">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Counted from the marks on the grid, not kept as a running balance, so it cannot
              drift away from the attendance. The quota is a year&apos;s worth
              {year ? '' : ' — this view spans every month on record, so compare it per year'}
              {leave.over.length ? ` · over quota on ${leave.over.join(', ')}` : ''}.
            </p>

            <h3 style={{ marginTop: '1.2rem' }}>Month by month</h3>
            <div className="scroll">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">P</th>
                    <th className="num">A</th>
                    <th className="num">Leave</th>
                    <th className="num">Lost</th>
                    <th className="num">Payable</th>
                    <th className="num">%</th>
                    <th className="num">Gross</th>
                    <th className="num">PF</th>
                    <th className="num">ESI</th>
                    <th className="num">PT</th>
                    <th className="num">Loan</th>
                    <th className="num">Net</th>
                    <th className="num">Sunday</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.period_id}>
                      <td className="name-cell">{m.label}</td>
                      <td className="num">{m.present || ''}</td>
                      <td className="num" style={{ color: m.absent ? 'var(--bad)' : undefined }}>
                        {m.absent || ''}
                      </td>
                      <td className="num">
                        {m.casual_leave + m.sick_leave + m.paid_leave + m.unpaid_leave || ''}
                      </td>
                      <td className="num">{m.days_lost || ''}</td>
                      <td className="num">{m.payable_days}</td>
                      <td className="num">{m.attendance_percent == null ? '—' : `${m.attendance_percent}%`}</td>
                      <td className="num">{inr(m.gross_salary)}</td>
                      <td className="num">{inr(m.pf)}</td>
                      <td className="num">{inr(m.esi)}</td>
                      <td className="num">{inr(m.pt)}</td>
                      <td className="num">{inr(m.loan_deduction)}</td>
                      <td className="num"><strong>{inr(m.net_salary)}</strong></td>
                      <td className="num">{inr(m.sunday_salary)}</td>
                      <td className="small">{m.status}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>{totals.months} months</strong></td>
                    <td className="num">{totals.present}</td>
                    <td className="num">{totals.absent}</td>
                    <td className="num">
                      {totals.casual_leave + totals.sick_leave + totals.paid_leave + totals.unpaid_leave}
                    </td>
                    <td className="num">{totals.days_lost}</td>
                    <td className="num">{totals.payable_days}</td>
                    <td className="num">
                      {totals.attendance_percent == null ? '—' : `${totals.attendance_percent}%`}
                    </td>
                    <td className="num">{inr(totals.gross_salary)}</td>
                    <td className="num">{inr(totals.pf)}</td>
                    <td className="num">{inr(totals.esi)}</td>
                    <td className="num">{inr(totals.pt)}</td>
                    <td className="num">{inr(totals.loan_deduction)}</td>
                    <td className="num"><strong>{inr(totals.net_salary)}</strong></td>
                    <td className="num">{inr(totals.sunday_salary)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {totals.unmarked_days ? (
              <p className="banner">
                {totals.unmarked_days} day{totals.unmarked_days === 1 ? '' : 's'} across these
                months were never marked. An unmarked day is paid as a working day, so the
                figures above assume they were worked.
              </p>
            ) : null}

            <p className="muted small">
              Every figure here came out of the salary sheet&apos;s own calculation — this page
              assembles, it does not recalculate, so a month here and that month&apos;s payslip
              cannot disagree. <strong>Sunday pay</strong> is settled on its own register and is
              shown beside the net, never added into it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Fig({ n, k }) {
  return (
    <div className="figure">
      <span className="n">{n}</span>
      <span className="k">{k}</span>
    </div>
  );
}

function save(body, filename) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
