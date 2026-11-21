/**
 * LOANS CLOSED OVER A PERIOD, and what is still running.
 *
 * Listed as not built on the note *"Closure is a status on the loan. Nothing
 * reports loans closed over a period."* Half of that was true and half was
 * not, and the half that was not is the point: `loans.status` is
 * active/held - it never says closed - but **closure is already a fact the
 * data holds**. A loan is finished when what has been repaid reaches what
 * was advanced, and the month it finished in is the month of the repayment
 * that got it there.
 *
 * That is the fourth stale "cannot be built" note found in a row. They are
 * worth re-reading rather than trusting: a note explaining why something is
 * impossible outlives the thing that made it so.
 *
 * ---------------------------------------------------------------------------
 * CLOSURE IS DERIVED, NEVER STORED.
 *
 * Writing a `closed_on` would be a second record of a fact the repayments
 * already carry, and the two would disagree the first time an instalment was
 * edited - which the app lets the office do, because somebody who cannot pay
 * this month gets it set to zero. So the repayments are the record, and this
 * reads them.
 * ---------------------------------------------------------------------------
 */

const n = (v) => Math.round(Number(v) || 0);

/** Sort key for a month, so "2026-09" orders before "2026-10". */
const monthKey = (r) => `${r.year || 0}-${String(r.month || 0).padStart(2, '0')}`;

/**
 * One loan, with the repayments posted against it.
 *
 * @param loan        { id, employee_id, employee_name, company_name, amount,
 *                      instalment, given_on, reason, status }
 * @param repayments  [{ amount, year, month, period_label }]
 */
export function settlementOf(loan = {}, repayments = []) {
  const paid = [...repayments]
    .filter((r) => n(r.amount) > 0)
    .sort((a, b) => monthKey(a).localeCompare(monthKey(b)));

  const amount = n(loan.amount);
  let running = 0;
  let closedOn = null;
  let instalments = 0;
  for (const r of paid) {
    running += n(r.amount);
    instalments += 1;
    if (closedOn === null && running >= amount && amount > 0) {
      closedOn = { year: r.year, month: r.month, label: r.period_label || monthKey(r) };
    }
  }

  const repaid = running;
  const outstanding = Math.max(0, amount - repaid);
  return {
    loan_id: loan.id,
    employee_id: loan.employee_id,
    name: loan.employee_name || '',
    code: loan.employee_code || '',
    company_name: loan.company_name || '',
    department: loan.department || '',
    amount,
    repaid,
    outstanding,
    /* What was actually taken each month, which is not always the agreed
       instalment - a month can be skipped without losing the debt. */
    instalment: n(loan.instalment),
    instalments_paid: instalments,
    given_on: loan.given_on || '',
    reason: loan.reason || '',
    status: loan.status || 'active',
    closed: outstanding === 0 && amount > 0,
    closed_on: closedOn ? closedOn.label : '',
    closed_year: closedOn ? closedOn.year : null,
    closed_month: closedOn ? closedOn.month : null,
    /* Over-recovered: more came out than was advanced. Shown rather than
       clamped, because it is money somebody is owed back. */
    over_recovered: Math.max(0, repaid - amount),
    /* How many more months at the agreed instalment. Null, never a guess,
       where no instalment is set - "not known" is not "next month". */
    months_left:
      outstanding > 0 && n(loan.instalment) > 0
        ? Math.ceil(outstanding / n(loan.instalment))
        : null,
  };
}

/**
 * The whole register.
 *
 * `year` narrows the CLOSED list to loans that finished in that year; the
 * running ones are always all of them, because a loan still being recovered
 * is outstanding whatever year it started in.
 */
export function loanSettlement(loans = [], repaymentsOf = () => [], { year } = {}) {
  const all = loans.map((loan) => settlementOf(loan, repaymentsOf(loan.id)));

  const closed = all
    .filter((l) => l.closed)
    .filter((l) => !year || Number(l.closed_year) === Number(year))
    .sort((a, b) => String(b.closed_on).localeCompare(String(a.closed_on)));

  const running = all
    .filter((l) => !l.closed)
    .sort((a, b) => b.outstanding - a.outstanding);

  const sum = (rows, f) => rows.reduce((t, r) => t + f(r), 0);
  return {
    year: year || null,
    closed,
    running,
    totals: {
      closed: closed.length,
      closed_amount: sum(closed, (l) => l.amount),
      running: running.length,
      advanced: sum(running, (l) => l.amount),
      recovered: sum(running, (l) => l.repaid),
      outstanding: sum(running, (l) => l.outstanding),
      /* Held loans take nothing this month. Named apart, because an
         outstanding figure that includes them reads as money coming back
         when none of it is. */
      held: running.filter((l) => l.status === 'held').length,
      held_outstanding: sum(
        running.filter((l) => l.status === 'held'),
        (l) => l.outstanding
      ),
      over_recovered: sum(all, (l) => l.over_recovered),
    },
  };
}

export const SETTLEMENT_COLUMNS = [
  ['Name', 'name'],
  ['Code', 'code'],
  ['Company', 'company_name'],
  ['Department', 'department'],
  ['Advanced', 'amount'],
  ['Given on', 'given_on'],
  ['Reason', 'reason'],
  ['Instalment', 'instalment'],
  ['Instalments paid', 'instalments_paid'],
  ['Repaid', 'repaid'],
  ['Outstanding', 'outstanding'],
  ['Months left', 'months_left'],
  ['Closed in', 'closed_on'],
  ['Status', 'status'],
];
