import { useMemo, useState } from 'react';
import { rupees } from '../../format.js';
import { col, num, printReport } from '../../printReport.js';

/**
 * THE MONTH, SIX WAYS.
 *
 * Company-wise, employee-wise, department-wise, attendance-wise, deductions
 * and payment status — from his brief, and all six out of the same rows the
 * register is showing.
 *
 * IT ADDS UP WHAT THE SHEET SAYS. There is no formula in this file: every
 * figure it shows was returned by `calculateRow` for a row, and every total
 * is a sum of those. *"All totals must reconcile with the main salary
 * register"* — they cannot fail to, because they are the register.
 */

const n = (v) => Number(v) || 0;

const GROUPS = [
  ['company', 'Company-wise', (r) => r.company_name || '(no company)'],
  ['employee', 'Employee-wise', (r) => r.employee_name],
  ['department', 'Department-wise', (r) => r.department || '(no department)'],
  ['attendance', 'Attendance-wise', (r) => {
    const absent = n(r.absent_days);
    if (!absent) return 'Full attendance';
    if (absent <= 1) return 'Up to 1 day absent';
    if (absent <= 3) return '2 to 3 days absent';
    if (absent <= 6) return '4 to 6 days absent';
    return 'More than 6 days absent';
  }],
  ['mode', 'Payment mode', (r) => r.payment_mode || '(not set)'],
  ['status', 'Payment status', (r) => r.status || 'pending'],
];

export default function MonthlySummary({ period, rows }) {
  const [by, setBy] = useState('company');
  const entry = GROUPS.find(([k]) => k === by) || GROUPS[0];

  const totals = useMemo(() => {
    const add = (list) => ({
      count: list.length,
      gross: list.reduce((t, r) => t + n(r.gross_salary), 0),
      additions: list.reduce((t, r) => t + n(r.addition) + Math.max(0, n(r.ot_salary)), 0),
      pt: list.reduce((t, r) => t + n(r.pt), 0),
      esi: list.reduce((t, r) => t + n(r.esi), 0),
      pf: list.reduce((t, r) => t + n(r.pf), 0),
      loan: list.reduce((t, r) => t + n(r.loan_deduction), 0),
      penalty: list.reduce((t, r) => t + n(r.penalty_deduction), 0),
      other: list.reduce((t, r) => t + n(r.deduction), 0),
      net: list.reduce((t, r) => t + n(r.net_salary), 0),
      sunday: list.reduce((t, r) => t + n(r.sunday_salary), 0),
    });
    const all = add(rows);
    all.deductions = all.pt + all.esi + all.pf + all.loan + all.penalty + all.other;
    return { all, add };
  }, [rows]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const name = String(entry[2](row) || '(none)');
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(row);
    }
    return [...map.entries()]
      .map(([name, list]) => {
        const sums = totals.add(list);
        return {
          name,
          ...sums,
          deductions: sums.pt + sums.esi + sums.pf + sums.loan + sums.penalty + sums.other,
        };
      })
      .sort((a, b) => (by === 'employee' ? String(a.name).localeCompare(String(b.name)) : b.net - a.net));
  }, [rows, entry, totals, by]);

  const COLUMNS = [
    col(entry[1].replace('-wise', ''), (g) => g.name),
    num('People', (g) => g.count),
    num('Gross', (g) => rupees(g.gross)),
    num('PT', (g) => rupees(g.pt)),
    num('ESI', (g) => rupees(g.esi)),
    num('PF', (g) => rupees(g.pf)),
    num('Loan', (g) => rupees(g.loan)),
    num('Penalty', (g) => rupees(g.penalty)),
    num('Deductions', (g) => rupees(g.deductions)),
    num('Net payable', (g) => rupees(g.net)),
  ];

  const printIt = () =>
    printReport({
      title: `${entry[1]} salary summary`,
      subtitle: period.label,
      meta: [
        `${rows.length} employee(s) · gross ${rupees(totals.all.gross)} · net ${rupees(totals.all.net)}`,
      ],
      landscape: true,
      columns: [col('#', (_g, i) => i + 1, '3%'), ...COLUMNS],
      rows: groups,
      totals: {
        label: `Total (${groups.length})`,
        People: rows.length,
        Gross: rupees(totals.all.gross),
        PT: rupees(totals.all.pt),
        ESI: rupees(totals.all.esi),
        PF: rupees(totals.all.pf),
        Loan: rupees(totals.all.loan),
        Penalty: rupees(totals.all.penalty),
        Deductions: rupees(totals.all.deductions),
        'Net payable': rupees(totals.all.net),
      },
      empty: 'Nothing to summarise.',
      footer:
        'Every figure is the salary sheet’s own — this page adds them up and works nothing out. Sunday duty is paid on its own register and is not in the net.',
    });

  const tile = (label, value, tone) => (
    <div className={tone}><b>{value}</b><span>{label}</span></div>
  );

  return (
    <>
      <div className="card">
        <div className="fo-figures">
          {tile('employees', rows.length)}
          {tile('gross salary', rupees(totals.all.gross))}
          {tile('additions', rupees(totals.all.additions))}
          {tile('deductions', rupees(totals.all.deductions), 'bad')}
          {tile('net payable', rupees(totals.all.net), 'good')}
        </div>
        <div className="fo-figures">
          {tile('PF', rupees(totals.all.pf))}
          {tile('ESI', rupees(totals.all.esi))}
          {tile('PT', rupees(totals.all.pt))}
          {tile('loan recovery', rupees(totals.all.loan))}
          {tile('penalty', rupees(totals.all.penalty))}
          {tile('Sunday duty (apart)', rupees(totals.all.sunday))}
        </div>
        <p className="muted small">
          These add up the same rows the register shows, so they reconcile with it by
          construction. Sunday duty is paid on its own register and is not part of the net.
        </p>
      </div>

      <div className="card scroll">
        <div className="toolbar">
          <div className="chips">
            {GROUPS.map(([key, label]) => (
              <button key={key} className={`chip ${by === key ? 'active' : ''}`} onClick={() => setBy(key)}>
                {label}
              </button>
            ))}
          </div>
          <span className="grow" />
          <button className="ghost" onClick={printIt} disabled={!groups.length}>Print</button>
        </div>

        <table className="sheet numbered fo-table">
          <thead>
            <tr>
              <th className="row-no">#</th>
              <th className="grow">{entry[1].replace('-wise', '')}</th>
              <th className="num">People</th><th className="num">Gross</th>
              <th className="num">PT</th><th className="num">ESI</th><th className="num">PF</th>
              <th className="num">Loan</th><th className="num">Penalty</th>
              <th className="num">Deductions</th><th className="num">Net payable</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={g.name}>
                <td className="row-no">{i + 1}</td>
                <td>{g.name}</td>
                <td className="num">{g.count}</td>
                <td className="num">{rupees(g.gross)}</td>
                <td className="num">{rupees(g.pt)}</td>
                <td className="num">{rupees(g.esi)}</td>
                <td className="num">{rupees(g.pf)}</td>
                <td className="num">{rupees(g.loan)}</td>
                <td className="num">{rupees(g.penalty)}</td>
                <td className="num minus">{rupees(g.deductions)}</td>
                <td className="num strong">{rupees(g.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="row-no" />
              <td>Total ({groups.length})</td>
              <td className="num">{rows.length}</td>
              <td className="num">{rupees(totals.all.gross)}</td>
              <td className="num">{rupees(totals.all.pt)}</td>
              <td className="num">{rupees(totals.all.esi)}</td>
              <td className="num">{rupees(totals.all.pf)}</td>
              <td className="num">{rupees(totals.all.loan)}</td>
              <td className="num">{rupees(totals.all.penalty)}</td>
              <td className="num minus">{rupees(totals.all.deductions)}</td>
              <td className="num strong">{rupees(totals.all.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
