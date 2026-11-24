import { useEffect, useMemo, useState } from 'react';
import { calculateRow, totalRows } from '../../../shared/calc.js';
import { col, num, printReport, printSlips } from '../printReport.js';
import { slipFor } from './Payslip.jsx';
import { days, rupees, rupees2 } from '../format.js';
import { formatDuration } from '../../../shared/timesheet.js';
import {
  CLEAR_HOURS_PATCH,
  chargeHoursPatch,
  hasTypedHours,
  hoursDecision,
  hoursMinutesOf,
} from '../../../shared/hoursDecision.js';
import { salaryDrift, takeMasterPatch } from '../../../shared/salaryDrift.js';
import { payslipFileName, payslipHtml } from '../../../shared/payslipPage.js';
import { loadCompanyLogos, logoFor } from '../companyLogos.js';
import ScrollFrame from './ScrollFrame.jsx';
import PayrollWorkflow from './salary/PayrollWorkflow.jsx';
import PayrollExceptions from './salary/PayrollExceptions.jsx';
import PaymentTracking from './salary/PaymentTracking.jsx';
import MonthlySummary from './salary/MonthlySummary.jsx';
import EmployeeStatement from './salary/EmployeeStatement.jsx';
import { api } from '../api.js';
import { todayIso } from '../../../shared/today.js';

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
  period, rows, onPatchRow, onPatchPeriod, onPayslip, onCompany, saving, locked, me, onGo, onReload, companyId,
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
    const today = todayIso();
    /*
     * THE COMPANY FILTER HAS TO REACH THIS TOO. The register shows one
     * company's rows; without this the headline counted every company's
     * exceptions and the strip said "85 of 115 have attendance marked" -
     * two figures about two different sets of people, side by side.
     */
    const narrow = companyId ? `&company_id=${companyId}` : '';
    api
      .get(`/periods/${period.id}/review?today=${today}${narrow}`)
      .then(setReview)
      .catch(() => setReview(null));
  };
  useEffect(() => {
    loadReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.id, rows, companyId]);

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

  /*
   * EVERY VISIBLE ROW, CALCULATED ONCE, and read by the footer, the decision
   * bar and the printed register alike.
   *
   * The footer used to sum the fields STORED on each row while every row on
   * screen recalculated itself - so between a change and the server's reply
   * the rows and the total below them disagreed. One typed cell made that a
   * blink; pressing "Deduct the short hours" changes eighty-six rows at
   * once, which turned it into a visibly wrong total on a payroll screen.
   */
  const calcs = useMemo(
    () => filtered.map((row) => ({ row, calc: calculateRow(row, period, row.attendance) })),
    [filtered, period]
  );
  const totals = useMemo(() => totalRows(calcs.map((c) => c.calc)), [calcs]);

  /*
   * THE ONE THING LEFT TO DECIDE. Dinesh: *"Amount to apne aap aayega na
   * minus hours ka / o deduct karna he ya nahi uska decision lena he
   * khali"*. The figure is already worked out on every policy; this turns it
   * into a yes or a no. Over the VISIBLE rows, so the company filter and the
   * search narrow it like everything else on this screen.
   */
  const decision = useMemo(() => hoursDecision(calcs, { period }), [calcs, period]);

  /*
   * WHERE THE MONTH AND THE RECORD DISAGREE ABOUT SOMEBODY'S SALARY.
   *
   * Dinesh: *"5 lac salary showing / 50 dala he"*. The month keeps the figure
   * it was given when the row was made, so a salary corrected on the record
   * afterwards never reaches it — and nothing said so. Named here, decided by
   * the office; see `shared/salaryDrift.js` for why there is no rule.
   */
  const drift = useMemo(() => salaryDrift(rows), [rows]);

  /*
   * In small batches rather than eighty-six requests at once. `onPatchRow`
   * already updates the row on screen before the save lands and counts
   * itself into the "Saving N" pill, so there is no reload to do here - the
   * leave-register lesson, the other way round.
   */
  const applyToAll = async (lines, patchOf) => {
    for (let i = 0; i < lines.length; i += 8) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(lines.slice(i, i + 8).map((l) => onPatchRow(l.id, patchOf(l))));
    }
  };

  const chargeShort = async () => {
    const ok = window.confirm(
      `Deduct the hours they are short of this month?\n\n` +
        `${decision.short.length} ${decision.short.length === 1 ? 'person' : 'people'}, ` +
        `₹${rupees(decision.shortAmount)} in all.\n\n` +
        `It goes into the OT min box on each row, where you can see it, change it ` +
        `or clear it. Nobody who already has a figure typed is touched` +
        `${decision.decided.length ? ` (${decision.decided.length} of them)` : ''}.`
    );
    if (!ok) return;
    await applyToAll(decision.short, (l) => chargeHoursPatch(l.minutes));
  };

  const payOver = async () => {
    const ok = window.confirm(
      `Pay the overtime for this month?\n\n` +
        `${decision.over.length} ${decision.over.length === 1 ? 'person has' : 'people have'} ` +
        `done more than their hours, ₹${rupees(decision.overAmount)} in all.`
    );
    if (!ok) return;
    await applyToAll(decision.over, (l) => chargeHoursPatch(l.minutes));
  };

  const handBack = async () => {
    const ok = window.confirm(
      `Clear the hours figure on ${decision.decided.length} ` +
        `${decision.decided.length === 1 ? 'row' : 'rows'}?\n\n` +
        `Each one goes back to what the month's rule says, which on "only the days" ` +
        `is nothing. Anything typed by hand is cleared too.`
    );
    if (!ok) return;
    await applyToAll(decision.decided, () => CLEAR_HOURS_PATCH);
  };

  /*
   * Bring the record's salary onto the month, for every row that disagrees.
   *
   * It names the worst one in the confirmation, because a figure out by a
   * factor of ten is the whole reason somebody presses this and reading it
   * back is the last chance to notice it is the OTHER figure that is wrong.
   */
  const takeMaster = async () => {
    const worst = drift.worst;
    const ok = window.confirm(
      `Put the employee record's salary onto ${drift.lines.length} ` +
        `${drift.lines.length === 1 ? 'row' : 'rows'} of this month?\n\n` +
        (worst
          ? `The biggest difference is ${worst.name}: this month pays \u20b9${rupees(worst.sheet)}, ` +
            `the record says \u20b9${rupees(worst.master)}.\n\n`
          : '') +
        `Every other figure on the row stays. If a month was meant to pay something ` +
        `different, press Cancel and fix the record instead.`
    );
    if (!ok) return;
    await applyToAll(drift.lines, (line) => takeMasterPatch(line));
  };

  /*
   * Stop this month charging the hours — the days-only rule, which every
   * month opened since v2.6.0 already starts on.
   *
   * It switches the MONTH, which is a policy and not a per-person judgement,
   * so it is deliberately a different button from "Deduct the short hours"
   * beside it, and it says both sides: what stops being deducted AND what
   * stops being paid, read off the payslip's own figures.
   */
  const stopCharging = async () => {
    const ok = window.confirm(
      `Stop charging the hours on this month?\n\n` +
        `\u20b9${rupees(Math.abs(decision.chargedAmount))} across ${decision.chargedPeople} ` +
        `${decision.chargedPeople === 1 ? 'person' : 'people'} comes out of the net — ` +
        `the short hours stop being deducted AND the overtime stops being paid.\n\n` +
        `The figures stay on screen in Month hrs. To charge somebody after that, ` +
        `type it into their OT min box.`
    );
    if (!ok) return;
    await onPatchPeriod({ late_policy: 'none' });
  };

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

  /*
   * HOW MUCH OF THE MONTH IS MARKED - in DAYS against days due, worked out
   * by the server with the month's holidays in hand, by the same function
   * the warnings come from. Counting PEOPLE WITH ANY MARK read "13 of 13
   * (100%)" over a list of warnings saying the attendance was unfinished,
   * because one mark on the 2nd made somebody "marked".
   */
  const attendance = review?.attendance || null;

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
        {/*
          * ATTENDANCE COMPLETION IS NOT SALARY PREPARATION. The two were one
          * line inside the workflow strip, so "how much of the month is
          * marked" - the figure that decides whether these salaries mean
          * anything yet - had to be read out of a sentence.
          */}
        <div className={`kpi ${attendance && attendance.percent < 100 ? 'flag' : ''}`}>
          <span className="kpi-ico cal">📅</span>
          <div>
            <b>{attendance?.days_expected ? `${attendance.percent}%` : '—'}</b>
            <span>
              {attendance?.days_expected
                ? `Attendance marked · ${attendance.days_marked} of ${attendance.days_expected} days`
                : 'Attendance marked'}
            </span>
          </div>
        </div>
        <div className={`kpi ${review?.summary?.critical ? 'flag' : ''}`}>
          <span className="kpi-ico warn">!</span>
          <div>
            <b>{review?.summary?.open ?? 0}</b>
            <span>
              Things to check
              {review?.summary?.critical ? ` · ${review.summary.critical} critical` : ''}
            </span>
          </div>
        </div>
      </div>

      <PayrollWorkflow
        workflow={review?.workflow}
        /*
         * THE REVIEW'S OWN PERIOD, not the one the page was opened with.
         * `period` is App.jsx state and nothing refreshes it when the month
         * is approved - so approving worked, the trail recorded it, and the
         * strip went on offering "Approve anyway" with no Lock button in
         * sight. The review is re-read after every decision and carries the
         * period it just looked at.
         */
        period={review?.period || period}
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

      {/*
        * THE DECISION, where the figure is - right on top of the Hours
        * columns rather than on another screen. The amount is worked out;
        * all that is left is yes or no, which is exactly what was asked
        * for.
        */}
      {/*
        * THE SALARY THE MONTH IS PAYING AGAINST THE SALARY ON THE RECORD.
        *
        * Dinesh: *"5 lac salary showing / 50 dala he"*. The month keeps the
        * figure it was given when the row was made; a correction on the
        * record afterwards never reaches it, and nothing said so. Both
        * figures are named and the office decides - there is no rule that
        * could be right here, so there is no rule.
        */}
      {drift.any ? (
        <div className="row gap wrap hours-decide drift-bar">
          <strong>Salary</strong>
          <span>
            {drift.lines.length} {drift.lines.length === 1 ? 'row pays' : 'rows pay'} something
            different from the employee record
            {drift.worst ? (
              <>
                {' '}&mdash; <strong>{drift.worst.name}</strong> is on &#8377;
                {rupees(drift.worst.sheet)} here and &#8377;{rupees(drift.worst.master)} on the record
              </>
            ) : null}
            .
          </span>
          <button type="button" onClick={takeMaster} disabled={locked}>
            Use the record&rsquo;s figure on {drift.lines.length === 1 ? 'it' : `all ${drift.lines.length}`}
          </button>
          <span className="muted small">
            A month keeps the salary it was given, so a figure corrected on the record later does
            not reach it by itself &mdash; and sometimes a month is meant to pay something else.
            Nothing changes until you press it.
          </span>
        </div>
      ) : null}

      {decision.anything ? (
        <div className="row gap wrap hours-decide">
          <strong>The month&rsquo;s hours</strong>
          {/*
            * WHICH WORLD THIS MONTH IS IN, said before the buttons.
            *
            * Dinesh: *"ot plus mins net me count ho raha he / o sirf dikhna
            * chahiye / katna he to o manually add hoga"*. His November was
            * opened before the days-only rule existed, so the hours really
            * are in the net - and this bar was offering to "deduct the short
            * hours" that were already deducted.
            */}
          {decision.charging ? (
            <>
              <span>
                This month <strong>charges the hours</strong>: &#8377;
                {rupees(Math.abs(decision.chargedAmount))} across {decision.chargedPeople}{' '}
                {decision.chargedPeople === 1 ? 'person is' : 'people are'} already in the net below.
              </span>
              {onPatchPeriod ? (
                <button type="button" onClick={stopCharging} disabled={locked}>
                  Only show them, don&rsquo;t charge
                </button>
              ) : null}
            </>
          ) : null}
          {/*
            * The two bulk buttons belong to the days-only world: there the
            * hours are shown and charged nothing, and saying yes is the whole
            * decision. On a month that ALREADY charges them, "Deduct the
            * short hours - 3 people, Rs 333" is offering to deduct what is
            * already inside the Rs 3,205 named above, which is exactly the
            * confusion that was reported. The per-row OT min box is still
            * there for one person.
            */}
          {!decision.charging && decision.short.length ? (
            <button type="button" onClick={chargeShort} disabled={locked}>
              Deduct the short hours &mdash; {decision.short.length}{' '}
              {decision.short.length === 1 ? 'person' : 'people'}, &#8377;{rupees(decision.shortAmount)}
            </button>
          ) : null}
          {!decision.charging && decision.over.length ? (
            <button type="button" className="ghost" onClick={payOver} disabled={locked}>
              Pay the overtime &mdash; {decision.over.length}, &#8377;{rupees(decision.overAmount)}
            </button>
          ) : null}
          {decision.decided.length ? (
            <button type="button" className="ghost" onClick={handBack} disabled={locked}>
              Clear {decision.decided.length} typed figure{decision.decided.length === 1 ? '' : 's'}
            </button>
          ) : null}
          <span className="muted small">
            {decision.charging
              ? 'Type into a row\u2019s OT min box to overrule the rule for one person'
              : 'It fills the OT min box on each row, so you can see it, change it or clear it. ' +
                'Nothing is touched where a figure is already typed'}
            {decision.unknown
              ? `, and ${decision.unknown} ${decision.unknown === 1 ? 'person has' : 'people have'} no clock times at all`
              : ''}
            .
          </span>
        </div>
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
              <th colSpan={3}>Hours</th>
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
              {/*
                * READ-ONLY, and on every policy. What the clock came to for
                * the month: nine hours times the days that were due, against
                * what was actually worked. On the days-only rule it changes
                * nobody's pay - it is here so the office can SEE it and
                * decide, which is exactly what the box beside it is for.
                */}
              <th title="What the clock came to this month: hours worked against hours due. On the 'only the days' rule this is information, not a charge - type a figure into OT min beside it if you want it to count.">
                Month hrs
              </th>
              <th title="What is actually charged or paid for hours. Blank uses the month's rule; type a number and that number is used instead, whatever the rule says.">OT min</th>
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
                  <td className="sticky-name" colSpan={26}>
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
                <td colSpan={25} className="empty">
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
                {/* After absent, Month hrs, OT min - three now that the
                    month's own hours are shown beside the typed figure. */}
                <td />
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
      {/* `judged` false means nobody clocked anything - "not known", which a
          number could not say. Never 0, which would read as "they did their
          hours exactly". */}
      <td
        className="num muted"
        title={
          calc.monthly_hours_judged
            ? `${formatDuration(calc.monthly_hours_worked)} worked against ${formatDuration(
                calc.monthly_hours_expected
              )} due over ${calc.monthly_hours_days} days = ${rupees2(
                Math.abs(calc.monthly_hours_amount)
              )} ${calc.monthly_hours_diff < 0 ? 'short' : 'of overtime'}`
            : 'Nothing was clocked this month, so the hours are not known'
        }
      >
        {!calc.monthly_hours_judged ? (
          '\u2014'
        ) : locked || hasTypedHours(row) || hoursMinutesOf(calc) === 0 ? (
          `${calc.monthly_hours_diff > 0 ? '+' : ''}${calc.monthly_hours_diff}`
        ) : (
          /*
            * One person, one press. The bar above does the whole month; this
            * is the exception - somebody whose hours really should count
            * when nobody else's does. A figure that reads as a decision has
            * to BE one, which is the lesson this file keeps relearning.
            */
          <button
            type="button"
            className="link"
            title={`Put ${hoursMinutesOf(calc)} into OT min for ${row.employee_name} - ${
              hoursMinutesOf(calc) < 0 ? 'deduct' : 'pay'
            } it this month`}
            onClick={() => commit('ot_minutes_override', hoursMinutesOf(calc))}
          >
            {`${calc.monthly_hours_diff > 0 ? '+' : ''}${calc.monthly_hours_diff}`}
          </button>
        )}
      </td>
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
