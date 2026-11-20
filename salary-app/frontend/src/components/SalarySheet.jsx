import { useEffect, useMemo, useState } from 'react';
import { calculateRow, totalRows } from '../../../shared/calc.js';
import { col, num, printReport, printSlips } from '../printReport.js';
import { slipFor } from './Payslip.jsx';
import { days, rupees, rupees2 } from '../format.js';
import { payslipFileName, payslipHtml } from '../../../shared/payslipPage.js';
import { loadCompanyLogos, logoFor } from '../companyLogos.js';
import ScrollFrame from './ScrollFrame.jsx';
import PayrollWorkflow from './salary/PayrollWorkflow.jsx';
import PayrollExceptions from './salary/PayrollExceptions.jsx';
import PaymentTracking from './salary/PaymentTracking.jsx';
import MonthlySummary from './salary/MonthlySummary.jsx';
import EmployeeStatement from './salary/EmployeeStatement.jsx';
import { api } from '../api.js';

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

/**
 * A cell, the way a spreadsheet has one: the worked-out figure sits in it
 * greyed, and typing replaces it with your own. Nothing is printed under the
 * box - a second line per cell doubled every row's height and made a sheet of
 * 85 people into something you had to scroll through twice.
 */
function EditableCell({ row, field, disabled, onCommit, auto }) {
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
      placeholder={auto ?? spec.placeholder}
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

/** Lakhs, the way the office reads a payroll total: ₹23.20 L. */
const short = (value) => {
  const v = Math.round(Number(value) || 0);
  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)} L`;
  return rupees(v);
};

const VIEWS = [
  ['sheet', 'Salary sheet'],
  ['summary', 'Monthly summary'],
  ['payments', 'Payment tracking'],
];

export default function SalarySheet({
  period, rows, onPatchRow, onPayslip, onCompany, saving, locked, me, onGo, onReload,
}) {
  const [query, setQuery] = useState('');
  const [dense, setDense] = useState(true);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState('sheet');
  const [review, setReview] = useState(null);
  const [open, setOpen] = useState(null);

  /*
   * The month's exceptions and where it has got to. A nice-to-have, like the
   * dashboard's extras: if it cannot be read the sheet still works, because
   * nothing on the sheet depends on it.
   */
  const loadReview = () => {
    if (!period) return;
    const today = new Date().toISOString().slice(0, 10);
    api
      .get(`/periods/${period.id}/review?today=${today}`)
      .then(setReview)
      .catch(() => setReview(null));
  };
  useEffect(() => {
    loadReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.id, rows]);

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
    let serial = 0;
    for (const row of filtered) {
      if (row.company_name !== current) {
        current = row.company_name;
        serial = 0;
        out.push({ type: 'company', name: current, id: row.company_id, key: `c-${current}` });
      }
      out.push({ type: 'row', row, serial: ++serial, key: `r-${row.id}` });
    }
    return out;
  }, [filtered]);

  /**
   * THE MONTH AS A PAYROLL REGISTER — built, not the screen printed.
   *
   * Dinesh: *"PURA SCREEN PRINT NAHI KARNA HE, REPORT PRINT KARNA HOTA
   * HE"*. The sheet on screen is a grid of boxes you type in; what the
   * office files is a register. Same rows, same `calculateRow` — it
   * assembles and recalculates nothing, so the paper and the sheet cannot
   * disagree about a rupee.
   */
  const printSheet = () => {
    const calcs = filtered.map((row) => ({ row, calc: calculateRow(row, period, row.attendance) }));
    const sum = (get) => calcs.reduce((total, c) => total + (Number(get(c)) || 0), 0);
    printReport({
      title: 'Salary register',
      subtitle: [period?.label, query.trim() && `matching “${query.trim()}”`].filter(Boolean).join(' · '),
      meta: [`${calcs.length} ${calcs.length === 1 ? 'person' : 'people'}`],
      landscape: true,
      columns: [
        col('#', (_r, i) => i + 1, '3%'),
        col('Employee', ({ row }) => row.employee_name),
        col('Company', ({ row }) => row.company_name || ''),
        num('Days', ({ calc }) => calc.working_days),
        num('Present', ({ calc }) => calc.present_days),
        num('Absent', ({ calc }) => calc.absent_days || 0),
        num('Salary', ({ calc }) => rupees(calc.salary)),
        num('Gross', ({ calc }) => rupees(calc.gross_salary)),
        num('OT ₹', ({ calc }) => rupees(calc.ot_salary)),
        num('Add', ({ calc }) => rupees(calc.addition || 0)),
        num('Deduct', ({ calc }) => rupees(calc.deduction || 0)),
        num('PT', ({ calc }) => rupees(calc.pt)),
        num('PF', ({ calc }) => rupees(calc.pf)),
        num('ESI', ({ calc }) => rupees(calc.esi)),
        num('Loan', ({ calc }) => rupees(calc.loan_deduction || 0)),
        num('Net payable', ({ calc }) => rupees(calc.net_salary)),
        col('Pay by', ({ row }) => row.payment_mode || ''),
        col('Status', ({ row }) => row.status || ''),
      ],
      rows: calcs,
      totals: {
        label: `Total (${calcs.length})`,
        Salary: rupees(sum(({ calc }) => calc.salary)),
        Gross: rupees(sum(({ calc }) => calc.gross_salary)),
        'OT ₹': rupees(sum(({ calc }) => calc.ot_salary)),
        Add: rupees(sum(({ calc }) => calc.addition)),
        Deduct: rupees(sum(({ calc }) => calc.deduction)),
        PT: rupees(sum(({ calc }) => calc.pt)),
        PF: rupees(sum(({ calc }) => calc.pf)),
        ESI: rupees(sum(({ calc }) => calc.esi)),
        Loan: rupees(sum(({ calc }) => calc.loan_deduction)),
        'Net payable': rupees(sum(({ calc }) => calc.net_salary)),
      },
      /* Sunday duty is settled on its own register, so it is not added in here. */
      footer:
        'Sunday duty is paid from the Sunday register and is not included in these figures. Every figure comes from the salary sheet itself — nothing is recalculated here.',
    });
  };

  /**
   * A slip each, in the order the sheet is showing them.
   *
   * The letterheads are fetched first and then the whole stack is built, so
   * eighty-five slips cannot come out with the first few carrying a logo and
   * the rest not. If the fetch fails they all go out with the company's name,
   * which is what a company with no logo has anyway.
   */
  const printSlipsForAll = async () => {
    await loadCompanyLogos();
    printSlips({
      slips: filtered.map((row) =>
        slipFor(
          row,
          period,
          calculateRow(row, period, row.attendance),
          logoFor(row.company_id) || logoFor(row.company_name)
        )
      ),
    });
  };

  const money = useMemo(() => {
    const sum = (get) => filtered.reduce((t, r) => t + (Number(get(r)) || 0), 0);
    const deductions =
      sum((r) => r.pt) + sum((r) => r.esi) + sum((r) => r.pf) +
      sum((r) => r.loan_deduction) + sum((r) => r.penalty_deduction) + sum((r) => r.deduction);
    return { gross: sum((r) => r.gross_salary), deductions, net: sum((r) => r.net_salary) };
  }, [filtered]);

  const isAdmin = !!me?.abilities?.includes('admin');
  const statementFor = (employeeId) => {
    const found = rows.find((r) => r.employee_id === employeeId);
    if (found) setOpen(found);
  };

  return (
    /* `salary-page` only means one thing: twenty columns want landscape paper. */
    <section className="salary-page">
      {/*
        * THE MONTH IN FIVE FIGURES, counted off the rows on screen - so the
        * company filter and the search narrow them exactly as they narrow
        * the sheet, and nothing here is a figure of its own.
        */}
      <div className="kpi-row">
        <div className="kpi"><span className="kpi-ico people">👥</span>
          <div><b>{filtered.length}</b><span>Total employees</span></div>
        </div>
        <div className="kpi"><span className="kpi-ico money">₹</span>
          <div><b>{short(money.gross)}</b><span>Gross salary</span></div>
        </div>
        <div className="kpi"><span className="kpi-ico minus">−</span>
          <div><b>{short(money.deductions)}</b><span>Total deductions</span></div>
        </div>
        <div className="kpi"><span className="kpi-ico ok">✓</span>
          <div><b>{short(money.net)}</b><span>Net payable</span></div>
        </div>
        <div className={`kpi ${review?.summary?.open ? 'flag' : ''}`}>
          <span className="kpi-ico warn">!</span>
          <div><b>{review?.summary?.open ?? 0}</b><span>Payroll exceptions</span></div>
        </div>
      </div>

      <PayrollWorkflow
        workflow={review?.workflow}
        period={period}
        isAdmin={isAdmin}
        onError={(err) => window.alert(err.message)}
        onChanged={() => { loadReview(); onReload?.(); }}
      />

      <nav className="tabs sub-tabs">
        {VIEWS.map(([key, label]) => (
          <button key={key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </nav>

      {view === 'summary' ? <MonthlySummary period={period} rows={filtered} /> : null}

      {view === 'payments' ? (
        <PaymentTracking
          period={period}
          rows={filtered}
          locked={locked}
          onError={(err) => window.alert(err.message)}
          onChanged={() => { onReload?.(); loadReview(); }}
          onOpenEmployee={statementFor}
        />
      ) : null}

      {open && (
        <EmployeeStatement
          period={period}
          row={open}
          onClose={() => setOpen(null)}
          onGo={onGo}
        />
      )}

      {view !== 'sheet' ? null : (
      <>
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
        {/*
          * Hand the month out without putting anything on the internet.
          *
          * Dinesh: "ABHI BINA DEPLY K BHEJ SAKU ESA BANAVO". The staff portal
          * answers this properly and needs a server; this is the part that
          * does not - one small file per person, carrying THEIR month and
          * nobody else's, which he forwards on WhatsApp.
          */}
        <button onClick={() => setSending(true)} disabled={!filtered.length}>
          Send payslips
        </button>
        <span className="grow" />
        <button className="ghost" onClick={printSheet} disabled={!filtered.length}>
          Print the register
        </button>
        {/*
          * EVERY SLIP, ONE TO A PAGE. Dinesh: *"salary slip aur payslip ka
          * bhi print report do"*. Each is the same document the single
          * payslip prints - one function, so a line added to one can never
          * be missing from eighty-five.
          *
          * Printed, not forwarded: "Send payslips" beside this makes one
          * HTML file per person for WhatsApp, where ONE FILE HOLDS ONE
          * PERSON. This is the stack for the drawer.
          */}
        <button className="ghost" onClick={printSlipsForAll} disabled={!filtered.length}>
          Print {filtered.length} payslip{filtered.length === 1 ? '' : 's'}
        </button>
        {saving > 0 && <span className="pill saving">Saving {saving}…</span>}
        {locked && <span className="pill locked">Locked</span>}
        <span className="muted small">
          {filtered.length} of {rows.length} employees
        </span>
      </div>

      {sending && (
        <SendPayslips period={period} rows={filtered} onClose={() => setSending(false)} />
      )}

      {review?.exceptions?.length ? (
        <PayrollExceptions
          period={period}
          review={review}
          onError={(err) => window.alert(err.message)}
          onChanged={loadReview}
          onOpenEmployee={statementFor}
        />
      ) : null}

      <ScrollFrame className={dense ? 'dense' : ''}>
        <table className="sheet numbered">
          <thead>
            {/*
              * The grouped band from his mock-up. It is labels only: not one
              * column moved, so every figure is where it always was and the
              * Excel, the print and the payslip are untouched.
              */}
            <tr className="band">
              <th className="row-no" />
              <th className="sticky-name" />
              <th colSpan={6}>Attendance</th>
              <th colSpan={5}>Salary calculation</th>
              <th colSpan={2}>OT</th>
              <th colSpan={3}>Add / deduct</th>
              <th colSpan={3}>Statutory</th>
              <th colSpan={2}>Recoveries</th>
              <th />
              <th colSpan={3}>Payment</th>
            </tr>
            <tr>
              <th className="row-no" title="Serial number within the company" />
              <th className="sticky-name">Employee</th>
              <th title="Working days in the month">WD</th>
              <th title="Sundays / holidays worked - paid extra at the day rate">Sun</th>
              <th title="A = 1 day, HF = half day, AD = 2 days">Absent</th>
              <th>Present</th>
              <th title="Paid leave taken: CL, SL and PL. It costs nothing - it is here because the register is read for it.">PL</th>
              <th title="Unpaid leave (UL). It docks a day like an absence, and is counted apart so the two are never confused.">LWP</th>
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
              <th title="This month's instalment against a fine, a loss or damage - recorded in People - Penalties, and taken every month until it is paid off, like a loan">
                Penalty
              </th>
              <th title="Gross - PT - ESI - PF - loan. Sunday duty is paid apart, on the Sunday tab.">Net payable</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Remark</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((item) =>
              item.type === 'company' ? (
                <tr className="company-row" key={item.key}>
                  <td className="row-no" />
                  <td className="sticky-name" colSpan={25}>
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
                  serial={item.serial}
                  period={period}
                  locked={locked}
                  onPatchRow={onPatchRow}
                  onPayslip={onPayslip}
                  onOpen={setOpen}
                />
              )
            )}
            {!filtered.length && (
              <tr>
                <td colSpan={24} className="empty">
                  No employees here yet. Add them under <strong>Employees</strong>, or import a sheet
                  from <strong>Reports</strong>.
                </td>
              </tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr>
                <td className="row-no" />
                <td className="sticky-name">Total ({totals.count})</td>
                {/* WD, Sun, Absent, Present, PL, LWP - six columns before the
                    salary now that paid and unpaid leave are shown. */}
                <td colSpan={6} />
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
                <td>{rupees(totals.penalty_deduction)}</td>
                <td className="grand">{rupees(totals.net_salary)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollFrame>
      </>
      )}
    </section>
  );
}

/**
 * One file per person, downloaded here and sent on WhatsApp.
 *
 * ONE FILE HOLDS ONE PERSON. It is built from that row alone and never from
 * the store, because the single-file build holds every salary in the company
 * and forwarding THAT to an employee hands them the lot.
 */
function SendPayslips({ period, rows, onClose }) {
  const [picked, setPicked] = useState(() => new Set(rows.map((r) => r.employee_id)));
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  /*
   * The letterheads, while somebody is still ticking names. Nothing waits on
   * it: a file saved before it arrives carries the company's name in type,
   * which is what a company with no logo has anyway.
   */
  useEffect(() => { loadCompanyLogos(); }, []);

  const save = (row) => {
    const calc = calculateRow(row, period, row.attendance);
    const html = payslipHtml({
      employee: {
        name: row.employee_name,
        code: row.employee_code,
        company_name: row.company_name,
        designation: row.designation,
      },
      period,
      row: { ...row, ...calc },
      note: note.trim() || undefined,
      /* The letterhead, carried inside the file like everything else here. */
      logo: logoFor(row.company_id) || logoFor(row.company_name),
    });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = payslipFileName({ name: row.employee_name }, period);
    a.click();
    // Let the browser take the file before the URL goes.
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const saveAll = async () => {
    const list = rows.filter((r) => picked.has(r.employee_id));
    for (let i = 0; i < list.length; i++) {
      setBusy(`${i + 1} of ${list.length}…`);
      save(list[i]);
      // A pause between them: browsers refuse a burst of downloads.
      await new Promise((r) => window.setTimeout(r, 350));
    }
    setBusy('');
  };

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker card wide-picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>Send {period.label} payslips</strong>
          <span className="muted small">one file each, to forward on WhatsApp</span>
        </div>
        <p className="muted small">
          Each file holds <strong>that one person’s</strong> month — their pay with the whole
          working, their days, and nothing about anybody else. It opens on any phone with no
          login and no internet, and prints to PDF.
        </p>
        <label className="field">
          A line to put on every slip (optional)
          <input
            value={note}
            placeholder="Salary credited on 7th. Any query, tell the office."
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="row" style={{ margin: '0.5rem 0' }}>
          <button
            onClick={() =>
              setPicked(
                picked.size === rows.length ? new Set() : new Set(rows.map((r) => r.employee_id))
              )
            }
          >
            {picked.size === rows.length ? 'Untick all' : `Tick all ${rows.length}`}
          </button>
          <button className="primary" disabled={!picked.size || !!busy} onClick={saveAll}>
            {busy || `Download ${picked.size} file${picked.size === 1 ? '' : 's'}`}
          </button>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: '42vh' }}>
          <table className="sheet">
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id}>
                  <td style={{ width: '1.6rem' }}>
                    <input
                      type="checkbox"
                      checked={picked.has(r.employee_id)}
                      onChange={() => {
                        const next = new Set(picked);
                        if (next.has(r.employee_id)) next.delete(r.employee_id);
                        else next.add(r.employee_id);
                        setPicked(next);
                      }}
                    />
                  </td>
                  <td>
                    {r.employee_name}
                    <div className="muted small">{r.company_name}</div>
                  </td>
                  <td className="num">{rupees(r.net_salary)}</td>
                  <td style={{ width: '5rem' }}>
                    <button className="ghost small" onClick={() => save(r)}>
                      just this one
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          The browser may ask once whether to allow several downloads — say yes. They land in
          your Downloads folder, named after the person and the month.
        </p>
      </div>
    </div>
  );
}

function Row({ row, serial, period, locked, onPatchRow, onPayslip, onOpen }) {
  // Recompute here rather than waiting for the round trip, so the row and the
  // totals move the moment a number is typed.
  const calc = useMemo(() => calculateRow(row, period, row.attendance), [row, period]);
  const commit = (field, value) => onPatchRow(row.id, { [field]: value === null ? '' : value });

  return (
    <tr className={row.status === 'paid' ? 'paid' : undefined}>
      <td className="row-no">{serial}</td>
      <td className="sticky-name">
        {/*
          * The name opens the full statement now - attendance, every
          * addition, the payment history - and the payslip is one press
          * inside it. It was the payslip straight away, which is one of four
          * things somebody wants from a name.
          */}
        <button className="link" onClick={() => onOpen(row)} title="Open this employee's salary statement">
          {row.employee_name}
        </button>
        {row.error && <span className="pill error-pill" title={row.error}>save failed</span>}
      </td>
      <td className="num muted">{days(calc.working_days)}</td>
      <td>
        <EditableCell
          row={row}
          field="sundays_override"
          disabled={locked}
          onCommit={commit}
          auto={days(calc.sundays_worked)}
        />
      </td>
      <td>
        <EditableCell
          row={row}
          field="absent_days_override"
          disabled={locked}
          onCommit={commit}
          auto={days(calc.absent_days)}
        />
      </td>
      <td className="num">{days(calc.present_days)}</td>
      {/* Paid leave and unpaid leave, counted off the marks the month is paid
          from - CL/SL/PL cost nothing, UL docks a day like an absence. */}
      <td className="num muted">
        {days((row.mark_counts?.PL || 0) + (row.mark_counts?.CL || 0) + (row.mark_counts?.SL || 0))}
      </td>
      <td className="num muted">{days(row.mark_counts?.UL || 0)}</td>
      <td><EditableCell row={row} field="salary" disabled={locked} onCommit={commit} /></td>
      <td className="num muted">{rupees2(calc.per_day)}</td>
      <td className="num muted">{rupees2(calc.per_hour)}</td>
      <td className="num deduct">{calc.absent_salary ? `-${rupees(calc.absent_salary)}` : '-'}</td>
      <td className="num muted">{rupees(calc.gross_after_absent)}</td>
      <td className={calc.ot_minutes < 0 ? 'deduct-cell' : undefined}>
        <EditableCell
          row={row}
          field="ot_minutes_override"
          disabled={locked}
          onCommit={commit}
          auto={calc.ot_minutes ? `${calc.ot_minutes > 0 ? '+' : ''}${calc.ot_minutes}` : '0'}
        />
      </td>
      <td className={calc.ot_salary < 0 ? 'deduct-cell' : undefined}>
        <EditableCell
          row={row}
          field="ot_amount_override"
          disabled={locked}
          onCommit={commit}
          auto={rupees(calc.ot_salary)}
        />
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
      <td
        className="num deduct"
        title={(row.penalty_notes || []).filter(Boolean).join('; ') || undefined}
      >
        {calc.penalty_deduction ? `-${rupees(calc.penalty_deduction)}` : '-'}
      </td>
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
