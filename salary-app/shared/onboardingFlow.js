/**
 * ONBOARDING: the office invites, the person fills in their own record, the
 * office checks it and only then is there an employee.
 *
 * Dinesh's brief: *"allow HR/Admin to invite new employees, after which
 * employees can independently log in, complete their employee information,
 * upload documents and submit their profile for HR verification"*.
 *
 * ---------------------------------------------------------------------------
 * AN INVITATION IS NOT AN EMPLOYEE.
 *
 * Nothing exists on the payroll, the attendance grid or any register until
 * somebody in the office APPROVES it. That is the whole point: a joining
 * form filled in by the person joining is the office's best source for a
 * bank account and an Aadhaar, and the worst possible thing to let straight
 * into the master unchecked.
 *
 * So an invitation carries a draft of the master's own fields - the SAME
 * fields as `shared/employeeMaster.js`, not a second list of them - and
 * approval is the one call that writes an employee.
 * ---------------------------------------------------------------------------
 *
 * Dependency-free, like the rest of shared/.
 */

/**
 * Where an invitation has got to.
 *
 * Fewer states than the brief lists, deliberately. "Invitation created" and
 * "invitation sent" are the same thing here because nothing sends: the link
 * is handed over by whoever made it, on WhatsApp or on paper, and a status
 * claiming it was sent would be the app asserting something it did not do.
 * "Profile incomplete" is not a state either - it is a percentage, and it is
 * shown as one.
 */
export const STATUSES = [
  ['invited', 'Invited', 'the link has been made; nobody has opened it yet'],
  ['opened', 'Opened', 'they have opened the link and started filling it in'],
  ['submitted', 'Submitted', 'they have declared it correct and sent it in'],
  ['returned', 'Returned', 'sent back for a correction, with remarks'],
  ['approved', 'Approved', 'checked, and now an employee'],
  ['cancelled', 'Cancelled', 'withdrawn by the office'],
];

export const statusLabel = (key) => STATUSES.find(([k]) => k === key)?.[1] || key;
export const statusWhy = (key) => STATUSES.find(([k]) => k === key)?.[2] || '';

/** Still being worked on, by either side. */
export const isOpen = (status) => ['invited', 'opened', 'submitted', 'returned'].includes(status);

/** What the person is asked for, in the order they are asked. */
export const EMPLOYEE_SECTIONS = ['basic', 'address', 'emergency', 'statutory', 'salary'];

/*
 * THE SECTIONS THE EMPLOYEE MAY FILL IN, and the ones they may only read.
 *
 * Employment is the office's: company, designation, joining date, who they
 * report to. Dinesh's brief says exactly this - *"Employees can view these
 * details but cannot modify them. Any correction must be requested through
 * HR"* - and it is also the only way the invitation means anything, because
 * those are the fields the office typed when it decided to hire somebody.
 *
 * Salary is NEITHER: it is not shown to them at all. A joining form is not
 * where somebody learns what they are being paid.
 */
export const THEIRS_TO_FILL = [
  'name', 'gender', 'dob', 'blood_group', 'marital_status', 'nationality', 'religion',
  'phone', 'phone_alt', 'email', 'father_name', 'mother_name', 'spouse_name',
  'father_occupation', 'father_company', 'mother_occupation', 'mother_company',
  'father_phone', 'mother_phone',
  'address_line1', 'address_line2', 'city', 'state', 'pincode',
  'perm_same', 'perm_line1', 'perm_line2', 'perm_city', 'perm_state', 'perm_pincode',
  'emergency_name', 'emergency_relation', 'emergency_phone', 'emergency_phone_alt',
  'emergency_address',
  'pan', 'aadhaar', 'uan', 'pf_no', 'esic_no',
  'bank_name', 'bank_account', 'ifsc',
];

/** What the office set and they can only read. */
export const OFFICE_SET = [
  'company_name', 'branch_name', 'department', 'designation',
  'employment_type', 'joined_on', 'reports_to_name', 'work_location',
];

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * What they are asked to confirm before it goes in.
 *
 * Required is a SHORT list, because a joining form that will not go in
 * without a UAN stops somebody who has never had a PF account, and that is
 * most first jobs. Everything else is chased by the office afterwards - the
 * record's own joining checklist already does exactly that.
 */
export const MUST_HAVE = [
  ['name', 'your full name'],
  ['phone', 'a mobile number'],
  ['dob', 'your date of birth'],
  ['address_line1', 'where you live'],
  ['emergency_name', 'somebody to call in an emergency'],
  ['emergency_phone', 'their number'],
];

export function whatIsMissing(draft = {}) {
  return MUST_HAVE.filter(([field]) => !filled(draft[field])).map(([, said]) => said);
}

/** How far through they are, over what they are actually asked for. */
export function progress(draft = {}) {
  const want = THEIRS_TO_FILL.filter((f) => {
    if (f.startsWith('perm_') && f !== 'perm_same' && draft.perm_same) return false;
    return f !== 'perm_same';
  });
  const have = want.filter((f) => filled(draft[f]));
  return {
    want: want.length,
    have: have.length,
    percent: want.length ? Math.round((have.length / want.length) * 100) : 0,
    missing: whatIsMissing(draft),
    ready: whatIsMissing(draft).length === 0,
  };
}

/**
 * The fields of a submitted draft that may become an employee.
 *
 * A WHITELIST, and the reason is the whole module: this is data typed by
 * somebody outside the office, and the one call that writes an employee must
 * not take `monthly_salary`, `active`, `is_draft` or anything else from it
 * however the request is written.
 */
export function masterFieldsFrom(draft = {}, invitation = {}) {
  const out = {};
  for (const field of THEIRS_TO_FILL) {
    if (field in draft) out[field] = draft[field];
  }
  /* The office's own decisions, from the invitation - never from the draft. */
  out.company_id = invitation.company_id;
  out.branch_id = invitation.branch_id || null;
  out.department = invitation.department || null;
  out.designation = invitation.designation || null;
  out.employment_type = invitation.employment_type || null;
  out.joined_on = invitation.joined_on || null;
  out.reports_to_id = invitation.reports_to_id || null;
  return out;
}

/** The declaration, in one place so the form and the record say the same words. */
export const DECLARATION =
  'I confirm that the information and documents provided by me are true and correct to the best of my knowledge.';
