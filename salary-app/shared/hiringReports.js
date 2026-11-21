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
 * Dependency-free apart from the offer statuses, which are named once in
 * shared/offer.js — the report saying "sent" where the screen says "Sent to
 * them" is two names for one fact.
 */

import { offerStatusMeta } from './offer.js';

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
  /*
   * WHO APPLIED. The one report that was missing, and the first one anybody
   * wants.
   *
   * Dinesh's HR, on the Reports screen: *"details nathi aavti jene form fill
   * kari ne apply karyu che eni ... next schedule krva mate"*. The screen
   * opened on the interview schedule, which reads the INTERVIEWS table -
   * somebody who has just applied has no interview yet, so it was correctly
   * empty and said "try widening the dates", which sent them hunting a date
   * filter that was never the problem. There was no report of applications
   * at all, which is where a recruitment funnel starts.
   */
  {
    key: 'applications',
    label: 'Applications received',
    hint: 'Everybody who applied, newest first — including straight off the form',
    uses: ['from', 'to', 'company_id', 'department', 'vacancy_id', 'status'],
    empty:
      'Nobody has applied in this range. Check the dates, or share the opening from Vacancies — ' +
      'applications also arrive on the Pipeline as soon as somebody fills the form in.',
    columns: [
      { label: 'Applied', key: 'applied_at', type: 'datetime' },
      REF, WHO, PHONE,
      { label: 'Where they are', key: 'stage' },
      JOB, DEPT, COMPANY,
      { label: 'How they applied', key: 'source' },
      { label: 'Experience', key: 'experience' },
      { label: 'Expected', key: 'expected_salary' },
      { label: 'Match', key: 'match_score' },
      { label: 'CV', key: 'has_cv' },
    ],
  },
  {
    key: 'schedule',
    label: 'Interview schedule',
    hint: 'Every interview in the date range',
    empty: 'No interview is booked in this range. A new applicant has no interview yet — open them on the Pipeline and use Schedule interview; they will appear here once they do.',
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
    empty: 'Nothing is booked for today. Scheduling is done from the Pipeline, on the person.',
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
    empty: 'Nothing is booked ahead. Somebody who has only applied has no interview yet — schedule them from the Pipeline.',
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
    empty: 'No interview has been marked done in this range.',
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
    empty: 'Nobody has been selected in this range. Selection happens on the application, after an evaluation.',
    uses: ['from', 'to', 'company_id', 'department', 'vacancy_id'],
    columns: [REF, WHO, PHONE, JOB, DEPT, COMPANY,
      { label: 'Offered', key: 'salary', type: 'money', total: true },
      { label: 'Joining', key: 'joining_date', type: 'date' },
      { label: 'Offer', key: 'offer_status' },
      { label: 'Where they are', key: 'stage' },
      { label: 'On the payroll', key: 'on_payroll' }],
  },
  /*
   * EVERY OFFER AND WHERE IT STANDS.
   *
   * Dinesh: *"vacancy aur offer letter ka bhi print report do"*. The letter
   * itself is one person's document; this is the list - who has been offered
   * what, who approved it, who has been sent it and who has answered.
   *
   * Deliberately NOT the same question as "Selected candidates" beside it.
   * That one is read off the stage as well as the offer, so it carries
   * somebody moved to Selected by hand with no offer ever written. This one
   * is offers only, including the drafts nobody has approved - which is the
   * half that goes missing otherwise, because a draft offer is invisible on
   * every other screen in the app.
   *
   * "Past its date" is not a decision, it is a fact about the calendar: the
   * offer still says sent and the day it was valid till has gone. Nothing
   * expires itself.
   */
  {
    key: 'offers',
    label: 'Offers out',
    hint: 'Every offer written, approved, sent or answered — drafts included',
    empty: 'No offer has been written in this range, drafts included.',
    uses: ['from', 'to', 'company_id', 'department', 'vacancy_id'],
    columns: [REF, WHO, PHONE, JOB, COMPANY,
      { label: 'Offered', key: 'salary', type: 'money', total: true },
      { label: 'Joining', key: 'joining_date', type: 'date' },
      { label: 'Valid till', key: 'valid_till', type: 'date' },
      { label: 'Where it stands', key: 'status', type: 'offer_status' },
      { label: 'Past its date', key: 'past_valid' },
      { label: 'Approved by', key: 'approved_by' },
      { label: 'Sent', key: 'sent_at', type: 'date' },
      { label: 'Answered', key: 'answered_at', type: 'date' }],
  },
  {
    key: 'hold',
    label: 'On hold',
    hint: 'Held at screening or after an evaluation — and why',
    empty: 'Nobody is on hold. Holding happens at screening, or on an evaluation.',
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
    empty: 'Nobody has been turned down in this range.',
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
    empty: 'Nothing is waiting for a next round to be booked.',
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
    empty: 'No interview has been held in this range, so there is nobody to count.',
    uses: ['from', 'to', 'company_id'],
    columns: [
      { label: 'Interviewer', key: 'interviewer' },
      { label: 'Interviews', key: 'total', type: 'number', total: true },
      { label: 'Done', key: 'done', type: 'number', total: true },
      { label: 'No show', key: 'no_show', type: 'number', total: true },
      { label: 'Cancelled', key: 'cancelled', type: 'number', total: true },
      { label: 'Still to come', key: 'scheduled', type: 'number', total: true },
      { label: 'Forms filled', key: 'forms', type: 'number', total: true },
      { label: 'Evaluations', key: 'evaluations', type: 'number', total: true },
      { label: 'Recommended', key: 'recommended', type: 'number', total: true },
      { label: 'Not recommended', key: 'not_recommended', type: 'number', total: true },
    ],
  },
  {
    key: 'funnel',
    label: 'The funnel',
    hint: 'How many are at each step, and what each step lets through',
    empty: 'No application in this range, so there is no funnel to draw.',
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
    empty: 'Nobody has joined in this range, so there is nothing to measure.',
    uses: ['from', 'to', 'company_id', 'vacancy_id'],
    columns: [REF, WHO, JOB, COMPANY,
      { label: 'Applied', key: 'applied_on', type: 'date' },
      { label: 'Joined', key: 'joined_on', type: 'date' },
      { label: 'Days', key: 'days', type: 'number' },
      { label: 'Salary', key: 'salary', type: 'money', total: true }],
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
    case 'offer_status': return offerStatusMeta(value)?.label || String(value);
    case 'date': return String(value).slice(0, 10);
    case 'datetime': return String(value).replace('T', ' ').slice(0, 16);
    default: return String(value);
  }
}

/**
 * The figures worth adding up, as text, keyed by the column's own label.
 *
 * Only the columns that SAY they can be totalled are. A sum of "days to hire"
 * is not a fact about anything, and the funnel's counts would double-count
 * every candidate who got through a step - so neither carries the flag. The
 * flag lives on the column beside the figure it describes, where somebody
 * adding a column will see it.
 */
export function reportTotals(report, rows = []) {
  const totals = {};
  for (const column of report?.columns || []) {
    if (!column.total) continue;
    const sum = rows.reduce((t, row) => t + (Number(row?.[column.key]) || 0), 0);
    totals[column.label] = cell({ [column.key]: sum }, column);
  }
  return totals;
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
