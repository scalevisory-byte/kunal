/**
 * WHICH PARTS OF THE APP A LOGIN MAY USE.
 *
 * Dinesh, looking at four people who are all Admin: *"rights me aur option
 * do"*. The four roles say what KIND of thing somebody may do - look, change,
 * or change the installation itself. They cannot say that Krishna handles
 * attendance and has no business on the salary sheet.
 *
 * So areas sit BESIDE the role rather than replacing it. The role still
 * decides look-or-change; the areas decide where.
 *
 * TWO RULES THE WHOLE DESIGN RESTS ON:
 *
 *   NOTHING TICKED MEANS EVERYTHING. A login with no areas set is exactly
 *   what it is today, so turning this on cannot quietly lock four people out
 *   of their own payroll on a Monday morning. Narrowing is a thing somebody
 *   chooses, one login at a time.
 *
 *   SALARY IS ITS OWN AREA, not a corner of Employees. It is the one thing in
 *   this app people actually want kept from each other, and it shows up in
 *   half a dozen places - the sheet, a payslip, the employee master, the
 *   registers, a CSV. Treating it as its own right is what lets it be
 *   enforced in ONE place rather than remembered in six.
 *
 * Dependency-free, so the server that enforces this and the screen that draws
 * the ticks cannot come to disagree about what a right means.
 */

/** key, what to call it, and what it covers in plain words. */
export const AREAS = [
  [
    'salary',
    'Salary sheet',
    'The month’s pay: every figure, payslips, the statutory registers and the pay in any export.',
  ],
  ['attendance', 'Attendance & time', 'The grid, the roll call, clock times, holidays and the punch imports.'],
  ['leave', 'Leave', 'Leave balances, applications and approvals.'],
  ['loans', 'Loans & advances', 'Loans given, and what is deducted each month.'],
  ['employees', 'Employees', 'The staff master, records, documents and the salary breakup.'],
  ['assets', 'Assets', 'The register, handovers, stock takes and maintenance.'],
  /*
   * Its own right, not a corner of Assets, because this is where the Tally,
   * Windows and antivirus keys are kept. Whoever counts the chairs has no
   * business reading them.
   */
  ['license', 'Software licences', 'The licence register: keys, seats, renewals and what they cost.'],
  ['hiring', 'Hiring', 'Vacancies, candidates, interviews, tests and offers.'],
  ['people', 'People', 'Warnings, appraisals, claims, penalties, tickets and exits.'],
  ['reports', 'Reports', 'Every report and export.'],
];

export const AREA_KEYS = AREAS.map(([key]) => key);

export const areaLabel = (key) => AREAS.find(([k]) => k === key)?.[1] || key;

/**
 * The areas a login carries, as a clean list.
 *
 * An empty list is NOT "nothing" - it is "nobody has narrowed this login",
 * which `may` reads as everything. Saying so here, once, is what stops some
 * future caller treating `[]` as a lockout.
 */
export function areasOf(user) {
  const raw = user?.areas;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return [...new Set(list.map((a) => String(a).trim()).filter((a) => AREA_KEYS.includes(a)))];
}

/** Has this login been narrowed at all? */
export const isNarrowed = (user) => areasOf(user).length > 0;

/**
 * May this login use this area?
 *
 * A STAFF LOGIN MAY USE NONE OF THEM. Its whole authority is /api/me, which
 * answers only about the one employee it is tied to; areas are about the
 * office side and granting one to a staff login would be the opposite of what
 * that role is for.
 */
export function may(user, area) {
  if (!user) return false;
  if (user.role === 'employee') return false;
  if (!AREA_KEYS.includes(area)) return true;
  const areas = areasOf(user);
  return areas.length === 0 || areas.includes(area);
}

/** What to show somebody: every area they may use. */
export const allowedAreas = (user) => AREA_KEYS.filter((a) => may(user, a));

/**
 * THE FIELDS THAT ARE PAY.
 *
 * Stripped from every office response for a login without the salary area.
 * Done in one place rather than per route, because a list of six screens to
 * remember is a list somebody forgets - and a figure that leaks once has
 * leaked.
 *
 * `salary` and `gross`-style keys are deliberately included: a payroll row
 * calls the month's figure `salary`, not `monthly_salary`.
 */
export const PAY_FIELDS = [
  'monthly_salary', 'salary', 'basic', 'hra', 'conveyance', 'medical', 'special',
  'gross_salary', 'gross_after_absent', 'net_salary', 'final_payable', 'per_day',
  'pf', 'esi', 'pt', 'employer_pf', 'employer_esi', 'ctc',
  'loan_deduction', 'addition', 'deduction', 'adjustment',
  'sunday_salary', 'ot_amount', 'offer_salary', 'current_salary', 'expected_salary',
];

const PAY = new Set(PAY_FIELDS);

/**
 * The same object with every pay figure taken out.
 *
 * Walks whatever it is given - the shapes here are deep (a month carries rows
 * which carry employees) and a one-level sweep would miss all of it.
 */
export function withoutPay(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => withoutPay(v, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (PAY.has(key)) continue;
    out[key] = withoutPay(v, depth + 1);
  }
  return out;
}
