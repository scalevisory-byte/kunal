import { useEffect, useMemo, useState } from 'react';
import { calculateRow, sundayDaysFromAttendance } from '../../../shared/calc.js';
import { shortSundays, sundayDutyFor, sundayHoursFor } from '../../../shared/sundayDuty.js';
import { formatDuration } from '../../../shared/timesheet.js';
import { days, daysInMonth, isSunday, rupees, rupees2, weekday } from '../format.js';

/**
 * The Sunday register - the "May Sunday" / "June sunday" tabs of the workbook.
 *
 * Sunday and holiday pay is settled apart from the month's salary: it sits
 * outside the gross, it does not count towards PT, and it is not in the salary
 * sheet's net payable either. This register is the only place it is paid from,
 * so it gets its own list - who worked which Sundays, at what day rate, for how
 * much - with its own paid/unpaid tracking.
 */
export default function SundayRegister({ period, rows, onPatchRow, locked }) {
  const [query, setQuery] = useState('');
  const [hidePaid, setHidePaid] = useState(false);

  // Recompute rather than reading what the server last sent. A count typed on
  // the salary sheet is saved as an override, and the echo of that save does
  // not carry the recalculated Sunday figures - so a person who had just been
  // given Sundays was missing from this register, and would never be paid.
  const computed = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        ...calculateRow(r, period, r.attendance),
        sunday_days: r.attendance ? sundayDaysFromAttendance(r.attendance) : r.sunday_days || [],
      })),
    [rows, period]
  );

  const worked = useMemo(() => {
    const q = query.trim().toLowerCase();
    return computed.filter(
      (r) =>
        // A typed amount with no Sundays behind it is how an arrear from a
        // month already closed gets paid, so it belongs here too - the export
        // already carried it, and leaving it off the screen made the money
        // invisible to the one person who has to hand it over.
        (r.sundays_worked > 0 || r.sunday_salary > 0) &&
        (!hidePaid || r.sunday_status !== 'paid') &&
        (!q ||
          r.employee_name.toLowerCase().includes(q) ||
          (r.company_name || '').toLowerCase().includes(q))
    );
  }, [computed, query, hidePaid]);

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
    for (const row of computed) for (const d of row.sunday_days || []) set.add(d);
    return [...set].sort((a, b) => a - b);
  }, [computed, period]);

  /*
   * Dinesh: "sunday duty minimum six hours ki rehti he", "6 hours work full
   * day salary sunday". So the register has to be able to say WHICH Sundays
   * actually carried the six hours - until now a two-hour Sunday and a
   * nine-hour one looked identical here and were paid identically.
   *
   * It reports. It deducts nothing: a Sunday with no clock times is "not
   * known", not "nought hours", and most of the staff are not on the readers
   * yet. Whoever hands the money over decides.
   */
  const sundayHours = sundayHoursFor(period);
  const duty = useMemo(() => {
    const map = new Map();
    for (const row of computed) map.set(row.id, sundayDutyFor(row, period));
    return map;
  }, [computed, period]);
  const short = useMemo(() => shortSundays(worked, period), [worked, period]);
  const [showShort, setShowShort] = useState(false);

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
              <th title={`What the clock says they did on those days. A Sunday's duty is ${sundayHours} hours.`}>
                Hours
              </th>
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
                {dates.map((d) => {
                  const on = (row.sunday_days || []).includes(d);
                  const seen = duty.get(row.id)?.days.find((x) => x.day === d);
                  return (
                    <td
                      key={d}
                      className={`num${isSunday(period.year, period.month, d) ? ' sunday' : ''}`}
                      title={
                        seen && seen.worked !== null
                          ? `${seen.in_time || '?'}–${seen.out_time || '?'} · ${formatDuration(seen.worked)}`
                          : on
                            ? 'no clock times on this day'
                            : undefined
                      }
                    >
                      {on ? (seen && seen.full === false ? '✓!' : '✓') : ''}
                    </td>
                  );
                })}
                <td className="num strong">{days(row.sundays_worked)}</td>
                <td className="num muted">
                  {(() => {
                    const d = duty.get(row.id);
                    if (!d || !d.clocked) return '—';
                    const total = d.days.reduce((s2, x) => s2 + (x.worked || 0), 0);
                    return formatDuration(total);
                  })()}
                </td>
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
                <td colSpan={dates.length + 8} className="empty">
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
                <td />
                <td className="grand">{rupees(totals.amount)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="muted small">
        A Sunday&rsquo;s duty is <strong>{sundayHours} hours</strong>, and {sundayHours} hours on it
        earns the <strong>whole day&rsquo;s</strong> pay — the full day rate, the same as any other
        Sunday. A day with no clock times on it reads as a dash: that is{' '}
        <strong>not known</strong>, not nought hours.
      </p>
      {short.length > 0 && (
        <div className="card narrow">
          <button className="ghost" onClick={() => setShowShort((v) => !v)}>
            {showShort ? 'Hide' : 'Show'} the {short.reduce((n, l) => n + l.days.length, 0)} Sunday
            {short.reduce((n, l) => n + l.days.length, 0) === 1 ? '' : 's'} the clock puts under{' '}
            {sundayHours}h ({short.length} {short.length === 1 ? 'person' : 'people'})
          </button>
          {showShort && (
            <>
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Day</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Worked</th>
                    <th>Short by</th>
                  </tr>
                </thead>
                <tbody>
                  {short.map((line) =>
                    line.days.map((d) => (
                      <tr key={`${line.employee_id}:${d.day}`}>
                        <td>{line.employee_name}</td>
                        <td className="num">
                          {d.day} {weekday(period.year, period.month, d.day)}
                        </td>
                        <td className="num muted">{d.in_time || '—'}</td>
                        <td className="num muted">{d.out_time || '—'}</td>
                        <td className="num">{formatDuration(d.worked)}</td>
                        <td className="num deduct">{formatDuration(d.short)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <p className="muted small">
                <strong>Nothing here has been deducted.</strong> Each of these is still paid a full
                day. Somebody whose second punch never registered has done the day, and docking that
                automatically is a mistake nobody can see. Type over the <strong>Amount</strong> on
                their row above if one of them should not be paid in full.
              </p>
            </>
          )}
        </div>
      )}
      <p className="muted small">
        This pay is settled <strong>entirely apart</strong> from the month's salary: it is not in
        the gross, not in the salary sheet's net payable, and it does not count towards the{' '}
        {rupees(period.pt_threshold)} PT line. It is paid and marked off here.
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
