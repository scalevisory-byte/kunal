/**
 * WHAT SOMEBODY MAY FILL IN ABOUT THEMSELVES, from their own login.
 *
 * Dinesh: *"employee banane k liye jo details chiaye / o khud employee bhar
 * k de / and uske documnet bhi khud upload karde"* — the details it takes to
 * make an employee should be typed by the employee, and their papers
 * uploaded by them.
 *
 * Half of that already existed: `shared/onboardingFlow.js` invites somebody
 * who has NOT joined yet to fill in the joining form and send their papers,
 * and the office approves. What did not exist is the same thing for the
 * eighty-odd people ALREADY on the payroll — their portal let them change a
 * bank account, a phone and an email, and nothing else, and it could not
 * upload a single file. Which is why their UAN and ESIC columns are blank:
 * nobody but the office could ever fill them, and the office has eighty of
 * them to chase.
 *
 * ---------------------------------------------------------------------------
 * ONE LIST, NOT A SECOND ONE.
 *
 * The fields are `onboardingFlow.THEIRS_TO_FILL` narrowed to what the master
 * actually has, and they are LABELLED and LAID OUT by
 * `employeeMaster.SECTIONS`. A joining form and a "complete your record"
 * form that asked for different things would be two definitions of the same
 * person, and the second one added would be the one that drifted.
 * ---------------------------------------------------------------------------
 *
 * THE RULE THAT DECIDES WHAT LANDS, and the only interesting thing here:
 *
 *   Their own facts — name, date of birth, father's name, where they live,
 *   who to ring in an emergency, their bank — are THEIRS. Nobody in the
 *   office knows them better. They write through, and `updateEmployee`
 *   records every one in `employee_history` by name and date, the way a
 *   bank account changing the week before payday already is.
 *
 *   A statutory identifier — PAN, Aadhaar, UAN, PF member ID, ESIC — may be
 *   FILLED IN when it is blank and may NOT be changed once it is set. It is
 *   the number a PF return, an ESI return and a TDS filing quote; the office
 *   usually took it off the card itself; and a wrong one is found months
 *   later by a rejected return. Supplying a missing one is strictly better
 *   than the blank that is there now — there is nothing to lose and a
 *   filing to gain. Overwriting a set one is a correction, and a correction
 *   goes through the office, who can see the card.
 *
 * Nothing here can reach a figure. `monthly_salary`, `basic`, `pf`, `esi`,
 * `joined_on`, `active`, `code`, `company_id` are not on the list and a
 * patch naming one is refused by name — not ignored, which is how somebody
 * comes to believe a form saved something it dropped.
 *
 * Dependency-free, like the rest of shared/.
 */

import { ALL_FIELDS } from './employeeMaster.js';
import { THEIRS_TO_FILL } from './onboardingFlow.js';
import { DOCUMENT_KINDS } from './documents.js';
import { STEPS, fieldLabel } from './onboarding.js';

/** Fields the master does not carry (the invitation keeps its own copies). */
const NOT_ON_THE_MASTER = new Set(['perm_same']);

/**
 * The employee's own fields, in the master's own order.
 *
 * Driven off `THEIRS_TO_FILL` so the joining form and this one ask for the
 * same things, and off `ALL_FIELDS` so each one is called what it is called
 * everywhere else.
 */
export const FILLABLE = ALL_FIELDS.filter(
  (f) => THEIRS_TO_FILL.includes(f.field) && !NOT_ON_THE_MASTER.has(f.field)
);

export const FILLABLE_NAMES = FILLABLE.map((f) => f.field);

/**
 * Fill a blank; never change one that is set. See the note at the top.
 */
export const ONCE_ONLY = ['pan', 'aadhaar', 'uan', 'pf_no', 'esic_no'];

/**
 * The sections the portal shows, in the order it shows them.
 *
 * `employment`, `salary` (the pay half), `documents` and `access` are not
 * here: employment is what the office decided when it hired them, pay is not
 * something somebody learns off a form, documents are files rather than
 * boxes, and leave quotas are the office's. The bank half of `salary` IS
 * here — it is on `THEIRS_TO_FILL` — under its own heading, because "Salary
 * & bank" as a title on a page that shows no salary reads as a page that is
 * hiding one.
 */
export const SELF_SECTIONS = [
  { key: 'basic', title: 'About you', why: 'Who you are. The office fills the PF forms from this.' },
  { key: 'address', title: 'Where you live', why: 'Present is where you are reached; permanent is what the forms ask for.' },
  { key: 'emergency', title: 'Who to call in an emergency', why: 'The one thing nobody misses until the day it is needed.' },
  { key: 'statutory', title: 'Your government numbers', why: 'Without these the PF and ESI returns cannot be filed and the TDS has no PAN.' },
  { key: 'bank', title: 'Where your salary goes', why: 'The account the transfer is made to.' },
];

const BANK_FIELDS = ['bank_name', 'bank_account', 'ifsc'];

/** The fields of one portal section, in the master's order. */
export function fieldsOf(sectionKey) {
  if (sectionKey === 'bank') {
    return BANK_FIELDS.map((name) => FILLABLE.find((f) => f.field === name)).filter(Boolean);
  }
  return FILLABLE.filter((f) => f.section === sectionKey && !BANK_FIELDS.includes(f.field));
}

/** Laid out, ready to render. The shape is data, not JSX. */
export const selfForm = () =>
  SELF_SECTIONS.map((section) => ({ ...section, fields: fieldsOf(section.key) }));

/** What the office decided, which they may read and not change. */
export const OFFICE_SET = [
  ['code', 'Employee ID'],
  ['company_name', 'Company'],
  ['branch_name', 'Branch'],
  ['designation', 'Designation'],
  ['department', 'Department'],
  ['employment_type', 'Employment type'],
  ['joined_on', 'Joined on'],
  ['work_location', 'Work location'],
];

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * May this person set this field to this value?
 *
 * Returns a reason rather than a bare false, because the reason is what the
 * screen has to say — and a refusal with no reason reads as a broken form.
 */
export function canSet(field, { current, next } = {}) {
  if (!FILLABLE_NAMES.includes(field)) {
    return { ok: false, why: `${field} is the office’s to change, not yours` };
  }
  if (ONCE_ONLY.includes(field) && filled(current) && String(current).trim() !== String(next ?? '').trim()) {
    const label = FILLABLE.find((f) => f.field === field)?.label || field;
    return {
      ok: false,
      why: `your ${label} is already on your record — ask the office to correct it, so they can check it against the card`,
    };
  }
  return { ok: true };
}

/**
 * Narrow a patch to what this person may actually set.
 *
 * Everything else comes back NAMED in `refused`, with why. Silently dropping
 * a field is how somebody types their salary into a form, sees "Saved", and
 * believes it.
 */
export function applySelf(employee = {}, patch = {}) {
  const allowed = {};
  const refused = [];
  for (const [field, next] of Object.entries(patch || {})) {
    const verdict = canSet(field, { current: employee[field], next });
    if (verdict.ok) allowed[field] = next;
    else refused.push({ field, why: verdict.why });
  }
  return { patch: allowed, refused };
}

/**
 * WHAT THE OFFICE IS ACTUALLY CHASING THEM FOR.
 *
 * The joining checklist already answers this, step by step, with what breaks
 * without each field — so the employee's page chases exactly what the
 * office's "Still to finish" list chases, rather than a third opinion. Only
 * the ones that are theirs to fill: a missing designation is not something
 * they can do anything about.
 */
export const WANTED = STEPS.flatMap((step) =>
  step.fields.filter((f) => FILLABLE_NAMES.includes(f))
);

/**
 * How far through their own record they are, and what is still wanted.
 *
 * TWO DIFFERENT FIGURES, deliberately, the same split the joining form
 * makes. `percent` is over everything they are asked, so it moves when they
 * fill anything in. `missing` is only what the office is chasing — because a
 * list that opens with "Spouse's name" and "Alternate mobile" is a list
 * somebody closes, and the PF return does not care about either.
 *
 * A permanent address is not counted while none has been typed: blank there
 * reads as "the same as above", which is what most people mean.
 */
export function selfProgress(employee = {}) {
  const want = FILLABLE.filter((f) => {
    if (f.field.startsWith('perm_') && samePermanent(employee)) return false;
    return true;
  });
  const have = want.filter((f) => filled(employee[f.field]));
  const missing = WANTED.filter((f) => !filled(employee[f]));
  return {
    want: want.length,
    have: have.length,
    percent: want.length ? Math.round((have.length / want.length) * 100) : 100,
    /* The checklist's own flat labels, not the form's. In a section headed
       "Who to call in an emergency", `Mobile` is clear; in a flat list of
       what is still wanted beside their own Mobile, it is not. */
    missing: missing.map(fieldLabel),
    missing_fields: missing,
    done: missing.length === 0,
  };
}

/** No permanent address typed at all reads as "the same as above". */
const samePermanent = (employee = {}) =>
  !['perm_line1', 'perm_line2', 'perm_city', 'perm_state', 'perm_pincode'].some((f) => filled(employee[f]));

/**
 * THE PAPERS THEY MAY SEND IN — theirs, not the office's.
 *
 * An offer letter and an appointment letter are issued BY the office; a
 * employee uploading one would be filing a document against themselves that
 * nobody in the office wrote. Everything else on the list is a copy of
 * something in their own hands.
 *
 * Whatever arrives lands UNCHECKED — `verified` stays null, which is a third
 * state and not "rejected". Somebody in the office still has to look at the
 * Aadhaar card. That is the whole reason the column is three-state.
 */
export const OFFICE_ISSUES = ['offer_letter', 'appointment'];

export const UPLOADABLE_KINDS = DOCUMENT_KINDS.filter((k) => !OFFICE_ISSUES.includes(k.key));

export const mayUpload = (kind) => UPLOADABLE_KINDS.some((k) => k.key === kind);

/** Said once, so the form and the record carry the same words. */
export const SELF_DECLARATION =
  'What I have typed here about myself is true, and the documents I have uploaded are copies of my own.';
