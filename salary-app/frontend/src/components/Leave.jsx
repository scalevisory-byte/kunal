import { useEffect, useMemo, useState } from 'react';
import { col, num, printReport } from '../printReport.js';
import { api } from '../api.js';
import LeaveLedger from './LeaveLedger.jsx';
import LeaveCalendar from './LeaveCalendar.jsx';
import LeaveYearEnd from './LeaveYearEnd.jsx';
import LeaveBonus from './LeaveBonus.jsx';
import { LEAVE_TYPES } from '../../../shared/calc.js';
import { days } from '../format.js';
import SandwichLeave from './SandwichLeave.jsx';
import WeeklyOff from './WeeklyOff.jsx';

/**
 * The leave register for a calendar year.
 *
 * Nothing is entered here. What somebody has taken is counted from the CL, SL
 * and PL marks on the attendance grid across every month of the year, so the
 * register and the grid can never disagree. Entitlement is set per employee;
 * anyone over it is flagged, because those days should have been unpaid.
 */
export default function Leave({
  periods,
  employees,
  companies = [],
  companyId = null,
  onGo,
  period,
  // The month's calculated rows, for the sandwich tool. Named apart from the
  // `rows` below, which are this year's leave balances.
  payrollRows = [],
  onPatch,
  onPatchCompany,
  onSaveAttendance,
  onReload,
  locked,
}) {
  const [view, setView] = useState('balances');
  const [year, setYear] = useState(() => periods[0]?.year || new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [onlyOver, setOnlyOver] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ledgerFor, setLedgerFor] = useState(null);

  const years = useMemo(() => {
    const set = new Set(periods.map((p) => p.year));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [periods]);

  const load = async (forYear) => {
    setLoading(true);
    setError('');
    try {
      const { rows: list } = await api.get(`/leave?year=${forYear}`);
      setRows(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(year);
    // Reloading whenever the year or the staff list changes is the whole thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, employees]);

  /*
   * OVER THEIR ENTITLEMENT MEANS AGAINST AN ENTITLEMENT SOMEBODY SET.
   *
   * With every quota still at nil, anybody who took a single day read as
   * "over" — which is not an offence, it is an unset quota, and a register
   * that flags the whole staff for it gets ignored. A type with no quota is
   * not judged; the panel above says what is actually wrong instead.
   */
  const over = (row) =>
    LEAVE_TYPES.filter((t) => row.quotas[t.code] > 0 && row.taken[t.code] > row.quotas[t.code]);

  /** Nobody anywhere has an entitlement set — the whole register is nil. */
  const noQuotas = rows.length > 0 &&
    rows.every((r) => LEAVE_TYPES.every((t) => !Number(r.quotas[t.code])));

  const [busy, setBusy] = useState(false);

  /**
   * SET THE ENTITLEMENT FOR EVERYBODY ON SCREEN.
   *
   * The inline boxes are right for correcting one person and hopeless for
   * starting: seventy-nine people across three types is 237 boxes, which is
   * why every quota on the live server was still nil.
   *
   * It asks for the three figures, names how many people it is about to
   * change, and **never overwrites a quota somebody has already set** unless
   * that is asked for — a bulk button that quietly flattened a
   * hand-adjusted entitlement would be worse than no button.
   */
  const setQuotasForAll = async () => {
    const people = filtered.length ? filtered : rows;
    if (!people.length) return;
    const ask = (label, fallback) => {
      const typed = window.prompt(`${label} — days a year`, String(fallback));
      return typed === null ? null : Math.max(0, Number(typed) || 0);
    };
    const cl = ask('Casual leave (CL)', 7);
    if (cl === null) return;
    const sl = ask('Sick leave (SL)', 7);
    if (sl === null) return;
    const pl = ask('Privilege leave (PL)', 12);
    if (pl === null) return;

    const already = people.filter((r) =>
      LEAVE_TYPES.some((t) => Number(r.quotas[t.code]) > 0)
    );
    let overwrite = true;
    if (already.length) {
      overwrite = window.confirm(
        `${already.length} of these ${people.length} already have a quota set.\n\n` +
          'OK — change theirs too.\nCancel — leave those alone and only fill in the blanks.'
      );
    }
    const target = overwrite ? people : people.filter((r) => !already.includes(r));
    if (!target.length) return;
    if (
      !window.confirm(
        `Set CL ${cl}, SL ${sl}, PL ${pl} for ${target.length} ` +
          `${target.length === 1 ? 'person' : 'people'}?`
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    try {
      /* One patch each, then ONE reload - reloading per person would mean
         seventy-nine round trips behind a spinner. */
      for (const row of target) {
        await onPatch(row.employee_id, { cl_quota: cl, sl_quota: sl, pl_quota: pl });
      }
      await load(year);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!onlyOver || over(r).length > 0) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          (r.company_name || '').toLowerCase().includes(q) ||
          (r.department || '').toLowerCase().includes(q))
    );
  }, [rows, query, onlyOver]);

  const totals = filtered.reduce(
    (acc, r) => {
      for (const t of LEAVE_TYPES) {
        acc.quota[t.code] += r.quotas[t.code];
        acc.taken[t.code] += r.taken[t.code];
      }
      acc.unpaid += r.taken.UL;
      return acc;
    },
    { quota: { CL: 0, SL: 0, PL: 0 }, taken: { CL: 0, SL: 0, PL: 0 }, unpaid: 0 }
  );

  const overCount = rows.filter((r) => over(r).length > 0).length;

  /**
   * THE YEAR'S LEAVE AS A REGISTER.
   *
   * Due, taken and left for each kind, straight off the rows on screen — and
   * `taken` is COUNTED FROM THE MARKS across the year's months, never a
   * running total somebody could edit, so this page and the attendance grid
   * cannot drift apart.
   *
   * Unpaid leave is shown with no balance beside it, because there is no
   * quota for it: it was taken anyway and it was docked.
   */
  const printLeave = () => {
    const narrowed = [
      query.trim() && `matching “${query.trim()}”`,
      onlyOver && 'only those over their entitlement',
    ].filter(Boolean);
    const names = [...new Set(filtered.map((r) => r.company_name).filter(Boolean))];
    printReport({
      title: 'Leave register',
      subtitle: [names.length === 1 ? names[0] : 'All companies', String(year), ...narrowed].join(' · '),
      meta: [
        `${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}`,
        overCount ? `${overCount} over their entitlement` : 'nobody over their entitlement',
      ],
      landscape: true,
      columns: [
        col('#', (_r, i) => i + 1, '3%'),
        col('Employee', (r) => r.name),
        col('Company', (r) => r.company_name || ''),
        col('Department', (r) => r.department || ''),
        ...LEAVE_TYPES.flatMap((t) => [
          num(`${t.code} due`, (r) => days(r.quotas[t.code])),
          num(`${t.code} taken`, (r) => days(r.taken[t.code])),
          num(`${t.code} left`, (r) => {
            const left = r.quotas[t.code] - r.taken[t.code];
            // Over the entitlement is said as a minus, never hidden at zero.
            return `${left < 0 ? '-' : ''}${days(Math.abs(left))}`;
          }),
        ]),
        num('Unpaid', (r) => days(r.taken.UL)),
      ],
      rows: filtered,
      totals: {
        label: `Total (${filtered.length})`,
        ...Object.fromEntries(
          LEAVE_TYPES.flatMap((t) => [
            [`${t.code} due`, days(totals.quota[t.code])],
            [`${t.code} taken`, days(totals.taken[t.code])],
            [`${t.code} left`, days(totals.quota[t.code] - totals.taken[t.code])],
          ])
        ),
        Unpaid: days(totals.unpaid),
      },
      footer:
        'Taken is counted from the attendance marks across the year, not kept as a separate running total — so this register and the attendance grid cannot disagree. Unpaid leave has no entitlement behind it: it was taken and it was docked.',
    });
  };

  if (view === 'weekly') {
    return (
      <section className="stack">
        <LeaveTabs view={view} setView={setView} />
        <WeeklyOff
          companies={companies}
          employees={employees}
          onPatchCompany={onPatchCompany}
          onPatchEmployee={onPatch}
          locked={locked}
        />
      </section>
    );
  }

  if (view === 'calendar') {
    return (
      <section className="stack">
        <LeaveTabs view={view} setView={setView} />
        <LeaveCalendar
          period={period}
          companyId={companyId}
          onGo={onGo}
          onError={(m) => setError(m)}
        />
      </section>
    );
  }

  if (view === 'bonus') {
    return (
      <section className="stack">
        <LeaveTabs view={view} setView={setView} />
        <LeaveBonus
          period={period}
          companyId={companyId}
          onReload={onReload}
        />
      </section>
    );
  }

  if (view === 'yearend') {
    return (
      <section className="stack">
        <LeaveTabs view={view} setView={setView} />
        <LeaveYearEnd
          year={year}
          companyId={companyId}
          onDone={() => load(year)}
          onError={(m) => setError(m)}
        />
      </section>
    );
  }

  if (view === 'sandwich') {
    return (
      <section className="stack">
        <LeaveTabs view={view} setView={setView} />
        {period && payrollRows.length ? (
          <SandwichLeave period={period} rows={payrollRows} onSave={onSaveAttendance} locked={locked} />
        ) : (
          <p className="muted small">Open a month to look for sandwiched days.</p>
        )}
      </section>
    );
  }

  return (
    <section className="stack">
      <LeaveTabs view={view} setView={setView} />
      <div className="card">
        <div className="toolbar">
          <label className="inline-num">
            Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <input
            className="search"
            placeholder="Search employee, company or department"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="check">
            <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} />
            Only over their entitlement
          </label>
          {/* The balances as a register — asked for by name alongside the
              attendance muster. */}
          <button className="ghost" onClick={printLeave} disabled={!filtered.length}>
            Print the leave register
          </button>
          {/*
            * SETTING SEVENTY-NINE PEOPLE ONE BOX AT A TIME IS NOT A FEATURE.
            * The inline boxes are right for correcting one person; they are
            * no way to start, which is why every quota on the live server
            * was still zero.
            */}
          <button disabled={!filtered.length || busy} onClick={setQuotasForAll}>
            Set quotas for these {filtered.length}
          </button>
          <span className="grow" />
          {loading && <span className="pill saving">Loading…</span>}
          {busy && <span className="pill saving">Saving…</span>}
          {overCount > 0 && (
            <span className="pill locked">{overCount} over their entitlement</span>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {/*
          * A PAGE OF ZEROS READS AS BROKEN SOFTWARE.
          *
          * With no quota set anywhere, every Due, Left and Taken column is 0
          * and the register looks as though it has lost the data. It has
          * not: nobody has said how much leave anybody gets. Say that, and
          * put the way to fix it right here - the same answer the roll call
          * gives for a month nobody has marked.
          */}
        {!loading && rows.length > 0 && noQuotas ? (
          <div className="ef-dup">
            <strong>No leave quota has been set for anybody yet.</strong>
            <p className="muted small">
              That is why every figure reads nil — not because anything is missing. Days{' '}
              <strong>taken</strong> are counted off the attendance grid and are right; what is
              not set is how many days each person is <strong>entitled</strong> to.
            </p>
            <button className="primary" disabled={busy} onClick={setQuotasForAll}>
              Set them for all {rows.length} people
            </button>
            <p className="muted small">
              You can change any one of them afterwards, right in the table or on their record.
            </p>
          </div>
        ) : null}

        <div className="table-wrap unboxed">
          <table className="sheet leave-register">
            <thead>
              <tr>
                <th className="sticky-name" rowSpan={2}>Employee</th>
                {/* It renders `department || company_name`, so calling it
                    Company was wrong on every row that has a department -
                    which on the live server is nearly all of them. */}
                <th rowSpan={2}>Company / department</th>
                {LEAVE_TYPES.map((t) => (
                  <th key={t.code} colSpan={3} className="leave-group">
                    {t.label} ({t.code})
                  </th>
                ))}
                <th rowSpan={2} title="Leave with no balance behind it - a day of salary each">
                  Unpaid
                </th>
              </tr>
              <tr>
                {LEAVE_TYPES.map((t) => [
                  <th key={`${t.code}-q`} title="Set on the employee's record">Due</th>,
                  <th key={`${t.code}-t`}>Taken</th>,
                  <th key={`${t.code}-b`}>Left</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.employee_id}>
                  <td className="sticky-name">
                    {/* THE NAME IS THE WAY INTO THAT PERSON'S LEDGER - date,
                        particulars, credit, debit, balance. It was plain
                        text, which is not a way in; the sixth time that
                        exact shape has come up in this app. */}
                    <button
                      type="button"
                      className="link name-link"
                      onClick={() => setLedgerFor(row.employee_id)}
                      title={`${row.name} — their leave ledger`}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="muted">{row.department || row.company_name}</td>
                  {LEAVE_TYPES.map((t) => {
                    const left = row.quotas[t.code] - row.taken[t.code];
                    return [
                      <td key={`${t.code}-q`} className="num">
                        <input
                          key={`${row.employee_id}-${t.quotaField}-${row.quotas[t.code]}`}
                          className="cell-input narrow"
                          inputMode="decimal"
                          defaultValue={row.quotas[t.code]}
                          onBlur={(e) => {
                            const value = Number(e.target.value) || 0;
                            if (value !== row.quotas[t.code]) {
                              onPatch(row.employee_id, { [t.quotaField]: value }).then(() => load(year));
                            }
                          }}
                        />
                      </td>,
                      <td key={`${t.code}-t`} className="num">{days(row.taken[t.code]) === '0' ? '-' : days(row.taken[t.code])}</td>,
                      <td key={`${t.code}-b`} className={`num strong${left < 0 ? ' deduct' : ''}`}>
                        {days(left)}
                      </td>,
                    ];
                  })}
                  <td className={`num${row.taken.UL ? ' deduct' : ''}`}>
                    {row.taken.UL ? days(row.taken.UL) : '-'}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={12} className="empty">
                    {onlyOver ? 'Nobody is over their entitlement.' : 'Nobody on the list yet.'}
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr>
                  <td className="sticky-name">Total ({filtered.length})</td>
                  <td />
                  {LEAVE_TYPES.map((t) => [
                    <td key={`${t.code}-q`} className="num">{days(totals.quota[t.code])}</td>,
                    <td key={`${t.code}-t`} className="num">{days(totals.taken[t.code])}</td>,
                    <td key={`${t.code}-b`} className="num">{days(totals.quota[t.code] - totals.taken[t.code])}</td>,
                  ])}
                  <td className="num">{days(totals.unpaid)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="muted small">
          <strong>Taken</strong> is counted from the CL, SL and PL marks on the attendance grid
          across every month of {year} — there is nothing to keep in step by hand. Change{' '}
          <strong>Due</strong> right here, or on the employee's own record.
        </p>
        <p className="muted small">
          A negative <strong>Left</strong> means more paid leave was taken than was due. Those days
          are still being paid — mark them <strong>Unpaid Leave</strong> on the grid instead if they
          should not be. <strong>Unpaid</strong> counts the UL marks, which already cost a day each.
        </p>
      </div>

      {ledgerFor ? (
        <LeaveLedger employeeId={ledgerFor} year={year} onClose={() => { setLedgerFor(null); load(year); }} />
      ) : null}
    </section>
  );
}

/** The three things the Leave tab answers: balances, the day off, the rule. */
function LeaveTabs({ view, setView }) {
  return (
    <div className="sub-tabs toolbar">
      {[
        ['balances', 'Balances'],
        ['calendar', 'Calendar'],
        ['yearend', 'Year end'],
        ['bonus', 'Bonus'],
        ['weekly', 'The day off'],
        ['sandwich', 'Sandwich leave'],
      ].map(([key, label]) => (
        <button key={key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}
