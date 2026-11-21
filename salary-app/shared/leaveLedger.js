/**
 * THE LEAVE LEDGER - one person, like a Tally account.
 *
 * Dinesh, naming it the most important thing in the leave brief: *"Create an
 * employee-wise Leave Ledger similar to an accounting ledger in Tally"* -
 * date, particulars, credit, debit, balance, reference, with opening and
 * closing balances that reconcile.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THE WHOLE THING HANGS ON: WHAT WAS TAKEN IS NOT STORED HERE.
 *
 * A day of leave is a MARK on the attendance grid. That mark is what the
 * salary sheet is paid from, what the muster roll prints and what the
 * absent/present report counts. If this module also kept its own record of
 * days taken, there would be two answers to "how much leave has she had" -
 * and the day they disagreed, nobody could say which was right.
 *
 * So:
 *   DEBITS ARE DERIVED, every time, from the marks across the leave year.
 *   CREDITS ARE STORED, because a credit is a DECISION - an opening balance,
 *       a monthly accrual, an annual entitlement, a correction, a carry
 *       forward, an expiry. None of those is visible anywhere else, and a
 *       balance worked out from quota-minus-taken can never show them.
 *
 * And the compatibility rule that matters more than any feature here:
 *   WITH NO STORED CREDITS, THE LEDGER FALLS BACK TO THE QUOTA on the
 *       employee record, as a single annual entitlement. Every balance in
 *       the app today is quota minus taken; this must read the same for
 *       everybody until somebody deliberately posts a credit. A new module
 *       that quietly moved eighty-six people's leave balances would be
 *       found out at the worst possible moment.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, like the rest of shared/.
 */

/** Why a credit exists. A credit with no reason is a number nobody can defend. */
export const CREDIT_KINDS = [
  ['opening', 'Opening balance', 'what they were carrying when the records began'],
  ['annual', 'Annual entitlement', 'the year’s leave, credited in one go'],
  ['monthly', 'Monthly credit', 'accrued a month at a time'],
  ['carry_forward', 'Carried forward', 'brought in from last year'],
  ['adjustment', 'Adjustment', 'a correction, with a reason'],
  ['encashed', 'Encashed', 'paid out instead of taken'],
  ['expiry', 'Lapsed', 'unused leave that has expired'],
];

export const creditLabel = (kind) =>
  CREDIT_KINDS.find(([k]) => k === kind)?.[1] || 'Credit';

/** Kinds that take leave AWAY rather than giving it. */
export const TAKES_AWAY = new Set(['expiry', 'encashed']);

const n = (v) => Number(v) || 0;
const day = (v) => (v ? String(v).slice(0, 10) : '');
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * One person's ledger for one leave type.
 *
 * @param code     CL, SL, PL…
 * @param credits  rows from `leave_credits` for this person and type
 * @param taken    [{ year, month, period_label, period_id, days, dates }]
 *                 derived from the marks - never stored
 * @param quota    the entitlement on the employee record, for the fallback
 * @param year     the leave year being shown
 */
export function ledgerFor({ code, credits = [], taken = [], quota = 0, year } = {}) {
  const lines = [];

  /*
   * THE FALLBACK. No credits posted for this person and type means the app
   * has always shown quota minus taken, and this must read the same. It is
   * marked as derived so the screen can say where it came from - a figure
   * nobody posted should never look like one somebody did.
   */
  const posted = credits.filter((c) => c.code === code);
  const opening = posted.find((c) => c.kind === 'opening');
  const effective = posted.length
    ? posted
    : quota > 0
      ? [{
          kind: 'annual',
          code,
          on_date: `${year}-01-01`,
          days: quota,
          note: 'from the yearly entitlement on their record',
          derived: true,
        }]
      : [];

  for (const c of effective) {
    const away = TAKES_AWAY.has(c.kind);
    lines.push({
      date: day(c.on_date),
      particulars: creditLabel(c.kind) + (c.note ? ` — ${c.note}` : ''),
      kind: c.kind,
      credit: away ? 0 : n(c.days),
      debit: away ? n(c.days) : 0,
      reference: c.reference || '',
      by: c.by_whom || '',
      derived: !!c.derived,
    });
  }

  for (const t of taken) {
    if (!n(t.days)) continue;
    lines.push({
      date: t.date || `${t.year}-${String(t.month).padStart(2, '0')}-01`,
      particulars: `Leave taken — ${t.period_label || MONTHS[(t.month || 1) - 1]}${
        t.dates ? ` (${t.dates})` : ''
      }`,
      kind: 'taken',
      credit: 0,
      debit: n(t.days),
      /* The reference is the month it was marked in, because that is where
         somebody goes to see it - and where the pay came out. */
      reference: t.period_label || '',
      by: '',
      period_id: t.period_id ?? null,
    });
  }

  lines.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (b.credit - a.credit));

  let balance = 0;
  for (const line of lines) {
    balance += line.credit - line.debit;
    line.balance = Math.round(balance * 100) / 100;
  }

  const sum = (f) => Math.round(lines.reduce((t, l) => t + f(l), 0) * 100) / 100;
  return {
    code,
    year,
    lines,
    summary: {
      /* Opening is what was carried IN - a posted opening balance or a carry
         forward. An annual entitlement is this year's, not last year's. */
      opening: n(opening?.days) + sum((l) => (l.kind === 'carry_forward' ? l.credit : 0)),
      credited: sum((l) => l.credit),
      availed: sum((l) => (l.kind === 'taken' ? l.debit : 0)),
      adjusted: sum((l) => (l.kind === 'adjustment' ? l.credit - l.debit : 0)),
      expired: sum((l) => (l.kind === 'expiry' ? l.debit : 0)),
      encashed: sum((l) => (l.kind === 'encashed' ? l.debit : 0)),
      closing: Math.round(balance * 100) / 100,
      /* Whether anything here was posted by a person. All-derived means the
         ledger is showing the old quota-minus-taken answer, and the screen
         says so rather than implying a ledger nobody has kept. */
      posted: posted.length > 0,
    },
  };
}

/**
 * THE ENTITLEMENT A LEDGER IS STANDING IN FOR, when nothing has been posted.
 *
 * Zero once anything is posted, because then the ledger IS the answer.
 *
 * This matters more than it looks. The fallback above is an assumption, not
 * an entry - so the first thing posted onto a ledger ENDS it. Post a 3-day
 * encashment onto somebody's untouched 7-day ledger and the closing balance
 * is not 4, it is MINUS 3: the 7 was never there. Anything that takes days
 * away has to write this figure down first, or refuse until somebody has.
 */
export const entitlementOf = (ledger) =>
  ledger?.summary?.posted ? 0 : Number(ledger?.lines?.find((l) => l.derived)?.credit) || 0;

/**
 * The same person across every leave type they have.
 *
 * `types` is the configured list, so a company that adds Compensatory Off
 * gets a column without a line of code changing.
 */
export function ledgersFor({ types = [], credits = [], takenByCode = {}, quotas = {}, year } = {}) {
  return types.map((t) =>
    ledgerFor({
      code: t.code,
      credits,
      taken: takenByCode[t.code] || [],
      quota: n(quotas[t.code]),
      year,
    })
  );
}

/** The balance register's row for one person: every type, side by side. */
export function balanceRow({ employee, ledgers = [] } = {}) {
  const row = {
    employee_id: employee?.id ?? employee?.employee_id ?? null,
    code: employee?.code || '',
    name: employee?.name || employee?.employee_name || '',
    company_name: employee?.company_name || '',
    department: employee?.department || '',
    types: {},
  };
  for (const l of ledgers) {
    row.types[l.code] = {
      opening: l.summary.opening,
      credited: l.summary.credited,
      availed: l.summary.availed,
      balance: l.summary.closing,
      /* NEGATIVE IS NOT AN ERROR - it is leave taken beyond the entitlement,
         which happens and which somebody has to decide about. It is flagged,
         never hidden and never clamped to nought. */
      over: l.summary.closing < 0,
      posted: l.summary.posted,
    };
  }
  return row;
}

/** The columns a ledger prints and exports as, in the order Dinesh listed. */
export const LEDGER_COLUMNS = [
  ['Date', 'date'],
  ['Particulars', 'particulars'],
  ['Credit', 'credit'],
  ['Debit', 'debit'],
  ['Balance', 'balance'],
  ['Reference', 'reference'],
];
