/**
 * The physical interview form.
 *
 * Dinesh asked for this in as many words: a form HR or an interviewer fills in
 * while somebody is sitting in front of them, recording what was said. He was
 * explicit about what it is NOT - "this is an interview information and
 * documentation form, not a complicated rating or assessment system", and
 * "avoid unnecessary scoring, complicated rating systems or excessive
 * evaluation parameters". So there is no score anywhere in this module. The
 * only judgements are the four communication/computer bands the office
 * already uses when it talks about a candidate, and one decision at the end.
 *
 * The rule the whole shape hangs on:
 *
 *   A fact about the PERSON belongs to the candidate. A fact about the
 *   INTERVIEW belongs to the form.
 *
 * So a date of birth, an address and a mobile number are written back to the
 * candidate record - fetched in, corrected in front of them, kept in one
 * place. An answer to "why are you leaving", a verdict on their Excel and the
 * interviewer's observations stay on the form, because a second interviewer in
 * a second round may say something different and both have to survive.
 *
 * Dependency-free, so the server validates a submission and the browser builds
 * the form from one list of fields and they cannot drift.
 */

/* ---------------- the bands ---------------- */

/** How well somebody speaks a language. Four words the office already uses. */
export const SPEAKING = ['Basic', 'Average', 'Good', 'Excellent'];

/** How well somebody knows a piece of software. */
export const KNOWLEDGE = ['Basic', 'Intermediate', 'Advanced'];

/**
 * Yes, No, or nothing.
 *
 * Three states, for the reason three-state columns exist all over this app: a
 * box nobody ticked must not read as "No". "Does not know Tally" is a thing
 * somebody found out; blank is a thing nobody asked.
 */
export const YES_NO = ['Yes', 'No'];

export const LANGUAGES = ['Gujarati', 'Hindi', 'English', 'Marathi', 'Other'];

/* ---------------- the questions ---------------- */

/**
 * The ten questions, in Dinesh's order and his words.
 *
 * Held here rather than in the markup so the print view, the stored answer and
 * the form itself cannot disagree about what was asked. `key` is what an
 * answer is filed under, and it never changes once a form has been submitted -
 * renaming one would orphan every answer already recorded.
 *
 * NONE of them is required. "Do not force interviewers to fill every answer":
 * an interview where only three questions were worth asking is a real
 * interview, and a form that refuses to save is a form that gets filled in
 * afterwards from memory, which is the thing this exists to stop.
 */
export const QUESTIONS = [
  { key: 'about', q: 'Tell me about yourself.' },
  { key: 'strengths', q: 'What are your key strengths?' },
  { key: 'weaknesses', q: 'What are your weaknesses?' },
  { key: 'why_booknfly', q: 'Why do you want to join BOOKNFLY?' },
  { key: 'why_leaving', q: 'Why are you leaving your current or previous job?' },
  { key: 'goals', q: 'What are your career goals?' },
  { key: 'role', q: 'What do you know about this job role?' },
  { key: 'pressure', q: 'How do you handle work pressure and deadlines?' },
  { key: 'team', q: 'Are you comfortable working in a team?' },
  { key: 'anything_else', q: 'Is there anything else you would like to share?' },
];

export const QUESTION_KEYS = QUESTIONS.map((q) => q.key);

/* ---------------- the declaration ---------------- */

/**
 * What the candidate signs off.
 *
 * Dinesh asked for the line "that goes at the bottom" - the one confirming
 * the details given are true. It is here rather than typed into the page so
 * the office's printed copy and the candidate's own screen say the same
 * words, which is the whole point of a declaration.
 */
export const DECLARATION =
  'I confirm that the details I have given above are true and correct to the best of my knowledge. I understand that anything found to be false may end my application or my employment.';

/* ---------------- the rounds ---------------- */

/**
 * What the rounds are called.
 *
 * A number alone ("round 2") does not say who is in the room, and the office
 * schedules a technical round and a final management round quite differently.
 * The list is a starting point, not a rule - the field takes free text too,
 * because a company that adds a fifth kind of round should not need a release.
 */
export const ROUND_NAMES = [
  'HR Round',
  'Technical Round',
  'Department Head Round',
  'Final Management Round',
];

/* ---------------- the sections ---------------- */

/**
 * Every field, in the order they are asked, grouped the way Dinesh grouped
 * them. The browser builds the form from this and the server checks a
 * submission against it, so a field cannot exist on one side only.
 *
 * `from` names the candidate column a field is fetched from and written back
 * to. A field with `from` is a fact about the PERSON: it is prefilled, and
 * correcting it at the interview corrects the candidate record. Everything
 * else lives on the form.
 */
export const SECTIONS = [
  {
    key: 'basic',
    title: 'Candidate',
    hint: 'Fetched from their record — correct anything that is wrong and it is corrected on their record too',
    fields: [
      { key: 'name', label: 'Candidate name', from: 'name', readOnly: true },
      { key: 'ref_no', label: 'Candidate ID', from: 'ref_no', readOnly: true },
      { key: 'phone', label: 'Mobile number', from: 'phone' },
      { key: 'email', label: 'Email address', from: 'email', type: 'email' },
      { key: 'dob', label: 'Date of birth', from: 'dob', type: 'date' },
      { key: 'gender', label: 'Gender', from: 'gender', options: ['Female', 'Male', 'Other'] },
    ],
  },
  {
    key: 'education',
    title: 'Educational qualification',
    fields: [
      { key: 'highest_qualification', label: 'Highest qualification', from: 'education' },
      { key: 'degree', label: 'Degree / course name' },
      { key: 'specialisation', label: 'Specialisation' },
      { key: 'college', label: 'College / university' },
      { key: 'passing_year', label: 'Passing year' },
      { key: 'additional_qualification', label: 'Additional qualification' },
      { key: 'certifications', label: 'Professional certifications', long: true },
    ],
  },
  {
    key: 'experience',
    title: 'Work experience',
    fields: [
      { key: 'fresher', label: 'Fresher or experienced', options: ['Fresher', 'Experienced'] },
      { key: 'exp_years', label: 'Total experience — years', type: 'number' },
      { key: 'exp_months', label: '…and months', type: 'number' },
      { key: 'last_company', label: 'Current / last company', from: 'current_company' },
      { key: 'last_designation', label: 'Current / last designation', from: 'role' },
      { key: 'previous_industry', label: 'Previous industry', from: 'industry' },
      { key: 'previous_responsibilities', label: 'Previous job responsibilities', long: true },
      { key: 'relevant_experience', label: 'Relevant experience for this job', long: true },
      { key: 'employment_status', label: 'Current employment status', options: ['Working', 'Serving notice', 'Not working'] },
      { key: 'reason_for_leaving', label: 'Reason for leaving', long: true },
    ],
  },
  {
    key: 'language',
    title: 'Language and communication',
    fields: [
      { key: 'languages', label: 'Languages', type: 'tags', options: LANGUAGES },
      { key: 'english_level', label: 'English', options: SPEAKING },
      { key: 'hindi_level', label: 'Hindi', options: SPEAKING },
      { key: 'gujarati_level', label: 'Gujarati', options: SPEAKING },
      { key: 'communication_remarks', label: 'Overall communication remarks', long: true },
    ],
  },
  {
    key: 'computer',
    title: 'Computer and technical knowledge',
    fields: [
      { key: 'computer_level', label: 'Overall computer knowledge', options: KNOWLEDGE },
      { key: 'word_level', label: 'MS Word', options: KNOWLEDGE },
      { key: 'excel_level', label: 'MS Excel', options: KNOWLEDGE },
      { key: 'email_level', label: 'Email and internet', options: KNOWLEDGE },
      { key: 'tally', label: 'Tally', options: YES_NO },
      { key: 'erp', label: 'ERP / accounting software', options: YES_NO },
      { key: 'software_name', label: 'Which software' },
      { key: 'other_technical', label: 'Other technical skills', long: true },
      { key: 'additional_software', label: 'Additional software knowledge', long: true },
    ],
  },
  {
    key: 'skills',
    title: 'Key skills',
    fields: [
      { key: 'key_skills', label: 'Key professional skills', type: 'tags', from: 'skills' },
      { key: 'technical_skills', label: 'Technical skills', type: 'tags' },
      { key: 'job_skills', label: 'Job-related skills', type: 'tags' },
      { key: 'other_skills', label: 'Other relevant skills', type: 'tags' },
    ],
  },
  {
    key: 'questions',
    title: 'Interview questions',
    hint: 'Answer only what was worth asking — none of these is required',
    questions: true,
  },
  {
    key: 'salary',
    title: 'Salary and joining',
    fields: [
      { key: 'last_salary', label: 'Last drawn monthly salary', from: 'current_salary', type: 'number' },
      { key: 'expected_salary', label: 'Expected monthly salary', from: 'expected_salary', type: 'number' },
      { key: 'negotiable', label: 'Salary negotiable', options: YES_NO },
      { key: 'recommended_salary', label: 'Recommended salary', type: 'number' },
      { key: 'notice_period', label: 'Notice period', from: 'notice_period' },
      { key: 'last_working_date', label: 'Last working date', type: 'date' },
      { key: 'available_from', label: 'Available joining date', type: 'date' },
      { key: 'join_immediately', label: 'Can join immediately', options: YES_NO },
      { key: 'joining_conditions', label: 'Any other joining conditions', long: true },
    ],
  },
  {
    key: 'address',
    title: 'Address',
    hint: 'Kept on their record, not on this form — one address, however many rounds they sit',
    address: true,
  },
  {
    key: 'references',
    title: 'References',
    hint: 'Up to two. Verification is HR’s to finish later — it is never required to submit this form',
    references: true,
  },
];

/** Every field that lives on the form itself (not written back to the person). */
export const FORM_FIELDS = SECTIONS.flatMap((s) => (s.fields || []))
  .filter((f) => !f.readOnly)
  .map((f) => f.key);

/** The fields fetched from, and written back to, the candidate record. */
export const CANDIDATE_FIELDS = SECTIONS.flatMap((s) => (s.fields || []))
  .filter((f) => f.from && !f.readOnly)
  .map((f) => ({ field: f.key, column: f.from }));

/* ---------------- the address ---------------- */

export const ADDRESS_PARTS = [
  { key: 'line1', label: 'House / flat number' },
  { key: 'line2', label: 'Street / area' },
  { key: 'landmark', label: 'Landmark' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pin', label: 'PIN code' },
];

export const addressColumns = (which) => ADDRESS_PARTS.map((p) => `${which}_${p.key}`);

/**
 * "Permanent address same as current" copies it, rather than remembering a tick.
 *
 * A stored flag would mean the permanent address is blank in the database and
 * assembled on the way out, so every report, export and letter would have to
 * know the rule, and one that forgot would print nothing. Copying writes the
 * truth once; the tick is only how it was typed.
 */
export function sameAsCurrent(values = {}) {
  const out = { ...values };
  for (const part of ADDRESS_PARTS) {
    out[`permanent_${part.key}`] = values[`current_${part.key}`] ?? null;
  }
  return out;
}

/* ---------------- references ---------------- */

export const REFERENCE_TYPES = ['Professional', 'Personal'];
export const VERIFICATION = ['Pending', 'Verified', 'Not verified'];
export const MAX_REFERENCES = 2;

/* ---------------- validation ---------------- */

export const STATUSES = ['draft', 'submitted'];

/**
 * Is this form fit to be submitted?
 *
 * NOTHING is required, and that is the point of what this form now is.
 *
 * It used to end with a decision and the interviewer's notes, which was
 * wrong: Dinesh pointed out that this form is filled in BEFORE the interview,
 * by the candidate. A verdict cannot be on a form that is completed before
 * anybody has met them. The decision lives on the evaluation, where the
 * interviewer records it afterwards.
 *
 * So submitting this means "these particulars are confirmed", and a candidate
 * who left half of it blank has still confirmed what they gave. Kept as a
 * function because the caller already has the shape, and because a rule may
 * well come back here.
 */
export function checkForm() {
  return [];
}

/**
 * What a round is called on screen.
 *
 * The number is kept because it orders the history and the name does not:
 * "HR Round" twice is a real thing that happens.
 */
export const roundLabel = (round, name) =>
  name ? `Round ${round} — ${name}` : `Round ${round}`;

/* ---------------- the candidate fills it in themselves ------------------- */

/**
 * The sections a CANDIDATE may fill in, sent a link before their interview.
 *
 * Dinesh: *"jab candidate interview k liye aaye to usko ye form ki link bhejni
 * he bharne k liye"*. Most of this form is facts only they know - where they
 * studied, what they earn, why they are leaving - and an interviewer typing
 * them while somebody sits opposite is a slow way to find out.
 *
 * THIS IS AN ALLOW-LIST, AND IT HAS TO STAY ONE.
 *
 * Dinesh's own rule: "do not allow candidates to change screening or
 * interview decisions". A deny-list would have to be remembered every time a
 * field is added to this file, and the first forgotten one hands a candidate
 * the verdict on themselves. Naming what they MAY touch fails the safe way: a
 * new field is not theirs until somebody says so here.
 *
 * Left out on purpose, every one of them: the interview notes, the decision
 * and its remarks, the next round, the rejection reason, the recommended
 * salary (the office's figure, not theirs), and the whole evaluation.
 */
export const CANDIDATE_SECTIONS = [
  'basic', 'education', 'experience', 'language', 'computer',
  'skills', 'questions', 'salary', 'address', 'references',
];

/** Exactly the form fields a candidate may write, derived from those sections. */
export const CANDIDATE_WRITABLE = SECTIONS.filter((s) => CANDIDATE_SECTIONS.includes(s.key))
  .flatMap((s) => s.fields || [])
  .filter((f) => !f.readOnly && f.key !== 'recommended_salary')
  .map((f) => f.key);

/**
 * Strip a candidate's submission down to what they are allowed to send.
 *
 * Runs on the SERVER, on every candidate submission, whatever the page sent.
 * The page showing only their own sections is a convenience; this is the
 * fence.
 */
export function fromCandidate(body = {}) {
  const out = {};
  for (const key of CANDIDATE_WRITABLE) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (Array.isArray(body.languages)) out.languages = body.languages;
  if (body.answers && typeof body.answers === 'object') {
    out.answers = Object.fromEntries(
      QUESTION_KEYS.map((k) => [k, body.answers[k] ?? '']).filter(([, v]) => String(v).trim())
    );
  }
  if (body.address && typeof body.address === 'object') {
    out.address = Object.fromEntries(
      ['current', 'permanent'].flatMap((w) =>
        ADDRESS_PARTS.map((part) => [`${w}_${part.key}`, body.address[`${w}_${part.key}`]])
      ).filter(([, v]) => v !== undefined)
    );
  }
  return out;
}
