/**
 * The recruitment reports.
 *
 * Dinesh listed nine by name - the interview schedule, today's and upcoming
 * interviews, completed interviews, selected / on hold / rejected candidates,
 * next round pending, and an interviewer-wise report - plus a funnel and a
 * time-to-hire from the earlier spec.
 *
 * THIS FILE ASSEMBLES. IT DOES NOT RECALCULATE.
 *
 * Every figure in every one of these reports was decided somewhere else and
 * stored: a screening verdict, an interview decision, an evaluation's
 * recommendation, the salary that was approved. Nothing here works anything
 * out a second time, because a report that computes its own version of a
 * number is a report that will one day disagree with the screen the number
 * came from - and then nobody can say which is right. The same rule the
 * payslip, the absent/present report and the employee report all follow.
 *
 * The columns live here rather than in the table markup so that what is on
 * screen, what prints and what lands in the CSV cannot drift apart.
 *
 * Dependency-free.
 */

/* ---------------- what can be asked for ---------------- */

export const FILTERS = [
  { key: 'from', label: 'From', type: 'date' },
  { key: 'to', label: 'To', type: 'date' },
  { key: 'company_id', label: 'Company', type: 'company' },
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'vacancy_id', label: 'Position', type: 'vacancy' },
  { key: 'interviewer', label: 'Interviewer', type: 'text' },
  { key: 'round', label: 'Round', type: 'number' },
  { key: 'status', label: 'Status', type: 'text' },
];

const WHEN = { label: 'When', key: 'at', type: 'datetime' };
const WHO = { label: 'Candidate', key: 'candidate_name' };
const REF = { label: 'Ref', key: 'ref_no' };
const JOB = { label: 'Position', key: 'job_title' };
const DEPT = { label: 'Department', key: 'department' };
const COMPANY = { label: 'Company', key: 'company_name' };
const PHONE = { label: 'Mobile', key: 'phone' };

/**
 * The reports, in the order Dinesh listed them.
 *
 * `uses` names which filters actually do anything, so the screen can hide the
 * ones that do not. A date filter on the interviewer-wise summary would look
 * as if it worked and silently change nothing, which is worse than not being
 * there.
 */
export const REPORTS = [
  {
    key: 'schedule',
    label: 'Interview schedule',
    hint: 'Every interview in the date range',
    uses: ['from', 'to', 'company_id', 'department', 'vacancy_id', 'interviewer', 'round', 'status'],
    columns: [WHEN, REF, WHO, PHONE, JOB, DEPT,
      { label: 'Round', key: 'round_label' },
      { label: 'Mode', key: 'mode' },
      { label: 'Where / link', key: 'location_or_link' },
      { label: 'Interviewer', key: 'interviewer' },
      { label: 'Status', key: 'status' },
      COMPANY],
  },
  {
    key: 'today',
    label: "Today's interviews",
    hint: 'What is happening today',
    uses: ['company_id', 'interviewer'],
    columns: [WHEN, REF, WHO, PHONE, JOB,
      { label: 'Round', key: 'round_label' },
      { label: 'Mode', key: 'mode' },
      { label: 'Where / link', key: 'location_or_link' },
      { label: 'Interviewer', key: 'interviewer' },
      { label: 'Status', key: 'status' }],
  },
  {
    key: 'upcoming',
    label: 'Upcoming interviews',
    hint: 'Scheduled, still to happen',
    uses: ['to', 'company_id', 'department', 'vacancy_id', 'interviewer'],
    columns: [WHEN, REF, WHO, PHONE, JOB,
      { label: 'Round', key: 'round_label' },
      { label: 'Interviewer', key: 'interviewer' },
      { label: 'Where / link', key: 'location_or_link' }],
  },
  {
    key: 'completed',
    label: 'Interviews completed',
    hint: 'Done, with what the form and the evaluation said',
    uses: ['from', 'to', 'company_id', 'department', 'vacancy_id', 'interviewer', 'round'],
    columns: [WHEN, REF, WHO, JOB,
      { label: 'Round', key: 'round_label' },
      { label: 'Interviewer', key: 'interviewer' },
      { label: 'Form', key: 'decision' },
      { label: 'Recommendation', key: 'recommendation' },
      { label: 'Evaluation', key: 'evaluation_status' },
      { label: 'Where they are', key: 'stage' }],
  },
  {
    key: 'selected',
    label: 'Selected candidates',
    hint: 'Offer accepted or already joined',
    uses: ['from', 'to', 'company_id', 'department', 'vacancy_id'],
    columns: [REF, WHO, PHONE, JOB, DEPT, COMPANY,
      { label: 'Offered', key: 'salary', type: 'money' },
      { label: 'Joining', key: 'joining_date', type: 'date' },
      { label: 'Offer', key: 'offer_status' },
      { label: 'Where they are', key: 'stage' },
      { label: 'On the payroll', key: 'on_payroll' }],
  },
  {
    key: 'hold',
    label: 'On hold',
    hint: 'Held at screening or after an evaluation — and why',
    uses: ['company_id', 'department', 'vacancy_id'],
    columns: [REF, WHO, PHONE, JOB, COMPANY,
      { label: 'Held at', key: 'held_at' },
      { label: 'Waiting for', key: 'reason' },
      { label: 'Since', key: 'since', type: 'date' },
      { label: 'By', key: 'by' }],
  },
  {
    key: 'rejected',
    label: 'Rejected',
    hint: 'Turned down, and whether they turned US down',
    uses: ['from', 'to', 'company_id', 'department', 'vacancy_id'],
    columns: [REF, WHO, PHONE, JOB, COMPANY,
      { label: 'At', key: 'held_at' },
      { label: 'Reason', key: 'reason' },
      { label: 'When', key: 'since', type: 'date' },
      { label: 'By', key: 'by' }],
  },
  {
    key: 'next_round',
    label: 'Next round pending',
    hint: 'An interview said “next round” and nothing is booked',
    uses: ['company_id', 'department', 'vacancy_id', 'interviewer'],
    columns: [REF, WHO, PHONE, JOB,
      { label: 'Last round', key: 'round_label' },
      { label: 'Seen on', key: 'at', type: 'datetime' },
      { label: 'Asked for', key: 'next_round' },
      { label: 'Suggested date', key: 'next_interview_date', type: 'date' },
      { label: 'Suggested interviewer', key: 'next_interviewer' },
      { label: 'Waiting', key: 'waiting_days', type: 'days' }],
  },
  {
    key: 'interviewers',
    label: 'Interviewer-wise',
    hint: 'How many each person has seen, and what they said',
    uses: ['from', 'to', 'company_id'],
    columns: [
      { label: 'Interviewer', key: 'interviewer' },
      { label: 'Interviews', key: 'total', type: 'number' },
      { label: 'Done', key: 'done', type: 'number' },
      { label: 'No show', key: 'no_show', type: 'number' },
      { label: 'Cancelled', key: 'cancelled', type: 'number' },
      { label: 'Still to come', key: 'scheduled', type: 'number' },
      { label: 'Forms filled', key: 'forms', type: 'number' },
      { label: 'Evaluations', key: 'evaluations', type: 'number' },
      { label: 'Recommended', key: 'recommended', type: 'number' },
      { label: 'Not recommended', key: 'not_recommended', type: 'number' },
    ],
  },
  {
    key: 'funnel',
    label: 'The funnel',
    hint: 'How many are at each step, and what each step lets through',
    uses: ['company_id', 'vacancy_id'],
    columns: [
      { label: 'Step', key: 'stage' },
      { label: 'Reached it', key: 'reached', type: 'number' },
      { label: 'Still there', key: 'here', type: 'number' },
      { label: 'Got through', key: 'through_pct', type: 'percent' },
    ],
  },
  {
    key: 'time_to_hire',
    label: 'Time to hire',
    hint: 'Applied to joined, for everybody who actually joined',
    uses: ['from', 'to', 'company_id', 'vacancy_id'],
    columns: [REF, WHO, JOB, COMPANY,
      { label: 'Applied', key: 'applied_on', type: 'date' },
      { label: 'Joined', key: 'joined_on', type: 'date' },
      { label: 'Days', key: 'days', type: 'number' },
      { label: 'Salary', key: 'salary', type: 'money' }],
  },
];

export const REPORT_KEYS = REPORTS.map((r) => r.key);
export const reportMeta = (key) => REPORTS.find((r) => r.key === key) || null;

/* ---------------- showing a cell ---------------- */

const money = (v) =>
  v === null || v === undefined || v === '' ? '' : `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;

/**
 * One cell, as text.
 *
 * Nothing here turns a missing value into a nought or a dash-as-zero. A blank
 * stays blank: "no evaluation yet" and "evaluated as nought" are different
 * facts, and a report that prints 0 for both is a report that gets believed.
 * The one exception is a counted column, where 0 is a real count and means it.
 */
export function cell(row, column) {
  const value = row?.[column.key];
  if (column.type === 'number') return value === null || value === undefined ? '' : String(value);
  if (value === null || value === undefined || value === '') return '';
  switch (column.type) {
    case 'money': return money(value);
    case 'percent': return `${value}%`;
    case 'days': return value === 1 ? '1 day' : `${value} days`;
    case 'date': return String(value).slice(0, 10);
    case 'datetime': return String(value).replace('T', ' ').slice(0, 16);
    default: return String(value);
  }
}

/** The rows as a grid of strings, which both the CSV and the print view take. */
export const asGrid = (report, rows = []) => ({
  headers: report.columns.map((c) => c.label),
  rows: rows.map((row) => report.columns.map((c) => cell(row, c))),
});

/** A file name somebody can find again: Interview-schedule-2026-11-15.csv */
export const reportFileName = (key, on = new Date()) =>
  `${(reportMeta(key)?.label || 'Report').replace(/[^A-Za-z0-9]+/g, '-')}-${
    on.toISOString().slice(0, 10)
  }.csv`;
