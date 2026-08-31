import { days, rupees, rupees2 } from '../format.js';

/** A printable slip for one employee. Print with the browser to get a PDF. */
export default function Payslip({ period, row, onClose }) {
  const earnings = [
    ['Salary for the month', row.salary],
    ['Overtime / short hours', row.ot_salary],
    ['Other additions / deductions', row.adjustment],
    ['Less: absent days', -row.absent_salary],
  ].filter(([, amount]) => Number(amount) !== 0);

  const deductions = [
    ['Professional tax', row.pt],
    ['ESI', row.esi],
    ['PF', row.pf],
  ].filter(([, amount]) => Number(amount) !== 0);

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
                <th>Working days</th><td>{days(row.working_days)}</td></tr>
            <tr><th>Present days</th><td>{days(row.present_days)}</td>
                <th>Absent days</th><td>{days(row.absent_days)}</td></tr>
            <tr><th>Sundays worked</th><td>{days(row.sundays_worked)}</td>
                <th>Rate per day</th><td>{rupees2(row.per_day)}</td></tr>
          </tbody>
        </table>

        <div className="payslip-cols">
          <table className="sheet">
            <thead><tr><th>Earnings</th><th>Amount</th></tr></thead>
            <tbody>
              {earnings.map(([label, amount]) => (
                <tr key={label}><td>{label}</td><td className="num">{rupees(amount)}</td></tr>
              ))}
              <tr className="subtotal"><td>Gross salary</td><td className="num">{rupees(row.gross_salary)}</td></tr>
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
                <td className="num">{rupees(row.pt + row.esi + row.pf)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <table className="sheet totals-table">
          <tbody>
            <tr><td>Net salary</td><td className="num">{rupees(row.net_salary)}</td></tr>
            {row.sunday_salary > 0 && (
              <tr>
                <td>Sunday / holiday pay ({days(row.sundays_worked)} × {rupees2(row.per_day)})</td>
                <td className="num">{rupees(row.sunday_salary)}</td>
              </tr>
            )}
            <tr className="grand-row">
              <td>Net payable</td>
              <td className="num">{rupees(row.final_payable)}</td>
            </tr>
          </tbody>
        </table>

        <p className="muted small">
          Paid by {row.payment_mode || 'bank'}. Computer generated slip — no signature required.
        </p>
      </div>
    </div>
  );
}
