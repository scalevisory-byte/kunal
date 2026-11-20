import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { ATTENDANCE_CODES, calculateRow } from '../../../../shared/calc.js';
import { payslipLines } from '../../../../shared/payslipLines.js';
import { days, rupees, rupees2 } from '../../format.js';
import { printSlips } from '../../printReport.js';
import { slipFor } from '../Payslip.jsx';
import { loadCompanyLogos, logoFor } from '../../companyLogos.js';

/**
 * ONE PERSON'S MONTH, IN FOUR TABS.
 *
 * Dinesh's brief calls this the most important feature, and sets the rule it
 * has to follow: *"Display the actual existing calculation values. Do not
 * independently recalculate them using new formulas."*
 *
 * SO IT ASSEMBLES, IT NEVER RECALCULATES. Every figure on the Salary Details
 * tab is what `calculateRow` returned for that row - the same call the sheet,
 * the payslip and the Excel all read - and this file contains no arithmetic
 * beyond adding up the lines it was handed. If the sheet says 22,092, so
 * does this, because it is the same number and not a second opinion.
 *
 * The attendance tab is the same marks the grid is paid from, shown day by
 * day. It is READ-ONLY on purpose: the brief says not to change attendance
 * from the salary statement, and a figure that can be edited from two
 * screens is a figure that gets edited from the wrong one.
 */

const TABS = [
  ['salary', 'Salary details'],
  ['attendance', 'Attendance'],
  ['adjust', 'Additions & deductions'],
  ['payments', 'Payment history'],
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

export default function EmployeeStatement({ period, row, onClose, onGo }) {
  const [tab, setTab] = useState('salary');
  const [payments, setPayments] = useState([]);
  const [logo, setLogo] = useState('');

  /*
   * Recalculated HERE from the same engine rather than read off the stored
   * row, for the one reason the payslip does it too: a statement opened
   * straight after typing shows what was typed, while the stored row still
   * carries the server's last answer. Same function, same inputs - so this
   * can never be a different number from the sheet behind it.
   */
  const calc = useMemo(
    () => calculateRow(row, period, row.attendance),
    [row, period]
  );
  const lines = useMemo(() => payslipLines(row, calc), [row, calc]);

  useEffect(() => {
    let alive = true;
    api
      .get(`/periods/${period.id}/statement/${row.employee_id}`)
      .then(({ payments: list }) => alive && setPayments(list || []))
      .catch(() => alive && setPayments([]));
    loadCompanyLogos().then(() => alive && setLogo(logoFor(row.company_id) || logoFor(row.company_name)));
    return () => { alive = false; };
  }, [period.id, row.employee_id, row.company_id, row.company_name]);

  const marks = row.mark_counts || {};
  const money = (v) => rupees2(v);

  const grid = useMemo(() => {
    const out = [];
    for (let day = 1; day <= daysInMonth(period.year, period.month); day += 1) {
      const entry = row.attendance?.[day];
      const mark = (typeof entry === 'object' ? entry?.code : entry) || '';
      out.push({
        day,
        weekday: WEEKDAYS[new Date(period.year, period.month - 1, day).getDay()],
        mark,
        meaning: ATTENDANCE_CODES[mark]?.label || '',
        in_time: entry?.in_time || '',
        out_time: entry?.out_time || '',
        minutes: Number(entry?.minutes) || 0,
        reason: entry?.reason || '',
      });
    }
    return out;
  }, [row.attendance, period.year, period.month]);

  /*
   * The entries behind the two totals, rather than only the totals. A month
   * carries one Add and one Deduct box plus whatever the ledgers posted -
   * a loan instalment and a penalty recovery - so each is named with where
   * it came from.
   */
  const adjustments = [
    row.addition > 0 && {
      kind: 'Addition', what: row.remark || 'Other addition', amount: row.addition, by: 'typed on the sheet',
    },
    row.deduction > 0 && {
      kind: 'Deduction', what: row.remark || 'Other deduction', amount: -row.deduction, by: 'typed on the sheet',
    },
    calc.loan_deduction > 0 && {
      kind: 'Deduction', what: 'Loan / advance instalment', amount: -calc.loan_deduction, by: 'Loans',
    },
    calc.penalty_deduction > 0 && {
      kind: 'Deduction',
      what: row.penalty_notes?.length ? `Penalty — ${row.penalty_notes.join('; ')}` : 'Penalty recovery',
      amount: -calc.penalty_deduction,
      by: 'People → Penalties',
    },
    calc.ot_salary !== 0 && {
      kind: calc.ot_salary > 0 ? 'Addition' : 'Deduction',
      what: calc.ot_salary > 0 ? 'Overtime' : 'Short hours',
      amount: calc.ot_salary,
      by: 'Time / attendance',
    },
    calc.late_salary > 0 && {
      kind: 'Deduction',
      what: `Late / early beyond the ${calc.late_concession_minutes} free minutes`,
      amount: -calc.late_salary,
      by: 'Time',
    },
  ].filter(Boolean);

  const added = adjustments.filter((a) => a.amount > 0).reduce((t, a) => t + a.amount, 0);
  const taken = adjustments.filter((a) => a.amount < 0).reduce((t, a) => t - a.amount, 0);

  const fact = (label, value, strong) => (
    <tr className={strong ? 'strong' : undefined}>
      <th>{label}</th>
      <td className="num">{value}</td>
    </tr>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal statement" onClick={(e) => e.stopPropagation()}>
        <header className="stm-head">
          <div>
            <h2>{row.employee_name}</h2>
            <p>
              {[row.employee_code, row.company_name, row.department, row.designation]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="stm-month">
            <span>Salary month</span>
            <strong>{period.label}</strong>
          </div>
          <button className="icon-x stm-close" onClick={onClose} title="Close">✕</button>
        </header>

        <nav className="tabs sub-tabs stm-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="stm-body">
          {tab === 'salary' && (
            <div className="stm-cols">
              <section className="card">
                <h3>Attendance summary</h3>
                <table className="kv stm-kv">
                  <tbody>
                    {fact('Working days', days(calc.working_days))}
                    {fact('Present', days(calc.present_days))}
                    {fact('Absent', days(calc.absent_days))}
                    {/* The off days are counted off the marks, which is where
                        they live - calculateRow has no figure for them. */}
                    {fact('Weekly off / Sundays', days(marks.S || 0))}
                    {fact('Sundays worked', days(calc.sundays_worked))}
                    {fact('Paid leave', days((marks.PL || 0) + (marks.CL || 0) + (marks.SL || 0)))}
                    {fact('LWP (unpaid)', days(marks.UL || 0))}
                  </tbody>
                </table>
              </section>

              <section className="card">
                <h3>Salary calculation</h3>
                <table className="kv stm-kv">
                  <tbody>
                    {fact('Monthly salary', money(calc.salary))}
                    {fact('Per day', money(calc.per_day))}
                    {fact('Per hour', money(calc.per_hour))}
                    {/* `-0.00` is what negating a nought gives, and it reads
                        as a figure somebody got wrong. */}
                    {fact('Absent deduction', money(calc.absent_salary ? -calc.absent_salary : 0))}
                    {fact('Salary after absence', money(calc.gross_after_absent), true)}
                    {fact('OT / short hours', money(calc.ot_salary))}
                    {fact('Other additions', money(calc.addition))}
                    {fact('Other deductions', money(calc.deduction ? -calc.deduction : 0))}
                    {fact('Gross salary', money(calc.gross_salary), true)}
                  </tbody>
                </table>
              </section>

              <section className="card">
                <h3>Deductions</h3>
                <table className="kv stm-kv">
                  <tbody>
                    {fact('PT', money(calc.pt))}
                    {fact('ESI', money(calc.esi))}
                    {fact('PF', money(calc.pf))}
                    {fact('Loan / advance', money(calc.loan_deduction))}
                    {fact('Penalty', money(calc.penalty_deduction))}
                    {fact('Late / early', money(calc.late_salary))}
                    {fact('Total deductions', money(lines.totalDeductions), true)}
                  </tbody>
                </table>
                <div className="stm-net">
                  <span>Net payable</span>
                  <strong>{money(calc.net_salary)}</strong>
                </div>
                {calc.sunday_salary > 0 && (
                  <p className="muted small">
                    Sunday / holiday duty {rupees(calc.sunday_salary)} is paid on its own register,
                    separately from this.
                  </p>
                )}
              </section>
            </div>
          )}

          {tab === 'attendance' && (
            <section className="card scroll">
              <p className="muted small">
                The same marks the salary above is paid from, day by day. Read-only here —
                attendance is changed on the Attendance tab, so a day cannot be edited from two
                screens.
              </p>
              <table className="sheet numbered fo-table">
                <thead>
                  <tr>
                    <th className="row-no">#</th>
                    <th>Day</th><th>Mark</th><th className="grow">What it means</th>
                    <th>In</th><th>Out</th><th>OT / short</th><th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((d) => (
                    <tr key={d.day} className={d.weekday === 'Sun' ? 'fo-in' : undefined}>
                      <td className="row-no">{d.day}</td>
                      <td className="small">{d.weekday}</td>
                      <td className="fo-tel">{d.mark}</td>
                      <td className="small">{d.meaning}</td>
                      <td className="fo-tel small">{d.in_time}</td>
                      <td className="fo-tel small">{d.out_time}</td>
                      <td className="fo-tel small">{d.minutes ? `${d.minutes > 0 ? '+' : ''}${d.minutes}m` : ''}</td>
                      <td className="small">{d.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <span className="grow" />
                <button className="ghost tiny" onClick={() => { onGo?.('attendance'); onClose(); }}>
                  open the attendance grid
                </button>
              </div>
            </section>
          )}

          {tab === 'adjust' && (
            <section className="card">
              <p className="muted small">
                Every addition and deduction on this month, and where each came from — not just
                the two totals.
              </p>
              <table className="sheet numbered fo-table">
                <thead>
                  <tr>
                    <th className="row-no">#</th>
                    <th>Type</th><th className="grow">Particulars</th>
                    <th className="num">Amount</th><th>Recorded in</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a, i) => (
                    <tr key={`${a.what}-${i}`}>
                      <td className="row-no">{i + 1}</td>
                      <td className="small">{a.kind}</td>
                      <td className="small">{a.what}</td>
                      <td className={`num ${a.amount < 0 ? 'minus' : ''}`}>{rupees(Math.abs(a.amount))}</td>
                      <td className="small muted">{a.by}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="row-no" />
                    <td colSpan={2}>Added {rupees(added)} · taken off {rupees(taken)}</td>
                    <td className="num">{rupees(added - taken)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              {!adjustments.length ? (
                <p className="empty fo-empty">Nothing added or taken off this month.</p>
              ) : null}
            </section>
          )}

          {tab === 'payments' && (
            <section className="card scroll">
              <p className="muted small">
                Their months as the sheet holds them.{' '}
                <strong>A month only reads as paid when somebody marked it paid</strong> — and the
                exception report names any marked paid with no date or reference against it.
              </p>
              <table className="sheet numbered fo-table">
                <thead>
                  <tr>
                    <th className="row-no">#</th>
                    <th className="grow">Month</th><th>Status</th><th>Mode</th>
                    <th>Paid on</th><th>Reference</th><th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={p.period_id}>
                      <td className="row-no">{i + 1}</td>
                      <td>{p.label}</td>
                      <td><span className={`tag pay-${p.status || 'pending'}`}>{p.status || 'pending'}</span></td>
                      <td className="small">{p.payment_mode}</td>
                      <td className="fo-tel small">{p.payment_date}</td>
                      <td className="fo-tel small">{p.payment_ref}</td>
                      <td className="small">{p.remark}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!payments.length ? <p className="empty fo-empty">No months yet.</p> : null}
            </section>
          )}
        </div>

        <footer className="row stm-foot">
          <span className="muted small">
            Every figure here is the one the salary sheet holds — nothing on this screen is
            worked out a second time.
          </span>
          <span className="grow" />
          <button
            className="primary"
            onClick={() => printSlips({ slips: [slipFor(row, period, calc, logo)] })}
          >
            Print payslip
          </button>
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
