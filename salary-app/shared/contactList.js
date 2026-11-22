/**
 * THE STAFF CONTACT LIST — who they are, where they sit, how to reach them.
 *
 * Dinesh: *"staff wise email & mobile number ka list bhi chiaye with
 * deopartmmet role"*.
 *
 * The master already held every one of these fields; what there was no way
 * to get was the five of them together on one page you could print or hand
 * to somebody. The employee export carries forty columns including salaries,
 * which is not a thing to send round the office.
 *
 * ---------------------------------------------------------------------------
 * NO SALARY, NO PAN, NO BANK ACCOUNT — AND THAT IS THE POINT.
 *
 * A contact list gets forwarded, printed and left on a desk. `CONTACT_FIELDS`
 * is the whole of what it can ever carry, so a column cannot be added to it
 * by accident later; there is a test asserting nothing else travels.
 * ---------------------------------------------------------------------------
 */

/** Everything this list is allowed to show. Nothing else, ever. */
export const CONTACT_FIELDS = [
  ['name', 'Name'],
  ['code', 'Code'],
  ['company_name', 'Company'],
  ['department', 'Department'],
  ['designation', 'Role'],
  ['phone', 'Mobile'],
  ['email', 'Email'],
  ['work_location', 'Where they work'],
];

/** Fields that must never reach a list that gets left on a desk. */
export const NEVER_ON_A_CONTACT_LIST = [
  'monthly_salary', 'salary', 'basic', 'hra', 'pan', 'aadhaar',
  'bank_account', 'ifsc', 'uan', 'esic_no', 'pf_no', 'dob',
];

const text = (v) => String(v ?? '').trim();

/** One person's line — only the fields above. */
export function contactLine(employee = {}) {
  const line = {};
  for (const [key] of CONTACT_FIELDS) line[key] = text(employee[key]);
  line.employee_id = employee.id;
  /* What is missing, so the office knows who to chase rather than reading
     a blank and assuming the app lost it. */
  line.missing = [
    line.phone ? null : 'mobile',
    line.email ? null : 'email',
    line.department ? null : 'department',
    line.designation ? null : 'role',
  ].filter(Boolean);
  return line;
}

/**
 * The whole list.
 *
 * Sorted by company, then department, then name — the order somebody reads
 * it in when they are looking for "whoever is in Accounts".
 */
export function contactList(employees = [], { company_id, department, q } = {}) {
  const hunt = text(q).toLowerCase();
  const lines = employees
    .filter((e) => e.active !== 0 && e.active !== false)
    .filter((e) => !company_id || String(e.company_id) === String(company_id))
    .filter((e) => !department || text(e.department) === text(department))
    .map(contactLine)
    .filter(
      (l) =>
        !hunt ||
        [l.name, l.code, l.department, l.designation, l.phone, l.email]
          .join(' ')
          .toLowerCase()
          .includes(hunt)
    )
    .sort(
      (a, b) =>
        a.company_name.localeCompare(b.company_name) ||
        a.department.localeCompare(b.department) ||
        a.name.localeCompare(b.name)
    );

  return {
    lines,
    totals: {
      people: lines.length,
      with_mobile: lines.filter((l) => l.phone).length,
      with_email: lines.filter((l) => l.email).length,
      /* Named because it is the actionable half: a list is only as good as
         the numbers on it, and "62 of 86 have a mobile" is the figure that
         gets the other 24 collected. */
      no_mobile: lines.filter((l) => !l.phone).length,
      no_email: lines.filter((l) => !l.email).length,
      departments: new Set(lines.map((l) => l.department).filter(Boolean)).size,
    },
  };
}
