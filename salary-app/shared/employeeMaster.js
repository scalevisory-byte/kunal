import { todayIso } from './today.js';
/**
 * THE EMPLOYEE MASTER: what a joining form actually asks.
 *
 * Dinesh's brief: a *"complete, professional New Employee form with 8
 * sections"*. Before this, adding somebody was six boxes - company, name,
 * salary, PF, ESI, how they are paid - and everything else was typed later
 * into the record drawer, if anybody remembered.
 *
 * ---------------------------------------------------------------------------
 * THE SECTIONS ARE DATA, NOT MARKUP.
 *
 * The form, the validation, the completeness figure and the tests all read
 * THIS list. A form whose fields live in JSX has no way to answer "what is
 * still missing", and the answer drifts the first time a field is added.
 * ---------------------------------------------------------------------------
 *
 * What it deliberately does NOT do:
 *
 *   IT DOES NOT GATE. Only a name, a company and a joining date are refused;
 *       everything else is a prompt. The office adds somebody in the middle
 *       of a shift from half a form and fills the rest in on Monday, and a
 *       system that refuses that gets worked around on paper.
 *
 *   IT CHANGES NO FIGURE. Not one field here reaches `calculateRow`. The
 *       salary, PF and ESI boxes are the ones the master already had.
 *
 * Dependency-free, like the rest of shared/.
 */

/** How somebody is employed. Free text is not a category. */
export const EMPLOYMENT_TYPES = [
  'Permanent',
  'Probation',
  'Contract',
  'Consultant',
  'Intern',
  'Part time',
  'Temporary',
];

export const MARITAL_STATUSES = ['', 'Single', 'Married', 'Widowed', 'Divorced'];
export const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/**
 * The eight sections, in the order the brief names them.
 *
 * `required: true` marks a field the form stars. Only three of them are
 * actually REFUSED (see `missingRequired`) - the rest are what a complete
 * record looks like, which is a different question from what a save needs.
 */
export const SECTIONS = [
  {
    key: 'basic',
    title: 'Basic details',
    why: 'Who they are. The name is what every other screen shows.',
    fields: [
      ['name', 'Full name', 'text', { required: true }],
      ['gender', 'Sex', 'select', { options: ['', 'Male', 'Female', 'Other'] }],
      ['dob', 'Date of birth', 'date', { hint: 'drives the birthday list' }],
      ['blood_group', 'Blood group', 'select', { options: BLOOD_GROUPS }],
      ['marital_status', 'Marital status', 'select', { options: MARITAL_STATUSES }],
      ['nationality', 'Nationality', 'text', { placeholder: 'Indian' }],
      ['religion', 'Religion', 'text', { hint: 'decides which festivals are a paid holiday' }],
      ['phone', 'Mobile', 'tel', { required: true }],
      ['phone_alt', 'Alternate mobile', 'tel'],
      ['email', 'Personal email', 'email'],
      ['father_name', "Father's name", 'text', { hint: 'the PF Form 2 asks for it' }],
      /* Dinesh: "Mother / father working detail / job company name". What
         each parent does and where - asked by the office for its own record,
         and an input to nothing: not one of these reaches a calculation. */
      ['father_occupation', "Father's work", 'text', { placeholder: 'e.g. business, service, retired' }],
      ['father_company', "Father's company / employer", 'text'],
      ['mother_name', "Mother's name", 'text'],
      ['mother_occupation', "Mother's work", 'text', { placeholder: 'e.g. homemaker, teacher' }],
      ['mother_company', "Mother's company / employer", 'text'],
      ['spouse_name', "Spouse's name", 'text', { hint: 'leave empty if unmarried' }],
    ],
  },
  {
    key: 'employment',
    title: 'Employment details',
    why: 'Which company, which job, and from when. The salary sheet reads these.',
    fields: [
      ['company_id', 'Company', 'company', { required: true }],
      ['branch_id', 'Branch', 'branch', { hint: 'leave empty if the company has one place' }],
      ['code', 'Employee code', 'code', { hint: 'what the payslip calls them' }],
      ['designation', 'Designation', 'master', { master: 'designation' }],
      ['department', 'Department', 'master', { master: 'department' }],
      ['employment_type', 'Employment type', 'select', { options: ['', ...EMPLOYMENT_TYPES] }],
      ['joined_on', 'Date of joining', 'date', { required: true }],
      ['probation_until', 'Probation until', 'date', { hint: 'leave empty if not on probation' }],
      /* ONE line of reporting. There was a second box here - Head of
         department - and Dinesh: "Reporting manager rakhna hai, HOD hata do".
         Two people to name is two answers to "who approves their leave"; the
         reporting manager is the one every approval in the app follows. The
         column stays, so nothing already typed is thrown away. */
      ['reports_to_id', 'Reporting manager', 'employee', { hint: 'approves their leave before the office does' }],
      ['work_location', 'Work location', 'text', { hint: 'if they do not sit at the branch address' }],
      ['shift_in', 'Shift starts', 'text', { hint: "leave empty for the office's usual day" }],
      ['shift_out', 'Shift ends', 'text', { placeholder: '06:00 for a night shift' }],
    ],
  },
  {
    key: 'address',
    title: 'Address details',
    why: 'Where they live. Present is where to reach them; permanent is what the forms ask.',
    fields: [
      ['address_line1', 'Address line 1', 'text'],
      ['address_line2', 'Address line 2', 'text'],
      ['city', 'City', 'text'],
      ['state', 'State', 'text'],
      ['pincode', 'PIN code', 'text'],
      ['perm_same', 'Permanent address is the same', 'checkbox'],
      ['perm_line1', 'Permanent line 1', 'text', { unless: 'perm_same' }],
      ['perm_line2', 'Permanent line 2', 'text', { unless: 'perm_same' }],
      ['perm_city', 'Permanent city', 'text', { unless: 'perm_same' }],
      ['perm_state', 'Permanent state', 'text', { unless: 'perm_same' }],
      ['perm_pincode', 'Permanent PIN code', 'text', { unless: 'perm_same' }],
    ],
  },
  {
    key: 'statutory',
    title: 'Statutory & government',
    why: 'Without these the PF and ESI returns will not file and the TDS has no PAN.',
    fields: [
      ['pan', 'PAN', 'text', { sensitive: true, placeholder: 'ABCDE1234F' }],
      ['aadhaar', 'Aadhaar', 'text', { sensitive: true, placeholder: '12 digits' }],
      ['uan', 'UAN', 'text', { hint: 'the PF number that follows them between jobs' }],
      ['pf_no', 'PF member ID', 'text'],
      ['esic_no', 'ESIC number', 'text'],
    ],
  },
  {
    key: 'salary',
    title: 'Salary & bank',
    why: 'What they are paid and where it goes.',
    pay: true,
    fields: [
      ['monthly_salary', 'Monthly salary', 'money', { required: true }],
      ['payment_mode', 'Pay by', 'select', { options: ['Bank', 'Cash', 'Gpay', 'Cheque'] }],
      ['basic', 'Basic', 'money', { hint: 'optional — it changes nothing about the total' }],
      ['hra', 'HRA', 'money'],
      ['conveyance', 'Conveyance', 'money'],
      ['medical', 'Medical', 'money'],
      ['pf', 'PF deduction', 'money'],
      ['esi', 'ESI deduction', 'money'],
      ['bank_name', 'Bank', 'text', { unless: 'cash' }],
      ['bank_account', 'Account number', 'text', { sensitive: true, unless: 'cash' }],
      ['ifsc', 'IFSC', 'text', { placeholder: 'SBIN0001234', unless: 'cash' }],
    ],
  },
  {
    key: 'emergency',
    title: 'Emergency contact',
    why: 'The one set of details nobody misses until the day something goes wrong.',
    fields: [
      ['emergency_name', 'Who to call', 'text'],
      ['emergency_relation', 'Relationship', 'text', { placeholder: 'father, wife, brother…' }],
      ['emergency_phone', 'Mobile', 'tel'],
      ['emergency_phone_alt', 'Alternate number', 'tel'],
      ['emergency_address', 'Address', 'textarea'],
    ],
  },
  {
    key: 'documents',
    title: 'Documents & verification',
    why: 'PAN card, Aadhaar, photograph, cancelled cheque. Uploaded on the record once they exist.',
    /* Nothing to type: a file needs a row to hang on, so the uploads open on
       the record the moment the person is saved. Said in the form rather
       than left as an empty tab somebody wonders about. */
    fields: [],
  },
  {
    key: 'access',
    title: 'System access & attendance',
    why: 'Their number on the punch machine, their leave entitlement, their weekly off, and whether they get a login.',
    fields: [
      /*
       * THE MOST IMPORTANT FIELD IN THE APP FOR ATTENDANCE, and it was on no
       * form at all - it could only be set from the Punch ID import or by
       * editing the row. The readers hold a NUMBER and no names whatever, so
       * somebody without this never appears in any punch, however well the
       * machines run. It is its own column and not a reuse of `code`: a
       * payslip number and a corridor number are different things, and
       * folding them into one would mean renumbering a reader changed
       * somebody's payslip.
       */
      ['device_code', 'Punch ID', 'text', {
        hint: "the machine's own number for them — without it their punches reach nobody",
      }],
      ['cl_quota', 'Casual leave a year', 'number'],
      ['sl_quota', 'Sick leave a year', 'number'],
      ['pl_quota', 'Privilege leave a year', 'number'],
      ['weekly_off', 'Weekly off', 'weeklyoff', { hint: "leave empty for the company's own" }],
      ['make_login', 'Give them a portal login', 'checkbox', { hint: 'the password is shown once, on the next screen' }],
    ],
  },
];

export const sectionOf = (key) => SECTIONS.find((s) => s.key === key) || null;

/** Every field in the form, flattened — for validation and completeness. */
export const ALL_FIELDS = SECTIONS.flatMap((s) =>
  s.fields.map(([field, label, kind, opts = {}]) => ({ ...opts, field, label, kind, section: s.key }))
);

/**
 * WHAT A SAVE ACTUALLY REFUSES: a name and a company. That is all.
 *
 * NOT the joining date, and not the salary, however loudly the form stars
 * them. Those two are starred because a record without them is incomplete -
 * but refusing them would break every other door into this table: the staff
 * spreadsheet import, the hiring handover, the bulk add. A gate on one of
 * several doors is not a gate, it is a surprise.
 *
 * So the form marks them, `completeness` counts them, the joining checklist
 * chases them, and the save goes through. The same rule the checklist itself
 * already followed.
 */
export const REFUSED_WITHOUT = ['name', 'company_id'];

/** Starred on the form: what a FINISHED record has. Not what a save needs. */
export const STARRED = ['name', 'company_id', 'joined_on', 'monthly_salary', 'phone'];

export function missingRequired(employee = {}) {
  return REFUSED_WITHOUT.filter((f) => {
    const v = employee[f];
    return v === undefined || v === null || String(v).trim() === '';
  }).map((f) => ALL_FIELDS.find((x) => x.field === f)?.label || f);
}

/* ================================================================= *
 * masking
 * ================================================================= */

/**
 * PAN, Aadhaar and a bank account, hidden on screen.
 *
 * `ABCDE1234F` reads back as `XXXXX234F`: enough to check you are looking at
 * the right record, not enough to copy down. The LAST few characters are the
 * ones kept, because that is what somebody checks against a passbook or a
 * card held in the hand.
 *
 * Honest about what this is and is not: the value still travels to a login
 * that covers Employees, because the PF return, the ESI return and the staff
 * export all need it and that permission is exactly what covers them. This
 * hides it from the screen - from a shoulder, a screenshot, a shared desk -
 * and the reveal is written to the audit trail. It is not encryption, and
 * nothing here pretends it is.
 */
const keepLast = (value, keep, group = 0) => {
  const v = String(value || '').trim();
  if (!v) return '';
  if (v.length <= keep) return v;
  const hidden = '•'.repeat(v.length - keep);
  const out = hidden + v.slice(-keep);
  if (!group) return out;
  return out.replace(new RegExp(`(.{${group}})`, 'g'), '$1 ').trim();
};

export const maskPan = (v) => keepLast(v, 4);
export const maskAadhaar = (v) => keepLast(String(v || '').replace(/\s+/g, ''), 4, 4);
export const maskAccount = (v) => keepLast(v, 4);

/** Which fields are masked on screen, and with what. */
export const MASKED = {
  pan: maskPan,
  aadhaar: maskAadhaar,
  bank_account: maskAccount,
};

export const maskOf = (field, value) => (MASKED[field] ? MASKED[field](value) : value);

/* ================================================================= *
 * the same person, twice
 * ================================================================= */

const digits = (v) => String(v || '').replace(/\D/g, '');
const tidy = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
/** The last ten digits: the same number with or without +91 or a 0. */
const mobile = (v) => digits(v).slice(-10);

/**
 * IS THIS PERSON ALREADY ON THE LIST?
 *
 * Dinesh: *"Duplicate employee detection"*, and *"Avoid duplicate employee
 * records"*. A second record for one person is the most expensive mistake
 * this master can make: two payslips, two PF accounts, attendance split
 * across both, and nobody notices until a return bounces.
 *
 * IT WARNS, IT DOES NOT REFUSE - except on an exact employee code, which is
 * a genuine clash rather than a resemblance. Two brothers at the same
 * company really can share a surname and a village; a system that refuses
 * them gets the second one typed as "Amit Shah 2".
 *
 * Ranked, strongest first, each saying WHY - "the same mobile number" is a
 * sentence somebody can act on; "possible duplicate" is not.
 */
export function duplicatesOf(candidate = {}, employees = [], { exceptId = null } = {}) {
  const found = [];
  const add = (employee, strength, why) => {
    const seen = found.find((f) => f.employee === employee);
    if (seen) {
      seen.why.push(why);
      seen.strength = Math.max(seen.strength, strength);
      return;
    }
    found.push({ employee, strength, why: [why] });
  };

  const wantMobile = mobile(candidate.phone);
  const wantPan = tidy(candidate.pan).replace(/\s/g, '');
  const wantAadhaar = digits(candidate.aadhaar);
  const wantUan = digits(candidate.uan);
  const wantAccount = digits(candidate.bank_account);
  const wantName = tidy(candidate.name);
  const wantCode = tidy(candidate.code);
  const wantDob = String(candidate.dob || '').slice(0, 10);

  for (const e of employees) {
    if (exceptId !== null && Number(e.id) === Number(exceptId)) continue;

    if (wantCode && tidy(e.code) === wantCode) add(e, 4, 'the same employee code');
    if (wantAadhaar && wantAadhaar.length === 12 && digits(e.aadhaar) === wantAadhaar) {
      add(e, 3, 'the same Aadhaar');
    }
    if (wantPan && tidy(e.pan).replace(/\s/g, '') === wantPan) add(e, 3, 'the same PAN');
    if (wantUan && wantUan.length === 12 && digits(e.uan) === wantUan) add(e, 3, 'the same UAN');
    if (wantMobile && wantMobile.length === 10 && mobile(e.phone) === wantMobile) {
      add(e, 2, 'the same mobile number');
    }
    if (wantAccount && wantAccount.length > 5 && digits(e.bank_account) === wantAccount) {
      add(e, 2, 'the same bank account');
    }
    /* A name on its own is NOT a duplicate - there are two Patels in most
       offices in Gujarat. A name AND a date of birth is worth asking about. */
    if (wantName && tidy(e.name) === wantName) {
      if (wantDob && String(e.dob || '').slice(0, 10) === wantDob) {
        add(e, 3, 'the same name and date of birth');
      } else {
        add(e, 1, 'the same name');
      }
    }
  }

  return found
    .sort((a, b) => b.strength - a.strength)
    .map((f) => ({
      id: f.employee.id,
      name: f.employee.name,
      code: f.employee.code || '',
      company_name: f.employee.company_name || '',
      active: f.employee.active === undefined ? 1 : f.employee.active,
      why: f.why,
      /* A clash is a fact; a resemblance is a question. Only the first is
         ever refused, and only on the code. */
      blocking: f.why.includes('the same employee code'),
    }));
}

/* ================================================================= *
 * how far through the form somebody is
 * ================================================================= */

/** Does this field apply to this person at all? */
export function fieldApplies(field, employee = {}) {
  if (field.unless === 'cash') return String(employee.payment_mode || '') !== 'Cash';
  if (field.unless === 'perm_same') return !employee.perm_same;
  return true;
}

const filled = (v) =>
  v !== undefined && v !== null && String(v).trim() !== '' && String(v) !== '0';

/**
 * A completeness figure per section, and overall.
 *
 * Counted over the fields that APPLY - somebody paid in cash is not 3 boxes
 * short for having no IFSC, and a permanent address marked "same as present"
 * is not five blanks.
 */
export function completeness(employee = {}) {
  const sections = {};
  let want = 0;
  let have = 0;
  for (const section of SECTIONS) {
    const fields = section.fields
      .map(([field, label, kind, opts = {}]) => ({ ...opts, field, label, kind }))
      .filter((f) => f.kind !== 'checkbox' && fieldApplies(f, employee));
    const done = fields.filter((f) => filled(employee[f.field]));
    sections[section.key] = {
      want: fields.length,
      have: done.length,
      percent: fields.length ? Math.round((done.length / fields.length) * 100) : 100,
      missing: fields.filter((f) => !filled(employee[f.field])).map((f) => f.label),
    };
    want += fields.length;
    have += done.length;
  }
  return { sections, want, have, percent: want ? Math.round((have / want) * 100) : 100 };
}

/* ================================================================= *
 * the lifecycle, derived and not stored
 * ================================================================= */

/**
 * WHERE SOMEBODY IS IN THEIR EMPLOYMENT - worked out, never stored.
 *
 * The row already carries `active`, `left_on`, `joined_on` and
 * `probation_until`. A `status` column beside them would be a second answer
 * to a question that already has one, and the two would disagree the first
 * time somebody set a leaving date without changing the status.
 */
export function lifecycleOf(employee = {}, today = todayIso()) {
  if (employee.is_draft) return { key: 'draft', label: 'Draft', why: 'not finished — not on any payroll' };
  if (employee.active === 0 || employee.left_on) {
    return {
      key: 'left',
      label: 'Left',
      why: employee.left_on ? `left on ${employee.left_on}` : 'marked inactive',
    };
  }
  if (employee.joined_on && employee.joined_on > today) {
    return { key: 'joining', label: 'Joining', why: `starts on ${employee.joined_on}` };
  }
  if (employee.probation_until && employee.probation_until >= today) {
    return { key: 'probation', label: 'On probation', why: `until ${employee.probation_until}` };
  }
  return { key: 'working', label: 'Working', why: '' };
}
