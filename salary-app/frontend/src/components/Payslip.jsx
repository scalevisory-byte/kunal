import { useMemo } from 'react';
import { calculateRow } from '../../../shared/calc.js';
import { days, rupees, rupees2 } from '../format.js';

/** A printable slip for one employee. Print with the browser to get a PDF. */
export default function Payslip({ period, row, onClose }) {
  // Recalculated here rather than read off the row, so a slip opened straight
  // after typing shows what was typed - the stored row only carries the
  // server's last answer.
  const calc = useMemo(() => calculateRow(row, period, row.attendance), [row, period]);

  // A slip reads as "earned, less deductions". A manual deduction is already
  // inside the gross everywhere else in the app, so it is added back into what
  // was earned and then listed with the other deductions - shown both ways at
  // once, and still balancing.
  const earned = calc.gross_salary + calc.deduction;

  const earnings = [
    ['Salary for the month', calc.salary],
    ['Overtime / short hours', calc.ot_salary],
    [row.remark ? `Added: ${row.remark}` : 'Other additions', calc.addition],
    ['Less: absent days', -calc.absent_salary],
  ].filter(([, amount]) => Number(amount) !== 0);

  const deductions = [
    ['Professional tax', calc.pt],
    ['ESI', calc.esi],
    ['PF', calc.pf],
    ['Loan / advance', calc.loan_deduction],
    [row.remark ? `Deducted: ${row.remark}` : 'Other deductions', calc.deduction],
  ].filter(([, amount]) => Number(amount) !== 0);

  const totalDeductions = deductions.reduce((sum, [, amount]) => sum + Number(amount), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal payslip" onClick={(e) => e.stopPropagation()}>
        <div className="payslip-head">
          <div>
            <h2>{row.company_name}</h2>
            <p className="muted">Salary slip — {period.label}</p>
          </div>
          <div className="no-print">
            <button onClick={() => window.print()}>Print / PDF</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        <table className="kv">
          <tbody>
            <tr><th>Employee</th><td>{row.employee_name}</td>
                <th>Working days</th><td>{days(calc.working_days)}</td></tr>
            <tr><th>Present days</th><td>{days(calc.present_days)}</td>
                <th>Absent days</th><td>{days(calc.absent_days)}</td></tr>
            <tr><th>Sundays worked</th><td>{days(calc.sundays_worked)}</td>
                <th>Rate per day</th><td>{rupees2(calc.per_day)}</td></tr>
            <tr><th>Paid leave</th><td>{row.mark_counts?.PL || 0}</td>
                <th>Unpaid leave</th><td>{row.mark_counts?.UL || 0}</td></tr>
          </tbody>
        </table>

        <div className="payslip-cols">
          <table className="sheet">
            <thead><tr><th>Earnings</th><th>Amount</th></tr></thead>
            <tbody>
              {earnings.map(([label, amount]) => (
                <tr key={label}><td>{label}</td><td className="num">{rupees(amount)}</td></tr>
              ))}
              <tr className="subtotal"><td>Gross salary</td><td className="num">{rupees(earned)}</td></tr>
            </tbody>
          </table>

          <table className="sheet">
            <thead><tr><th>Deductions</th><th>Amount</th></tr></thead>
            <tbody>
              {deductions.length ? (
                deductions.map(([label, amount]) => (
                  <tr key={label}><td>{label}</td><td className="num">{rupees(amount)}</td></tr>
                ))
              ) : (
                <tr><td className="muted">None</td><td className="num">-</td></tr>
              )}
              <tr className="subtotal">
                <td>Total deductions</td>
                <td className="num">{rupees(totalDeductions)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <table className="sheet totals-table">
          <tbody>
            <tr className="grand-row">
              <td>Net payable</td>
              <td className="num">{rupees(calc.net_salary)}</td>
            </tr>
            {/* Sunday duty is settled on its own register, so it is stated here
                for the record but never added into the month's payable. */}
            {calc.sunday_salary > 0 && (
              <tr className="muted">
                <td>
                  Sunday / holiday pay ({days(calc.sundays_worked)} × {rupees2(calc.per_day)})
                  <span className="hint"> paid separately</span>
                </td>
                <td className="num">{rupees(calc.sunday_salary)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <p className="muted small">
          Paid by {row.payment_mode || 'bank'}. Computer generated slip — no signature required.
        </p>
      </div>
    </div>
  );
}
