/**
 * Leaving: notice, leave encashment, gratuity, and the full and final.
 *
 * Everything here **assembles**; nothing recalculates. The final month's pay
 * comes out of `calculateRow` exactly as the payslip does, so the settlement
 * and the payslip cannot disagree. What this module adds is the arithmetic that
 * only happens once, at the end: what unused leave is worth, whether gratuity
 * is due, and what short notice costs.
 *
 * Three deliberate choices, because an F&F is the one payment nobody can
 * correct next month:
 *
 * - **Only privilege leave is encashed** by default. CL and SL lapse at the end
 *   of the year everywhere this is used; paying them out would hand over days
 *   nobody had a claim to. It is a setting, not a guess.
 * - **An unreturned asset is never deducted automatically.** Its value is named
 *   beside the settlement and somebody decides. Docking a laptop off a final
 *   payment that then turns out to be in a drawer is not recoverable.
 * - **Gratuity is reported with its rule and its eligibility**, never silently
 *   included or silently dropped. Under five years of service it is stated as
 *   not due, with the service length, rather than left off the page.
 *
 * Dependency-free, like the rest of shared/.
 */

/** How somebody left. The reason matters: a termination is not a resignation. */
export const EXIT_TYPES = [
  { code: 'resigned', label: 'Resigned', notice_from: 'employee' },
  { code: 'terminated', label: 'Terminated', notice_from: 'employer' },
  { code: 'absconded', label: 'Absconded', notice_from: 'employee' },
  { code: 'retired', label: 'Retired', notice_from: 'none' },
  { code: 'contract_ended', label: 'Contract ended', notice_from: 'none' },
];

export const EXIT_TYPE = Object.fromEntries(EXIT_TYPES.map((t) => [t.code, t]));

/**
 * The rules, all overridable per settlement so a negotiated exit is possible
 * without editing code.
 *
 *   notice_days       what the contract asks for
 *   encash_codes      which leave kinds are paid out
 *   encash_cap_days   0 = no cap
 *   gratuity_years    the Payment of Gratuity Act's five years
 *   gratuity_days     15 days' wages per completed year, worked on a 26-day month
 */
export const SETTLEMENT_RULES = {
  notice_days: 30,
  encash_codes: ['PL'],
  encash_cap_days: 0,
  gratuity_years: 5,
  gratuity_days: 15,
  gratuity_month_days: 26,
};

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round0 = (n) => Math.round(num(n));
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/** A date, or null. Never a silent Invalid Date. */
export function readDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from one date to another, or null when either is missing. */
export function daysBetween(from, to) {
  const a = readDate(from);
  const b = readDate(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * Completed years of service, and the months past them.
 * Six months and a day counts as a further year for gratuity, which is the
 * Act's own rounding, so it is reported separately from the plain count.
 */
export function serviceLength(joinedOn, lastDay) {
  const from = readDate(joinedOn);
  const to = readDate(lastDay);
  if (!from || !to || to < from) return { years: 0, months: 0, days: 0, known: false, gratuity_years: 0 };

  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  if (days < 0) {
    months--;
    const prev = new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    days += prev;
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  // The Act counts a part-year over six months as a full year.
  const gratuity_years = years + (months >= 6 ? 1 : 0);
  return { years, months, days, known: true, gratuity_years };
}

/**
 * What the notice period came to, and what is owed either way.
 *
 * Somebody who resigns and leaves early owes the shortfall; an employer who
 * terminates without notice owes it instead. Which way round is decided by the
 * exit type, not by who filled the form in.
 */
export function noticeOf({ type = 'resigned', resigned_on, last_working_day, notice_days } = {}) {
  const required = Math.max(0, num(notice_days, SETTLEMENT_RULES.notice_days));
  const served = daysBetween(resigned_on, last_working_day);
  const owedBy = EXIT_TYPE[type]?.notice_from || 'employee';

  if (served === null) {
    return { required, served: null, short: null, owed_by: owedBy, known: false };
  }
  const short = Math.max(0, required - served);
  return {
    required,
    served,
    short,
    // Nobody owes anything where the notice was served, or where the type asks
    // for none (a retirement, a contract simply ending).
    owed_by: short > 0 && owedBy !== 'none' ? owedBy : 'nobody',
    known: true,
  };
}

/**
 * Unused leave worth paying out.
 *
 * `taken` and `quotas` come from the same count the Leave tab shows, which is
 * counted off the marks across the year's periods - so this cannot drift from
 * what was actually taken.
 */
export function leaveEncashment({ quotas = {}, taken = {}, per_day = 0, rules } = {}) {
  const settings = { ...SETTLEMENT_RULES, ...(rules || {}) };
  const codes = settings.encash_codes || [];
  const lines = [];
  let days = 0;

  for (const code of ['CL', 'SL', 'PL']) {
    const quota = Math.max(0, num(quotas[code]));
    const used = Math.max(0, num(taken[code]));
    const left = Math.max(0, quota - used);
    const encashed = codes.includes(code) ? left : 0;
    lines.push({ code, quota, taken: used, left, encashed, paid: codes.includes(code) });
    days += encashed;
  }

  const cap = Math.max(0, num(settings.encash_cap_days));
  const capped = cap > 0 ? Math.min(days, cap) : days;
  return {
    lines,
    days: round2(days),
    capped_days: round2(capped),
    cap,
    per_day: round2(per_day),
    amount: round0(capped * num(per_day)),
    codes,
  };
}

/**
 * Gratuity, reported whether or not it is due.
 *
 * 15 days' wages for every completed year, on a 26-day month, which is the
 * Act's formula: last drawn Basic + DA x 15/26 x years. Where no salary breakup
 * is set there is no Basic to use, so the monthly salary stands in and the
 * result says so - an honest approximation beats a confident wrong number.
 */
export function gratuityOf({ basic, monthly_salary, service, rules } = {}) {
  const settings = { ...SETTLEMENT_RULES, ...(rules || {}) };
  const wages = num(basic) > 0 ? num(basic) : num(monthly_salary);
  const years = num(service?.gratuity_years);
  const eligible = service?.known === true && years >= settings.gratuity_years;
  const amount = eligible
    ? round0((wages * settings.gratuity_days * years) / settings.gratuity_month_days)
    : 0;
  return {
    eligible,
    years,
    needs_years: settings.gratuity_years,
    wages: round0(wages),
    on: num(basic) > 0 ? 'basic' : 'monthly salary',
    amount,
    // Said carefully, because the Act's rounding reads as a contradiction next
    // to the plain service length: somebody at 7 years 6 months is paid for 8.
    note: noteFor(service, years, eligible, settings),
  };
}

function noteFor(service, years, eligible, settings) {
  if (service?.known !== true) return 'no joining date, so the service length is not known';
  const served = `${service.years} ${service.years === 1 ? 'year' : 'years'}${
    service.months ? ` ${service.months} ${service.months === 1 ? 'month' : 'months'}` : ''
  } of service`;
  const rounded =
    years > service.years ? `, counted as ${years} (a part year over six months counts as one)` : '';
  if (eligible) return `${served}${rounded}`;
  return `${served}${rounded}, under the ${settings.gratuity_years} the Act asks for`;
}

/**
 * The whole settlement, assembled.
 *
 * @param input {
 *   employee          the master row (salary, basic, joining date)
 *   exit              the exit record (type, dates, notice, rules)
 *   final_month       the calculated payroll row for the last month, or null
 *   leave             { quotas, taken } as the Leave tab counts them
 *   loan_outstanding  what is still owed on any loan or advance
 *   claims            approved expense claims not yet paid
 *   assets            assets still out, each { label, value }
 *   extras            { label, amount } lines somebody added by hand
 * }
 */
export function settlement(input = {}) {
  const {
    employee = {},
    exit = {},
    final_month = null,
    leave = {},
    loan_outstanding = 0,
    claims = [],
    assets = [],
    extras = [],
  } = input;
  const rules = { ...SETTLEMENT_RULES, ...(exit.rules || {}) };

  const salary = num(employee.monthly_salary);
  // The day rate the whole app pays on - 26 days, never the calendar.
  const perDay = final_month ? num(final_month.per_day) : salary / rules.gratuity_month_days;

  const service = serviceLength(employee.joined_on, exit.last_working_day);
  const notice = noticeOf({
    type: exit.type,
    resigned_on: exit.resigned_on,
    last_working_day: exit.last_working_day,
    notice_days: exit.notice_days ?? rules.notice_days,
  });
  const encashment = leaveEncashment({
    quotas: leave.quotas,
    taken: leave.taken,
    per_day: perDay,
    rules,
  });
  const gratuity = gratuityOf({
    basic: final_month ? final_month.earned_basic : employee.basic,
    monthly_salary: salary,
    service,
    rules,
  });

  const claimsDue = claims.reduce((sum, c) => sum + num(c.amount), 0);
  const noticeShortfall = notice.short > 0 && notice.owed_by === 'employee' ? notice.short * perDay : 0;
  const noticePay = notice.short > 0 && notice.owed_by === 'employer' ? notice.short * perDay : 0;

  const pays = [
    final_month
      ? { label: `Salary for ${exit.final_month_label || 'the final month'}`, amount: round0(final_month.net_salary) }
      : { label: 'Salary for the final month', amount: 0, missing: true },
    { label: `Leave encashment (${encashment.capped_days} days)`, amount: encashment.amount },
    { label: 'Gratuity', amount: gratuity.amount },
    { label: `Notice pay (${notice.short || 0} days)`, amount: round0(noticePay) },
    { label: 'Expense claims approved and unpaid', amount: round0(claimsDue) },
    ...extras
      .filter((e) => num(e.amount) > 0)
      .map((e) => ({ label: String(e.label || 'Other'), amount: round0(e.amount) })),
  ];

  const recovers = [
    { label: 'Loan / advance outstanding', amount: round0(loan_outstanding) },
    { label: `Short notice (${notice.short || 0} days)`, amount: round0(noticeShortfall) },
    ...extras
      .filter((e) => num(e.amount) < 0)
      .map((e) => ({ label: String(e.label || 'Other'), amount: round0(-e.amount) })),
  ];

  const payable = pays.reduce((s, l) => s + num(l.amount), 0);
  const recoverable = recovers.reduce((s, l) => s + num(l.amount), 0);

  /*
   * Assets still out are NOT deducted. They are listed with what they are
   * worth so that somebody decides, because a deduction against a laptop that
   * turns out to be in a drawer cannot be undone after the payment is made.
   */
  const outstandingAssets = assets.map((a) => ({
    label: String(a.label || a.kind || 'Asset'),
    value: round0(a.value),
  }));

  const open = [];
  if (!final_month) open.push('the final month has not been calculated yet');
  if (!exit.last_working_day) open.push('no last working day, so service and notice are not known');
  if (!service.known) open.push('no joining date on the record, so gratuity cannot be worked out');
  if (outstandingAssets.length)
    open.push(
      `${outstandingAssets.length} ${outstandingAssets.length === 1 ? 'asset is' : 'assets are'} still out`,
    );

  return {
    service,
    notice,
    encashment,
    gratuity,
    per_day: round2(perDay),
    pays: pays.filter((l) => l.amount !== 0 || l.missing),
    recovers: recovers.filter((l) => l.amount !== 0),
    payable: round0(payable),
    recoverable: round0(recoverable),
    net: round0(payable - recoverable),
    assets_out: outstandingAssets,
    assets_value: outstandingAssets.reduce((s, a) => s + a.value, 0),
    open,
  };
}
