/**
 * The salary structure: Basic, HRA and the allowances that make up a salary.
 *
 * Until now a salary was one number, which is all the sheet needed. A breakup
 * is what an offer letter, a payslip, a Form 16 and the PF return are all
 * actually written against - PF is charged on Basic, HRA carries a tax
 * exemption, and nobody can read "20000" and know either.
 *
 * ---------------------------------------------------------------------------
 * The rule that makes this safe to add to a payroll already running:
 *
 *   THE BREAKUP NEVER CHANGES WHAT ANYBODY IS PAID.
 *
 * `monthly_salary` on the master stays the master. Special allowance is not
 * stored - it is whatever is left over - so the components cannot drift away
 * from the total, and a month's gross, net and PF come out exactly as they did
 * before any of this existed. Setting a structure only changes how the same
 * money is *described*.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, so the server and the standalone file read it identically.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round0 = (n) => Math.round(num(n));

/** The components somebody types. Special is deliberately not among them. */
export const COMPONENTS = [
  { key: 'basic', label: 'Basic', hint: 'PF and gratuity are charged on this' },
  { key: 'hra', label: 'HRA', hint: 'house rent allowance - carries a tax exemption' },
  { key: 'conveyance', label: 'Conveyance', hint: 'travel allowance' },
  { key: 'medical', label: 'Medical', hint: 'medical allowance' },
];

export const SPECIAL = { key: 'special', label: 'Special allowance', hint: 'whatever is left of the salary' };

/** Every line of a payslip's earnings, in the order they are read. */
export const ALL_COMPONENTS = [...COMPONENTS, SPECIAL];

/**
 * What somebody's salary is made of.
 *
 * @returns {
 *   set         a usable breakup exists
 *   over        the components add up to more than the salary - an error
 *   basic..special  the monthly amounts
 *   total       the salary they sum to, which is always monthly_salary
 *   typed       what was actually typed, before special is worked out
 * }
 */
export function salaryStructure(employee) {
  const total = round0(employee?.monthly_salary);
  const typed = {
    basic: round0(employee?.basic),
    hra: round0(employee?.hra),
    conveyance: round0(employee?.conveyance),
    medical: round0(employee?.medical),
  };
  const named = typed.basic + typed.hra + typed.conveyance + typed.medical;
  const special = total - named;

  return {
    ...typed,
    special: Math.max(0, special),
    total,
    typed,
    named,
    // Nothing typed at all is "no structure yet", not a structure of zero.
    set: named > 0 && special >= 0 && total > 0,
    over: named > total,
    // How much is over, so the message can say it rather than just complain.
    overBy: Math.max(0, named - total),
  };
}

/**
 * The structure as this month actually earned it.
 *
 * Everything is pro-rated by the same ratio the gross was cut by, so a month
 * at half attendance shows half the Basic and half the HRA. Special is again
 * the balancing figure, so the lines add up to `grossAfterAbsent` to the
 * rupee - rounding each one separately would leave the payslip a rupee or two
 * short of its own total, which is exactly the kind of thing somebody notices.
 *
 * OT, additions and deductions are NOT split across components: they are not
 * part of the structure and appear as their own lines, where they belong.
 */
export function earnedStructure(employee, { gross_after_absent, salary } = {}) {
  // The components were typed against the master salary, so that is what they
  // are a proportion OF. Scaling by it rather than by the month's salary means
  // a month where the salary itself was edited still splits sensibly, instead
  // of the breakup silently disappearing because the parts now exceed it.
  const basis = round0(employee?.monthly_salary) || round0(salary);
  const structure = salaryStructure({ ...employee, monthly_salary: basis });
  if (!structure.set) return null;

  const earned = round0(gross_after_absent);
  if (basis <= 0) return null;

  const share = (amount) => round0((num(amount) * earned) / basis);
  const basic = share(structure.basic);
  const hra = share(structure.hra);
  const conveyance = share(structure.conveyance);
  const medical = share(structure.medical);

  return {
    basic,
    hra,
    conveyance,
    medical,
    special: earned - basic - hra - conveyance - medical,
    total: earned,
  };
}

/* ---------------- building one ---------------- */

/**
 * The usual Indian small-business split, as a starting point.
 *
 * HRA is 40% of Basic rather than 50%: Vadodara and Surat are not metros for
 * this, and quoting 50% is the kind of thing that only shows up when somebody
 * claims the exemption.
 *
 * Conveyance and medical are the old flat figures people still use. They are a
 * suggestion like everything else here - nothing in the app assumes them.
 */
export const DEFAULT_TEMPLATE = {
  basicPercent: 50,
  hraPercentOfBasic: 40,
  conveyance: 1600,
  medical: 1250,
};

/**
 * Turn a salary into components using a template.
 *
 * The flat allowances are trimmed before they can push the named components
 * past the salary, so a small salary produces a smaller conveyance rather than
 * a negative special allowance. Basic is never trimmed - it is the figure
 * everything else is charged on.
 */
export function applyTemplate(monthlySalary, template = DEFAULT_TEMPLATE) {
  const total = round0(monthlySalary);
  if (total <= 0) return { basic: 0, hra: 0, conveyance: 0, medical: 0 };

  const t = { ...DEFAULT_TEMPLATE, ...(template || {}) };
  const basic = Math.min(total, round0((total * num(t.basicPercent)) / 100));
  const hra = Math.min(total - basic, round0((basic * num(t.hraPercentOfBasic)) / 100));

  let left = total - basic - hra;
  const conveyance = Math.max(0, Math.min(left, round0(t.conveyance)));
  left -= conveyance;
  const medical = Math.max(0, Math.min(left, round0(t.medical)));

  return { basic, hra, conveyance, medical };
}

/* ---------------- what it implies, without changing anything ---------------- */

export const PF_RULES = {
  // The statutory ceiling on PF wages, and the employee's rate.
  wageCeiling: 15000,
  employeeRate: 12,
};

/**
 * What PF *would* be if it were charged on Basic, and what is actually being
 * deducted. This only ever reports: nothing in the app changes a deduction on
 * its own, because that would move somebody's take-home without being asked.
 */
export function pfOnBasic(employee, rules = PF_RULES) {
  const { wageCeiling, employeeRate } = { ...PF_RULES, ...(rules || {}) };
  const structure = salaryStructure(employee);
  if (!structure.set) return null;

  const wages = Math.min(structure.basic, wageCeiling);
  const would = round0((wages * employeeRate) / 100);
  const deducted = round0(employee?.pf);

  return {
    wages,
    would,
    deducted,
    capped: structure.basic > wageCeiling,
    // Worth saying out loud, and worth saying nothing else about.
    matches: would === deducted,
    difference: deducted - would,
  };
}

/** Rows of a payslip's earnings, with the extras that sit outside the structure. */
export function payslipEarnings(employee, row) {
  const earned = earnedStructure(employee, row);
  if (!earned) {
    return [{ key: 'salary', label: 'Salary', amount: round0(row?.gross_after_absent) }];
  }
  return ALL_COMPONENTS.map(({ key, label }) => ({ key, label, amount: earned[key] })).filter(
    (line) => line.amount !== 0
  );
}
