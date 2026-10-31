/**
 * What is still missing before a new joiner is properly on the books.
 *
 * Adding somebody to the payroll takes a name and a salary, which is all the
 * salary sheet needs — and then the month ends and the PF return will not file
 * because there is no UAN, and the salary will not transfer because there is no
 * IFSC. This turns that into a list somebody can work down.
 *
 * It is a checklist, not a gate. Nothing here blocks a save, refuses a payslip
 * or hides anybody: payroll runs on what it has. It only says what is missing
 * and why it will matter.
 *
 * Dependency-free, so the dashboard and the server read it identically.
 */

/** Shape checks only. A PAN that is the right shape can still be the wrong PAN. */
const SHAPES = {
  pan: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/i, hint: 'ABCDE1234F' },
  aadhaar: { re: /^\d{12}$/, hint: '12 digits' },
  uan: { re: /^\d{12}$/, hint: '12 digits' },
  esic_no: { re: /^\d{10,17}$/, hint: '10–17 digits' },
  ifsc: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/i, hint: 'SBIN0001234' },
  bank_account: { re: /^\d{6,20}$/, hint: '6–20 digits' },
  phone: { re: /^\d{10}$/, hint: '10 digits' },
  email: { re: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, hint: 'name@example.com' },
};

const clean = (value) => String(value ?? '').replace(/\s+/g, '').trim();

/**
 * Every step, in the order somebody would actually do them.
 *
 * `why` is the point: a checklist that does not say what breaks gets ignored.
 */
export const STEPS = [
  {
    key: 'identity',
    title: 'Who they are',
    fields: ['name', 'dob', 'gender', 'phone'],
    required: ['name', 'phone'],
    why: 'The birthday card on the dashboard and anything you ever have to post to them.',
  },
  {
    key: 'employment',
    title: 'The job',
    fields: ['designation', 'department', 'joined_on', 'monthly_salary'],
    required: ['joined_on', 'monthly_salary'],
    why: 'A joining date part-way through the month is how their first salary gets pro-rated. Without it they are paid a full month.',
  },
  {
    key: 'statutory',
    title: 'Statutory numbers',
    fields: ['pan', 'aadhaar', 'uan', 'esic_no'],
    required: [],
    why: 'The PF and ESI returns are filed per person. A missing UAN or ESIC number is named on the register and stops that line filing.',
  },
  {
    key: 'bank',
    title: 'Where the salary goes',
    fields: ['bank_name', 'bank_account', 'ifsc'],
    required: [],
    why: 'A bank transfer needs all three. Somebody paid in cash does not — set their payment mode to Cash instead.',
  },
  {
    key: 'leave',
    title: 'Leave entitlement',
    fields: ['cl_quota', 'sl_quota', 'pl_quota'],
    required: [],
    why: 'Leave taken is counted against these. Left at zero, every leave they take shows as over quota.',
  },
];

const FIELD_LABELS = {
  name: 'Name',
  dob: 'Date of birth',
  gender: 'Gender',
  phone: 'Mobile',
  email: 'Email',
  designation: 'Designation',
  department: 'Department',
  joined_on: 'Joining date',
  monthly_salary: 'Monthly salary',
  pan: 'PAN',
  aadhaar: 'Aadhaar',
  uan: 'UAN',
  esic_no: 'ESIC number',
  bank_name: 'Bank',
  bank_account: 'Account number',
  ifsc: 'IFSC',
  cl_quota: 'Casual leave',
  sl_quota: 'Sick leave',
  pl_quota: 'Privilege leave',
};

export const fieldLabel = (key) => FIELD_LABELS[key] || key;

const filled = (employee, key) => {
  const value = employee?.[key];
  if (value === null || value === undefined || String(value).trim() === '') return false;
  // A quota or a salary of zero is a real answer for a quota and not for a salary.
  if (key === 'monthly_salary') return Number(value) > 0;
  return true;
};

/**
 * Where this person is. Steps carry their own missing and malformed lists, so
 * the UI can show one section at a time rather than a wall of red.
 */
export function onboardingStatus(employee, { paidInCash = false } = {}) {
  const steps = STEPS.map((step) => {
    // Cash in hand needs no bank details, and saying otherwise is noise.
    const skip = step.key === 'bank' && paidInCash;
    const fields = step.fields.map((key) => {
      const has = filled(employee, key);
      const shape = SHAPES[key];
      const value = clean(employee?.[key]);
      return {
        key,
        label: fieldLabel(key),
        filled: has,
        // Only complain about a shape once something has been typed.
        malformed: has && shape && !shape.re.test(value),
        hint: shape?.hint || '',
        required: step.required.includes(key),
      };
    });
    const missing = skip ? [] : fields.filter((f) => !f.filled);
    const malformed = fields.filter((f) => f.malformed);
    return {
      ...step,
      skipped: skip,
      fields,
      missing,
      malformed,
      done: skip || (missing.length === 0 && malformed.length === 0),
      blocking: skip ? [] : fields.filter((f) => f.required && !f.filled),
    };
  });

  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    percent: Math.round((done / steps.length) * 100),
    complete: done === steps.length,
    // Everything still missing, flattened, for a one-line summary.
    missing: steps.flatMap((s) => s.missing.map((f) => f.label)),
    blocking: steps.flatMap((s) => s.blocking.map((f) => f.label)),
  };
}

/**
 * The people who are not finished. Sorted by who joined most recently, because
 * that is who somebody is actually chasing.
 */
export function openOnboarding(employees = []) {
  return employees
    .filter((employee) => employee.active !== 0)
    .map((employee) => ({
      employee,
      status: onboardingStatus(employee, { paidInCash: /cash/i.test(employee.payment_mode || '') }),
    }))
    .filter(({ status }) => !status.complete)
    .sort((a, b) => String(b.employee.joined_on || '').localeCompare(String(a.employee.joined_on || '')));
}
