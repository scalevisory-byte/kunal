import { useMemo } from 'react';
import { calculateRow } from '../../../shared/calc.js';
import {
  DEDUCTION_COLUMNS,
  DEDUCTION_HEADS,
  deductionStatement,
} from '../../../shared/deductionStatement.js';
import {
  SALARY_DEPARTMENT_COLUMNS,
  salaryByDepartment,
} from '../../../shared/salaryByDepartment.js';
import { rupees } from '../format.js';
import { col, num, printReport } from '../printReport.js';
import { saveCsv } from '../saveCsv.js';
import ScrollFrame from './ScrollFrame.jsx';

/**
 * Two reports that were listed as not built.
 *
 * Both ASSEMBLE and never recalculate: every figure came out of
 * `calculateRow`, which is what the payslip was built from and what the bank
 * file was paid from, so neither can disagree with a payslip.
 */

const calculated = (payroll) =>
  (payroll?.rows || []).map((row) => ({
    ...row,
    ...calculateRow(row, payroll.period, row.attendance),
  }));

/* ------------------------------------------------------------------ */

export function DeductionStatement({ payroll }) {
  const { lines, totals } = useMemo(
    () => (payroll ? deductionStatement(calculated(payroll)) : { lines: [], totals: null }),
    [payroll]
  );
  if (!payroll || !totals) return null;

  /*
   * ONLY THE HEADS THAT ACTUALLY TOOK SOMETHING.
   *
   * Seven columns of which four are empty pushed the Net paid column off the
   * side of an ordinary laptop - and an empty column says nothing anyway.
   * The ones left out are NAMED under the table, so "no penalties this
   * month" is stated rather than left to be inferred from a column that is
   * not there.
   */
  const heads = DEDUCTION_HEADS.filter(([key]) => totals[key]);
  const shownHeads = heads.length ? heads : DEDUCTION_HEADS.slice(0, 3);
  const leftOut = DEDUCTION_HEADS.filter(([key]) => !shownHeads.some(([k]) => k === key));

  const print = () =>
    printReport({
      title: 'Salary deductions',
      subtitle: payroll.period?.label,
      meta: [
        `${totals.people} people · ${rupees(totals.total)} deducted from ${rupees(totals.earned)} earned`,
        `Employer’s own share on top: ${rupees(totals.pf_employer + totals.esi_employer)}`,
        'Absence is not a deduction — a day not worked was never earned, and the gross is already after it.',
        'Earned is before anything came out. The Deduct box and the late charge are taken off before the gross is struck, so they are added back here or they would be counted twice.',
      ],
      columns: [
        col('Name', (r) => r.name),
        col('Department', (r) => r.department, '11%'),
        num('Earned', (r) => rupees(r.earned), '9%'),
        ...shownHeads.map(([key, label]) =>
          num(label, (r) => (r[key] ? rupees(r[key]) : ''), '8%')
        ),
        num('Deducted', (r) => rupees(r.total), '9%'),
        num('Net paid', (r) => rupees(r.net_salary), '9%'),
      ],
      rows: lines,
      totals: {
        label: `${totals.people} people`,
        Earned: rupees(totals.earned),
        ...Object.fromEntries(shownHeads.map(([key, label]) => [label, rupees(totals[key])])),
        Deducted: rupees(totals.total),
        'Net paid': rupees(totals.net_salary),
      },
      empty: 'Nothing was deducted this month.',
      footer:
        'Every figure came out of the same calculation the payslips were printed from. This report changes nothing.',
    });

  return (
    <div className="card">
      <div className="late-head">
        <div>
          <h2>Salary deductions — {payroll.period?.label}</h2>
          <p className="muted small">
            Every deduction under its own head, down the staff. <strong>Absence is not a
            deduction</strong> — a day not worked was never earned, so it is shown apart and
            never added in; counting it would double it, because the gross is already after it.
          </p>
        </div>
        <span className="grow" />
        <button onClick={print}>Print</button>
        <button
          className="ghost"
          onClick={() =>
            saveCsv(`Deductions-${payroll.period?.label || ''}.csv`, DEDUCTION_COLUMNS, lines)
          }
        >
          CSV
        </button>
      </div>

      <div className="stat-row">
        <Money label="Earned" value={totals.earned} />
        <Money label="Deducted" value={totals.total} strong />
        <Money label="Net paid" value={totals.net_salary} />
        <Money label="Not earned (absence)" value={totals.absent_salary} />
        <Money label="Employer’s own share" value={totals.pf_employer + totals.esi_employer} />
      </div>

      {/* Wider than a laptop once a month carries every head, so it scrolls
          sideways inside its own frame rather than pushing the page out. */}
      <ScrollFrame box="scroll">
      <table className="sheet">
        <thead>
          <tr>
            <th>Name</th>
            <th className="num" title="Before anything came out">Earned</th>
            {shownHeads.map(([key, label, why]) => (
              <th className="num" key={key} title={why}>{label}</th>
            ))}
            <th className="num">Deducted</th>
            <th className="num">Net paid</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.employee_id}>
              <td>
                {l.name}
                {l.code ? <span className="muted small"> · {l.code}</span> : null}
                {l.department ? <div className="muted small">{l.department}</div> : null}
              </td>
              <td className="num">{rupees(l.earned)}</td>
              {shownHeads.map(([key]) => (
                <td className="num" key={key}>{l[key] ? rupees(l[key]) : ''}</td>
              ))}
              <td className="num strong">{l.total ? rupees(l.total) : ''}</td>
              <td className="num">{rupees(l.net_salary)}</td>
            </tr>
          ))}
          {!lines.length && (
            <tr><td colSpan={4 + shownHeads.length} className="empty">Nobody in this month.</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th>{totals.people} people</th>
            <th className="num">{rupees(totals.earned)}</th>
            {shownHeads.map(([key]) => (
              <th className="num" key={key}>
                {totals[key] ? rupees(totals[key]) : ''}
                {totals.counts[key] ? (
                  <div className="muted small">{totals.counts[key]} people</div>
                ) : null}
              </th>
            ))}
            <th className="num">{rupees(totals.total)}</th>
            <th className="num">{rupees(totals.net_salary)}</th>
          </tr>
        </tfoot>
      </table>
      </ScrollFrame>

      {leftOut.length ? (
        <p className="muted small">
          Nothing came out under{' '}
          {leftOut.map(([, label]) => label).join(', ').replace(/, ([^,]*)$/, ' or $1')} this
          month, so those columns are not shown.
        </p>
      ) : null}

      <p className="muted small">
        {totals.balances ? (
          <>
            Earned less every deduction <strong>is</strong> the net, to the rupee — which is
            the only thing that makes a statement like this worth reading. (<strong>Earned</strong>{' '}
            is before anything came out: the Deduct box and the late charge are taken off
            before the sheet&rsquo;s gross is struck, so they are added back here rather than
            being counted twice.)
          </>
        ) : (
          <>
            <strong>Earned less the deductions does not equal the net here.</strong> That
            happens where a net salary was typed over the formula on the sheet — those rows are
            paid at the typed figure, not at this sum.
          </>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function SalaryByDepartment({ payroll }) {
  const { lines, totals } = useMemo(
    () => (payroll ? salaryByDepartment(calculated(payroll)) : { lines: [], totals: null }),
    [payroll]
  );
  if (!payroll || !totals) return null;

  const print = () =>
    printReport({
      title: 'Salary cost by department',
      subtitle: payroll.period?.label,
      meta: [
        `${totals.people} people · ${rupees(totals.cost)} to the company · ${rupees(totals.net_salary)} taken home`,
        'Cost is the gross plus the employer’s own PF and ESI. Sunday pay is settled on its own register and is not in it.',
      ],
      columns: [
        col('Department', (r) => r.department),
        num('People', (r) => r.people, '7%'),
        num('Earned', (r) => rupees(r.earned), '10%'),
        num('Deducted', (r) => rupees(r.deductions), '10%'),
        num('Net paid', (r) => rupees(r.net_salary), '11%'),
        num('Employer PF/ESI', (r) => rupees(r.employer), '11%'),
        num('Cost to company', (r) => rupees(r.cost), '12%'),
        num('Per head', (r) => rupees(r.per_head), '10%'),
        num('Share', (r) => `${r.share}%`, '7%'),
      ],
      rows: lines,
      totals: {
        label: 'All departments',
        People: totals.people,
        Earned: rupees(totals.earned),
        Deducted: rupees(totals.deductions),
        'Net paid': rupees(totals.net_salary),
        'Employer PF/ESI': rupees(totals.employer),
        'Cost to company': rupees(totals.cost),
        'Per head': rupees(totals.per_head),
      },
      empty: 'Nobody in this month.',
      footer:
        'Assembled from the same calculated month the payslips were printed from. Sunday pay is shown apart because it is paid from its own register.',
    });

  return (
    <div className="card">
      <div className="late-head">
        <div>
          <h2>Salary cost by department — {payroll.period?.label}</h2>
          <p className="muted small">
            <strong>Net paid</strong> is what people take home. <strong>Cost to company</strong>{' '}
            is the gross plus the employer&rsquo;s own PF and ESI — two different questions, so
            both are here. Sunday pay is settled on its own register and is <strong>not</strong>{' '}
            in either.
          </p>
        </div>
        <span className="grow" />
        <button onClick={print}>Print</button>
        <button
          className="ghost"
          onClick={() =>
            saveCsv(
              `Salary-by-department-${payroll.period?.label || ''}.csv`,
              SALARY_DEPARTMENT_COLUMNS,
              lines
            )
          }
        >
          CSV
        </button>
      </div>

      <div className="stat-row">
        <Money label="Cost to company" value={totals.cost} strong />
        <Money label="Earned" value={totals.earned} />
        <Money label="Net paid" value={totals.net_salary} />
        <Money label="Employer PF/ESI" value={totals.employer} />
        <Money label="Per head" value={totals.per_head} />
      </div>

      <table className="sheet">
        <thead>
          <tr>
            <th>Department</th>
            <th className="num">People</th>
            <th className="num" title="Before anything came out">Earned</th>
            <th className="num">Deducted</th>
            <th className="num">Net paid</th>
            <th className="num">Employer PF/ESI</th>
            <th className="num">Cost to company</th>
            <th className="num">Per head</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((d) => (
            <tr key={d.department}>
              <td>{d.department}</td>
              <td className="num">
                {d.people}
                {d.paid !== d.people ? (
                  <div className="muted small">{d.paid} paid</div>
                ) : null}
              </td>
              <td className="num">{rupees(d.earned)}</td>
              <td className="num">{d.deductions ? rupees(d.deductions) : ''}</td>
              <td className="num">{rupees(d.net_salary)}</td>
              <td className="num">{d.employer ? rupees(d.employer) : ''}</td>
              <td className="num strong">{rupees(d.cost)}</td>
              <td className="num">{rupees(d.per_head)}</td>
              <td className="num">{d.share}%</td>
            </tr>
          ))}
          {!lines.length && <tr><td colSpan={9} className="empty">Nobody in this month.</td></tr>}
        </tbody>
        {lines.length > 1 && (
          <tfoot>
            <tr>
              <th>All departments</th>
              <th className="num">{totals.people}</th>
              <th className="num">{rupees(totals.earned)}</th>
              <th className="num">{rupees(totals.deductions)}</th>
              <th className="num">{rupees(totals.net_salary)}</th>
              <th className="num">{rupees(totals.employer)}</th>
              <th className="num">{rupees(totals.cost)}</th>
              <th className="num">{rupees(totals.per_head)}</th>
              <th className="num">100%</th>
            </tr>
          </tfoot>
        )}
      </table>

      {totals.sunday_salary ? (
        <p className="muted small">
          {rupees(totals.sunday_salary)} of Sunday and holiday working is owed on top, and is
          paid from the Sunday register — not from this month&rsquo;s salary.
        </p>
      ) : null}
    </div>
  );
}

function Money({ label, value, strong }) {
  return (
    <div className="stat plain">
      <span className={`value${strong ? ' strong' : ''}`}>{rupees(value)}</span>
      <span className="label">{label}</span>
    </div>
  );
}
