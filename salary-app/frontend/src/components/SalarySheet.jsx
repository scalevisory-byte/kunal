import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateRow, totalRows } from '../../../shared/calc.js';
import { days, rupees, rupees2 } from '../format.js';

/**
 * The calculation sheet. Typing in a cell recalculates the row immediately with
 * the same module the server uses, then saves in the background - so the totals
 * never lag behind the keyboard, and a failed save is visible rather than lost.
 */

/** Columns the user can type into, and how each behaves. */
const EDITABLE = {
  // `override: true` means blank hands the column back to its formula, and a
  // value typed there is flagged so it is obvious the formula is being bypassed.
  sundays_override: { placeholder: 'auto', override: true },
  absent_days_override: { placeholder: 'auto', override: true },
  ot_minutes_override: { placeholder: 'auto', override: true },
  ot_amount_override: { placeholder: 'auto', override: true },
  addition: { placeholder: '0' },
  deduction: { placeholder: '0' },
  esi: { placeholder: '0' },
  pf: { placeholder: '0' },
  salary: { placeholder: '0' },
};

function EditableCell({ row, field, disabled, onCommit }) {
  const spec = EDITABLE[field];
  const stored = row[field];
  const [draft, setDraft] = useState(stored === null || stored === undefined ? '' : String(stored));
  const [focused, setFocused] = useState(false);

  // While the field is not being typed in, keep it in step with the server.
  useEffect(() => {
    if (!focused) setDraft(stored === null || stored === undefined ? '' : String(stored));
  }, [stored, focused]);

  const isOverride = spec.override && stored !== null && stored !== undefined;

  return (
    <input
      className={`cell-input${isOverride ? ' overridden' : ''}`}
      inputMode="decimal"
      disabled={disabled}
      placeholder={spec.placeholder}
      value={draft}
      title={isOverride ? 'Typed over the formula - clear the box to go back to the formula' : undefined}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const trimmed = draft.trim();
        const current = stored === null || stored === undefined ? '' : String(stored);
        if (trimmed === current) return;
        if (trimmed !== '' && !Number.isFinite(Number(trimmed))) {
          setDraft(current); // reject anything that is not a number
          return;
        }
        onCommit(field, trimmed === '' ? null : Number(trimmed));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') {
          setDraft(stored === null || stored === undefined ? '' : String(stored));
          e.target.blur();
        }
      }}
    />
  );
}

export default function SalarySheet({ period, rows, onPatchRow, onPayslip, onCompany, saving, locked }) {
  const [query, setQuery] = useState('');
  const [dense, setDense] = useState(true);
  const scroller = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.employee_name.toLowerCase().includes(q) ||
        (r.company_name || '').toLowerCase().includes(q) ||
        (r.employee_code || '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  const totals = useMemo(() => totalRows(filtered), [filtered]);

  // Company name repeats down column A in the sheet; here it only prints when
  // it changes, and carries that company's running total when it does.
  const grouped = useMemo(() => {
    const out = [];
    let current = null;
    for (const row of filtered) {
      if (row.company_name !== current) {
        current = row.company_name;
        out.push({ type: 'company', name: current, id: row.company_id, key: `c-${current}` });
      }
      out.push({ type: 'row', row, key: `r-${row.id}` });
    }
    return out;
  }, [filtered]);

  return (
    <section>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search employee or company"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={dense} onChange={(e) => setDense(e.target.checked)} />
          Compact
        </label>
        <span className="grow" />
        {saving > 0 && <span className="pill saving">Saving {saving}…</span>}
        {locked && <span className="pill locked">Locked</span>}
        <span className="muted small">
          {filtered.length} of {rows.length} employees
        </span>
      </div>

      <div className={`table-wrap${dense ? ' dense' : ''}`} ref={scroller}>
        <table className="sheet">
          <thead>
            <tr>
              <th className="sticky-name">Employee</th>
              <th title="Working days in the month">WD</th>
              <th title="Sundays / holidays worked - paid extra at the day rate">Sun</th>
              <th title="A = 1 day, HF = half day, AD = 2 days">Absent</th>
              <th>Present</th>
              <th>Salary</th>
              <th title="Salary / working days">Per day</th>
              <th title="Salary / working days / hours per day">Per hr</th>
              <th title="Absent days x day rate">Absent ₹</th>
              <th title="Salary - absent salary">After absent</th>
              <th title="Added up from the short hours marked on each day. Type a number to override the month's total.">OT min</th>
              <th title="Auto = minutes x per-minute rate. Type an amount to override it.">OT ₹</th>
              <th title="Anything extra to pay this month - an incentive, arrears, a reimbursement">Add</th>
              <th title="Anything to take off - a breakage, a fine, a recovery. Enter it as a positive number.">Deduct</th>
              <th title="ROUND(after absent + OT + adjust)">Gross</th>
              <th title="Professional tax">PT</th>
              <th>ESI</th>
              <th>PF</th>
              <th title="This month's instalment against a loan or advance - set it on the Loans tab">Loan</th>
              <th title="Gross - PT - ESI - PF - loan. Sunday duty is paid apart, on the Sunday tab.">Net payable</th>
              <th>Mode</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grouped.map((item) =>
              item.type === 'company' ? (
                <tr className="company-row" key={item.key}>
                  <td className="sticky-name" colSpan={23}>
                    <button
                      className="company-link"
                      title="Show only this company - click again for all of them"
                      onClick={() => onCompany?.(item.id)}
                    >
                      {item.name}
                    </button>
                  </td>
                </tr>
              ) : (
                <Row
                  key={item.key}
                  row={item.row}
                  period={period}
                  locked={locked}
                  onPatchRow={onPatchRow}
                  onPayslip={onPayslip}
                />
              )
            )}
            {!filtered.length && (
              <tr>
                <td colSpan={23} className="empty">
                  No employees here yet. Add them under <strong>Employees</strong>, or import a sheet
                  from <strong>Reports</strong>.
                </td>
              </tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr>
                <td className="sticky-name">Total ({totals.count})</td>
                <td colSpan={4} />
                <td>{rupees(totals.salary)}</td>
                <td colSpan={2} />
                <td>{rupees(totals.absent_salary)}</td>
                <td />
                <td />
                <td>{rupees(totals.ot_salary)}</td>
                <td>{rupees(totals.addition)}</td>
                <td>{rupees(totals.deduction)}</td>
                <td>{rupees(totals.gross_salary)}</td>
                <td>{rupees(totals.pt)}</td>
                <td>{rupees(totals.esi)}</td>
                <td>{rupees(totals.pf)}</td>
                <td>{rupees(totals.loan_deduction)}</td>
                <td className="grand">{rupees(totals.net_salary)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function Row({ row, period, locked, onPatchRow, onPayslip }) {
  // Recompute here rather than waiting for the round trip, so the row and the
  // totals move the moment a number is typed.
  const calc = useMemo(() => calculateRow(row, period, row.attendance), [row, period]);
  const commit = (field, value) => onPatchRow(row.id, { [field]: value === null ? '' : value });

  return (
    <tr className={row.status === 'paid' ? 'paid' : undefined}>
      <td className="sticky-name">
        <button className="link" onClick={() => onPayslip(row)} title="Open payslip">
          {row.employee_name}
        </button>
        {row.error && <span className="pill error-pill" title={row.error}>save failed</span>}
      </td>
      <td className="num muted">{days(calc.working_days)}</td>
      <td><EditableCell row={row} field="sundays_override" disabled={locked} onCommit={commit} />
        {!row.overrides?.sundays && <span className="hint">{days(calc.sundays_worked)}</span>}
      </td>
      <td><EditableCell row={row} field="absent_days_override" disabled={locked} onCommit={commit} />
        {!row.overrides?.absent_days && <span className="hint">{days(calc.absent_days)}</span>}
      </td>
      <td className="num">{days(calc.present_days)}</td>
      <td><EditableCell row={row} field="salary" disabled={locked} onCommit={commit} /></td>
      <td className="num muted">{rupees2(calc.per_day)}</td>
      <td className="num muted">{rupees2(calc.per_hour)}</td>
      <td className="num deduct">{calc.absent_salary ? `-${rupees(calc.absent_salary)}` : '-'}</td>
      <td className="num muted">{rupees(calc.gross_after_absent)}</td>
      <td><EditableCell row={row} field="ot_minutes_override" disabled={locked} onCommit={commit} />
        {!row.overrides?.ot_minutes && (
          <span className={`hint${calc.ot_minutes < 0 ? ' deduct' : ''}`}>
            {calc.ot_minutes ? `${calc.ot_minutes > 0 ? '+' : ''}${calc.ot_minutes}` : 'from days'}
          </span>
        )}
      </td>
      <td><EditableCell row={row} field="ot_amount_override" disabled={locked} onCommit={commit} />
        {row.ot_amount_override === null && (
          <span className={`hint${calc.ot_salary < 0 ? ' deduct' : ''}`}>{rupees(calc.ot_salary)}</span>
        )}
      </td>
      <td><EditableCell row={row} field="addition" disabled={locked} onCommit={commit} /></td>
      <td className="deduct-cell">
        <EditableCell row={row} field="deduction" disabled={locked} onCommit={commit} />
      </td>
      <td className="num strong">{rupees(calc.gross_salary)}</td>
      <td className="num deduct">{calc.pt ? `-${calc.pt}` : '-'}</td>
      <td><EditableCell row={row} field="esi" disabled={locked} onCommit={commit} /></td>
      <td><EditableCell row={row} field="pf" disabled={locked} onCommit={commit} /></td>
      <td className="num deduct">{calc.loan_deduction ? `-${rupees(calc.loan_deduction)}` : '-'}</td>
      <td className="num grand">{rupees(calc.net_salary)}</td>
      <td>
        <select
          value={row.payment_mode || ''}
          disabled={locked}
          onChange={(e) => onPatchRow(row.id, { payment_mode: e.target.value })}
        >
          <option value="">-</option>
          <option>Bank</option>
          <option>Cash</option>
          <option>Gpay</option>
          <option>Cheque</option>
        </select>
      </td>
      <td>
        <select
          value={row.status || 'pending'}
          disabled={locked}
          onChange={(e) => onPatchRow(row.id, { status: e.target.value })}
        >
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="hold">Hold</option>
        </select>
      </td>
      <td>
        <input
          key={`remark-${row.id}-${row.remark || ''}`}
          className="cell-input wide"
          placeholder={row.addition || row.deduction ? 'What for?' : 'Remark'}
          title="Why the addition or deduction - it prints on the payslip"
          disabled={locked}
          defaultValue={row.remark || ''}
          onBlur={(e) => {
            if ((e.target.value || '') !== (row.remark || '')) {
              onPatchRow(row.id, { remark: e.target.value });
            }
          }}
        />
      </td>
    </tr>
  );
}
