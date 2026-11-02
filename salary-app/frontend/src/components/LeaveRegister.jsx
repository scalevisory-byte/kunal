import { useMemo } from 'react';
import { LEAVE_TYPES, calculateRow } from '../../../shared/calc.js';
import { leaveRegister, leaveRegisterCsv } from '../../../shared/leaveRegister.js';
import { rupees } from '../format.js';

/**
 * The leave register — paid and unpaid, counted apart from the salary.
 *
 * Dinesh: "unpaid ka alag se gina jayega, paid leave ka alag se — alag hi
 * register banega dono ka."
 *
 * The thing to be clear about, and the page says it too: **this moves no
 * money.** Both figures are what the salary sheet already did, pulled out and
 * shown on their own — paid leave is a day the company paid for and is
 * already inside the salary; unpaid leave is a day it did not and is already
 * deducted. The register assembles; it never re-prices a day, so it and the
 * payslip cannot disagree.
 */
export default function LeaveRegister({ payroll }) {
  const { lines, totals } = useMemo(() => {
    if (!payroll) return { lines: [], totals: null };
    const rows = (payroll.rows || []).map((row) => ({
      ...row,
      ...calculateRow(row, payroll.period, row.attendance),
    }));
    return leaveRegister(rows);
  }, [payroll]);

  const save = () => {
    const rows = (payroll.rows || []).map((row) => ({
      ...row,
      ...calculateRow(row, payroll.period, row.attendance),
    }));
    const blob = new Blob([leaveRegisterCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leave-this-month.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!payroll) return null;

  return (
    <div className="card">
      <div className="late-head">
        <div>
          <h2>Leave this month — paid and unpaid</h2>
          <p className="muted small">
            Paid leave and unpaid leave, each counted on its own and apart from the salary
            sheet. Only the people who took something are listed. (The{' '}
            <strong>Leave register ({payroll.period?.year})</strong> file above is a different
            thing — that is the year&apos;s balances against each person&apos;s quota.)
          </p>
        </div>
        {lines.length > 0 && (
          <button className="ghost" onClick={save}>
            Leave this month (CSV)
          </button>
        )}
      </div>

      {!lines.length ? (
        <p className="muted small">Nobody took leave this month.</p>
      ) : (
        <>
          <div className="figures">
            <div className="figure">
              <span className="n">{totals.paid_days}</span>
              <span className="k">Paid leave days</span>
            </div>
            <div className="figure">
              <span className="n">{rupees(totals.paid_amount)}</span>
              <span className="k">Paid for those days</span>
            </div>
            <div className="figure">
              <span className="n">{totals.unpaid_days}</span>
              <span className="k">Unpaid leave days</span>
            </div>
            <div className="figure">
              <span className="n">{rupees(totals.unpaid_amount)}</span>
              <span className="k">Not paid for those</span>
            </div>
          </div>

          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="sticky-name">Name</th>
                  {LEAVE_TYPES.map((k) => (
                    <th key={k.code} className="num" title={`${k.label} leave, days`}>
                      {k.label}
                    </th>
                  ))}
                  <th className="num">Paid days</th>
                  <th className="num">Paid ₹</th>
                  <th className="num">Unpaid days</th>
                  <th className="num">Unpaid ₹</th>
                  <th className="num" title="Plain absence — not leave, shown so the two are not confused">
                    Absent
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.employee_id}>
                    <td className="sticky-name">{l.employee_name}</td>
                    {l.paid.map((k) => (
                      <td key={k.code} className="num">
                        {k.days || <span className="muted">—</span>}
                      </td>
                    ))}
                    <td className="num">{l.paid_days || <span className="muted">—</span>}</td>
                    <td className="num">{l.paid_amount ? rupees(l.paid_amount) : <span className="muted">—</span>}</td>
                    <td className="num">{l.unpaid_days || <span className="muted">—</span>}</td>
                    <td className="num deduct">
                      {l.unpaid_amount ? rupees(l.unpaid_amount) : <span className="muted">—</span>}
                    </td>
                    <td className="num muted">{l.absent_days || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky-name">
                    <strong>Total</strong> — {totals.people} {totals.people === 1 ? 'person' : 'people'}
                  </td>
                  {LEAVE_TYPES.map((k) => (
                    <td key={k.code} className="num">{totals.by_kind[k.code].days || '—'}</td>
                  ))}
                  <td className="num">{totals.paid_days}</td>
                  <td className="num">{rupees(totals.paid_amount)}</td>
                  <td className="num">{totals.unpaid_days}</td>
                  <td className="num deduct">{rupees(totals.unpaid_amount)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="muted small">
            <strong>Nothing here changes anybody&apos;s pay.</strong> A paid leave day is paid
            in full and that money is already in the month&apos;s salary; an unpaid day is
            already deducted from it. This register says what those days came to, separately,
            so the two can be read apart — the amounts are the salary sheet&apos;s own, never
            worked out a second time. Plain absence is shown on the right and is deliberately
            counted as neither: somebody who simply did not come in has not taken leave.
          </p>
        </>
      )}
    </div>
  );
}
