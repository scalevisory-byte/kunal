import ExcelJS from 'exceljs';
import {
  MONTH_NAMES,
  STANDARD_WORKING_DAYS,
  ATTENDANCE_CODES,
  calculateRow,
  countMarks,
  sundayDaysFromAttendance,
  totalRows,
} from '../../shared/calc.js';
import { parseSheet, listSheetNames } from '../../shared/sheet.js';

/**
 * Marks the clock times may overwrite. Everything else - leave, a holiday, a
 * Sunday - was a deliberate decision and keeps its mark. Same set as the
 * server's AUTO_MARKS and the Time tab's.
 */
const AUTO_TIME_MARKS = new Set(['', 'P', 'A', 'HF']);
import { readPunchFile, punchesToMarks } from '../../shared/punches.js';
import { wouldLoop } from '../../shared/orgChart.js';
import {
  DEFAULT_MARK_MAP,
  isLegacyXls,
  monthlyStatusToMarks,
  readMonthlyStatus,
  sheetsFromExcelJS,
} from '../../shared/monthlyStatus.js';
import { buildWorkbook } from '../../shared/workbook.js';
import { buildMonthlyPack } from '../../shared/monthlyPack.js';
import { CSV_COLUMNS, statutoryReport, toCsv } from '../../shared/statutory.js';
import { employeeReport } from '../../shared/employeeReport.js';
import { TIME_FIELDS, parseTime, timesToDay } from '../../shared/timesheet.js';
import { ALL_STAGES, MATCH_BANDS, REJECTED, STAGES } from '../../shared/stages.js';
import {
  PENALTY_KINDS,
  instalmentOf,
  kindLabel as penaltyKindLabel,
  outstandingOf,
  penaltyReport,
  validatePenalty,
  wageCheck,
} from '../../shared/penalties.js';
import { WEIGHTS, matchScore } from '../../shared/match.js';
import { checkTestUrl, testFor } from '../../shared/hiringTest.js';
import { validateVacancy } from '../../shared/vacancyForm.js';
import { cleanPublicUrl, reachablePublicly } from '../../shared/publicUrl.js';
import { settlement } from '../../shared/settlement.js';
import { digest } from '../../shared/digest.js';
import { codeProblem, nextCode, tidyCode } from '../../shared/assetCode.js';
import { labelSheet, labelSvg, voucherHtml } from '../../shared/assetLabels.js';
import { STATE_KEYS, allocationProblem, financialYear } from '../../shared/assetStatus.js';
import { assetDashboard, purchaseYears } from '../../shared/assetDashboard.js';
import qr from 'qrcode-generator';
import { handoverSlip, registerCsv, registerTotals, handoverCsv } from '../../shared/assetReport.js';
import {
  SERVICE_KINDS,
  looksDuplicate,
  maintenanceAlerts,
  maintenanceTotals,
  ownership,
  ownershipCsv,
  servicesCsv,
  spendReport,
} from '../../shared/maintenance.js';
import { fromBand } from '../../shared/experienceBand.js';
import {
  hiringDigest,
  publicVacancy,
  stageMessage,
  vacancyBroadcast,
  waLink,
} from '../../shared/hiringMessages.js';
import { CSV_COLUMNS as HIRING_CSV, toCsv as hiringCsv } from '../../shared/hiringCsv.js';

/**
 * The standalone build's data layer.
 *
 * The single-file HTML has no server behind it, so this stands in for the API:
 * it answers the same paths with the same shapes, and keeps everything in the
 * browser's localStorage. The calculation, the sheet reader and the exporter
 * are the very same modules the server uses - only the storage differs.
 *
 * Everything lives under one key so a backup is a single copy-paste.
 */

/*
 * Where this build keeps its data.
 *
 * Every file:// copy in one browser shares localStorage, so a blank copy and
 * the real one would otherwise be the same store - open the blank file in the
 * browser holding the payroll and all 85 people are there, which is exactly
 * what happened. A blank build gets its own key and cannot see the real work,
 * nor touch it.
 */
const KEY = typeof __STORE_KEY__ === 'string' ? __STORE_KEY__ : 'salary-app-data-v1';

const EMPTY = {
  companies: [],
  employees: [],
  periods: [],
  payroll_rows: [],
  attendance: [], // { …, in_time, lunch_out, lunch_in, out_time, reason, approved, uniform }
  holidays: [], // { id, period_id, day, name, religions[], code, applied_at }
  loans: [], // { id, employee_id, amount, instalment, given_on, reason, status }
  repayments: [], // { loan_id, period_id, amount }
  /*
   * Hiring. The office half of it runs here perfectly well - an opening, a
   * person, the link between them, a test result, an interview, a to-do - and
   * the handover to payroll is the whole point of hiring living inside the
   * HRMS, so it had to work offline too.
   *
   * What genuinely cannot: a candidate opening an apply link, and a CV file.
   * Both need an address on the internet and somewhere other than this browser
   * to keep a file. Those two say so where they are, rather than blanking the
   * tab - which is what this file used to do with the whole module.
   */
  vacancies: [],
  candidates: [],
  applications: [],
  tests: [],
  interviews: [],
  hiring_tasks: [],
  /*
   * The People tab. Warnings and appreciations, appraisals, expense claims,
   * office tasks, the helpdesk, leaving, and the trail of who changed what.
   *
   * This file used to say all of it needed the server. That was never true of
   * the data - it already holds 115 people and a year of payslips - only of
   * there being a second person to approve things, which the screens now say
   * instead of the module being switched off.
   */
  employee_notes: [],
  appraisals: [],
  expense_claims: [],
  penalties: [],
  penalty_recoveries: [],
  staff_tasks: [],
  tickets: [],
  ticket_replies: [],
  employee_exits: [],
  /*
   * The asset register and everything hanging off it. Only a PHOTOGRAPH of an
   * asset genuinely needs a server - a file cannot live inside an HTML page -
   * and that one says so where it is.
   */
  assets: [],
  asset_handovers: [],
  asset_services: [],
  asset_verifications: [],
  // Categories, the types under them, brands and vendors. One list with a
  // `kind`, not four tables - see the note on the server's asset_masters.
  asset_masters: [],
  audit_log: [],
  // The highest JOB-/CAN- number ever handed out, so one is never reused.
  ref_high: {},
  /*
   * Settings that belong to the installation. Today just the public address -
   * where this app will be reachable once it IS. It is worth typing here even
   * offline: the apply link points at wherever it is deployed, not at this
   * file, so the post can be written now and sent the day it goes up.
   */
  settings: {},
  next_id: 1,
};

/**
 * What is baked in at build time (vite.config.js reads seed.json), so the file
 * opens with real data rather than empty.
 *
 * Always the employee master. Optionally a whole month as well - the period,
 * its payroll rows, the attendance and the festivals - built by
 * scripts/make-seed.mjs from the sheets that month was run on, so the file
 * arrives with a month already done rather than needing it typed in again.
 *
 * It seeds **only a browser that has never stored anything**, so it can never
 * overwrite real work; once a month has been touched here, the seed is gone
 * for good and the stored copy is the only one.
 */
const SEED = typeof __SEED__ === 'undefined' ? null : __SEED__;

const freshStore = () => {
  const store = structuredClone(EMPTY);
  if (!SEED) return store;
  return {
    ...store,
    companies: structuredClone(SEED.companies || []),
    employees: structuredClone(SEED.employees || []),
    periods: structuredClone(SEED.periods || []),
    payroll_rows: structuredClone(SEED.payroll_rows || []),
    attendance: structuredClone(SEED.attendance || []),
    holidays: structuredClone(SEED.holidays || []),
    next_id: SEED.next_id || 1,
  };
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...JSON.parse(raw) } : freshStore();
  } catch {
    // A corrupt or unreadable store must not brick the page.
    cache = freshStore();
  }
  return cache;
}


function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (err) {
    throw new Error(
      err?.name === 'QuotaExceededError'
        ? 'The browser is out of storage for this page. Export the month, then delete an old one.'
        : `Could not save: ${err?.message || err}`
    );
  }
}

const nextId = () => load().next_id++;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Thrown with a status so the caller can tell 404 from 400, like the API does. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------------- reads that mirror the server's joins ---------------- */

/*
 * Looked up by id, with the id COERCED.
 *
 * Every id that reaches here from a form is a string - a `<select>` value and
 * an `<input>` value always are - and `5 === '5'` is false, so a strict
 * compare silently finds nothing and the screen shows "employee not found"
 * for somebody who is plainly on the list. It cost a whole afternoon once
 * already, when a manager picker stored reports_to_id as a string and the org
 * chart showed all 115 people as roots.
 *
 * A bad id gives NaN, which matches nothing, which is the right answer.
 */
const byId = (rows, id) => {
  const want = Number(id);
  return rows.find((r) => r.id === want) || null;
};
const companyOf = (id) => byId(load().companies, id);
const employeeOf = (id) => byId(load().employees, id);
const periodOf = (id) => byId(load().periods, id);

function sortedEmployees() {
  const db = load();
  return [...db.employees]
    .map((e) => ({ ...e, company_name: companyOf(e.company_id)?.name || '' }))
    .sort((a, b) => {
      const ca = companyOf(a.company_id);
      const cb = companyOf(b.company_id);
      return (
        (ca?.sort_order ?? 0) - (cb?.sort_order ?? 0) ||
        (ca?.name || '').localeCompare(cb?.name || '') ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.name.localeCompare(b.name)
      );
    });
}

/** Adds a row for every active employee who has none yet, like syncPayrollRows. */
function syncRows(periodId) {
  const db = load();
  const have = new Set(
    db.payroll_rows.filter((r) => r.period_id === periodId).map((r) => r.employee_id)
  );
  let added = 0;
  for (const emp of db.employees) {
    if (!emp.active) continue;
    if (have.has(emp.id)) {
      const row = db.payroll_rows.find((r) => r.period_id === periodId && r.employee_id === emp.id);
      if (row && !row.salary) row.salary = emp.monthly_salary;
      continue;
    }
    db.payroll_rows.push({
      id: nextId(),
      period_id: periodId,
      employee_id: emp.id,
      salary: emp.monthly_salary,
      absent_days_override: null,
      sundays_override: null,
      ot_minutes_override: null,
      ot_amount_override: null,
      addition: 0,
      deduction: 0,
      adjustment_note: null,
      adjustment: 0,
      esi: emp.esi,
      pf: emp.pf,
      sunday_salary_override: null,
      payment_mode: emp.payment_mode,
      status: 'pending',
      sunday_status: null,
      sunday_mode: null,
      remark: null,
    });
    added++;
  }
  return added;
}

function attendanceFor(periodId, employeeId) {
  const marks = {};
  for (const a of load().attendance) {
    if (a.period_id !== periodId || a.employee_id !== employeeId) continue;
    marks[a.day] = {
      code: a.code || '',
      minutes: a.minutes || 0,
      in_time: a.in_time || '',
      lunch_out: a.lunch_out || '',
      lunch_in: a.lunch_in || '',
      out_time: a.out_time || '',
      reason: a.reason || '',
      // null stays null: "nobody has decided" is not "not approved", and
      // "nobody looked at the uniform" is not "turned up wrong".
      approved: a.approved === null || a.approved === undefined ? null : Boolean(a.approved),
      uniform: a.uniform === null || a.uniform === undefined ? null : Boolean(a.uniform),
    };
  }
  return marks;
}

/** The same shape buildPayroll() returns on the server. */
function loanOutstanding(loan) {
  const repaid = load()
    .repayments.filter((r) => r.loan_id === loan.id)
    .reduce((sum, r) => sum + (r.amount || 0), 0);
  return { repaid, outstanding: Math.round((loan.amount - repaid) * 100) / 100 };
}

/** Gives every active loan an instalment for this month, once. */
function postRepayments(periodId) {
  const db = load();
  let added = 0;
  for (const loan of db.loans) {
    if (loan.status !== 'active') continue;
    if (db.repayments.some((r) => r.loan_id === loan.id && r.period_id === periodId)) continue;
    const { outstanding } = loanOutstanding(loan);
    if (outstanding <= 0) continue;
    const amount = Math.min(Number(loan.instalment) || 0, outstanding);
    if (amount <= 0) continue;
    db.repayments.push({ loan_id: loan.id, period_id: periodId, amount });
    added++;
  }
  return added;
}

/*
 * Penalties, recovered the way a loan is - the same rule the server runs.
 *
 * "ek loan ki tarah penalty deduction ka option banavo / jo add kiya ho wo
 * salary me se auto deduct ho jaye". A month already posted is skipped, so
 * opening the salary sheet twice cannot fine anybody twice, and a penalty on
 * hold or waived posts nothing.
 */
function postPenaltyRecoveries(periodId) {
  const db = load();
  let added = 0;
  for (const pen of db.penalties) {
    if (pen.status !== 'open') continue;
    if (db.penalty_recoveries.some((r) => r.penalty_id === pen.id && r.period_id === periodId)) continue;
    const taken = db.penalty_recoveries
      .filter((r) => r.penalty_id === pen.id)
      .reduce((t, r) => t + (Number(r.amount) || 0), 0);
    const outstanding = (Number(pen.amount) || 0) - taken;
    if (outstanding <= 0) continue;
    const months = Math.max(1, Number(pen.months) || 1);
    // The last month carries the rounding, so the instalments come to the
    // penalty exactly rather than leaving a rupee behind for ever.
    const instalment = Math.round((Number(pen.amount) || 0) / months);
    const amount = Math.min(instalment > 0 ? instalment : outstanding, outstanding);
    if (amount <= 0) continue;
    db.penalty_recoveries.push({
      id: nextId(),
      penalty_id: pen.id,
      period_id: periodId,
      amount,
      by_whom: 'automatic',
      in_deduction: 0,
      posted_at: stampNow(),
    });
    added++;
  }
  // Anything now fully taken stops being open, so it posts nothing next month.
  for (const pen of db.penalties) {
    if (pen.status !== 'open') continue;
    const taken = db.penalty_recoveries
      .filter((r) => r.penalty_id === pen.id)
      .reduce((t, r) => t + (Number(r.amount) || 0), 0);
    if (taken >= (Number(pen.amount) || 0)) pen.status = 'recovered';
  }
  return added;
}

/*
 * employee_id -> what comes off this month, and what for.
 *
 * in_deduction = 1 marks rows taken BEFORE this was automatic, whose money
 * was written straight into the row's own deduction column by the old
 * button. Counting those here would charge a closed month twice.
 */
function penaltyDeductions(periodId) {
  const db = load();
  const map = new Map();
  for (const r of db.penalty_recoveries) {
    if (r.period_id !== periodId) continue;
    if (Number(r.in_deduction) === 1) continue;
    const pen = db.penalties.find((x) => x.id === r.penalty_id);
    if (!pen) continue;
    const at = map.get(pen.employee_id) || { amount: 0, notes: [] };
    at.amount += Number(r.amount) || 0;
    if (pen.note) at.notes.push(pen.note);
    map.set(pen.employee_id, at);
  }
  return map;
}

function loanDeductions(periodId) {
  const db = load();
  const map = new Map();
  for (const r of db.repayments) {
    if (r.period_id !== periodId) continue;
    const loan = db.loans.find((l) => l.id === r.loan_id);
    if (!loan) continue;
    map.set(loan.employee_id, (map.get(loan.employee_id) || 0) + (r.amount || 0));
  }
  return map;
}

function buildPayroll(periodId, { sync = true } = {}) {
  const period = periodOf(periodId);
  if (!period) return null;
  if (sync && !period.locked) {
    syncRows(periodId);
    postRepayments(periodId);
    postPenaltyRecoveries(periodId);
    save();
  }
  const loans = loanDeductions(periodId);
  const penalties = penaltyDeductions(periodId);

  const rows = load()
    .payroll_rows.filter((r) => r.period_id === periodId)
    .map((row) => {
      const emp = employeeOf(row.employee_id);
      if (!emp) return null;
      const marks = attendanceFor(periodId, row.employee_id);
      /*
       * What the engine needs off the master, exactly as the server's
       * listPayrollRows joins it: the salary breakup and the salary it was
       * typed against, the PF/ESI modes, and the person's own shift. Without
       * these the standalone file would quietly ignore a breakup, deduct a
       * fixed PF for somebody set to auto, and judge a night shift against
       * the office's 09:30.
       */
      const fromMaster = {
        basic: emp.basic ?? 0,
        hra: emp.hra ?? 0,
        conveyance: emp.conveyance ?? 0,
        medical: emp.medical ?? 0,
        monthly_salary: emp.monthly_salary ?? 0,
        pf_mode: emp.pf_mode || 'fixed',
        esi_mode: emp.esi_mode || 'fixed',
        shift_in: emp.shift_in || null,
        shift_out: emp.shift_out || null,
        weekly_off: emp.weekly_off || null,
      };
      return {
        ...row,
        ...fromMaster,
        employee_name: emp.name,
        employee_code: emp.code,
        designation: emp.designation,
        religion: emp.religion || null,
        department: emp.department || null,
        uan: emp.uan || null,
        esic_no: emp.esic_no || null,
        pf_no: emp.pf_no || null,
        pan: emp.pan || null,
        bank_name: emp.bank_name || null,
        bank_account: emp.bank_account || null,
        ifsc: emp.ifsc || null,
        company_id: emp.company_id,
        company_name: companyOf(emp.company_id)?.name || '',
        company_weekly_off: companyOf(emp.company_id)?.weekly_off || null,
        attendance: marks,
        mark_counts: countMarks(marks),
        sunday_days: sundayDaysFromAttendance(marks),
        loan_deduction: loans.get(row.employee_id) || 0,
        penalty_deduction: penalties.get(row.employee_id)?.amount || 0,
        penalty_notes: penalties.get(row.employee_id)?.notes || [],
        overrides: {
          absent_days: row.absent_days_override !== null,
          sundays: row.sundays_override !== null,
          ot_minutes: row.ot_minutes_override !== null,
          ot_amount: row.ot_amount_override !== null,
          sunday_salary: row.sunday_salary_override !== null,
        },
        ...calculateRow(
          {
            ...row,
            ...fromMaster,
            loan_deduction: loans.get(row.employee_id) || 0,
            penalty_deduction: penalties.get(row.employee_id)?.amount || 0,
          },
          period,
          marks,
        ),
      };
    })
    .filter(Boolean);

  const order = sortedEmployees().map((e) => e.id);
  rows.sort((a, b) => order.indexOf(a.employee_id) - order.indexOf(b.employee_id));

  const byCompany = new Map();
  for (const row of rows) {
    if (!byCompany.has(row.company_id)) {
      byCompany.set(row.company_id, { company_id: row.company_id, company_name: row.company_name, rows: [] });
    }
    byCompany.get(row.company_id).rows.push(row);
  }

  return {
    period,
    rows,
    companies: [...byCompany.values()].map((g) => ({
      company_id: g.company_id,
      company_name: g.company_name,
      totals: totalRows(g.rows),
    })),
    totals: totalRows(rows),
  };
}

/* ---------------- hiring, offline ---------------- */

/*
 * The server keeps all of this in six SQLite tables and joins on read. Here it
 * is six arrays and the joins are done by hand, exactly as the employee and
 * payroll side of this file already works.
 *
 * What is NOT re-implemented is anything with judgement in it: the match score
 * (shared/match.js), the stages (shared/stages.js), the test rules
 * (shared/hiringTest.js) and every message (shared/hiringMessages.js) are the
 * same modules the server runs, so a candidate cannot score 71 on the laptop
 * and 64 on the server.
 */

const VACANCY_FIELDS = [
  'company_id', 'title', 'department', 'reports_to', 'location', 'work_mode',
  'employment_type', 'experience_band', 'education', 'positions',
  'salary_min', 'salary_max', 'skills', 'description', 'responsibilities',
  'requirements', 'benefits', 'internal_notes',
  'test_url', 'test_pass_percent', 'test_seconds_per_question', 'test_duration_minutes',
  'status', 'opened_on', 'needed_by', 'apply_by',
];

const CANDIDATE_FIELDS = [
  'name', 'phone', 'email', 'dob', 'gender', 'location', 'preferred_location',
  'education', 'experience', 'current_company', 'current_salary',
  'expected_salary', 'notice_period', 'role', 'skills', 'industry',
  'source', 'referred_by', 'notes',
];

/* Deliberately no stage, stage_log, stage_changed_at or employee_id: a stage
   moves through its own call so the log is written, and payroll through the
   hire button. Word for word the server's `skip` list. */
const APPLICATION_FIELDS = [
  'match_score', 'test_score', 'test_status', 'offer_salary', 'joining_date', 'notes',
];

const INTERVIEW_FIELDS = [
  'application_id', 'at', 'mode', 'location_or_link', 'round', 'panel', 'notes', 'status',
];

const TASK_FIELDS = [
  'title', 'due_on', 'priority', 'status', 'application_id', 'candidate_id', 'vacancy_id',
];

const hiringNow = () => new Date().toISOString();
const today = () => hiringNow().slice(0, 10);

/** Only the fields the table has, so a stray key cannot land in the store. */
function pick(fields, body, existing = {}) {
  const out = {};
  for (const key of fields) {
    if (body && key in body) out[key] = body[key] === undefined ? null : body[key];
    else if (key in existing) out[key] = existing[key];
  }
  return out;
}

/**
 * JOB-001, CAN-001 - the number somebody reads out over a phone, and the one
 * printed on an advert and quoted back by a candidate who saw it.
 *
 * It is a HIGH-WATER MARK, never a count and never the last row: deleting the
 * newest opening must not hand JOB-002 to a different job while the first
 * JOB-002 is still on a WhatsApp forward somebody is reading. The same rule
 * the asset codes follow, and for the same reason.
 *
 * The mark is seeded from whatever is already on file, so a store written
 * before this existed carries on from the right number rather than from one.
 */
function nextHiringRef(key, prefix) {
  const db = load();
  db.ref_high ||= {};
  const seen = Math.max(
    Number(db.ref_high[key]) || 0,
    ...db[key].map((r) => Number(String(r.ref_no).replace(/\D/g, '')) || 0),
    0
  );
  db.ref_high[key] = seen + 1;
  return `${prefix}-${String(seen + 1).padStart(3, '0')}`;
}

/** Digits only: "+91 98250 12345" and "9825012345" are one person. */
const normalisePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const vacancyOf = (id) => load().vacancies.find((v) => v.id === Number(id)) || null;
const candidateOf = (id) => load().candidates.find((c) => c.id === Number(id)) || null;
const applicationOf = (id) => load().applications.find((a) => a.id === Number(id)) || null;

/** v.* plus the company name and the two counts the server sub-selects. */
function vacancyRow(v) {
  if (!v) return null;
  const db = load();
  const apps = db.applications.filter((a) => a.vacancy_id === v.id);
  return {
    ...v,
    company_name: companyOf(v.company_id)?.name || '',
    applications: apps.length,
    hired: apps.filter((a) => a.employee_id).length,
  };
}

const candidateRow = (c) =>
  c && { ...c, applications: load().applications.filter((a) => a.candidate_id === c.id).length };

/** The server's APPLICATION_COLUMNS join, by hand. */
function applicationRow(a) {
  if (!a) return null;
  const c = candidateOf(a.candidate_id);
  const v = vacancyOf(a.vacancy_id);
  if (!c || !v) return null;
  return {
    ...a,
    candidate_ref: c.ref_no,
    candidate_name: c.name,
    phone: c.phone,
    email: c.email,
    location: c.location,
    preferred_location: c.preferred_location,
    education: c.education,
    experience: c.experience,
    skills: c.skills,
    expected_salary: c.expected_salary,
    current_salary: c.current_salary,
    current_company: c.current_company,
    notice_period: c.notice_period,
    role: c.role,
    resume_path: c.resume_path || null,
    resume_name: c.resume_name || null,
    source: c.source,
    vacancy_ref: v.ref_no,
    job_title: v.title,
    department: v.department,
    job_location: v.location,
    vacancy_status: v.status,
    company_id: v.company_id,
    company_name: companyOf(v.company_id)?.name || '',
  };
}

function interviewRow(i) {
  if (!i) return null;
  const app = applicationOf(i.application_id);
  const c = app ? candidateOf(app.candidate_id) : null;
  const v = app ? vacancyOf(app.vacancy_id) : null;
  return {
    ...i,
    candidate_name: c?.name || null,
    phone: c?.phone || null,
    job_title: v?.title || null,
    vacancy_ref: v?.ref_no || null,
    company_name: v ? companyOf(v.company_id)?.name || null : null,
  };
}

const taskRow = (t) =>
  t && {
    ...t,
    candidate_name: candidateOf(t.candidate_id)?.name || null,
    job_title: vacancyOf(t.vacancy_id)?.title || null,
  };

/*
 * There is no .env on a laptop, so there is no app-wide test address and no
 * public URL. An opening's OWN test link still resolves, which is the one that
 * matters - the office types it per vacancy anyway.
 */
const HIRING_DEFAULTS = { url: null, passPercent: 50, secondsPerQuestion: 30 };

const publicBase = () => String(load().settings?.public_url || '');
const testRules = (vacancy) => testFor(vacancy, HIRING_DEFAULTS);

const listApplicationRows = ({ vacancy_id, candidate_id, company_id, stage, q } = {}) => {
  const needle = q ? String(q).toLowerCase() : '';
  return load()
    .applications.map(applicationRow)
    .filter(Boolean)
    .filter((r) => !vacancy_id || r.vacancy_id === Number(vacancy_id))
    .filter((r) => !candidate_id || r.candidate_id === Number(candidate_id))
    .filter((r) => !company_id || r.company_id === Number(company_id))
    .filter((r) => !stage || r.stage === stage)
    .filter(
      (r) =>
        !needle ||
        [r.candidate_name, r.phone, r.job_title, r.vacancy_ref]
          .some((f) => String(f || '').toLowerCase().includes(needle))
    )
    .sort((a, b) => b.match_score - a.match_score || b.id - a.id);
};

const listTestsFor = (candidateId) =>
  load()
    .tests.filter((t) => t.candidate_id === Number(candidateId))
    // id breaks the tie, as on the server: taken_at is only to the second.
    .sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)) || b.id - a.id);

const upcomingInterviews = () => {
  const since = new Date(Date.now() - 86400000).toISOString();
  return load()
    .interviews.filter((i) => i.status === 'Scheduled' && String(i.at) >= since.slice(0, 16))
    .map(interviewRow)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
};

const openTasks = () =>
  load()
    .hiring_tasks.filter((t) => t.status === 'open')
    .map(taskRow)
    .sort((a, b) => {
      if (!a.due_on !== !b.due_on) return a.due_on ? -1 : 1;
      return String(a.due_on || '').localeCompare(String(b.due_on || '')) || b.id - a.id;
    });

/** The same figures the server's hiringOverview() counts. */
function hiringOverview() {
  const db = load();
  const published = db.vacancies.filter((v) => v.status === 'published');
  const byStage = {};
  for (const a of db.applications) byStage[a.stage] = (byStage[a.stage] || 0) + 1;

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthStart = `${today().slice(0, 7)}-01`;
  const hiredIds = new Set(db.applications.filter((a) => a.employee_id).map((a) => a.employee_id));

  return {
    vacancies: {
      open: published.length,
      draft: db.vacancies.filter((v) => v.status === 'draft').length,
      total: db.vacancies.length,
      positions: published.reduce((n, v) => n + (Number(v.positions) || 0), 0),
      unfilled:
        published.reduce((n, v) => n + (Number(v.positions) || 0), 0) -
        db.applications.filter(
          (a) => a.employee_id && published.some((v) => v.id === a.vacancy_id)
        ).length,
    },
    candidates: {
      total: db.candidates.length,
      withResume: db.candidates.filter((c) => c.resume_path).length,
      addedThisWeek: db.candidates.filter((c) => String(c.created_at) >= weekAgo).length,
    },
    applications: {
      total: db.applications.length,
      thisWeek: db.applications.filter((a) => String(a.created_at) >= weekAgo).length,
      byStage,
      rejected: byStage[REJECTED] || 0,
    },
    interviews: { upcoming: upcomingInterviews().length },
    tasks: {
      open: db.hiring_tasks.filter((t) => t.status === 'open').length,
      overdue: db.hiring_tasks.filter(
        (t) => t.status === 'open' && t.due_on && t.due_on < today()
      ).length,
    },
    hires: {
      total: db.applications.filter((a) => a.employee_id).length,
      thisMonth: db.employees.filter(
        (e) => hiredIds.has(e.id) && e.joined_on && e.joined_on >= monthStart
      ).length,
      awaitingPayroll: db.applications.filter(
        (a) => ['Selected', 'Joined'].includes(a.stage) && !a.employee_id
      ).length,
    },
  };
}

/*
 * The same rules the form checks and the server checks - one list in
 * shared/vacancyForm.js, so the laptop and the server cannot disagree about
 * what a vacancy is allowed to say. Required-ness stays with the caller.
 */
function checkVacancyValues(values) {
  const { min, max } = fromBand(values.experience_band);
  const problems = validateVacancy(
    { positions: 1, ...values, experience_min: min, experience_max: max },
    { assessment: !!values.test_url }
  );
  delete problems.company_id;
  delete problems.title;
  delete problems.location;
  const [first] = Object.values(problems);
  if (first) throw new HttpError(400, first);
  return values;
}

/** A test link is checked when it is SAVED, not when a candidate opens it. */
function checkedTestUrl(values) {
  if (!('test_url' in values)) return values;
  const text = String(values.test_url || '').trim();
  if (!text) return { ...values, test_url: null };
  const { url, problem } = checkTestUrl(text);
  if (problem) throw new HttpError(400, problem);
  return { ...values, test_url: url };
}

/** Re-score every application on an opening whose requirement just changed. */
function rescoreVacancy(vacancy) {
  for (const a of load().applications) {
    if (a.vacancy_id !== vacancy.id) continue;
    a.match_score = matchScore(candidateOf(a.candidate_id) || {}, vacancy).total;
  }
}

/**
 * The one thing that cannot be done offline, said once and reused: a CV is a
 * file and a candidate's apply link is an address on the internet. Neither
 * exists in an HTML file on a laptop.
 */
const NO_FILES_OFFLINE =
  'A CV has to live somewhere other than this browser, so attaching one needs the server version. ' +
  'Everything else about this candidate works here.';

/* ---------------- the People tab, offline ---------------- */

/*
 * Warnings and appreciations, appraisals, expense claims, office tasks, the
 * helpdesk, leaving and the full and final, and the trail of who changed what.
 *
 * This file used to say all of it needed the server - "a trail that outlives
 * one browser is not something a single file on a laptop can hold". That was
 * never true of the DATA: this file already holds 115 people, a year of
 * attendance and every payslip. It was true of exactly one thing, and it still
 * is: there is nobody else here. A claim the office approves and the employee
 * raised is one person wearing both hats, and the trail's `who` is a name typed
 * on a form - which the server version says about itself too.
 *
 * So it all works, and the screens say that plainly rather than pretending
 * there is an approver on the other side.
 *
 * Two rules carried over from the server word for word, because they are the
 * ones that cost money if they differ:
 *   - nothing decides itself
 *   - money reaches the payroll through ONE call that names the month it comes
 *     out of (paying a claim), and it cannot be made twice
 */

const NOTE_KINDS = ['warning', 'appreciation', 'note'];
const WARNING_LEVELS = ['verbal', 'written', 'final'];
const CLAIM_KINDS = ['Travel', 'Food', 'Petrol', 'Lodging', 'Phone', 'Other'];
const CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'paid'];
const TASK_PRIORITIES = ['low', 'normal', 'high'];
const TICKET_CATEGORIES = [
  'Salary', 'Attendance', 'Leave', 'PF / ESI', 'Bank details', 'Documents', 'Complaint', 'Other',
];
const ASSET_KINDS = [
  'Laptop', 'Desktop', 'Mobile', 'SIM card', 'ID card', 'Access card', 'Vehicle', 'Tools',
  'Furniture', 'Other',
];

const ASSET_FIELDS = [
  'company_id', 'branch_id', 'kind', 'label', 'identifier', 'purchase_cost',
  'purchase_date', 'vendor', 'invoice_no', 'warranty_until',
  'amc_until', 'amc_vendor', 'amc_cost',
  'employee_id', 'issued_on', 'returned_on', 'condition', 'note',
  'brand', 'model', 'description', 'department', 'location', 'floor_room',
  'warranty_from', 'warranty_provider', 'purchase_remarks', 'state_note',
];

const MASTER_KINDS = ['category', 'type', 'brand', 'vendor'];
/** Only a vendor has these; the other three keep them null. */
const VENDOR_FIELDS = ['contact_person', 'phone', 'email', 'address', 'gstin'];

const dayNow = () => new Date().toISOString().slice(0, 10);
const stampNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const nameOf = (employeeId) => employeeOf(Number(employeeId))?.name || `#${employeeId}`;

/**
 * The trail.
 *
 * `who` is a name somebody typed on a form, not an authenticated identity -
 * one shared password, no accounts - and the screen says so. Written the same
 * way the server writes it so the two lists read alike.
 */
function auditLine(entry = {}) {
  const db = load();
  db.audit_log.push({
    id: nextId(),
    at: stampNow(),
    who: entry.who || null,
    action: String(entry.action || 'changed'),
    entity: String(entry.entity || 'unknown'),
    entity_id: entry.entity_id === undefined ? null : Number(entry.entity_id) || null,
    label: entry.label || null,
    field: entry.field || null,
    from_value:
      entry.from_value === undefined || entry.from_value === null ? null : String(entry.from_value),
    to_value: entry.to_value === undefined || entry.to_value === null ? null : String(entry.to_value),
    note: entry.note || null,
  });
}

const withPerson = (row) => {
  const e = employeeOf(row.employee_id);
  return {
    ...row,
    employee_name: e?.name || null,
    employee_code: e?.code || null,
    company_name: e ? companyOf(e.company_id)?.name || null : null,
  };
};

/** The increment in rupees and per cent, worked out rather than stored. */
function withIncrement(row) {
  const from = Number(row.from_salary) || 0;
  const to = Number(row.to_salary) || 0;
  const rise = to && from ? to - from : 0;
  return {
    ...row,
    increment: rise,
    increment_percent: from > 0 && to ? Math.round((rise / from) * 1000) / 10 : null,
  };
}

const ticketRow = (t) => {
  const replies = load().ticket_replies.filter((r) => r.ticket_id === t.id);
  const last = replies[replies.length - 1];
  return {
    ...withPerson(t),
    replies: replies.length,
    last_reply_at: last?.created_at || null,
    last_side: last?.side || null,
  };
};

const ticketWithReplies = (t) =>
  t && {
    ...withPerson(t),
    replies: load()
      .ticket_replies.filter((r) => r.ticket_id === t.id)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id),
  };

const exitRow = (x) => {
  const e = employeeOf(x.employee_id);
  return {
    ...x,
    employee_name: e?.name || null,
    employee_code: e?.code || null,
    joined_on: e?.joined_on || null,
    monthly_salary: e?.monthly_salary ?? null,
    company_name: e ? companyOf(e.company_id)?.name || null : null,
  };
};

/**
 * The full and final.
 *
 * It ASSEMBLES, it never recalculates: the final month's net is the payslip's
 * own figure, read with sync:false for the same reason the server does it -
 * reading a closed month to settle somebody must not backdate a new hire into
 * it or post another loan instalment.
 */
function fullAndFinalOf(employeeId) {
  const db = load();
  const employee = employeeOf(employeeId);
  if (!employee) throw new HttpError(404, 'employee not found');
  const exit = db.employee_exits.find((x) => x.employee_id === employee.id);
  if (!exit) return null;

  let finalMonth = null;
  let finalLabel = null;
  const last = exit.last_working_day ? new Date(exit.last_working_day) : null;
  if (last && !Number.isNaN(last.getTime())) {
    const period = db.periods.find(
      (p) => p.year === last.getFullYear() && p.month === last.getMonth() + 1
    );
    if (period) {
      finalLabel = period.label;
      const payroll = buildPayroll(period.id, { sync: false });
      finalMonth = payroll?.rows.find((r) => r.employee_id === employee.id) || null;
    }
  }

  const year = last && !Number.isNaN(last.getTime()) ? last.getFullYear() : new Date().getFullYear();
  const leave = leaveOf(employee, year);
  const loans = db.loans
    .filter((l) => l.employee_id === employee.id && l.status !== 'closed')
    .map((l) => ({ ...l, ...loanOutstanding(l) }));
  const claims = db.expense_claims
    .filter((c) => c.employee_id === employee.id && c.status === 'approved')
    .map(withPerson);

  return {
    employee,
    exit,
    final_month: finalMonth,
    final_month_label: finalLabel,
    settlement: settlement({
      employee,
      exit: { ...exit, final_month_label: finalLabel },
      final_month: finalMonth,
      leave: { quotas: leave.quotas, taken: leave.taken },
      loan_outstanding: loans.reduce((sum, l) => sum + (Number(l.outstanding) || 0), 0),
      claims,
      // No asset register in this file, so nothing is named as unreturned -
      // which is the safe way round: an asset is NAMED and valued, never
      // deducted, so having none means nothing is wrongly withheld.
      assets: [],
      extras: exit.extras || [],
    }),
    loans,
    claims,
    assets: [],
    leave,
  };
}

/** One person's leave for a year, counted off the marks like the Leave tab. */
function leaveOf(employee, year) {
  const db = load();
  const periodIds = new Set(db.periods.filter((p) => p.year === year).map((p) => p.id));
  const taken = { CL: 0, SL: 0, PL: 0, UL: 0 };
  for (const a of db.attendance) {
    if (!periodIds.has(a.period_id) || a.employee_id !== employee.id) continue;
    if (taken[a.code] !== undefined) taken[a.code] += 1;
  }
  return {
    employee_id: employee.id,
    quotas: { CL: employee.cl_quota || 0, SL: employee.sl_quota || 0, PL: employee.pl_quota || 0 },
    taken,
  };
}

/* ---------------- the Assets tab, offline ---------------- */

/*
 * The register, handovers, the stock take and the service history.
 *
 * Same answer as Hiring and People: these are records, and this file already
 * keeps records. One thing genuinely needs a server and says so where it is -
 * a PHOTOGRAPH of an asset is a file, and a file cannot live inside an HTML
 * page on a laptop. Everything else works.
 *
 * Nothing with judgement in it is re-implemented. The asset code series
 * (shared/assetCode.js), the Code 128 barcode (shared/barcode.js), the
 * register totals and the handover slip (shared/assetReport.js), the cost of
 * ownership and the duplicate check (shared/maintenance.js) and the voucher
 * (shared/voucher.js) are the very modules the server runs.
 */

const assetOf = (id) => byId(load().assets, id);

/** Every code ever used, written-off ones included - a number is never reused. */
const assetCodesInUse = () => load().assets.map((a) => a.code).filter(Boolean);

/** Days until a date, or null. Negative means it has passed. */
function daysUntilDay(date) {
  if (!date) return null;
  const then = new Date(date);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((then - today) / 86400000);
}

/** a.* plus the joins every asset screen reads. */
function assetRow(a, { round } = {}) {
  if (!a) return null;
  const db = load();
  const holder = a.employee_id ? employeeOf(a.employee_id) : null;
  const verdict = round
    ? db.asset_verifications.find((v) => v.asset_id === a.id && v.round === round) || null
    : null;
  return {
    ...a,
    employee_name: holder?.name || null,
    company_name: a.company_id ? companyOf(a.company_id)?.name || null : null,
    branch_name: null,
    handovers: db.asset_handovers.filter((h) => h.asset_id === a.id).length,
    // Always nought here, and that is the honest answer: a PDF and a
    // photograph are files, and this build has nowhere to put one. The
    // register says so beside the paperclip rather than looking broken.
    documents: 0,
    photos: 0,
    warranty_left_days: daysUntilDay(a.warranty_until),
    ...(round
      ? {
          // null is "not looked at yet", which is NOT "missing". Counting the
          // third as the second is how a stock take invents losses.
          verified_found: verdict ? Boolean(verdict.found) : null,
          verified_on: verdict?.verified_on || null,
        }
      : {}),
  };
}

function listAssetsOffline({ employee_id, company_id, out, written_off = false, round } = {}) {
  return load()
    .assets.filter((a) => !employee_id || a.employee_id === Number(employee_id))
    .filter((a) => !company_id || a.company_id === Number(company_id))
    // "Out" means issued to somebody and not back yet.
    .filter((a) => !out || (a.employee_id && !a.returned_on))
    // A written-off asset keeps its row and its code; it is simply off the
    // register unless asked for.
    .filter((a) => written_off || !a.written_off_on)
    .map((a) => assetRow(a, { round }))
    .sort(
      (x, y) =>
        Number(Boolean(y.employee_id && !y.returned_on)) - Number(Boolean(x.employee_id && !x.returned_on)) ||
        String(x.kind || '').localeCompare(String(y.kind || '')) ||
        String(x.code || '').localeCompare(String(y.code || '')) ||
        String(x.label || '').localeCompare(String(y.label || ''))
    );
}

const handoverRow = (h) => {
  const a = assetOf(h.asset_id);
  return {
    ...h,
    code: a?.code || null,
    label: a?.label || null,
    kind: a?.kind || null,
    purchase_cost: a?.purchase_cost ?? 0,
    // The serial identifies the actual object on a document somebody signs.
    identifier: a?.identifier || null,
    company_name: a?.company_id ? companyOf(a.company_id)?.name || null : null,
  };
};

const listHandoversOffline = ({ asset_id, employee_id, open } = {}) =>
  load()
    .asset_handovers.filter((h) => !asset_id || h.asset_id === Number(asset_id))
    .filter((h) => !employee_id || h.employee_id === Number(employee_id))
    .filter((h) => !open || !h.returned_on)
    .map(handoverRow)
    .sort((a, b) => String(b.issued_on).localeCompare(String(a.issued_on)) || b.id - a.id);

const openHandoverOf = (assetId) =>
  load().asset_handovers.find((h) => h.asset_id === Number(assetId) && !h.returned_on) || null;

const serviceRow = (s) => {
  const a = assetOf(s.asset_id);
  return {
    ...s,
    code: a?.code || null,
    label: a?.label || null,
    // Aliased, and it matters: taking the asset's `kind` would put "Laptop"
    // where the timeline means "Repair". The server was bitten by exactly this.
    asset_kind: a?.kind || null,
    company_name: a?.company_id ? companyOf(a.company_id)?.name || null : null,
    under_warranty: Boolean(s.under_warranty),
  };
};

const listServicesOffline = ({ asset_id, company_id, from, to } = {}) =>
  load()
    .asset_services.filter((s) => !asset_id || s.asset_id === Number(asset_id))
    .filter((s) => !company_id || assetOf(s.asset_id)?.company_id === Number(company_id))
    .filter((s) => !from || String(s.serviced_on) >= from)
    .filter((s) => !to || String(s.serviced_on) <= to)
    .map(serviceRow)
    .sort((a, b) => String(b.serviced_on).localeCompare(String(a.serviced_on)) || b.id - a.id);

/** The register plus what each one has cost to keep. */
const assetsWithOwnershipOffline = (opts = {}) => {
  const byAsset = new Map();
  for (const s of listServicesOffline({ company_id: opts.company_id })) {
    if (!byAsset.has(s.asset_id)) byAsset.set(s.asset_id, []);
    byAsset.get(s.asset_id).push(s);
  }
  return listAssetsOffline(opts).map((asset) => {
    const services = byAsset.get(asset.id) || [];
    return { ...asset, services, ownership: ownership(asset, services) };
  });
};

/** Append-only, written by the same calls that move the asset. */
function logHandoverOffline(
  assetId,
  { employee_id, issued_on, issued_by, condition_out, note, expected_return_on, accessories } = {}
) {
  const db = load();
  db.asset_handovers.push({
    id: nextId(),
    asset_id: Number(assetId),
    employee_id: employee_id || null,
    // Kept as text too, so a slip still reads correctly after somebody has
    // left and their row is gone.
    employee_name: employee_id ? employeeOf(employee_id)?.name || null : null,
    issued_on: issued_on || dayNow(),
    issued_by: issued_by || null,
    returned_on: null,
    returned_by: null,
    condition_out: condition_out || null,
    condition_in: null,
    note: note || null,
    // Null is open-ended, which is how most allocations are - and why the
    // overdue alert only counts the ones that named a date.
    expected_return_on: expected_return_on || null,
    accessories: accessories || null,
    acknowledged_on: null,
    acknowledged_by: null,
    created_at: stampNow(),
  });
}

/** Bring it back in. Used by the return call and by writing one off. */
function returnAssetOffline(id, { returned_on, condition, note, by } = {}) {
  const asset = assetOf(id);
  if (!asset) throw new HttpError(404, 'not found');
  const open = openHandoverOf(id);
  if (open) {
    open.returned_on = returned_on || dayNow();
    open.returned_by = by || null;
    open.condition_in = condition || null;
    if (note) open.note = note;
  }
  asset.returned_on = returned_on || dayNow();
  if (condition) asset.condition = condition;
  auditLine({
    who: by, action: 'returned', entity: 'assets', entity_id: asset.id,
    label: `${asset.code || ''} ${asset.label}`.trim(),
    from_value: employeeOf(asset.employee_id)?.name || null,
  });
  return asset;
}

/** The timeline, assembled from the rows that already hold each part. */
function assetHistoryOffline(id) {
  const asset = assetOf(id);
  if (!asset) return null;
  const events = [];

  if (asset.purchase_date || asset.created_at) {
    events.push({
      on: asset.purchase_date || String(asset.created_at).slice(0, 10),
      what: asset.purchase_date ? 'Bought' : 'Added to the register',
      detail: [asset.vendor, asset.invoice_no].filter(Boolean).join(', ') || null,
      amount: Number(asset.purchase_cost) || 0,
    });
  }
  for (const h of listHandoversOffline({ asset_id: id }).reverse()) {
    events.push({
      on: h.issued_on, what: 'Issued', who: h.employee_name,
      detail: h.condition_out || null, by: h.issued_by,
    });
    if (h.returned_on) {
      events.push({
        on: h.returned_on, what: 'Returned', who: h.employee_name,
        detail: h.condition_in || null, by: h.returned_by,
      });
    }
  }
  for (const s of listServicesOffline({ asset_id: id }).reverse()) {
    events.push({
      on: s.serviced_on,
      what: s.kind || 'Serviced',
      detail: [s.work, s.vendor, s.under_warranty ? 'under warranty' : null].filter(Boolean).join(', ') || null,
      amount: Number(s.cost) || 0,
      by: s.logged_by,
    });
  }
  for (const v of load().asset_verifications.filter((v) => v.asset_id === Number(id))) {
    events.push({
      on: v.verified_on,
      what: v.found ? 'Checked' : 'Not found',
      detail: [v.round, v.note].filter(Boolean).join(' · ') || null,
      by: v.verified_by,
    });
  }
  if (asset.written_off_on) {
    events.push({ on: asset.written_off_on, what: 'Written off', detail: asset.written_off_why || null });
  }

  return {
    asset: assetRow(asset),
    events: events
      .filter((e) => e.on)
      .sort((a, b) => String(a.on).localeCompare(String(b.on))),
  };
}

/** How a round is going. Three figures, never two. */
function roundProgressOffline(round) {
  const assets = listAssetsOffline({ round });
  const missing = assets.filter((a) => a.verified_found === false);
  const todo = assets.filter((a) => a.verified_found === null);
  return {
    round,
    total: assets.length,
    found: assets.filter((a) => a.verified_found === true).length,
    missing: missing.length,
    not_checked: todo.length,
    missing_value: missing.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0),
    missing_assets: missing,
    not_checked_assets: todo,
  };
}

/**
 * A photograph is a file, and a file cannot live inside an HTML page. Said in
 * one place so every route that touches one says the same thing.
 */
const ASSET_DOC_KINDS = [
  ['invoice', 'Invoice'],
  ['warranty', 'Warranty card'],
  ['delivery', 'Delivery note'],
  ['amc', 'AMC contract'],
  ['other', 'Something else'],
];

const NO_PHOTOS_OFFLINE =
  'A photograph is a file, so keeping one needs the server version. Everything else about ' +
  'this asset works here — the note on its condition is on the handover.';

/* ---------------- the router ---------------- */

const ROW_FIELDS = [
  'salary', 'absent_days_override', 'sundays_override', 'ot_minutes_override',
  'ot_amount_override', 'addition', 'deduction', 'adjustment_note',
  'adjustment', 'esi', 'pf', 'sunday_salary_override',
  'payment_mode', 'status', 'sunday_status', 'sunday_mode', 'remark',
];

/*
 * Everything the server's own EMPLOYEE_FIELDS carries, and for the same reason:
 * a field missing here cannot be saved in the single-file build at all. The
 * salary breakup, the PF/ESI modes, the shift and the weekly off were all absent
 * once, which made those panels look as if they worked and then quietly dropped
 * what was typed.
 */
const EMPLOYEE_FIELDS = [
  'company_id', 'code', 'name', 'designation', 'religion', 'department',
  'dob', 'gender', 'marital_status', 'blood_group',
  'father_name', 'mother_name', 'spouse_name',
  'phone', 'phone_alt', 'email', 'address',
  'emergency_name', 'emergency_phone', 'emergency_relation',
  'pan', 'aadhaar', 'uan', 'esic_no', 'pf_no',
  'bank_name', 'bank_account', 'ifsc',
  'cl_quota', 'sl_quota', 'pl_quota',
  'basic', 'hra', 'conveyance', 'medical',
  'pf_mode', 'esi_mode', 'shift_in', 'shift_out', 'weekly_off', 'reports_to_id',
  'monthly_salary', 'pf', 'esi', 'payment_mode', 'joined_on', 'left_on',
  // When probation ends. Informational; the reminder needs the date.
  'probation_until',
  'active', 'sort_order',
];

/** Answers an /api path the way the server would. */
export async function handle(method, path, body) {
  const db = load();
  const [, ...parts] = path.split('?')[0].split('/');
  const route = `${method} /${parts.join('/')}`;

  /*
   * There is nobody to sign in as: this file is the whole installation and it
   * lives on one laptop. But App.jsx asks for the sign-in state before it will
   * load anything at all, so a 404 here left the page showing "No months yet"
   * with every tab empty - the file looked broken rather than offline. So the
   * question is answered honestly: nothing is guarding this, and nobody is
   * signed in.
   */
  if (route === 'GET /auth/state') {
    return { needs_setup: false, open: true, roles: [], signed_in: null };
  }

  /* config */
  if (route === 'GET /config') {
    return {
      currency: 'INR',
      codes: ATTENDANCE_CODES,
      standalone: true,
      defaults: {
        working_days: STANDARD_WORKING_DAYS,
        hours_per_day: 9,
        pt_threshold: 12000,
        pt_amount: 200,
        late_policy: 'hours',
        late_concession_minutes: 300,
        late_grace_minutes: 0,
        shift_in: '09:30',
        shift_out: '18:30',
      },
    };
  }

  /* statutory registers */
  const statutory = path.split('?')[0].match(/^\/periods\/(\d+)\/statutory$/);
  if (statutory && method === 'GET') {
    const payroll = buildPayroll(Number(statutory[1]));
    if (!payroll) throw new HttpError(404, 'period not found');
    return statutoryReport(payroll);
  }

  /* loans */
  if (parts[0] === 'loans') {
    const withTotals = (loan) => ({
      ...loan,
      ...loanOutstanding(loan),
      employee_name: employeeOf(loan.employee_id)?.name,
      company_name: companyOf(employeeOf(loan.employee_id)?.company_id)?.name,
    });

    if (parts.length === 1 && method === 'GET') {
      const params = new URLSearchParams(path.split('?')[1] || '');
      const periodId = Number(params.get('period_id')) || null;
      return {
        loans: db.loans.map(withTotals).reverse(),
        repayments: periodId
          ? db.repayments
              .filter((r) => r.period_id === periodId)
              .map((r) => {
                const loan = db.loans.find((l) => l.id === r.loan_id);
                return {
                  ...r,
                  employee_id: loan?.employee_id,
                  loan_amount: loan?.amount,
                  reason: loan?.reason,
                  employee_name: employeeOf(loan?.employee_id)?.name,
                };
              })
          : [],
      };
    }

    if (parts.length === 1 && method === 'POST') {
      const amount = Number(body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'the amount must be more than zero');
      if (!employeeOf(Number(body?.employee_id))) throw new HttpError(400, 'employee not found');
      const loan = {
        id: nextId(),
        employee_id: Number(body.employee_id),
        amount,
        instalment: Number(body.instalment) || 0,
        given_on: body.given_on || null,
        reason: body.reason || null,
        status: body.status === 'held' ? 'held' : 'active',
        created_at: new Date().toISOString(),
      };
      db.loans.push(loan);
      save();
      return withTotals(loan);
    }

    if (parts[1] === 'post' && parts[2] && method === 'POST') {
      const period = periodOf(Number(parts[2]));
      if (!period) throw new HttpError(404, 'period not found');
      if (period.locked) throw new HttpError(409, 'period is locked');
      const added = postRepayments(period.id);
      save();
      return { added };
    }

    const loan = db.loans.find((l) => l.id === Number(parts[1]));
    if (!loan) throw new HttpError(404, 'not found');

    if (parts.length === 2 && method === 'PATCH') {
      for (const key of ['amount', 'instalment', 'given_on', 'reason', 'status']) {
        if (key in (body || {})) loan[key] = body[key] === '' ? null : body[key];
      }
      save();
      return withTotals(loan);
    }
    if (parts.length === 2 && method === 'DELETE') {
      db.loans = db.loans.filter((l) => l.id !== loan.id);
      db.repayments = db.repayments.filter((r) => r.loan_id !== loan.id);
      save();
      return null;
    }
    if (parts[2] === 'repayment' && parts[3] && method === 'PUT') {
      const period = periodOf(Number(parts[3]));
      if (!period) throw new HttpError(404, 'period not found');
      if (period.locked) throw new HttpError(409, 'period is locked');
      const amount = Math.max(0, Number(body?.amount) || 0);
      const existing = db.repayments.find((r) => r.loan_id === loan.id && r.period_id === period.id);
      if (existing) existing.amount = amount;
      else db.repayments.push({ loan_id: loan.id, period_id: period.id, amount });
      save();
      return withTotals(loan);
    }
  }

  /* leave */
  if (parts[0] === 'leave' && method === 'GET') {
    const year = Number(new URLSearchParams(path.split('?')[1] || '').get('year')) ||
      new Date().getFullYear();
    const periodIds = new Set(db.periods.filter((p) => p.year === year).map((p) => p.id));
    const used = new Map();
    for (const a of db.attendance) {
      if (!periodIds.has(a.period_id)) continue;
      if (!['CL', 'SL', 'PL', 'UL'].includes(a.code)) continue;
      if (!used.has(a.employee_id)) used.set(a.employee_id, {});
      const bucket = used.get(a.employee_id);
      bucket[a.code] = (bucket[a.code] || 0) + 1;
    }
    return {
      year,
      rows: sortedEmployees()
        .filter((e) => e.active)
        .map((emp) => {
          const u = used.get(emp.id) || {};
          return {
            employee_id: emp.id,
            name: emp.name,
            company_name: emp.company_name,
            department: emp.department,
            quotas: { CL: emp.cl_quota || 0, SL: emp.sl_quota || 0, PL: emp.pl_quota || 0 },
            taken: { CL: u.CL || 0, SL: u.SL || 0, PL: u.PL || 0, UL: u.UL || 0 },
          };
        }),
    };
  }

  /* companies */
  if (route === 'GET /companies') {
    return {
      companies: db.companies
        .map((c) => ({
          ...c,
          employee_count: db.employees.filter((e) => e.company_id === c.id && e.active).length,
        }))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)),
    };
  }
  if (route === 'POST /companies') {
    const name = String(body?.name || '').trim();
    if (!name) throw new HttpError(400, 'company name is required');
    if (db.companies.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(400, 'a company with that name already exists');
    }
    const company = { id: nextId(), name, sort_order: Number(body.sort_order) || db.companies.length };
    db.companies.push(company);
    save();
    return company;
  }
  if (parts[0] === 'companies' && parts[1]) {
    const company = companyOf(Number(parts[1]));
    if (!company) throw new HttpError(404, 'not found');
    if (method === 'PATCH') {
      for (const key of ['name', 'sort_order', 'weekly_off'])
        if (key in (body || {})) company[key] = body[key] === '' ? null : body[key];
      save();
      return company;
    }
    if (method === 'DELETE') {
      const gone = db.employees.filter((e) => e.company_id === company.id).map((e) => e.id);
      db.employees = db.employees.filter((e) => e.company_id !== company.id);
      db.payroll_rows = db.payroll_rows.filter((r) => !gone.includes(r.employee_id));
      db.attendance = db.attendance.filter((a) => !gone.includes(a.employee_id));
      db.companies = db.companies.filter((c) => c.id !== company.id);
      save();
      return null;
    }
  }

  /* employees */
  if (route === 'GET /employees') return { employees: sortedEmployees() };
  if (route === 'POST /employees') {
    const name = String(body?.name || '').trim();
    if (!name) throw new HttpError(400, 'employee name is required');
    if (!Number(body?.company_id)) throw new HttpError(400, 'company_id is required');
    const employee = {
      id: nextId(),
      company_id: Number(body.company_id),
      code: body.code || null,
      name,
      designation: body.designation || null,
      religion: body.religion || null,
      department: body.department || null,
      dob: body.dob || null,
      gender: body.gender || null,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      pan: body.pan || null,
      aadhaar: body.aadhaar || null,
      uan: body.uan || null,
      esic_no: body.esic_no || null,
      pf_no: body.pf_no || null,
      bank_name: body.bank_name || null,
      bank_account: body.bank_account || null,
      ifsc: body.ifsc || null,
      cl_quota: Number(body.cl_quota) || 0,
      sl_quota: Number(body.sl_quota) || 0,
      pl_quota: Number(body.pl_quota) || 0,
      monthly_salary: Number(body.monthly_salary) || 0,
      pf: Number(body.pf) || 0,
      esi: Number(body.esi) || 0,
      payment_mode: body.payment_mode || 'Bank',
      joined_on: body.joined_on || null,
      left_on: body.left_on || null,
      active: body.active === undefined ? 1 : body.active ? 1 : 0,
      sort_order: Number(body.sort_order) || db.employees.length,
    };
    db.employees.push(employee);
    save();
    return { ...employee, company_name: companyOf(employee.company_id)?.name || '' };
  }
  if (parts[0] === 'employees' && parts[1]) {
    const employee = employeeOf(Number(parts[1]));
    if (!employee) throw new HttpError(404, 'not found');

    /* one person down the months */
    if (parts[2] === 'report' && method === 'GET') {
      const params = new URLSearchParams(path.split('?')[1] || '');
      const year = Number(params.get('year')) || null;
      const months = db.periods
        .filter((period) => !year || period.year === year)
        .sort((a, b) => a.year - b.year || a.month - b.month)
        .map((period) => {
          // sync: false, for the same reason the server does it - reading a
          // past month must not backdate a new hire or post a loan instalment
          // into a month already paid.
          const payroll = buildPayroll(period.id, { sync: false });
          const row = payroll?.rows.find((r) => r.employee_id === employee.id);
          return row ? { period: payroll.period, row } : null;
        })
        .filter(Boolean);

      return {
        ...employeeReport({ employee, months }),
        years: [...new Set(db.periods.map((p) => p.year))].sort((a, b) => b - a),
        year,
      };
    }

    if (method === 'PATCH') {
      /*
       * The same refusal the server makes. Without it this build would accept
       * a reporting line the server rejects, and the two would disagree about
       * the same click.
       */
      if ('reports_to_id' in (body || {})) {
        const manager = Number(body.reports_to_id) || null;
        if (manager && wouldLoop(db.employees, employee.id, manager)) {
          throw new HttpError(400, 'That would make the reporting line circle back on itself.');
        }
      }
      for (const key of EMPLOYEE_FIELDS) {
        if (!(key in (body || {}))) continue;
        let value = body[key];
        if (key === 'active') value = value ? 1 : 0;
        // An id has to be stored as a number: a select hands back a string,
        // and "3" never matches employee 3 when the chart looks the manager up.
        if (key === 'reports_to_id') value = Number(value) || null;
        employee[key] = value;
      }
      save();
      return { ...employee, company_name: companyOf(employee.company_id)?.name || '' };
    }
    if (method === 'DELETE') {
      db.employees = db.employees.filter((e) => e.id !== employee.id);
      db.payroll_rows = db.payroll_rows.filter((r) => r.employee_id !== employee.id);
      db.attendance = db.attendance.filter((a) => a.employee_id !== employee.id);
      const goneLoans = db.loans.filter((l) => l.employee_id === employee.id).map((l) => l.id);
      db.loans = db.loans.filter((l) => l.employee_id !== employee.id);
      db.repayments = db.repayments.filter((r) => !goneLoans.includes(r.loan_id));
      save();
      return null;
    }
  }

  /* periods */
  if (route === 'GET /periods') {
    return {
      periods: [...db.periods].sort((a, b) => b.year - a.year || b.month - a.month),
      codes: ATTENDANCE_CODES,
    };
  }
  if (route === 'POST /periods') {
    const year = Number(body?.year);
    const month = Number(body?.month);
    if (!year || !month || month < 1 || month > 12) throw new HttpError(400, 'year and month are required');
    if (db.periods.some((p) => p.year === year && p.month === month)) {
      throw new HttpError(409, 'that month already exists');
    }
    const period = {
      id: nextId(),
      year,
      month,
      label: String(body.label || '').trim() || `${MONTH_NAMES[month - 1]} ${year}`,
      // Fixed at 26, exactly as the server does it.
      working_days: STANDARD_WORKING_DAYS,
      hours_per_day: Number(body.hours_per_day) || 9,
      pt_threshold: body.pt_threshold === undefined ? 12000 : Number(body.pt_threshold),
      pt_amount: body.pt_amount === undefined ? 200 : Number(body.pt_amount),
      // The late/early rule, per month. 'hours' is the default and charges
      // nothing for lateness as such - exactly as the server has it.
      late_policy: body.late_policy === 'concession' ? 'concession' : 'hours',
      late_concession_minutes:
        body.late_concession_minutes === undefined ? 300 : Number(body.late_concession_minutes),
      late_grace_minutes: Number(body.late_grace_minutes) || 0,
      shift_in: body.shift_in || '09:30',
      shift_out: body.shift_out || '18:30',
      locked: 0,
    };
    db.periods.push(period);
    syncRows(period.id);
    save();
    return period;
  }

  if (parts[0] === 'periods' && parts[1] && parts[2] === 'holidays') {
    const period = periodOf(Number(parts[1]));
    if (!period) throw new HttpError(404, 'period not found');
    const rest = parts.slice(3);

    if (!rest.length && method === 'GET') {
      return {
        holidays: db.holidays
          .filter((h) => h.period_id === period.id)
          .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name)),
        religions: [...new Set(db.employees.map((e) => e.religion).filter(Boolean))].sort(),
      };
    }

    if (!rest.length && method === 'POST') {
      if (period.locked) throw new HttpError(409, 'period is locked');
      const name = String(body?.name || '').trim();
      const day = Number(body?.day);
      const code = String(body?.code || 'PH').toUpperCase();
      if (!name) throw new HttpError(400, 'the festival needs a name');
      if (!day || day < 1 || day > 31) throw new HttpError(400, 'pick a date in the month');
      if (!ATTENDANCE_CODES[code]) throw new HttpError(400, `unknown mark: ${code}`);
      const holiday = {
        id: nextId(),
        period_id: period.id,
        day,
        name,
        religions: Array.isArray(body.religions) ? body.religions.filter(Boolean) : [],
        code,
        applied_at: null,
      };
      db.holidays.push(holiday);
      save();
      return holiday;
    }

    const holiday = db.holidays.find((h) => h.id === Number(rest[0]));
    if (!holiday || holiday.period_id !== period.id) throw new HttpError(404, 'not found');
    if (period.locked) throw new HttpError(409, 'period is locked');

    if (rest.length === 1 && method === 'DELETE') {
      db.holidays = db.holidays.filter((h) => h.id !== holiday.id);
      save();
      return null;
    }

    if (rest[1] === 'apply' && method === 'POST') {
      const people = db.employees.filter(
        (e) => e.active && (!holiday.religions.length || holiday.religions.includes(e.religion))
      );
      for (const person of people) {
        const index = db.attendance.findIndex(
          (a) => a.period_id === period.id && a.employee_id === person.id && a.day === holiday.day
        );
        // Only the mark changes - the day's minutes and clock times stay.
        const record = {
          ...(index >= 0 ? db.attendance[index] : { minutes: 0 }),
          period_id: period.id,
          employee_id: person.id,
          day: holiday.day,
          code: holiday.code,
        };
        if (index >= 0) db.attendance[index] = record;
        else db.attendance.push(record);
      }
      holiday.applied_at = new Date().toISOString();
      save();
      return { marked: people.length, holiday };
    }
  }

  if (parts[0] === 'periods' && parts[1]) {
    const period = periodOf(Number(parts[1]));
    if (!period) throw new HttpError(404, 'period not found');
    const tail = parts.slice(2);

    if (!tail.length) {
      if (method === 'GET') return period;
      if (method === 'PATCH') {
        // working_days is deliberately absent: it is fixed at 26.
        for (const key of [
          'label',
          'hours_per_day',
          'pt_threshold',
          'pt_amount',
          'late_policy',
          'late_concession_minutes',
          'late_grace_minutes',
          'shift_in',
          'shift_out',
          'locked',
        ]) {
          if (key in (body || {})) period[key] = key === 'locked' ? (body[key] ? 1 : 0) : body[key];
        }
        save();
        return period;
      }
      if (method === 'DELETE') {
        db.periods = db.periods.filter((p) => p.id !== period.id);
        db.payroll_rows = db.payroll_rows.filter((r) => r.period_id !== period.id);
        db.attendance = db.attendance.filter((a) => a.period_id !== period.id);
        db.holidays = db.holidays.filter((h) => h.period_id !== period.id);
        db.repayments = db.repayments.filter((r) => r.period_id !== period.id);
        save();
        return null;
      }
    }

    if (tail[0] === 'payroll' && method === 'GET') {
      // sync=false is how a caller says it is only reading an old month - see
      // the note on the same route in the API.
      const sync = new URLSearchParams(path.split('?')[1] || '').get('sync') !== 'false';
      return buildPayroll(period.id, { sync });
    }

    if (tail[0] === 'sync' && method === 'POST') {
      if (period.locked) throw new HttpError(409, 'period is locked');
      const added = syncRows(period.id);
      save();
      return { added };
    }

    if (tail[0] === 'rows' && tail[1] && method === 'PATCH') {
      if (period.locked) throw new HttpError(409, 'period is locked');
      const row = db.payroll_rows.find((r) => r.id === Number(tail[1]));
      if (!row) throw new HttpError(404, 'row not found');
      for (const key of ROW_FIELDS) {
        if (!(key in (body || {}))) continue;
        const value = body[key];
        if (['adjustment_note', 'payment_mode', 'status', 'sunday_status', 'sunday_mode', 'remark'].includes(key)) {
          row[key] = value === '' ? null : value;
        } else {
          // Blank on an override column means "go back to the formula", not zero.
          const parsed = num(value);
          if (parsed !== null && !Number.isFinite(parsed)) continue;
          row[key] = parsed;
        }
      }
      // The columns the server keeps NOT NULL must never become null here either.
      for (const key of ['salary', 'addition', 'deduction', 'adjustment', 'esi', 'pf']) {
        if (row[key] === null || row[key] === undefined) row[key] = 0;
      }
      if (!row.status) row.status = 'pending';
      save();
      const emp = employeeOf(row.employee_id);
      return { ...row, employee_name: emp?.name, company_id: emp?.company_id };
    }

    if (tail[0] === 'attendance') {
      if (method === 'POST') {
        if (period.locked) throw new HttpError(409, 'period is locked');
        const entries = Array.isArray(body?.entries) ? body.entries : [];
        const unknown = entries
          .map((e) => String(e.code || '').trim().toUpperCase())
          .filter((code) => code && !ATTENDANCE_CODES[code]);
        if (unknown.length) {
          throw new HttpError(400, `unknown attendance code(s): ${[...new Set(unknown)].join(', ')}`);
        }
        for (const entry of entries) {
          for (const field of TIME_FIELDS) {
            const value = entry[field];
            if (value === undefined || value === null || value === '') continue;
            if (parseTime(value) === null) {
              throw new HttpError(400, `${field.replace('_', ' ')} is not a time: ${value}`);
            }
          }
        }
        const hoursPerDay = Number(period.hours_per_day) || 9;
        for (const entry of entries) {
          const employeeId = Number(entry.employee_id);
          const day = Number(entry.day);
          if (!employeeId || !day) continue;
          const index = db.attendance.findIndex(
            (a) => a.period_id === period.id && a.employee_id === employeeId && a.day === day
          );
          /*
           * EVERY column is only touched by an entry that names it, so marking
           * somebody Present on the grid never wipes the hours typed on the
           * Time tab, and an import that knows nothing about lunch leaves the
           * lunch alone. Naming one with an empty value clears it.
           *
           * Word for word the server's rule - see `setAttendance` in
           * backend/src/db.js. The two have drifted before and it cost twice.
           */
          const stored = index >= 0 ? db.attendance[index] : null;
          const times = {};
          for (const field of TIME_FIELDS) {
            const value = field in entry ? entry[field] : stored?.[field];
            times[field] = value === undefined || value === null ? '' : String(value);
          }
          const anyTime = TIME_FIELDS.some((f) => times[f]);

          let code =
            'code' in entry
              ? String(entry.code || '').trim().toUpperCase()
              : String(stored?.code || '').trim().toUpperCase();
          let minutes = 'minutes' in entry ? Number(entry.minutes) || 0 : Number(stored?.minutes) || 0;

          // Clock times become money here too, so hours are worth the same in
          // the file as they are on the server.
          if (anyTime && !('minutes' in entry)) {
            const judged = timesToDay(times, { hoursPerDay });
            minutes = judged.minutes;
            if (!('code' in entry) && AUTO_TIME_MARKS.has(code)) {
              if (judged.code) code = judged.code;
              else if (times.in_time) code = 'P';
            }
          }

          /*
           * Why somebody was out, and whether it was allowed - same per-field
           * rule, so "Mark everyone Present" cannot wipe a reason typed that
           * morning. `approved` is three-state: null is "nobody has decided",
           * which is NOT "not approved".
           */
          const reason =
            'reason' in entry ? String(entry.reason ?? '').trim() || null : stored?.reason || null;
          const approved =
            'approved' in entry
              ? entry.approved === null || entry.approved === undefined || entry.approved === ''
                ? null
                : Boolean(entry.approved)
              : stored?.approved === null || stored?.approved === undefined
                ? null
                : Boolean(stored.approved);
          // The uniform check, three-state for the same reason.
          const uniform =
            'uniform' in entry
              ? entry.uniform === null || entry.uniform === undefined || entry.uniform === ''
                ? null
                : Boolean(entry.uniform)
              : stored?.uniform === null || stored?.uniform === undefined
                ? null
                : Boolean(stored.uniform);

          if (code || minutes || anyTime || reason || approved !== null || uniform !== null) {
            const record = {
              period_id: period.id,
              employee_id: employeeId,
              day,
              code,
              minutes,
              ...times,
              reason,
              approved,
              uniform,
            };
            if (index >= 0) db.attendance[index] = record;
            else db.attendance.push(record);
          } else if (index >= 0) {
            db.attendance.splice(index, 1);
          }
        }
        save();
        return { saved: entries.length };
      }
      if (method === 'DELETE') {
        db.attendance = db.attendance.filter((a) => a.period_id !== period.id);
        save();
        return { cleared: true };
      }
    }
  }

  /* ---------------- hiring ---------------- */
  if (parts[0] === 'hiring') {
    const params = new URLSearchParams(path.split('?')[1] || '');
    const what = parts[1];
    const id = Number(parts[2]);

    if (route === 'GET /hiring/config') {
      return {
        stages: STAGES,
        rejected: REJECTED,
        bands: MATCH_BANDS,
        weights: WEIGHTS,
        /*
         * No address, so no apply link and nothing for a test system to post
         * back to. Said as null rather than invented: the screens read these
         * and explain themselves from them.
         */
        public_url: publicBase() || null,
        public_url_reachable: reachablePublicly(publicBase()),
        test_configured: false,
        test_pass_percent: HIRING_DEFAULTS.passPercent,
        test_seconds_per_question: HIRING_DEFAULTS.secondsPerQuestion,
        whatsapp: null,
        offline: true,
      };
    }

    if (route === 'PUT /hiring/public-url') {
      const { url, problem } = cleanPublicUrl(body?.url);
      if (problem) throw new HttpError(400, problem);
      db.settings = { ...(db.settings || {}), public_url: url };
      save();
      return { public_url: url || null, public_url_reachable: reachablePublicly(url) };
    }

    if (route === 'GET /hiring/overview') {
      return {
        ...hiringOverview(),
        upcoming: upcomingInterviews(),
        open_tasks: openTasks(),
        recent: listApplicationRows().slice(0, 12),
      };
    }

    if (route === 'GET /hiring/digest') {
      const day = today();
      return {
        text: hiringDigest({
          interviews: upcomingInterviews().filter((i) => String(i.at).slice(0, 10) === day),
          tasks: openTasks(),
          newApplications: hiringOverview().applications.thisWeek,
        }),
        whatsapp: null,
      };
    }

    /* ---- openings ---- */
    if (what === 'vacancies') {
      if (parts.length === 2 && method === 'GET') {
        const status = params.get('status');
        const companyId = Number(params.get('company_id')) || null;
        const needle = (params.get('q') || '').toLowerCase();
        return {
          vacancies: db.vacancies
            .map(vacancyRow)
            .filter((v) => !status || v.status === status)
            .filter((v) => !companyId || v.company_id === companyId)
            .filter(
              (v) =>
                !needle ||
                [v.title, v.ref_no, v.location, v.skills, v.department]
                  .some((f) => String(f || '').toLowerCase().includes(needle))
            )
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id),
        };
      }

      if (parts.length === 2 && method === 'POST') {
        const values = checkVacancyValues(checkedTestUrl(pick(VACANCY_FIELDS, body)));
        if (!String(values.title || '').trim()) throw new HttpError(400, 'an opening needs a job title');
        // Every opening belongs to one of our own companies - without that
        // there is nobody to put the person on the payroll of later.
        if (!companyOf(Number(values.company_id))) throw new HttpError(400, 'an opening needs a company');
        const vacancy = {
          id: nextId(),
          ref_no: nextHiringRef('vacancies', 'JOB'),
          ...values,
          company_id: Number(values.company_id),
          positions: Number(values.positions) || 1,
          status: values.status || 'draft',
          opened_on: values.opened_on || today(),
          created_at: hiringNow(),
          updated_at: hiringNow(),
        };
        db.vacancies.push(vacancy);
        save();
        return vacancyRow(vacancy);
      }

      const vacancy = vacancyOf(id);
      if (parts.length >= 3 && !vacancy) throw new HttpError(404, 'not found');

      if (parts.length === 3 && method === 'GET') {
        return { vacancy: vacancyRow(vacancy), applications: listApplicationRows({ vacancy_id: vacancy.id }) };
      }
      if (parts.length === 3 && method === 'PATCH') {
        Object.assign(vacancy, checkVacancyValues(checkedTestUrl(pick(VACANCY_FIELDS, body, vacancy))), {
          company_id: body?.company_id === undefined ? vacancy.company_id : Number(body.company_id),
          updated_at: hiringNow(),
        });
        // The requirement changed, so every score measured against the old
        // one is stale.
        rescoreVacancy(vacancy);
        save();
        return vacancyRow(vacancy);
      }
      if (parts.length === 3 && method === 'DELETE') {
        // ON DELETE CASCADE, by hand: the applications on this opening, and
        // the interviews and to-dos hanging off those.
        const gone = new Set(db.applications.filter((a) => a.vacancy_id === vacancy.id).map((a) => a.id));
        db.applications = db.applications.filter((a) => a.vacancy_id !== vacancy.id);
        db.interviews = db.interviews.filter((i) => !gone.has(i.application_id));
        db.hiring_tasks = db.hiring_tasks.filter((t) => t.vacancy_id !== vacancy.id);
        db.vacancies = db.vacancies.filter((v) => v.id !== vacancy.id);
        save();
        return null;
      }

      /* People already on file who are not on this opening yet, best fit
         first - so a new opening starts from the books, not an empty page. */
      if (parts[3] === 'suggestions' && method === 'GET') {
        const on = new Set(
          db.applications.filter((a) => a.vacancy_id === vacancy.id).map((a) => a.candidate_id)
        );
        const limit = Number(params.get('limit')) || 25;
        return {
          suggestions: db.candidates
            .filter((c) => !on.has(c.id))
            .map((candidate) => {
              const { total, factors, missing } = matchScore(candidate, vacancy);
              return { candidate, match_score: total, factors, missing };
            })
            .sort((a, b) => b.match_score - a.match_score)
            .slice(0, limit),
        };
      }

      /*
       * The advert still writes itself - that text is worth having offline,
       * because it gets pasted into WhatsApp and the job boards by hand. The
       * apply LINK does not, and says so instead of being faked.
       */
      if (parts[3] === 'share' && method === 'GET') {
        // vacancyRow, not the stored row: the advert names the company, and
        // the company name only exists on the joined row. A candidate who
        // does not know who is hiring does not turn up.
        const joined = vacancyRow(vacancy);
        const baseUrl = publicBase();
        return {
          public: publicVacancy(joined),
          apply_url: baseUrl ? `${baseUrl}/apply/${joined.ref_no}` : null,
          apply_url_reachable: reachablePublicly(baseUrl),
          broadcast: vacancyBroadcast(joined, { baseUrl }),
          published: vacancy.status === 'published',
          /*
           * `offline` says this FILE cannot answer an apply link, which is a
           * different thing from not knowing the address. Once the address is
           * typed the post is right; what is still missing is the app running
           * at it, and the screen says which of the two is the problem.
           */
          offline: true,
        };
      }
    }

    /* ---- candidates ---- */
    if (what === 'candidates') {
      if (parts.length === 2 && method === 'GET') {
        const needle = (params.get('q') || '').toLowerCase();
        const limit = Number(params.get('limit')) || 500;
        const offset = Number(params.get('offset')) || 0;
        const all = db.candidates
          .filter(
            (c) =>
              !needle ||
              [c.name, c.phone, c.ref_no, c.skills, c.location, c.role]
                .some((f) => String(f || '').toLowerCase().includes(needle))
          )
          .slice()
          .sort((a, b) => b.id - a.id);
        return { rows: all.slice(offset, offset + limit).map(candidateRow), total: all.length };
      }

      if (parts.length === 2 && method === 'POST') {
        const values = pick(CANDIDATE_FIELDS, body);
        if (!String(values.name || '').trim()) throw new HttpError(400, 'a candidate needs a name');
        values.phone = normalisePhone(values.phone);
        if (!values.phone) throw new HttpError(400, 'a candidate needs a mobile number');
        // The mobile number IS the identity - the unique index on the server.
        if (db.candidates.some((c) => c.phone === values.phone)) {
          throw new HttpError(409, 'Somebody with this mobile number is already on file');
        }
        const candidate = {
          id: nextId(),
          ref_no: nextHiringRef('candidates', 'CAN'),
          ...values,
          source: values.source || 'office',
          resume_path: null,
          resume_name: null,
          created_at: hiringNow(),
          updated_at: hiringNow(),
        };
        db.candidates.push(candidate);
        save();
        return candidateRow(candidate);
      }

      const candidate = candidateOf(id);
      if (parts.length >= 3 && !candidate) throw new HttpError(404, 'not found');

      if (parts.length === 3 && method === 'GET') {
        return {
          candidate,
          applications: listApplicationRows({ candidate_id: candidate.id }),
          tests: listTestsFor(candidate.id),
          // No file store, so never a link. Null is what the server sends for
          // somebody with no CV, so the screen already knows how to read it.
          resume: null,
        };
      }
      if (parts.length === 3 && method === 'PATCH') {
        const values = pick(CANDIDATE_FIELDS, body, candidate);
        if (body && 'phone' in body) {
          values.phone = normalisePhone(values.phone);
          if (!values.phone) throw new HttpError(400, 'a candidate needs a mobile number');
          if (db.candidates.some((c) => c.id !== candidate.id && c.phone === values.phone)) {
            throw new HttpError(409, 'Somebody with this mobile number is already on file');
          }
        }
        Object.assign(candidate, values, { updated_at: hiringNow() });
        save();
        return candidateRow(candidate);
      }
      if (parts.length === 3 && method === 'DELETE') {
        const gone = new Set(db.applications.filter((a) => a.candidate_id === candidate.id).map((a) => a.id));
        db.applications = db.applications.filter((a) => a.candidate_id !== candidate.id);
        db.interviews = db.interviews.filter((i) => !gone.has(i.application_id));
        db.tests = db.tests.filter((t) => t.candidate_id !== candidate.id);
        db.hiring_tasks = db.hiring_tasks.filter((t) => t.candidate_id !== candidate.id);
        db.candidates = db.candidates.filter((c) => c.id !== candidate.id);
        save();
        return null;
      }
      if (parts[3] === 'resume') throw new HttpError(400, NO_FILES_OFFLINE);
      if (parts[3] === 'resume-link') throw new HttpError(404, 'no CV on file');
    }

    /* ---- the pipeline ---- */
    if (what === 'applications') {
      if (parts.length === 2 && method === 'GET') {
        const rows = listApplicationRows({
          vacancy_id: Number(params.get('vacancy_id')) || null,
          candidate_id: Number(params.get('candidate_id')) || null,
          company_id: Number(params.get('company_id')) || null,
          stage: params.get('stage'),
          q: params.get('q'),
        });
        const limit = Number(params.get('limit')) || 1000;
        const offset = Number(params.get('offset')) || 0;
        return { rows: rows.slice(offset, offset + limit), total: rows.length };
      }

      /* Putting somebody already on file forward for an opening. */
      if (parts.length === 2 && method === 'POST') {
        const vacancy = vacancyOf(body?.vacancy_id);
        const candidate = candidateOf(body?.candidate_id);
        if (!vacancy) throw new HttpError(400, 'opening not found');
        if (!candidate) throw new HttpError(400, 'candidate not found');
        const already = db.applications.find(
          (a) => a.vacancy_id === vacancy.id && a.candidate_id === candidate.id
        );
        // Pressing submit twice is not a mistake worth shouting about.
        if (already) return { application: applicationRow(already), created: false };

        const at = hiringNow();
        const application = {
          id: nextId(),
          vacancy_id: vacancy.id,
          candidate_id: candidate.id,
          match_score: matchScore(candidate, vacancy).total,
          stage: 'New',
          test_score: null,
          test_status: null,
          offer_salary: null,
          joining_date: null,
          employee_id: null,
          stage_log: [{ stage: 'New', on: at, by: body?.by || body?.source || 'office' }],
          stage_changed_at: at,
          notes: null,
          created_at: at,
        };
        db.applications.push(application);
        save();
        return { application: applicationRow(application), created: true };
      }

      const application = applicationOf(id);
      if (parts.length >= 3 && !application) throw new HttpError(404, 'not found');

      if (parts.length === 3 && method === 'GET') {
        const candidate = candidateOf(application.candidate_id);
        const vacancy = vacancyOf(application.vacancy_id);
        const resolved = testRules(vacancy);
        return {
          application: applicationRow(application),
          // Why it scored what it scored. The number alone is no use to
          // somebody deciding.
          match: matchScore(candidate, vacancy),
          interviews: db.interviews
            .filter((i) => i.application_id === application.id)
            .map(interviewRow)
            .sort((a, b) => String(a.at).localeCompare(String(b.at))),
          tests: listTestsFor(application.candidate_id),
          resume: null,
          test: {
            source: resolved.source,
            pass_percent: resolved.passPercent,
            seconds_per_question: resolved.secondsPerQuestion,
            problem: resolved.problem,
          },
        };
      }

      if (parts.length === 3 && method === 'PATCH') {
        Object.assign(application, pick(APPLICATION_FIELDS, body, application));
        save();
        return applicationRow(application);
      }

      if (parts.length === 3 && method === 'DELETE') {
        db.interviews = db.interviews.filter((i) => i.application_id !== application.id);
        db.hiring_tasks = db.hiring_tasks.filter((t) => t.application_id !== application.id);
        db.applications = db.applications.filter((a) => a.id !== application.id);
        save();
        return null;
      }

      /*
       * The one way an application changes stage. A person chose it: neither
       * the match score nor a test result moves anybody. It comes back with
       * the message to send, because the point of the move is usually that
       * somebody needs telling.
       */
      if (parts[3] === 'stage' && method === 'POST') {
        const stage = body?.stage;
        if (!stage) throw new HttpError(400, 'which stage?');
        if (!ALL_STAGES.includes(stage)) throw new HttpError(400, `unknown stage: ${stage}`);
        if (application.stage !== stage) {
          const at = hiringNow();
          application.stage_log = [
            ...(application.stage_log || []),
            { stage, on: at, by: body?.by || 'office', ...(body?.note ? { note: body.note } : {}) },
          ];
          application.stage = stage;
          application.stage_changed_at = at;
          save();
        }
        const candidate = candidateOf(application.candidate_id);
        const text = stageMessage(stage, {
          candidate,
          vacancy: vacancyOf(application.vacancy_id),
          offer: { salary: application.offer_salary, joining_date: application.joining_date },
        });
        return {
          application: applicationRow(application),
          notify: text ? { text, whatsapp: waLink(candidate.phone, text) } : null,
        };
      }

      /*
       * The handover to payroll, and the whole reason hiring lives inside the
       * HRMS: the person who joins becomes an employee row, so they land on
       * the salary sheet, the attendance grid and the PF/ESI registers without
       * their name being typed a second time.
       *
       * Deliberately its own button, not a side effect of reaching "Joined" -
       * a wrong salary here is a wrong payslip at the end of the month. And
       * hiring the same person twice does not make a second employee.
       */
      if (parts[3] === 'hire' && method === 'POST') {
        if (application.employee_id) {
          return {
            employee: employeeOf(application.employee_id),
            application: applicationRow(application),
            created: false,
          };
        }
        const candidate = candidateOf(application.candidate_id);
        const vacancy = vacancyOf(application.vacancy_id);
        const salary = Number(body?.monthly_salary ?? application.offer_salary) || 0;
        if (salary <= 0) {
          throw new HttpError(400, 'a monthly salary is needed before somebody goes on the payroll');
        }
        const joined = body?.joined_on || application.joining_date || today();
        // The company comes from the OPENING, never from the form.
        const employee = await handle('POST', '/employees', {
          company_id: vacancy.company_id,
          name: candidate.name,
          designation: body?.designation || vacancy.title,
          department: body?.department || vacancy.department || null,
          dob: candidate.dob || null,
          gender: candidate.gender || null,
          phone: candidate.phone,
          email: candidate.email || null,
          address: candidate.location || null,
          monthly_salary: salary,
          joined_on: joined,
          payment_mode: body?.payment_mode || 'Bank',
          cl_quota: Number(body?.cl_quota) || 0,
          sl_quota: Number(body?.sl_quota) || 0,
          pl_quota: Number(body?.pl_quota) || 0,
          pf: Number(body?.pf) || 0,
          esi: Number(body?.esi) || 0,
          code: body?.code || null,
          religion: body?.religion || null,
        });
        application.employee_id = employee.id;
        application.offer_salary = salary;
        application.joining_date = joined;
        save();
        await handle('POST', `/hiring/applications/${application.id}/stage`, {
          stage: 'Joined',
          by: body?.by || 'office',
          note: 'Added to payroll',
        });
        return { employee, application: applicationRow(applicationOf(application.id)), created: true };
      }

      /*
       * A result typed in by hand. The bar is the OPENING's, not the app's,
       * and it is kept ON the result - the opening's pass mark can be edited
       * afterwards, and "passed" with no bar recorded cannot be explained six
       * months later.
       */
      if (parts[3] === 'test' && method === 'POST') {
        const max = Number(body?.max_score) || 0;
        const score = Number(body?.score) || 0;
        const percentage = max > 0 ? Math.round((score / max) * 1000) / 10 : Number(body?.percentage) || 0;
        const rules = testRules(vacancyOf(application.vacancy_id));
        const stated = Number(body?.pass_percent);
        const passPercent = Number.isFinite(stated) && stated > 0 ? stated : rules.passPercent;
        const statedLimit = Number(body?.seconds_per_question);
        const test = {
          id: nextId(),
          candidate_id: application.candidate_id,
          application_id: application.id,
          type: body?.type || 'skills',
          score,
          max_score: max,
          percentage,
          pass_percent: passPercent,
          passed: percentage >= passPercent,
          seconds_per_question:
            Number.isFinite(statedLimit) && statedLimit > 0
              ? Math.round(statedLimit)
              : rules.secondsPerQuestion,
          source: body?.source || 'typed in',
          answers: body?.answers ?? null,
          taken_at: hiringNow(),
        };
        db.tests.push(test);
        // The application carries the latest result so the board can sort on
        // it. The test itself never moves anybody.
        application.test_score = Math.round(percentage);
        application.test_status = test.passed ? 'passed' : 'below threshold';
        save();
        return { test, application: applicationRow(application) };
      }
    }

    /* ---- interviews ---- */
    if (what === 'interviews') {
      if (parts.length === 2 && method === 'GET') {
        const applicationId = Number(params.get('application_id')) || null;
        if (params.get('upcoming') === 'true') return { interviews: upcomingInterviews() };
        return {
          interviews: db.interviews
            .filter((i) => !applicationId || i.application_id === applicationId)
            .map(interviewRow)
            .sort((a, b) => String(a.at).localeCompare(String(b.at))),
        };
      }
      if (parts.length === 2 && method === 'POST') {
        const values = pick(INTERVIEW_FIELDS, body);
        if (!Number(values.application_id)) throw new HttpError(400, 'an interview needs an application');
        if (!values.at) throw new HttpError(400, 'an interview needs a date and time');
        const app = applicationOf(values.application_id);
        if (!app) throw new HttpError(400, 'an interview needs an application');
        const interview = {
          id: nextId(),
          ...values,
          application_id: app.id,
          mode: values.mode || 'in-person',
          round: Number(values.round) || 1,
          status: values.status || 'Scheduled',
          created_at: hiringNow(),
        };
        db.interviews.push(interview);

        // An interview nobody is reminded about is an interview that gets
        // missed, so scheduling one puts it on the office's list for that day.
        const joined = applicationRow(app);
        db.hiring_tasks.push({
          id: nextId(),
          title: `Interview: ${joined.candidate_name} for ${joined.job_title}`,
          due_on: String(interview.at).slice(0, 10),
          priority: 'high',
          status: 'open',
          application_id: app.id,
          candidate_id: app.candidate_id,
          vacancy_id: app.vacancy_id,
          created_at: hiringNow(),
          done_at: null,
        });
        save();

        const candidate = candidateOf(app.candidate_id);
        // Scheduling does NOT move the application - that happens when the
        // candidate confirms.
        const text = stageMessage('Interview', {
          candidate,
          vacancy: vacancyOf(app.vacancy_id),
          interview,
        });
        return {
          interview,
          notify: text ? { text, whatsapp: waLink(candidate.phone, text) } : null,
        };
      }
      const interview = db.interviews.find((i) => i.id === id);
      if (parts.length === 3 && !interview) throw new HttpError(404, 'not found');
      if (parts.length === 3 && method === 'PATCH') {
        Object.assign(interview, pick(INTERVIEW_FIELDS, body, interview));
        save();
        return interview;
      }
      if (parts.length === 3 && method === 'DELETE') {
        db.interviews = db.interviews.filter((i) => i.id !== id);
        save();
        return null;
      }
    }

    /* ---- the office's own list ---- */
    if (what === 'tasks') {
      if (parts.length === 2 && method === 'GET') {
        const status = params.get('status');
        return {
          tasks: db.hiring_tasks
            .filter((t) => !status || t.status === status)
            .map(taskRow)
            .sort((a, b) => {
              if (!a.due_on !== !b.due_on) return a.due_on ? -1 : 1;
              return String(a.due_on || '').localeCompare(String(b.due_on || '')) || b.id - a.id;
            }),
        };
      }
      if (parts.length === 2 && method === 'POST') {
        const values = pick(TASK_FIELDS, body);
        if (!String(values.title || '').trim()) throw new HttpError(400, 'a task needs a title');
        const task = {
          id: nextId(),
          ...values,
          priority: values.priority || 'normal',
          status: values.status || 'open',
          created_at: hiringNow(),
          done_at: null,
        };
        db.hiring_tasks.push(task);
        save();
        return taskRow(task);
      }
      const task = db.hiring_tasks.find((t) => t.id === id);
      if (parts.length === 3 && !task) throw new HttpError(404, 'not found');
      if (parts.length === 3 && method === 'PATCH') {
        Object.assign(task, pick(TASK_FIELDS, body, task));
        if (task.status === 'done' && !task.done_at) task.done_at = hiringNow();
        save();
        return taskRow(task);
      }
      if (parts.length === 3 && method === 'DELETE') {
        db.hiring_tasks = db.hiring_tasks.filter((t) => t.id !== id);
        save();
        return null;
      }
    }
  }

  /* ---------------- People ---------------- */
  if (parts[0] === 'people') {
    const params = new URLSearchParams(path.split('?')[1] || '');
    const what = parts[1];
    const id = Number(parts[2]);
    const by = body?.by || null;

    if (route === 'GET /people/options') {
      return {
        asset_kinds: ASSET_KINDS,
        claim_kinds: CLAIM_KINDS,
        claim_statuses: CLAIM_STATUSES,
        note_kinds: NOTE_KINDS,
        task_priorities: TASK_PRIORITIES,
        ticket_categories: TICKET_CATEGORIES,
        warning_levels: WARNING_LEVELS,
      };
    }

    /* ---- warnings and appreciations ---- */
    if (what === 'notes') {
      if (parts.length === 2 && method === 'GET') {
        const kind = params.get('kind');
        const employeeId = Number(params.get('employee_id')) || null;
        return {
          notes: db.employee_notes
            .filter((n) => !kind || n.kind === kind)
            .filter((n) => !employeeId || n.employee_id === employeeId)
            .map(withPerson)
            .sort((a, b) => String(b.dated).localeCompare(String(a.dated)) || b.id - a.id),
        };
      }
      if (parts.length === 2 && method === 'POST') {
        const employee = employeeOf(body?.employee_id);
        if (!employee) throw new HttpError(400, 'employee not found');
        const subject = String(body?.subject || '').trim();
        if (!subject) throw new HttpError(400, 'say what it is about in a line');
        const kind = NOTE_KINDS.includes(body?.kind) ? body.kind : 'note';
        const note = {
          id: nextId(),
          employee_id: employee.id,
          kind,
          // Only a warning carries a severity: an appreciation has no level.
          severity: kind === 'warning' ? body?.severity || 'verbal' : null,
          // WHAT it was about, which is not how formally it was given.
          category: body?.category || null,
          dated: String(body?.dated || '').trim() || dayNow(),
          subject,
          detail: body?.detail || null,
          issued_by: body?.issued_by || null,
          // A warning the person never saw is not much of a warning.
          acknowledged_on: body?.acknowledged_on || null,
          created_at: stampNow(),
        };
        db.employee_notes.push(note);
        auditLine({
          who: by, action: 'created', entity: 'employee_notes', entity_id: note.id,
          label: `${kind} for ${employee.name}`, note: subject,
        });
        save();
        return withPerson(note);
      }
      const note = db.employee_notes.find((n) => n.id === id);
      if (parts.length === 3 && !note) throw new HttpError(404, 'not found');
      if (parts.length === 3 && method === 'PATCH') {
        for (const key of ['kind', 'severity', 'category', 'dated', 'subject', 'detail', 'issued_by', 'acknowledged_on']) {
          if (key in (body || {})) note[key] = body[key] === '' ? null : body[key];
        }
        auditLine({
          who: by, action: 'changed', entity: 'employee_notes', entity_id: id,
          label: `${note.kind} for ${nameOf(note.employee_id)}`,
        });
        save();
        return withPerson(note);
      }
      if (parts.length === 3 && method === 'DELETE') {
        db.employee_notes = db.employee_notes.filter((n) => n.id !== id);
        auditLine({
          who: by, action: 'deleted', entity: 'employee_notes', entity_id: id,
          label: `${note.kind} for ${nameOf(note.employee_id)}`,
        });
        save();
        return { deleted: true };
      }
    }

    /* ---- appraisals: a proposal until applied ---- */
    if (what === 'appraisals') {
      if (parts.length === 2 && method === 'GET') {
        const pending = params.get('pending') === 'true';
        const cycle = params.get('cycle');
        return {
          appraisals: db.appraisals
            .filter((a) => !pending || !a.applied_at)
            .filter((a) => !cycle || a.cycle === cycle)
            .map((a) => withIncrement({ ...withPerson(a), monthly_salary: employeeOf(a.employee_id)?.monthly_salary }))
            .sort((a, b) => String(b.reviewed_on).localeCompare(String(a.reviewed_on)) || b.id - a.id),
        };
      }
      if (parts.length === 2 && method === 'POST') {
        const employee = employeeOf(body?.employee_id);
        if (!employee) throw new HttpError(400, 'employee not found');
        /*
         * Measured against what they are on NOW unless somebody says
         * otherwise, so an increment can never be worked off a stale figure.
         */
        const from =
          body?.from_salary === undefined
            ? Number(employee.monthly_salary) || 0
            : Number(body.from_salary) || 0;
        const to =
          body?.to_salary === undefined || body?.to_salary === '' ? null : Number(body.to_salary);
        if (to !== null && !(to >= 0)) throw new HttpError(400, 'the new salary must be a number');
        const row = {
          id: nextId(),
          employee_id: employee.id,
          cycle: body?.cycle || null,
          reviewed_on: String(body?.reviewed_on || '').trim() || dayNow(),
          reviewed_by: body?.reviewed_by || null,
          rating: body?.rating || null,
          summary: body?.summary || null,
          from_salary: from,
          to_salary: to,
          effective_from: body?.effective_from || null,
          next_review_on: body?.next_review_on || null,
          applied_at: null,
          created_at: stampNow(),
        };
        db.appraisals.push(row);
        auditLine({
          who: by, action: 'created', entity: 'appraisals', entity_id: row.id,
          label: `appraisal for ${employee.name}`,
        });
        save();
        return withIncrement(withPerson(row));
      }
      const row = db.appraisals.find((a) => a.id === id);
      if (parts.length >= 3 && !row) throw new HttpError(404, 'not found');

      if (parts.length === 3 && method === 'PATCH') {
        if (row.applied_at) throw new HttpError(400, 'this increment has been paid - it stays on the record');
        for (const key of ['cycle', 'reviewed_on', 'reviewed_by', 'rating', 'summary',
                           'from_salary', 'to_salary', 'effective_from', 'next_review_on']) {
          if (key in (body || {})) row[key] = body[key] === '' ? null : body[key];
        }
        save();
        return withIncrement(withPerson(row));
      }
      if (parts.length === 3 && method === 'DELETE') {
        if (row.applied_at) throw new HttpError(400, 'this increment has been paid - it stays on the record');
        db.appraisals = db.appraisals.filter((a) => a.id !== id);
        auditLine({
          who: by, action: 'deleted', entity: 'appraisals', entity_id: id,
          label: `appraisal for ${nameOf(row.employee_id)}`,
        });
        save();
        return { deleted: true };
      }
      /*
       * Applying writes the salary through the normal employee patch, so it
       * lands in the change history like any other rise. Applying twice gives
       * no second rise.
       */
      if (parts[3] === 'apply' && method === 'POST') {
        if (row.applied_at) {
          return {
            appraisal: withIncrement(withPerson(row)),
            employee: employeeOf(row.employee_id),
            applied: false,
          };
        }
        const to = Number(row.to_salary);
        if (!(to > 0)) throw new HttpError(400, 'set the new salary before applying it');
        const employee = await handle('PATCH', `/employees/${row.employee_id}`, {
          monthly_salary: to,
        });
        row.applied_at = stampNow();
        auditLine({
          who: by, action: 'applied', entity: 'appraisals', entity_id: id,
          label: `increment for ${employee.name}`, field: 'monthly_salary',
          from_value: row.from_salary, to_value: to,
        });
        save();
        return { appraisal: withIncrement(withPerson(row)), employee, applied: true };
      }
    }

    /* ---- penalties: fines, losses, damage ---- */
    if (what === 'penalties') {
      /*
       * Word for word the server's two rules: recording one deducts NOTHING,
       * and the law's limits are reported rather than enforced. Records, not
       * files, so they belong in this file as much as anywhere.
       */
      const dress = (pen) => {
        const recoveries = db.penalty_recoveries.filter((r) => r.penalty_id === pen.id);
        const recovered =
          Math.round(recoveries.reduce((t, r) => t + Number(r.amount || 0), 0) * 100) / 100;
        const employee = employeeOf(pen.employee_id);
        const full = {
          ...pen,
          employee_name: employee?.name || null,
          employee_code: employee?.code || null,
          company_name: employee?.company_id ? companyOf(employee.company_id)?.name || null : null,
          recovered,
          recoveries_count: recoveries.length,
          kind_label: penaltyKindLabel(pen.kind),
        };
        return { ...full, outstanding: outstandingOf(full), instalment: instalmentOf(full) };
      };

      if (parts.length === 2 && method === 'GET') {
        const status = params.get('status');
        const employeeId = Number(params.get('employee_id')) || null;
        const penalties = db.penalties
          .filter((x) => !status || x.status === status)
          .filter((x) => !employeeId || x.employee_id === employeeId)
          .map(dress)
          .sort(
            (a, b) =>
              (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) ||
              String(b.happened_on).localeCompare(String(a.happened_on)) ||
              b.id - a.id
          );
        return {
          penalties,
          kinds: PENALTY_KINDS,
          report: penaltyReport(penalties, { from: params.get('from'), to: params.get('to') }),
        };
      }

      if (parts.length === 2 && method === 'POST') {
        const { ok, problems } = validatePenalty(body || {});
        if (!ok) throw new HttpError(400, problems.join('; '));
        const employee = employeeOf(body.employee_id);
        if (!employee) throw new HttpError(400, 'employee not found');
        const pen = {
          id: nextId(),
          employee_id: employee.id,
          kind: String(body.kind),
          amount: Number(body.amount),
          what: String(body.what || '').trim() || null,
          asset_id: Number(body.asset_id) || null,
          note: String(body.note).trim(),
          happened_on: body.happened_on || dayNow(),
          told_on: body.told_on || null,
          acknowledged_on: body.acknowledged_on || null,
          months: Number(body.months) || 1,
          status: 'open',
          waived_note: null,
          raised_by: by || null,
          created_at: stampNow(),
        };
        db.penalties.push(pen);
        auditLine({
          who: by, action: 'created', entity: 'penalties', entity_id: pen.id,
          label: `${penaltyKindLabel(pen.kind)} — ${employee.name}`,
          to_value: pen.amount, note: pen.note,
        });
        save();
        return dress(pen);
      }

      const pen = db.penalties.find((x) => x.id === id);
      if (parts.length >= 3 && !pen) throw new HttpError(404, 'not found');

      if (parts.length === 3 && method === 'GET') {
        return {
          penalty: dress(pen),
          recoveries: db.penalty_recoveries
            .filter((r) => r.penalty_id === pen.id)
            .map((r) => ({ ...r, period_label: periodOf(r.period_id)?.label || null })),
        };
      }

      if (parts.length === 3 && method === 'PATCH') {
        for (const key of ['kind', 'amount', 'what', 'note', 'happened_on', 'told_on', 'acknowledged_on', 'months']) {
          if (key in (body || {})) {
            pen[key] = key === 'amount' || key === 'months' ? Number(body[key]) : body[key] || null;
          }
        }
        save();
        return dress(pen);
      }

      /* What it WOULD do, before anybody does it. */
      if (parts[3] === 'preview' && method === 'GET') {
        const period = periodOf(Number(params.get('period_id')));
        if (!period) throw new HttpError(400, 'pick a month');
        const full = dress(pen);
        const built = buildPayroll(period.id, { sync: false });
        const row = built?.rows.find((r) => r.employee_id === pen.employee_id) || null;
        const wanted = Number(params.get('amount'));
        const take = Math.min(wanted > 0 ? wanted : full.instalment, full.outstanding);
        const already = row
          ? (Number(row.pt) || 0) + (Number(row.pf) || 0) + (Number(row.esi) || 0) +
            (Number(row.loan_deduction) || 0) + (Number(row.deduction) || 0)
          : 0;
        return {
          penalty: full,
          period: { id: period.id, label: period.label, locked: Boolean(period.locked) },
          has_row: Boolean(row),
          amount: take,
          gross: row ? row.gross_salary : null,
          net_now: row ? row.net_salary : null,
          net_after: row ? Math.round(row.net_salary - take) : null,
          other_deductions: Math.round(already),
          ...wageCheck({ amount: take, wages: row ? row.gross_salary : 0, otherDeductions: already, kind: pen.kind }),
        };
      }

      /* The one call that moves money, and it names the month. */
      if (parts[3] === 'recover' && method === 'POST') {
        const full = dress(pen);
        if (pen.status === 'waived') throw new HttpError(400, 'this penalty was waived');
        if (full.outstanding <= 0) throw new HttpError(400, 'this has been recovered in full');
        const period = periodOf(Number(body?.period_id));
        if (!period) throw new HttpError(400, 'pick a month to take it from');
        if (period.locked) throw new HttpError(400, `${period.label} is closed`);
        if (db.penalty_recoveries.some((r) => r.penalty_id === pen.id && r.period_id === period.id)) {
          throw new HttpError(400, `already taken from ${period.label}`);
        }
        syncRows(period.id);
        const row = db.payroll_rows.find(
          (r) => r.period_id === period.id && r.employee_id === pen.employee_id
        );
        if (!row) throw new HttpError(400, `${nameOf(pen.employee_id)} has no row in ${period.label}`);
        const wanted = Number(body?.amount);
        const take = Math.min(wanted > 0 ? wanted : full.instalment, full.outstanding);
        if (!(take > 0)) throw new HttpError(400, 'nothing to take');

        /*
         * The LEDGER, and nothing else. This used to add the money to the
         * row's own deduction column - the box a one-off is typed into - and
         * append the reason to its remark. The recovery is now summed off
         * this table into its own penalty_deduction column, so writing both
         * would take it twice.
         */
        db.penalty_recoveries.push({
          id: nextId(),
          penalty_id: pen.id,
          period_id: period.id,
          amount: take,
          by_whom: by || null,
          in_deduction: 0,
          posted_at: stampNow(),
        });
        if (outstandingOf(dress(pen)) <= 0) pen.status = 'recovered';
        auditLine({
          who: by, action: 'changed', entity: 'penalties', entity_id: pen.id,
          label: `${full.kind_label} — ${full.employee_name}`,
          to_value: take, note: `recovered from ${period.label}: ${pen.note}`,
        });
        save();
        return dress(pen);
      }

      if (parts[3] === 'waive' && method === 'POST') {
        if (pen.status === 'waived') throw new HttpError(400, 'this was already waived');
        if (!String(body?.note || '').trim()) throw new HttpError(400, 'say why it is being waived');
        pen.status = 'waived';
        pen.waived_note = String(body.note).trim();
        auditLine({
          who: by, action: 'changed', entity: 'penalties', entity_id: pen.id,
          label: `${penaltyKindLabel(pen.kind)} — ${nameOf(pen.employee_id)}`,
          from_value: 'open', to_value: 'waived', note: pen.waived_note,
        });
        save();
        return dress(pen);
      }

      if (parts.length === 3 && method === 'PATCH') {
        /*
         * Hold and resume, which is a loan's On hold: a month somebody cannot
         * pay, or a penalty being argued about. Only those two values are
         * settable here - 'recovered' is reached by the ledger adding up and
         * 'waived' is a decision with its own route and its own required
         * reason, so neither may be reachable by a PATCH sent by mistake.
         *
         * Held is NOT waived. The money is still owed and still counted as
         * outstanding; it is simply not being taken this month.
         */
        if ('status' in (body || {})) {
          const want = String(body.status || '').trim();
          if (want !== 'open' && want !== 'held') {
            throw new HttpError(400, 'a penalty can only be put on hold or taken off it here');
          }
          if (pen.status === 'waived') throw new HttpError(400, 'this penalty was waived');
          if (pen.status === 'recovered') throw new HttpError(400, 'this has been recovered in full');
          auditLine({
            who: by, action: 'changed', entity: 'penalties', entity_id: pen.id,
            label: `${penaltyKindLabel(pen.kind)} — ${nameOf(pen.employee_id)}`,
            from_value: pen.status, to_value: want,
          });
          pen.status = want;
        }
        for (const key of ['kind', 'amount', 'what', 'note', 'happened_on', 'told_on', 'acknowledged_on', 'months']) {
          if (!(key in (body || {}))) continue;
          if (key === 'amount' && dress(pen).recovered > Number(body[key])) {
            throw new HttpError(
              400,
              `${dress(pen).recovered} has already come out — it cannot be worth less than that`
            );
          }
          pen[key] =
            key === 'amount' || key === 'months'
              ? Number(body[key]) || (key === 'months' ? 1 : 0)
              : body[key] === '' || body[key] === null
                ? null
                : String(body[key]).trim();
        }
        save();
        return dress(pen);
      }

      if (parts.length === 3 && method === 'DELETE') {
        if (dress(pen).recovered > 0) {
          throw new HttpError(400, 'money has already come out of this — waive it instead, so the record stands');
        }
        db.penalties = db.penalties.filter((x) => x.id !== pen.id);
        auditLine({
          who: by, action: 'deleted', entity: 'penalties', entity_id: pen.id,
          label: `${penaltyKindLabel(pen.kind)} — ${nameOf(pen.employee_id)}`,
        });
        save();
        return { deleted: true };
      }
    }

    /* ---- expense claims ---- */
    if (what === 'claims') {
      const claimOrder = { pending: 0, approved: 1 };
      if (parts.length === 2 && method === 'GET') {
        const status = params.get('status');
        const employeeId = Number(params.get('employee_id')) || null;
        return {
          claims: db.expense_claims
            .filter((c) => !status || c.status === status)
            .filter((c) => !employeeId || c.employee_id === employeeId)
            .map(withPerson)
            .sort(
              (a, b) =>
                (claimOrder[a.status] ?? 2) - (claimOrder[b.status] ?? 2) ||
                String(b.spent_on).localeCompare(String(a.spent_on)) ||
                b.id - a.id
            ),
        };
      }
      if (parts.length === 2 && method === 'POST') {
        const employee = employeeOf(body?.employee_id);
        if (!employee) throw new HttpError(400, 'employee not found');
        const amount = Number(body?.amount);
        if (!(amount > 0)) throw new HttpError(400, 'what did it cost?');
        const claim = {
          id: nextId(),
          employee_id: employee.id,
          kind: body?.kind || 'Other',
          spent_on: String(body?.spent_on || '').trim() || dayNow(),
          amount,
          detail: body?.detail || null,
          status: 'pending',
          decided_by: null,
          decided_at: null,
          decision_note: null,
          paid_period_id: null,
          paid_at: null,
          created_at: stampNow(),
        };
        db.expense_claims.push(claim);
        auditLine({
          who: by || employee.name, action: 'created', entity: 'expense_claims',
          entity_id: claim.id, label: `${claim.kind} claim by ${employee.name}`, to_value: amount,
        });
        save();
        return withPerson(claim);
      }
      const claim = db.expense_claims.find((c) => c.id === id);
      if (parts.length >= 3 && !claim) throw new HttpError(404, 'not found');

      /*
       * A decision is taken ONCE. "Approved then rejected then approved" is
       * not a trail anybody can act on.
       */
      if (parts[3] === 'decide' && method === 'POST') {
        const status = body?.status;
        if (!['approved', 'rejected'].includes(status)) {
          throw new HttpError(400, 'a claim is approved or rejected');
        }
        if (claim.status === 'paid') throw new HttpError(400, 'this claim has already been paid');
        if (claim.status !== 'pending') throw new HttpError(400, `this claim was already ${claim.status}`);
        Object.assign(claim, {
          status,
          decided_by: by || null,
          decided_at: stampNow(),
          decision_note: body?.note || null,
        });
        auditLine({
          who: by, action: status, entity: 'expense_claims', entity_id: id,
          label: `${claim.kind} claim by ${nameOf(claim.employee_id)}`,
          to_value: claim.amount, note: body?.note || null,
        });
        save();
        return withPerson(claim);
      }

      /*
       * Paid through a month's payroll, as an addition on that person's row.
       * Only an approved claim; ADDED to whatever addition is already there
       * rather than replacing it; and never twice, so a double click cannot
       * pay a petrol bill twice.
       */
      if (parts[3] === 'pay' && method === 'POST') {
        if (claim.status === 'paid') throw new HttpError(400, 'this claim has already been paid');
        if (claim.status !== 'approved') throw new HttpError(400, 'approve the claim before paying it');
        const period = periodOf(Number(body?.period_id));
        if (!period) throw new HttpError(400, 'pick a month to pay it in');
        if (period.locked) throw new HttpError(400, `${period.label} is closed`);
        syncRows(period.id);
        const row = db.payroll_rows.find(
          (r) => r.period_id === period.id && r.employee_id === claim.employee_id
        );
        if (!row) throw new HttpError(400, `${nameOf(claim.employee_id)} has no row in ${period.label}`);

        row.addition = (Number(row.addition) || 0) + Number(claim.amount);
        row.adjustment_note = [row.adjustment_note, `${claim.kind} claim ${claim.spent_on}`]
          .filter(Boolean)
          .join('; ');
        Object.assign(claim, { status: 'paid', paid_period_id: period.id, paid_at: stampNow() });
        auditLine({
          who: by, action: 'paid', entity: 'expense_claims', entity_id: id,
          label: `${claim.kind} claim by ${nameOf(claim.employee_id)}`,
          to_value: claim.amount, note: `in ${period.label}`,
        });
        save();
        return withPerson(claim);
      }

      if (parts.length === 3 && method === 'DELETE') {
        if (claim.status === 'paid') throw new HttpError(400, 'a paid claim stays on the record');
        db.expense_claims = db.expense_claims.filter((c) => c.id !== id);
        auditLine({
          who: by, action: 'deleted', entity: 'expense_claims', entity_id: id,
          label: `${claim.kind} claim by ${nameOf(claim.employee_id)}`,
        });
        save();
        return { deleted: true };
      }
    }

    /* ---- office tasks given to staff ---- */
    if (what === 'tasks') {
      const prio = { high: 0, normal: 1, low: 2 };
      if (parts.length === 2 && method === 'GET') {
        const status = params.get('status');
        const employeeId = Number(params.get('employee_id')) || null;
        return {
          tasks: db.staff_tasks
            .filter((t) => !status || t.status === status)
            .filter((t) => !employeeId || t.employee_id === employeeId)
            .map((t) => ({
              ...withPerson(t),
              // Worked out on read, never stored: a date does not become
              // overdue by somebody opening the page.
              overdue: t.status === 'open' && !!t.due_on && t.due_on < dayNow(),
            }))
            .sort(
              (a, b) =>
                (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) ||
                (!a.due_on) - (!b.due_on) ||
                String(a.due_on || '').localeCompare(String(b.due_on || '')) ||
                (prio[a.priority] ?? 1) - (prio[b.priority] ?? 1) ||
                b.id - a.id
            ),
        };
      }
      if (parts.length === 2 && method === 'POST') {
        const title = String(body?.title || '').trim();
        if (!title) throw new HttpError(400, 'what is the task?');
        const employee = body?.employee_id ? employeeOf(body.employee_id) : null;
        if (body?.employee_id && !employee) throw new HttpError(400, 'employee not found');
        const task = {
          id: nextId(),
          employee_id: employee?.id || null,
          title,
          detail: body?.detail || null,
          assigned_by: body?.assigned_by || by || null,
          due_on: body?.due_on || null,
          priority: TASK_PRIORITIES.includes(body?.priority) ? body.priority : 'normal',
          status: 'open',
          done_on: null,
          done_note: null,
          created_at: stampNow(),
        };
        db.staff_tasks.push(task);
        auditLine({
          who: by, action: 'created', entity: 'staff_tasks', entity_id: task.id,
          label: employee ? `task for ${employee.name}` : 'task', note: title,
        });
        save();
        return withPerson(task);
      }
      const task = db.staff_tasks.find((t) => t.id === id);
      if (parts.length >= 3 && !task) throw new HttpError(404, 'not found');

      if (parts.length === 3 && method === 'PATCH') {
        for (const key of ['title', 'detail', 'assigned_by', 'due_on', 'priority', 'employee_id']) {
          if (key in (body || {})) task[key] = body[key] === '' ? null : body[key];
        }
        save();
        return withPerson(task);
      }
      if (parts[3] === 'status' && method === 'POST') {
        const status = body?.status;
        if (!['open', 'done', 'dropped'].includes(status)) {
          throw new HttpError(400, 'a task is open, done or dropped');
        }
        task.status = status;
        task.done_on = status === 'open' ? null : body?.note?.date || dayNow();
        task.done_note = body?.note?.text || (typeof body?.note === 'string' ? body.note : null);
        auditLine({
          who: by,
          action: status === 'done' ? 'done' : status === 'dropped' ? 'dropped' : 'reopened',
          entity: 'staff_tasks', entity_id: id, label: task.title,
          from_value: task.status, to_value: status,
        });
        save();
        return withPerson(task);
      }
      if (parts.length === 3 && method === 'DELETE') {
        // What was asked for and whether it happened IS the record.
        if (task.status === 'done') {
          throw new HttpError(400, 'a task that was done stays on the record — drop it instead');
        }
        db.staff_tasks = db.staff_tasks.filter((t) => t.id !== id);
        auditLine({ who: by, action: 'deleted', entity: 'staff_tasks', entity_id: id, label: task.title });
        save();
        return { deleted: true };
      }
    }

    /* ---- the helpdesk ---- */
    if (what === 'tickets') {
      const order = { open: 0, answered: 1 };
      if (parts.length === 2 && method === 'GET') {
        const status = params.get('status');
        const employeeId = Number(params.get('employee_id')) || null;
        return {
          tickets: db.tickets
            .filter((t) => !status || t.status === status)
            .filter((t) => !employeeId || t.employee_id === employeeId)
            .map(ticketRow)
            .sort(
              (a, b) =>
                (order[a.status] ?? 2) - (order[b.status] ?? 2) ||
                String(b.created_at).localeCompare(String(a.created_at))
            ),
        };
      }
      if (parts.length === 2 && method === 'POST') {
        const employee = employeeOf(body?.employee_id);
        if (!employee) throw new HttpError(400, 'employee not found');
        const subject = String(body?.subject || '').trim();
        if (!subject) throw new HttpError(400, 'say what it is about in a line');
        const ticket = {
          id: nextId(),
          employee_id: employee.id,
          category: body?.category || 'Other',
          subject,
          detail: body?.detail || null,
          status: 'open',
          assigned_to: body?.assigned_to || null,
          priority: TASK_PRIORITIES.includes(body?.priority) ? body.priority : 'normal',
          closed_on: null,
          created_at: stampNow(),
        };
        db.tickets.push(ticket);
        auditLine({
          who: by || employee.name, action: 'created', entity: 'tickets', entity_id: ticket.id,
          label: `${ticket.category} from ${employee.name}`, note: subject,
        });
        save();
        return ticketWithReplies(ticket);
      }
      const ticket = db.tickets.find((t) => t.id === id);
      if (parts.length >= 3 && !ticket) throw new HttpError(404, 'not found');
      if (parts.length === 3 && method === 'GET') return ticketWithReplies(ticket);

      /*
       * Answering is NOT closing: the person who raised it decides whether the
       * answer settled it, and a reply from them puts it back to open.
       */
      if (parts[3] === 'reply' && method === 'POST') {
        const text = String(body?.body || '').trim();
        if (!text) throw new HttpError(400, 'nothing to say?');
        if (ticket.status === 'closed') throw new HttpError(400, 'this one is closed — raise a new one');
        const side = body?.side === 'employee' ? 'employee' : 'office';
        db.ticket_replies.push({
          id: nextId(),
          ticket_id: ticket.id,
          side,
          author: body?.author || null,
          body: text,
          created_at: stampNow(),
        });
        ticket.status = side === 'employee' ? 'open' : 'answered';
        auditLine({
          who: body?.author, action: 'replied', entity: 'tickets', entity_id: id,
          label: `${ticket.category} from ${nameOf(ticket.employee_id)}`,
          note: side === 'employee' ? 'from the employee' : 'from the office',
        });
        save();
        return ticketWithReplies(ticket);
      }
      if (parts[3] === 'close' && method === 'POST') {
        if (ticket.status !== 'closed') {
          ticket.status = 'closed';
          ticket.closed_on = dayNow();
          // A last word is allowed on closing, which a plain reply would
          // refuse once it is closed.
          if (body?.note) {
            db.ticket_replies.push({
              id: nextId(), ticket_id: ticket.id, side: 'office',
              author: by || null, body: String(body.note).trim(), created_at: stampNow(),
            });
          }
          auditLine({
            who: by, action: 'closed', entity: 'tickets', entity_id: id,
            label: `${ticket.category} from ${nameOf(ticket.employee_id)}`,
          });
          save();
        }
        return ticketWithReplies(ticket);
      }
      if (parts[3] === 'reopen' && method === 'POST') {
        ticket.status = 'open';
        ticket.closed_on = null;
        auditLine({
          who: by, action: 'reopened', entity: 'tickets', entity_id: id,
          label: `${ticket.category} from ${nameOf(ticket.employee_id)}`,
        });
        save();
        return ticketWithReplies(ticket);
      }
    }

    /* ---- leaving, and the full and final ---- */
    if (what === 'exits') {
      if (parts.length === 2 && method === 'GET') {
        const settled =
          params.get('settled') === 'true' ? true : params.get('settled') === 'false' ? false : undefined;
        return {
          exits: db.employee_exits
            .filter((x) => settled === undefined || !!x.settled_on === settled)
            .map(exitRow)
            .sort((a, b) =>
              String(b.last_working_day || b.resigned_on || '').localeCompare(
                String(a.last_working_day || a.resigned_on || '')
              ) || b.id - a.id
            ),
        };
      }
      const employeeId = Number(parts[2]);
      if (parts.length === 3 && method === 'GET') {
        const found = fullAndFinalOf(employeeId);
        if (!found) throw new HttpError(404, 'nothing recorded for this person');
        return found;
      }
      if (parts.length === 3 && method === 'PUT') {
        const employee = employeeOf(employeeId);
        if (!employee) throw new HttpError(404, 'employee not found');
        const existing = db.employee_exits.find((x) => x.employee_id === employee.id);
        const pickField = (key, fallback) => (key in (body || {}) ? body[key] || null : fallback ?? null);
        const row = {
          id: existing?.id ?? nextId(),
          employee_id: employee.id,
          type: body?.type || existing?.type || 'resigned',
          resigned_on: pickField('resigned_on', existing?.resigned_on),
          notice_days:
            'notice_days' in (body || {})
              ? body.notice_days === '' ? null : Number(body.notice_days)
              : existing?.notice_days ?? null,
          last_working_day: pickField('last_working_day', existing?.last_working_day),
          reason: pickField('reason', existing?.reason),
          exit_interview: pickField('exit_interview', existing?.exit_interview),
          extras: 'extras' in (body || {}) ? body.extras || [] : existing?.extras || [],
          // The clearance list, kept with the exit because it only exists
          // while somebody is leaving.
          clearance: 'clearance' in (body || {}) ? body.clearance || [] : existing?.clearance || [],
          rules: 'rules' in (body || {}) ? body.rules || {} : existing?.rules || {},
          settled_on: existing?.settled_on ?? null,
          settled_amount: existing?.settled_amount ?? null,
          created_at: existing?.created_at || stampNow(),
        };
        if (existing) Object.assign(existing, row);
        else db.employee_exits.push(row);
        auditLine({
          who: by, action: existing ? 'changed' : 'created', entity: 'employee_exits',
          entity_id: employee.id, label: `exit for ${employee.name}`,
        });
        save();
        return fullAndFinalOf(employee.id);
      }
      if (parts[3] === 'settle' && method === 'POST') {
        const existing = db.employee_exits.find((x) => x.employee_id === employeeId);
        if (!existing) throw new HttpError(404, 'no exit recorded for this person');
        // Settled once, after which the dates stop moving.
        if (existing.settled_on) throw new HttpError(400, 'this settlement has already been paid');
        existing.settled_on = body?.settled_on || dayNow();
        existing.settled_amount = Number(body?.amount) || 0;
        auditLine({
          who: by, action: 'settled', entity: 'employee_exits', entity_id: employeeId,
          label: `full and final for ${nameOf(employeeId)}`, to_value: existing.settled_amount,
        });
        save();
        return fullAndFinalOf(employeeId);
      }
      if (parts.length === 3 && method === 'DELETE') {
        db.employee_exits = db.employee_exits.filter((x) => x.employee_id !== employeeId);
        auditLine({
          who: by, action: 'deleted', entity: 'employee_exits', entity_id: employeeId,
          label: `exit for ${nameOf(employeeId)}`,
        });
        save();
        return { deleted: true };
      }
    }

    /* ---- the trail ---- */
    if (route === 'GET /people/audit') {
      const entity = params.get('entity');
      const entityId = Number(params.get('entity_id')) || null;
      const whoLike = (params.get('who') || '').toLowerCase();
      const since = params.get('since');
      const limit = Math.min(1000, Math.max(1, Number(params.get('limit')) || 200));
      return {
        entries: db.audit_log
          .filter((e) => !entity || e.entity === entity)
          .filter((e) => !entityId || e.entity_id === entityId)
          .filter((e) => !whoLike || String(e.who || '').toLowerCase().includes(whoLike))
          .filter((e) => !since || String(e.at) >= since)
          .sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id - a.id)
          .slice(0, limit),
      };
    }

    /*
     * What to say, not the sending of it. Same module the server runs, so the
     * text is identical; what is missing here is the two lists this file has
     * no table for - attendance correction requests and assets still out with
     * a leaver - and empty is the truthful answer for both, not a guess.
     */
    /* ---- the asset register ---- */
    if (what === 'assets') {
      const assetId = Number(parts[2]);

      if (parts.length === 2 && method === 'GET') {
        const assets = listAssetsOffline({
          employee_id: Number(params.get('employee_id')) || undefined,
          company_id: Number(params.get('company_id')) || undefined,
          out: params.get('out') === 'true',
          written_off: params.get('written_off') === 'true',
          round: params.get('round') || undefined,
        });
        return { assets, totals: registerTotals(assets), kinds: ASSET_KINDS };
      }

      if (parts.length === 2 && method === 'POST') {
        const label = String(body?.label || '').trim();
        if (!label) throw new HttpError(400, 'give the asset a name');
        const companyId = Number(body?.company_id) || null;
        const company = companyId ? companyOf(companyId)?.name || null : null;
        const kind = body?.kind || 'Other';

        /*
         * Typed if somebody typed one - an office with stickers already on
         * the laptops should keep them - and worked out if not. The series
         * reads the HIGHEST number ever used, so a code is never reused.
         */
        let code = null;
        if (body?.code) {
          const problem = codeProblem(body.code);
          if (problem) throw new HttpError(400, problem);
          code = tidyCode(body.code);
          if (db.assets.some((a) => a.code === code)) {
            throw new HttpError(400, `${code} is already on something else`);
          }
        } else {
          code = nextCode(company || 'GEN', kind, assetCodesInUse());
        }

        /*
         * A serial already on the register ASKS rather than refuses, like the
         * duplicate service does: serials get retyped off a sticker and two
         * boxes really do carry the same one.
         */
        const serial = String(body?.identifier || '').trim();
        if (serial && !body?.force) {
          const twin = db.assets.find(
            (a) => String(a.identifier || '').toLowerCase() === serial.toLowerCase()
          );
          if (twin) {
            const clash = new HttpError(
              409,
              `Serial ${serial} is already on ${twin.code || 'another asset'} (${twin.label}). Add it anyway?`
            );
            clash.duplicate = assetRow(twin);
            throw clash;
          }
        }

        const asset = {
          id: nextId(),
          code,
          company_id: companyId,
          branch_id: Number(body?.branch_id) || null,
          kind,
          label,
          identifier: body?.identifier || null,
          purchase_cost: Number(body?.purchase_cost ?? body?.value) || 0,
          purchase_date: body?.purchase_date || null,
          vendor: body?.vendor || null,
          invoice_no: body?.invoice_no || null,
          warranty_until: body?.warranty_until || null,
          warranty_from: body?.warranty_from || null,
          warranty_provider: body?.warranty_provider || null,
          purchase_remarks: body?.purchase_remarks || null,
          brand: body?.brand || null,
          model: body?.model || null,
          description: body?.description || null,
          department: body?.department || null,
          location: body?.location || null,
          floor_room: body?.floor_room || null,
          state: null,
          state_note: null,
          state_since: null,
          amc_until: body?.amc_until || null,
          amc_vendor: body?.amc_vendor || null,
          amc_cost: body?.amc_cost === '' || body?.amc_cost === undefined ? null : Number(body.amc_cost),
          employee_id: Number(body?.employee_id) || null,
          issued_on: body?.issued_on || null,
          returned_on: body?.returned_on || null,
          condition: body?.condition || null,
          note: body?.note || null,
          written_off_on: null,
          written_off_why: null,
          created_at: stampNow(),
        };
        db.assets.push(asset);
        // Added already in somebody's hands: that is a handover, and the log
        // must say so or the history starts with a gap.
        if (asset.employee_id && !asset.returned_on) {
          logHandoverOffline(asset.id, {
            employee_id: asset.employee_id,
            issued_on: asset.issued_on,
            issued_by: body?.by,
            condition_out: asset.condition,
          });
        }
        auditLine({
          who: body?.by, action: 'created', entity: 'assets', entity_id: asset.id,
          label: `${code} ${label}`.trim(),
        });
        save();
        return assetRow(asset);
      }

      /* Scanning a label: the code off a barcode scanner lands here. */
      if (parts[2] === 'by-code' && method === 'GET') {
        const wanted = tidyCode(decodeURIComponent(parts[3] || ''));
        const found = db.assets.find((a) => a.code === wanted);
        if (!found) throw new HttpError(404, `nothing on the register with the code ${parts[3]}`);
        return assetRow(found);
      }

      /*
       * The employee signing for it. On the handover, not the asset: what was
       * agreed was agreed about THAT handover, and the next one is signed
       * again.
       */
      if (parts[2] === 'handovers' && parts[4] === 'acknowledge' && method === 'POST') {
        const row = db.asset_handovers.find((h) => h.id === Number(parts[3]));
        if (!row) throw new HttpError(404, 'not found');
        if (!row.acknowledged_on) {
          row.acknowledged_on = body?.on || dayNow();
          row.acknowledged_by = body?.by || row.employee_name || null;
          auditLine({
            who: body?.by, action: 'acknowledged', entity: 'asset_handovers', entity_id: row.id,
            label: `${row.employee_name || 'somebody'} signed for it`,
          });
          save();
        }
        return handoverRow(row);
      }

      if (parts[2] === 'dashboard' && method === 'GET') {
        const companyId = Number(params.get('company_id')) || undefined;
        const branchId = Number(params.get('branch_id')) || undefined;
        const all = listAssetsOffline({ company_id: companyId, branch_id: branchId, written_off: true });
        const category = params.get('category') || '';
        const year = params.get('year') || '';
        const assets = all
          .filter((a) => !category || a.kind === category)
          .filter((a) => !year || financialYear(a.purchase_date) === year);
        const ids = new Set(assets.map((a) => a.id));
        const rounds = [...new Set(db.asset_verifications.map((v) => v.round))];
        const round = params.get('round') || rounds[rounds.length - 1] || null;
        return {
          ...assetDashboard({
            assets,
            handovers: listHandoversOffline({}).filter((h) => ids.has(h.asset_id)),
            services: listServicesOffline({}).filter((x) => ids.has(x.asset_id)),
            verifications: round
              ? db.asset_verifications
                  .filter((v) => v.round === round)
                  .map((v) => ({ ...v, found: Boolean(v.found) }))
              : [],
            round,
            soon: Number(params.get('soon')) || 30,
          }),
          round,
          years: purchaseYears(all),
          categories: [...new Set(all.map((a) => a.kind).filter(Boolean))].sort(),
        };
      }

      if (parts[2] === 'handovers' && method === 'GET') {
        return {
          handovers: listHandoversOffline({
            asset_id: Number(params.get('asset_id')) || undefined,
            employee_id: Number(params.get('employee_id')) || undefined,
            open: params.get('open') === 'true',
          }),
        };
      }

      /* One person's slip, to print and have signed. */
      if (parts[2] === 'slip' && method === 'GET') {
        const employee = employeeOf(Number(parts[3]));
        if (!employee) throw new HttpError(404, 'employee not found');
        return handoverSlip({
          employee,
          company: companyOf(employee.company_id)?.name || null,
          handovers: listHandoversOffline({ employee_id: employee.id }),
        });
      }

      const asset = assetOf(assetId);
      if (parts.length >= 3 && Number.isFinite(assetId) && !asset) throw new HttpError(404, 'not found');

      if (parts.length === 3 && method === 'PATCH') {
        const before = { ...asset };
        for (const key of ASSET_FIELDS) {
          if (!(key in (body || {}))) continue;
          const value = body[key];
          if (['purchase_cost', 'amc_cost', 'company_id', 'branch_id', 'employee_id'].includes(key)) {
            asset[key] = value === '' || value === null ? null : Number(value);
          } else {
            asset[key] = value === '' ? null : value;
          }
        }
        if (asset.purchase_cost === null) asset.purchase_cost = 0;
        if (body?.code !== undefined) {
          // A typed code is tidied, not rejected - the office already has
          // stickers - but it still cannot be on two things.
          const problem = body.code ? codeProblem(body.code) : null;
          if (problem) throw new HttpError(400, problem);
          const tidy = body.code ? tidyCode(body.code) : null;
          if (tidy && db.assets.some((a) => a.id !== asset.id && a.code === tidy)) {
            throw new HttpError(400, `${tidy} is already on something else`);
          }
          asset.code = tidy;
        }
        auditLine({
          who: body?.by, action: 'changed', entity: 'assets', entity_id: asset.id,
          label: `${asset.code || ''} ${asset.label}`.trim(),
          from_value: before.label, to_value: asset.label,
        });
        save();
        return assetRow(asset);
      }

      if (parts.length === 3 && method === 'DELETE') {
        /*
         * Anything with a HISTORY is written off, not deleted: deleting takes
         * the handovers, the service bills and the stock-take verdicts with
         * it - and frees a code that is printed on a sticker and quoted on a
         * bill. Only an asset nothing has ever happened to can go.
         */
        if (db.asset_handovers.some((h) => h.asset_id === asset.id)) {
          throw new HttpError(
            400,
            'this asset has been issued to somebody - write it off instead of deleting it'
          );
        }
        if (db.asset_services.some((s) => s.asset_id === asset.id)) {
          throw new HttpError(
            400,
            'this asset has a service on its record - write it off instead of deleting it'
          );
        }
        if (db.asset_verifications.some((v) => v.asset_id === asset.id)) {
          throw new HttpError(
            400,
            'this asset has been through a stock take - write it off instead of deleting it'
          );
        }
        db.assets = db.assets.filter((a) => a.id !== asset.id);
        auditLine({
          who: body?.by, action: 'deleted', entity: 'assets', entity_id: asset.id,
          label: `${asset.code || ''} ${asset.label}`.trim(),
        });
        save();
        return { deleted: true };
      }

      if (parts[3] === 'history' && method === 'GET') return assetHistoryOffline(asset.id);

      /*
       * Issuing while it is already out with somebody else CLOSES the first
       * handover rather than losing it - which is what used to happen on the
       * server, and is why asset history had nothing behind it.
       */
      if (parts[3] === 'issue' && method === 'POST') {
        if (asset.written_off_on) throw new HttpError(400, 'that asset is written off');
        // Only an AVAILABLE asset goes out. Passing it straight on from the
        // person holding it is the one exception, handled below.
        if (asset.state && STATE_KEYS.includes(asset.state)) {
          throw new HttpError(400, allocationProblem(assetRow(asset)));
        }
        const employee = employeeOf(body?.employee_id);
        if (!employee) throw new HttpError(400, 'employee not found');
        const open = openHandoverOf(asset.id);
        if (open && open.employee_id === employee.id) return assetRow(asset);
        if (open) {
          open.returned_on = body?.issued_on || dayNow();
          open.returned_by = body?.by || null;
          open.condition_in = 'passed on directly';
        }
        logHandoverOffline(asset.id, {
          employee_id: employee.id,
          issued_on: body?.issued_on || dayNow(),
          issued_by: body?.by,
          condition_out: body?.condition,
          note: body?.note,
          expected_return_on: body?.expected_return_on,
          accessories: body?.accessories,
        });
        asset.employee_id = employee.id;
        asset.issued_on = body?.issued_on || dayNow();
        asset.returned_on = null;
        if (body?.condition) asset.condition = body.condition;
        auditLine({
          who: body?.by, action: 'issued', entity: 'assets', entity_id: asset.id,
          label: `${asset.code || ''} ${asset.label}`.trim(), to_value: employee.name,
        });
        save();
        return assetRow(asset);
      }

      if (parts[3] === 'return' && method === 'POST') {
        returnAssetOffline(asset.id, body || {});
        save();
        return assetRow(asset);
      }

      /*
       * Written off, not deleted: the row and the code stay, because an old
       * service bill and a signed slip still refer to them. Anything still out
       * is brought back first, so nobody is left holding something that no
       * longer exists.
       */
      if (parts[3] === 'write-off' && method === 'POST') {
        if (asset.written_off_on) return assetRow(asset);
        const why = String(body?.why || '').trim();
        if (!why) throw new HttpError(400, 'say why it is being written off');
        if (asset.employee_id && !asset.returned_on) {
          returnAssetOffline(asset.id, {
            returned_on: body?.on || dayNow(),
            condition: 'written off',
            by: body?.by,
          });
        }
        asset.written_off_on = body?.on || dayNow();
        asset.written_off_why = why;
        auditLine({
          who: body?.by, action: 'written off', entity: 'assets', entity_id: asset.id,
          label: `${asset.code || ''} ${asset.label}`.trim(), note: why,
        });
        save();
        return assetRow(asset);
      }

      /* One verdict per asset per round: checking again REPLACES it. */
      if (parts[3] === 'verify' && method === 'POST') {
        const round = String(body?.round || '').trim();
        if (!round) throw new HttpError(400, 'which round is this?');
        const found = body?.found === undefined ? true : Boolean(body.found);
        const existing = db.asset_verifications.find(
          (v) => v.asset_id === asset.id && v.round === round
        );
        const record = {
          id: existing?.id ?? nextId(),
          asset_id: asset.id,
          round,
          found: found ? 1 : 0,
          verified_on: body?.on || dayNow(),
          verified_by: body?.by || null,
          held_by: employeeOf(asset.employee_id)?.name || null,
          note: body?.note || null,
          created_at: existing?.created_at || stampNow(),
        };
        if (existing) Object.assign(existing, record);
        else db.asset_verifications.push(record);
        auditLine({
          who: body?.by, action: found ? 'verified' : 'not found', entity: 'assets',
          entity_id: asset.id, label: `${asset.code || ''} ${asset.label}`.trim(), note: round,
        });
        save();
        return assetRow(asset);
      }

      /*
       * Under maintenance, damaged, missing - or back in use. Its own call
       * rather than a field on the form, because it is a decision somebody
       * takes about the thing and belongs on the trail with a date.
       */
      if (parts[3] === 'state' && method === 'POST') {
        if (asset.written_off_on) throw new HttpError(400, 'that asset is written off');
        const wanted = String(body?.state || '').trim();
        const next = wanted && wanted !== 'available' ? wanted : null;
        if (next && !STATE_KEYS.includes(next)) {
          throw new HttpError(400, `a state is one of ${STATE_KEYS.join(', ')}, or blank for none`);
        }
        if (next !== asset.state) {
          auditLine({
            who: body?.by, action: next || 'back in use', entity: 'assets', entity_id: asset.id,
            label: `${asset.code || ''} ${asset.label}`.trim(),
            from_value: asset.state || 'in use', to_value: next || 'in use',
            note: body?.note || null,
          });
          asset.state = next;
          asset.state_note = next ? body?.note || null : null;
          asset.state_since = next ? body?.on || dayNow() : null;
          save();
        }
        return assetRow(asset);
      }

      /* A photograph is a file. Refused honestly rather than half-working. */
      if (parts[3] === 'photos') {
        if (method === 'GET') return { photos: [] };
        throw new HttpError(400, NO_PHOTOS_OFFLINE);
      }

      /*
       * So is an invoice. The invoice NUMBER and date are on the asset and do
       * work here - it is only the scan that cannot live inside an HTML page.
       */
      if (parts[3] === 'documents') {
        if (method === 'GET') return { documents: [], kinds: ASSET_DOC_KINDS };
        throw new HttpError(
          400,
          'Attaching the invoice needs the server version — a PDF is a file, and a file cannot ' +
            'live inside this HTML page. The invoice number and date are on the asset and do work here.'
        );
      }

      /*
       * The duplicate check ASKS rather than refuses: two identical repairs on
       * one day do happen, and a system that will not record the truth gets
       * worked around. 409 carrying the row it resembles.
       */
      if (parts[3] === 'services' && method === 'POST') {
        const on = String(body?.serviced_on || '').trim() || dayNow();
        const cost = Number(body?.cost) || 0;
        if (cost < 0) throw new HttpError(400, 'a cost is not a negative number');
        if (!body?.force) {
          const twin = looksDuplicate({ serviced_on: on, cost }, listServicesOffline({ asset_id: asset.id }));
          if (twin) {
            const err = new HttpError(
              409,
              `${asset.code} already has a ${
                cost ? `₹${Math.round(cost).toLocaleString('en-IN')}` : 'no-cost'
              } service on ${on}${twin.work ? ` (${twin.work})` : ''}. Add it anyway?`
            );
            err.duplicate = twin;
            throw err;
          }
        }
        const service = {
          id: nextId(),
          asset_id: asset.id,
          serviced_on: on,
          kind: body?.kind || 'Service',
          work: body?.work || null,
          vendor: body?.vendor || null,
          invoice_no: body?.invoice_no || null,
          cost,
          under_warranty: body?.under_warranty ? 1 : 0,
          // Never computed - only what the person doing the work said. No
          // date means not scheduled, never overdue.
          next_service_on: body?.next_service_on || null,
          note: body?.note || null,
          logged_by: body?.by || null,
          created_at: stampNow(),
        };
        db.asset_services.push(service);
        auditLine({
          who: body?.by, action: 'serviced', entity: 'assets', entity_id: asset.id,
          label: `${asset.code || ''} ${asset.label}`.trim(),
          to_value: cost || null, note: body?.work || null,
        });
        save();
        return serviceRow(service);
      }
    }

    /* ---- the lists behind the pickers ---- */
    if (what === 'asset-masters') {
      const withParent = (m) => ({
        ...m,
        parent_name: m.parent_id ? db.asset_masters.find((x) => x.id === m.parent_id)?.name || null : null,
      });
      if (parts.length === 2 && method === 'GET') {
        const kind = params.get('kind');
        return {
          masters: db.asset_masters
            .filter((m) => !kind || m.kind === kind)
            .map(withParent)
            .sort(
              (a, b) =>
                String(a.kind).localeCompare(String(b.kind)) ||
                (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
                String(a.name).localeCompare(String(b.name))
            ),
          kinds: MASTER_KINDS,
        };
      }
      if (parts.length === 2 && method === 'POST') {
        const kind = String(body?.kind || '').trim();
        if (!MASTER_KINDS.includes(kind)) {
          throw new HttpError(400, `a master is one of ${MASTER_KINDS.join(', ')}`);
        }
        const name = String(body?.name || '').trim();
        if (!name) throw new HttpError(400, 'give it a name');
        // A type under no category is a type of nothing.
        const parentId = kind === 'type' ? Number(body?.parent_id) || null : null;
        if (kind === 'type' && !parentId) throw new HttpError(400, 'which category is this a type of?');
        if (db.asset_masters.some(
          (m) => m.kind === kind && (m.parent_id || 0) === (parentId || 0) && m.name === name
        )) {
          throw new HttpError(400, `${name} is already on the list`);
        }
        const row = {
          id: nextId(),
          kind,
          name,
          parent_id: parentId,
          note: body?.note || null,
          active: 1,
          sort_order: Number(body?.sort_order) || 0,
          // Only a vendor is somebody you ring up; a brand has no phone.
          ...Object.fromEntries(
            VENDOR_FIELDS.map((f) => [f, kind === 'vendor' ? body?.[f] || null : null])
          ),
          created_at: stampNow(),
        };
        db.asset_masters.push(row);
        save();
        return withParent(row);
      }
      const master = db.asset_masters.find((m) => m.id === id);
      if (parts.length === 3 && !master) throw new HttpError(404, 'not found');
      if (parts.length === 3 && method === 'PATCH') {
        if ('name' in (body || {})) master.name = String(body.name || '').trim() || master.name;
        if ('note' in (body || {})) master.note = body.note || null;
        if ('active' in (body || {})) master.active = body.active ? 1 : 0;
        if ('sort_order' in (body || {})) master.sort_order = Number(body.sort_order) || 0;
        if (master.kind === 'vendor') {
          for (const f of VENDOR_FIELDS) if (f in (body || {})) master[f] = body[f] || null;
        }
        save();
        return withParent(master);
      }
      if (parts.length === 3 && method === 'DELETE') {
        /*
         * Taking a name off the list does NOT touch the assets carrying it:
         * an asset stores the name as text, so an old laptop keeps saying
         * "Dell" after Dell comes off the vendor list. A master is there to
         * make typing easy, not a key that can rewrite history.
         */
        db.asset_masters = db.asset_masters.filter((m) => m.id !== master.id && m.parent_id !== master.id);
        save();
        return { deleted: true };
      }
    }

    /* ---- maintenance ---- */
    if (what === 'maintenance') {
      if (parts.length === 2 && method === 'GET') {
        const companyId = Number(params.get('company_id')) || undefined;
        const assets = assetsWithOwnershipOffline({ company_id: companyId, written_off: true });
        return {
          assets,
          totals: maintenanceTotals(assets),
          alerts: maintenanceAlerts(assets),
          spend: spendReport(assets, listServicesOffline({ company_id: companyId }), {
            year: params.get('year') || 'all',
          }),
          kinds: SERVICE_KINDS,
        };
      }
      if (parts[2] === 'services' && parts.length === 3 && method === 'GET') {
        return {
          services: listServicesOffline({
            asset_id: Number(params.get('asset_id')) || undefined,
            company_id: Number(params.get('company_id')) || undefined,
            from: params.get('from') || undefined,
            to: params.get('to') || undefined,
          }),
        };
      }
      if (parts[2] === 'services' && parts[3]) {
        const service = db.asset_services.find((s) => s.id === Number(parts[3]));
        if (!service) throw new HttpError(404, 'not found');
        if (method === 'PATCH') {
          for (const key of ['serviced_on', 'kind', 'work', 'vendor', 'invoice_no', 'cost',
                             'under_warranty', 'next_service_on', 'note']) {
            if (!(key in (body || {}))) continue;
            if (key === 'cost') service.cost = Number(body.cost) || 0;
            else if (key === 'under_warranty') service.under_warranty = body.under_warranty ? 1 : 0;
            else service[key] = body[key] === '' ? null : body[key];
          }
          save();
          return serviceRow(service);
        }
        if (method === 'DELETE') {
          db.asset_services = db.asset_services.filter((s) => s.id !== service.id);
          save();
          return { deleted: true };
        }
      }
    }

    /* ---- the stock take ---- */
    if (what === 'rounds') {
      if (parts.length === 2 && method === 'GET') {
        const byRound = new Map();
        for (const v of db.asset_verifications) {
          const seen = byRound.get(v.round) || {
            round: v.round, checked: 0, found: 0, started: v.verified_on, last: v.verified_on,
          };
          seen.checked += 1;
          seen.found += v.found ? 1 : 0;
          if (String(v.verified_on) < String(seen.started)) seen.started = v.verified_on;
          if (String(v.verified_on) > String(seen.last)) seen.last = v.verified_on;
          byRound.set(v.round, seen);
        }
        return {
          rounds: [...byRound.values()]
            .map((r) => ({ ...r, missing: r.checked - r.found }))
            .sort((a, b) => String(b.last).localeCompare(String(a.last))),
        };
      }
      if (parts.length === 3 && method === 'GET') {
        return roundProgressOffline(decodeURIComponent(parts[2]));
      }
    }

    if (route === 'GET /people/digest') {
      const wanted =
        Number(params.get('period_id')) ||
        db.periods.find((p) => !p.locked)?.id ||
        db.periods[0]?.id;
      const payroll = wanted ? buildPayroll(wanted, { sync: false }) : null;
      /*
       * Three dates the office is meant to remember: probation ending, a
       * document running out, a review falling due. Only the LATEST review
       * per person carries a live date - an older one superseded by a newer
       * would read as a second appraisal due.
       */
      const newestReview = new Map();
      for (const a of db.appraisals) {
        const seen = newestReview.get(a.employee_id);
        if (!seen || String(a.reviewed_on) > String(seen.reviewed_on)) newestReview.set(a.employee_id, a);
      }
      return digest({
        period: payroll?.period || null,
        rows: payroll?.rows || [],
        requests: [],
        claims: db.expense_claims.map(withPerson),
        tickets: db.tickets.map(ticketRow),
        tasks: db.staff_tasks.filter((t) => t.status === 'open').map(withPerson),
        exits: db.employee_exits.filter((x) => !x.settled_on).map(exitRow),
        assets_out: [],
        employees: db.employees,
        // No document store in this file, so nothing is claimed to expire.
        documents: [],
        appraisals: [...newestReview.values()].map(withPerson),
        today: dayNow(),
      });
    }
  }

  throw new HttpError(404, `not available offline: ${route}`);
}

/* ---------------- file in, file out ---------------- */

export async function upload(path, formData) {
  const file = formData.get('file');
  const buffer = await file.arrayBuffer();

  if (path === '/import/sheets') return { sheets: await listSheetNames(ExcelJS, buffer) };

  if (path === '/punches/read') {
    const read = await readPunchFile(ExcelJS, buffer, {
      sheetName: formData.get('sheet') || undefined,
      headerRow: formData.get('header_row') || undefined,
    });
    if (read.error) throw new Error(read.error);
    return {
      sheet: read.sheet,
      sheets: read.sheets,
      headerRow: read.headerRow,
      headers: read.headers,
      sampleRows: read.rows.slice(0, 8).map((r) => r.values),
      rowCount: read.rows.length,
    };
  }

  const punchTarget = path.match(/^\/periods\/(\d+)\/punches$/);
  if (punchTarget) {
    const db = load();
    const period = periodOf(Number(punchTarget[1]));
    if (!period) throw new Error('period not found');
    if (period.locked) throw new Error('period is locked');

    const mapping = JSON.parse(formData.get('mapping') || '{}');
    const rules = JSON.parse(formData.get('rules') || '{}');
    if (!mapping.employee || !mapping.date) {
      throw new Error('say which column holds the employee and which the date');
    }

    const read = await readPunchFile(ExcelJS, buffer, {
      sheetName: formData.get('sheet') || undefined,
      headerRow: formData.get('header_row') || undefined,
    });
    if (read.error) throw new Error(read.error);

    const result = punchesToMarks({
      rows: read.rows,
      mapping,
      rules,
      employees: db.employees,
      period,
    });

    const dryRun = String(formData.get('dry_run')) === 'true';
    if (!dryRun) {
      syncRows(period.id);
      for (const entry of result.entries) {
        const index = db.attendance.findIndex(
          (a) => a.period_id === period.id && a.employee_id === entry.employee_id && a.day === entry.day
        );
        // The machine is authoritative for the mark, the minutes and the in and
        // out times; anything it does not carry (a typed lunch) stays.
        const record = { ...(index >= 0 ? db.attendance[index] : {}), period_id: period.id, ...entry };
        if (index >= 0) db.attendance[index] = record;
        else db.attendance.push(record);
      }
      save();
    }
    return { ...result, dryRun, written: dryRun ? 0 : result.entries.length };
  }

  if (path === '/import') {
    const read = await parseSheet(ExcelJS, buffer, { sheetName: formData.get('sheet') || undefined });
    if (read.error) throw new Error(read.error);
    const { sheet, parsed, skipped } = read;

    if (String(formData.get('dry_run')) === 'true') {
      return { sheet, dryRun: true, parsed: parsed.length, skipped, preview: parsed.slice(0, 15) };
    }

    const db = load();
    const periodId = Number(formData.get('period_id')) || null;
    let created = 0;
    let updated = 0;
    const marks = [];
    const written = [];

    parsed.forEach((item, index) => {
      let company = db.companies.find((c) => c.name.toLowerCase() === item.company.trim().toLowerCase());
      if (!company) {
        company = { id: nextId(), name: item.company.trim(), sort_order: index };
        db.companies.push(company);
      }
      let employee = db.employees.find(
        (e) => e.company_id === company.id && e.name.trim().toLowerCase() === item.name.trim().toLowerCase()
      );
      if (employee) {
        Object.assign(employee, { monthly_salary: item.salary, esi: item.esi, pf: item.pf });
        updated++;
      } else {
        employee = {
          id: nextId(),
          company_id: company.id,
          code: null,
          name: item.name,
          designation: null,
          religion: null,
          monthly_salary: item.salary,
          pf: item.pf,
          esi: item.esi,
          payment_mode: item.payment_mode || 'Bank',
          joined_on: null,
          left_on: null,
          active: 1,
          sort_order: index,
        };
        db.employees.push(employee);
        created++;
      }
      for (const [day, code] of Object.entries(item.attendance)) {
        marks.push({ employee_id: employee.id, day: Number(day), code });
      }
      written.push({ employee, item });
    });

    let rowsWritten = 0;
    if (periodId) {
      syncRows(periodId);
      for (const mark of marks) {
        const index = db.attendance.findIndex(
          (a) => a.period_id === periodId && a.employee_id === mark.employee_id && a.day === mark.day
        );
        const record = { period_id: periodId, ...mark, minutes: 0 };
        if (index >= 0) db.attendance[index] = record;
        else db.attendance.push(record);
      }
      for (const { employee, item } of written) {
        const row = db.payroll_rows.find((r) => r.period_id === periodId && r.employee_id === employee.id);
        if (!row) continue;
        const hasMarks = Object.keys(item.attendance).length > 0;
        Object.assign(row, {
          salary: item.salary,
          absent_days_override: hasMarks ? null : item.absent,
          sundays_override: hasMarks ? null : item.sundays,
          ot_minutes_override: item.ot_minutes || null,
          ot_amount_override: !item.ot_minutes && item.ot_amount ? item.ot_amount : null,
          addition: Math.max(item.adjustment, 0),
          deduction: Math.max(-item.adjustment, 0),
          esi: item.esi,
          pf: item.pf,
          payment_mode: item.payment_mode || row.payment_mode,
        });
        rowsWritten++;
      }
    }
    save();
    return { sheet, parsed: parsed.length, skipped, created, updated, rowsWritten, attendanceMarks: marks.length };
  }

  /* the machine's Monthly Status report */
  const monthly = path.match(/^\/periods\/(\d+)\/monthly-status$/);
  if (monthly) {
    const db = load();
    const period = periodOf(Number(monthly[1]));
    if (!period) throw new HttpError(404, 'period not found');
    if (period.locked) throw new HttpError(409, 'period is locked');

    // ExcelJS cannot open the legacy .xls these machines still export. Saying
    // so beats failing with something about a corrupt zip.
    if (isLegacyXls(new Uint8Array(buffer))) {
      throw new Error(
        'This is an old .xls file, which this single-file version cannot open. ' +
          'Open it in Excel and save it as .xlsx, then try again.'
      );
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheets = readMonthlyStatus(sheetsFromExcelJS(wb));
    if (sheets.every((sheet) => sheet.error)) {
      throw new Error('no day-by-day grid was found in that file');
    }

    const existing = {};
    for (const row of db.attendance.filter((a) => a.period_id === period.id)) {
      if (row.code) existing[`${row.employee_id}:${row.day}`] = row.code;
    }

    const result = monthlyStatusToMarks({
      sheets,
      employees: db.employees,
      period,
      markMap: { ...DEFAULT_MARK_MAP, ...JSON.parse(formData.get('mark_map') || '{}') },
      includeEmptyDays: formData.get('include_empty_days') === 'true',
      onlyBlank: formData.get('only_blank') === 'true',
      existing,
    });

    const dryRun = formData.get('dry_run') === 'true';
    if (!dryRun && result.entries.length) {
      syncRows(period.id);
      for (const entry of result.entries) {
        const index = db.attendance.findIndex(
          (a) => a.period_id === period.id && a.employee_id === entry.employee_id && a.day === entry.day
        );
        // Only the mark comes from this report. Hours somebody typed on the
        // Time tab are not in it and must survive.
        const record = { ...(index >= 0 ? db.attendance[index] : {}), period_id: period.id, ...entry };
        if (index >= 0) db.attendance[index] = record;
        else db.attendance.push(record);
      }
      save();
    }

    return {
      ...result,
      entries: undefined,
      months: sheets.filter((sheet) => !sheet.error).map((sheet) => ({
        sheet: sheet.name,
        month: sheet.month,
        year: sheet.year,
      })),
      period: { month: period.month, year: period.year },
      dryRun,
      written: dryRun ? 0 : result.entries.length,
    };
  }

  throw new Error(`not available offline: ${path}`);
}

/** Builds the download in the browser and hands back a Blob. */
/**
 * Pages the browser opens in a new tab: an asset label, a sheet of them, and
 * the voucher. On the server these are routes; here they are built from the
 * SAME shared module and handed over as a blob, so a sticker printed from the
 * single file is the sticker printed from the server.
 *
 * The QR carries the bare code rather than a link: this file has no address,
 * so a URL in it would scan to nothing. The caption is the code either way,
 * which is what somebody reads off a laptop lid.
 */
export function page(path) {
  const clean = path.split('?')[0];
  const params = new URLSearchParams(path.split('?')[1] || '');

  const one = clean.match(/^\/people\/assets\/(\d+)\/label\.svg$/);
  if (one) {
    const asset = assetOf(Number(one[1]));
    if (!asset) throw new HttpError(404, 'not found');
    const { svg, problem, status } = labelSvg(assetRow(asset), {
      qr,
      as: params.get('as') || 'qr',
      heightMm: params.get('h'),
      sizeMm: params.get('mm'),
      link: asset.code,
    });
    if (problem) throw new HttpError(status || 400, problem);
    return { body: svg, type: 'image/svg+xml' };
  }

  if (clean === '/people/assets/labels.html') {
    const ids = String(params.get('ids') || '')
      .split(',')
      .map(Number)
      .filter(Boolean);
    const assets = ids.length
      ? ids.map((id) => assetRow(assetOf(id))).filter(Boolean)
      : listAssetsOffline({ company_id: Number(params.get('company_id')) || undefined });
    return {
      body: labelSheet(assets, {
        qr,
        mm: params.get('mm'),
        as: params.get('as'),
        linkFor: (a) => a.code,
      }),
      type: 'text/html',
    };
  }

  const vouch = clean.match(/^\/people\/assets\/(\d+)\/voucher\.html$/);
  if (vouch) {
    const asset = assetOf(Number(vouch[1]));
    if (!asset) throw new HttpError(404, 'not found');
    return { body: voucherHtml(assetRow(asset), { qr, link: asset.code }), type: 'text/html' };
  }

  throw new HttpError(404, `not available offline: ${path}`);
}

export async function file(path) {
  const registerPath = path.match(/^\/periods\/(\d+)\/statutory\/(pf|esi|pt|wages)\.csv$/);
  if (registerPath) {
    const payroll = buildPayroll(Number(registerPath[1]));
    if (!payroll) throw new Error('period not found');
    const report = statutoryReport(payroll);
    const which = registerPath[2];
    const rows = which === 'pt' ? report.pt.rows : which === 'wages' ? report.wages : report[which].rows;
    return new Blob([toCsv(CSV_COLUMNS[which], rows)], { type: 'text/csv;charset=utf-8' });
  }

  /*
   * Hiring's two exports. The CV itself is never in one - a spreadsheet of
   * strangers' resumes is exactly the file that gets forwarded by mistake -
   * so the candidates export carries "yes"/"" and nothing more.
   */
  /* The asset register's four downloads. */
  const assetCsv = path.split('?')[0].match(
    /^\/people\/(assets\/register|assets\/handovers|maintenance\/services|maintenance\/ownership)\.csv$/
  );
  if (assetCsv) {
    const params = new URLSearchParams(path.split('?')[1] || '');
    const companyId = Number(params.get('company_id')) || undefined;
    const which = assetCsv[1];
    let body;
    if (which === 'assets/register') {
      body = registerCsv(
        listAssetsOffline({ company_id: companyId, written_off: params.get('written_off') === 'true' })
      );
    } else if (which === 'assets/handovers') {
      body = handoverCsv(
        listHandoversOffline({
          employee_id: Number(params.get('employee_id')) || undefined,
          open: params.get('open') === 'true',
        })
      );
    } else if (which === 'maintenance/services') {
      body = servicesCsv(
        listServicesOffline({
          company_id: companyId,
          from: params.get('from') || undefined,
          to: params.get('to') || undefined,
        })
      );
    } else {
      body = ownershipCsv(assetsWithOwnershipOffline({ company_id: companyId, written_off: true }));
    }
    return new Blob([body], { type: 'text/csv;charset=utf-8' });
  }

  const hiringExport = path.split('?')[0].match(/^\/hiring\/export\/(pipeline|candidates)\.csv$/);
  if (hiringExport) {
    const params = new URLSearchParams(path.split('?')[1] || '');
    const which = hiringExport[1];
    const body =
      which === 'pipeline'
        ? hiringCsv(
            HIRING_CSV.pipeline,
            (await handle('GET', `/hiring/applications?limit=100000${
              params.get('vacancy_id') ? `&vacancy_id=${params.get('vacancy_id')}` : ''
            }${params.get('stage') ? `&stage=${encodeURIComponent(params.get('stage'))}` : ''}`)).rows
          )
        : hiringCsv(
            HIRING_CSV.candidates,
            (await handle('GET', `/hiring/candidates?limit=100000${
              params.get('q') ? `&q=${encodeURIComponent(params.get('q'))}` : ''
            }`)).rows.map((r) => ({ ...r, has_resume: r.resume_path ? 'yes' : '' }))
          );
    return new Blob([body], { type: 'text/csv;charset=utf-8' });
  }

  const match = path.match(/^\/periods\/(\d+)\/(pack\.xlsx|export\.xlsx|export\.csv|bank\.csv|sunday\.csv)$/);
  if (!match) throw new Error(`not available offline: ${path}`);
  const payroll = buildPayroll(Number(match[1]));
  if (!payroll) throw new Error('period not found');

  if (match[2] === 'pack.xlsx') {
    const wb = await buildMonthlyPack(ExcelJS, payroll, {
      holidays: load().holidays.filter((h) => h.period_id === payroll.period.id),
    });
    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  if (match[2] === 'export.xlsx') {
    const wb = await buildWorkbook(ExcelJS, payroll);
    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  if (match[2] === 'sunday.csv') {
    const lines = ['Company,Employee,Dates,Days,Day Rate,Amount,Paid By,Status'];
    for (const row of payroll.rows.filter((r) => r.sundays_worked > 0)) {
      lines.push(
        [
          row.company_name,
          row.employee_name,
          (row.sunday_days || []).join(' '),
          row.sundays_worked,
          row.per_day,
          row.sunday_salary,
          row.sunday_mode || '',
          row.sunday_status || 'pending',
        ]
          .map(escape)
          .join(',')
      );
    }
    return new Blob([`\ufeff${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
  }

  if (match[2] === 'bank.csv') {
    const lines = ['Company,Employee,Mode,Amount'];
    for (const row of payroll.rows.filter((r) => r.final_payable > 0 && r.status !== 'paid')) {
      lines.push([row.company_name, row.employee_name, row.payment_mode || '', row.final_payable].map(escape).join(','));
    }
    return new Blob([`﻿${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
  }

  const columns = [
    ['Company', 'company_name'], ['Employee', 'employee_name'], ['Working Days', 'working_days'],
    ['Sunday', 'sundays_worked'], ['Absent Days', 'absent_days'], ['Present Days', 'present_days'],
    ['Salary', 'salary'], ['Salary/Day', 'per_day'], ['Absent Salary', 'absent_salary'],
    ['Hours Worked', 'worked_hours'], ['OT/LT Minutes', 'ot_minutes'], ['OT/LT Salary', 'ot_salary'],
    ['Addition', 'addition'], ['Deduction', 'deduction'],
    ['Late Mins', 'late_minutes'], ['Early Mins', 'early_minutes'],
    ['Late/Early Charged', 'late_salary'],
    ['Gross Salary', 'gross_salary'], ['PT', 'pt'], ['ESI', 'esi'], ['PF', 'pf'],
    ['Loan', 'loan_deduction'],
    ['Penalty', 'penalty_deduction'],
    ['Net Payable', 'net_salary'],
    ['Mode', 'payment_mode'], ['Status', 'status'],
  ];
  const lines = [columns.map(([label]) => label).join(',')];
  const withHours = payroll.rows.map((row) => ({
    ...row,
    worked_hours: Math.round(((row.worked_minutes || 0) / 60) * 100) / 100,
  }));
  for (const row of withHours) lines.push(columns.map(([, key]) => escape(row[key])).join(','));
  return new Blob([`﻿${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
}

/** Whole-store backup and restore, since there is no server holding the data. */
export const backup = () => JSON.stringify(load(), null, 2);

export function restore(json) {
  const data = JSON.parse(json);
  for (const key of ['companies', 'employees', 'periods', 'payroll_rows', 'attendance']) {
    if (!Array.isArray(data[key])) throw new Error(`that file is missing "${key}"`);
  }
  cache = { ...EMPTY, ...data };
  save();
}

/**
 * Empty it. Everything, back to nothing.
 *
 * `EMPTY`, not `freshStore()`: the seeded staff list is baked into THIS file,
 * so starting from the seed would put all eighty-five of them straight back
 * and read as if the erase had failed. Somebody asking for empty means empty.
 *
 * There is no undo. The backup taken beside it is the only way back, which is
 * why the button asks for it first.
 */
export function eraseEverything() {
  cache = structuredClone(EMPTY);
  save();
  return { erased: true };
}
