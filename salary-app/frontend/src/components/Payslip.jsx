import { useEffect, useMemo, useState } from 'react';
import { calculateRow } from '../../../shared/calc.js';
import { payslipFacts, payslipLines } from '../../../shared/payslipLines.js';
import { days, rupees, rupees2 } from '../format.js';
import { printSlips } from '../printReport.js';
import { loadCompanyLogos, logoFor } from '../companyLogos.js';

/**
 * The slip for printing, from the same lines the screen is showing.
 *
 * Exported so the salary sheet can print a batch of them without a second
 * copy of this layout — one was written by hand first and had already lost
 * the penalty line.
 */
/**
 * @param logo  that company's logo as a data: URI, or '' for none - the slip
 *              is built in the browser, so the picture has to be handed in.
 *              Dinesh: *"payslip me bhi logo aana chahiye"*.
 */
export function slipFor(row, period, calc, logo = '') {
  const { earned, earnings, deductions, totalDeductions, net, sunday } = payslipLines(row, calc);
  return {
    company: row.company_name || '',
    logo,
    what: `Salary slip — ${period.label}`,
    name: row.employee_name,
    about: [row.employee_code, row.designation].filter(Boolean).join(' · '),
    facts: payslipFacts(row, calc).map(([label, value]) => [
      label,
      label === 'Rate per day' ? rupees2(value) : days(value),
    ]),
    earnings: earnings.map(([label, amount]) => [label, rupees(amount)]),
    earningsTotal: ['Gross salary', rupees(earned)],
    deductions: deductions.map(([label, amount]) => [label, rupees(amount)]),
    deductionsTotal: ['Total deductions', rupees(totalDeductions)],
    net: ['Net payable', rupees(net)],
    /* Stated for the record, never added in: it is paid from its own register. */
    extras: sunday > 0 ? [[`Sunday / holiday pay — paid separately`, rupees(sunday)]] : [],
    note: `Paid by ${row.payment_mode || 'bank'}. Computer generated slip — no signature required.`,
  };
}

/** A printable slip for one employee. Print with the browser to get a PDF. */
export default function Payslip({ period, row, onClose }) {
  // Recalculated here rather than read off the row, so a slip opened straight
  // after typing shows what was typed - the stored row only carries the
  // server's last answer.
  const calc = useMemo(() => calculateRow(row, period, row.attendance), [row, period]);

  /*
   * The company's letterhead. Fetched once per session and kept; until it
   * arrives the slip simply has the company's name, which is what a company
   * with no logo has anyway - nothing waits on a picture.
   */
  const [logo, setLogo] = useState('');
  useEffect(() => {
    let alive = true;
    loadCompanyLogos().then(() => {
      if (alive) setLogo(logoFor(row.company_id) || logoFor(row.company_name));
    });
    return () => { alive = false; };
  }, [row.company_id, row.company_name]);

  // A slip reads as "earned, less deductions". A manual deduction is already
  // inside the gross everywhere else in the app, so it is added back into what
  // was earned and then listed with the other deductions - shown both ways at
  // once, and still balancing.
  // The late/early charge is inside the gross too, and gets the same treatment,
  // so "earned less deductions" still balances to the rupee.
  const { earned, earnings, deductions, totalDeductions, broken } = payslipLines(row, calc);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal payslip" onClick={(e) => e.stopPropagation()}>
        <div className="payslip-head">
          <div>
            {logo ? <img className="payslip-logo" src={logo} alt="" /> : null}
            <h2>{row.company_name}</h2>
            <p className="muted">Salary slip — {period.label}</p>
          </div>
          <div className="no-print">
            {/* Builds the slip as a document rather than printing the
                dialog it is sitting in. */}
            <button onClick={() => printSlips({ slips: [slipFor(row, period, calc, logo)] })}>
              Print / PDF
            </button>
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
          {broken && calc.absent_days > 0 ? (
            <p className="muted small">
              Every line above is after {days(calc.absent_days)} day
              {calc.absent_days === 1 ? '' : 's'} absent.
            </p>
          ) : null}

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
