import { useEffect, useMemo, useState } from 'react';
import { days, daysInMonth, isSunday, rupees, rupees2, weekday } from '../format.js';

/**
 * The Sunday register - the "May Sunday" / "June sunday" tabs of the workbook.
 *
 * Sunday and holiday pay is settled apart from the month's salary: it sits
 * outside the gross, it does not count towards PT, and it is often handed over
 * separately. So it gets its own list - who worked which Sundays, at what day
 * rate, for how much - with its own paid/unpaid tracking.
 */
export default function SundayRegister({ period, rows, onPatchRow, locked }) {
  const [query, setQuery] = useState('');
  const [hidePaid, setHidePaid] = useState(false);

  const worked = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.sundays_worked > 0 &&
        (!hidePaid || r.sunday_status !== 'paid') &&
        (!q ||
          r.employee_name.toLowerCase().includes(q) ||
          (r.company_name || '').toLowerCase().includes(q))
    );
  }, [rows, query, hidePaid]);

  /**
   * A column per date anyone actually worked, plus the month's own Sundays so
   * an empty register still shows the shape of the month. A holiday worked on a
   * Tuesday earns its own column the same way.
   */
  const dates = useMemo(() => {
    const set = new Set();
    for (let d = 1; d <= daysInMonth(period.year, period.month); d++) {
      if (isSunday(period.year, period.month, d)) set.add(d);
    }
    for (const row of rows) for (const d of row.sunday_days || []) set.add(d);
    return [...set].sort((a, b) => a - b);
  }, [rows, period]);

  const totals = worked.reduce(
    (acc, r) => ({ count: acc.count + r.sundays_worked, amount: acc.amount + r.sunday_salary }),
    { count: 0, amount: 0 }
  );
  const unpaid = worked.filter((r) => r.sunday_status !== 'paid');

  // Rows whose count was typed in rather than marked have no dates to show.
  const undated = worked.filter((r) => !(r.sunday_days || []).length);

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
          <input type="checkbox" checked={hidePaid} onChange={(e) => setHidePaid(e.target.checked)} />
          Only unpaid
        </label>
        <span className="grow" />
        {locked && <span className="pill locked">Locked</span>}
        <span className="muted small">
          {worked.length} worked · {rupees(totals.amount)} in all
          {unpaid.length > 0 && ` · ${rupees(unpaid.reduce((s, r) => s + r.sunday_salary, 0))} still to pay`}
        </span>
      </div>

      <div className="table-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th className="sticky-name">Employee</th>
              <th>Company</th>
              {dates.map((d) => (
                <th key={d} className={isSunday(period.year, period.month, d) ? 'sunday' : undefined}>
                  <span className="dow">{weekday(period.year, period.month, d)}</span>
                  <span>{d}</span>
                </th>
              ))}
              <th title="Sundays and holidays worked">Days</th>
              <th title="Salary ÷ working days">Day rate</th>
              <th title="Days × day rate, unless a number is typed over it">Amount</th>
              <th>Paid by</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {worked.map((row) => (
              <tr key={row.id} className={row.sunday_status === 'paid' ? 'paid' : undefined}>
                <td className="sticky-name">{row.employee_name}</td>
                <td className="muted">{row.company_name}</td>
                {dates.map((d) => (
                  <td key={d} className={`num${isSunday(period.year, period.month, d) ? ' sunday' : ''}`}>
                    {(row.sunday_days || []).includes(d) ? '✓' : ''}
                  </td>
                ))}
                <td className="num strong">{days(row.sundays_worked)}</td>
                <td className="num muted">{rupees2(row.per_day)}</td>
                <td>
                  <SundayAmount row={row} locked={locked} onPatchRow={onPatchRow} />
                </td>
                <td>
                  <select
                    value={row.sunday_mode || ''}
                    disabled={locked}
                    onChange={(e) => onPatchRow(row.id, { sunday_mode: e.target.value })}
                  >
                    <option value="">-</option>
                    <option>Cash</option>
                    <option>Bank</option>
                    <option>Gpay</option>
                    <option>Cheque</option>
                  </select>
                </td>
                <td>
                  <select
                    value={row.sunday_status || 'pending'}
                    disabled={locked}
                    onChange={(e) => onPatchRow(row.id, { sunday_status: e.target.value })}
                  >
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                  </select>
                </td>
              </tr>
            ))}
            {!worked.length && (
              <tr>
                <td colSpan={dates.length + 7} className="empty">
                  Nobody has worked a Sunday this month yet. Mark a day <strong>SP</strong> (Sunday
                  Present) or <strong>HP</strong> (Holiday Present) on the attendance grid and they
                  will appear here.
                </td>
              </tr>
            )}
          </tbody>
          {worked.length > 0 && (
            <tfoot>
              <tr>
                <td className="sticky-name">Total ({worked.length})</td>
                <td colSpan={dates.length + 1} />
                <td className="num">{days(totals.count)}</td>
                <td />
                <td className="grand">{rupees(totals.amount)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="muted small">
        This pay sits <strong>outside</strong> the month's gross: it is added after the net salary,
        it does not count towards the {rupees(period.pt_threshold)} PT line, and it is marked paid
        here rather than on the salary sheet.
      </p>
      {undated.length > 0 && (
        <p className="muted small">
          {undated.length} row{undated.length === 1 ? ' has' : 's have'} a Sunday count typed in
          rather than marked on the grid, so the dates are blank —{' '}
          {undated.map((r) => r.employee_name).slice(0, 4).join(', ')}
          {undated.length > 4 && ` and ${undated.length - 4} more`}. Mark those days{' '}
          <strong>SP</strong> on the attendance grid to fill them in.
        </p>
      )}
    </section>
  );
}

/** The amount, typed over the day-rate calculation when it needs rounding off. */
function SundayAmount({ row, locked, onPatchRow }) {
  const stored = row.sunday_salary_override;
  const [draft, setDraft] = useState(stored === null || stored === undefined ? '' : String(stored));
  const [focused, setFocused] = useState(false);

  // While the box is not being typed in, keep it in step with the server.
  useEffect(() => {
    if (!focused) setDraft(stored === null || stored === undefined ? '' : String(stored));
  }, [stored, focused]);

  return (
    <div className="sunday-amount">
      <input
        className={`cell-input${stored !== null && stored !== undefined ? ' overridden' : ''}`}
        inputMode="decimal"
        disabled={locked}
        placeholder={String(row.sunday_salary)}
        value={draft}
        title="Type an amount to round it off; empty it to go back to days × day rate"
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
            setDraft(current);
            return;
          }
          onPatchRow(row.id, { sunday_salary_override: trimmed === '' ? '' : Number(trimmed) });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') {
            setDraft(stored === null || stored === undefined ? '' : String(stored));
            e.target.blur();
          }
        }}
      />
      <span className="hint">{rupees(row.sunday_salary)}</span>
    </div>
  );
}
