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
import { WEIGHTS, matchScore } from '../../shared/match.js';
import { checkTestUrl, testFor } from '../../shared/hiringTest.js';
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

const KEY = 'salary-app-data-v1';

const EMPTY = {
  companies: [],
  employees: [],
  periods: [],
  payroll_rows: [],
  attendance: [], // { period_id, employee_id, day, code, minutes, in_time, lunch_out, lunch_in, out_time }
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
  // The highest JOB-/CAN- number ever handed out, so one is never reused.
  ref_high: {},
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

const companyOf = (id) => load().companies.find((c) => c.id === id) || null;
const employeeOf = (id) => load().employees.find((e) => e.id === id) || null;
const periodOf = (id) => load().periods.find((p) => p.id === id) || null;

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
    save();
  }
  const loans = loanDeductions(periodId);

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
        overrides: {
          absent_days: row.absent_days_override !== null,
          sundays: row.sundays_override !== null,
          ot_minutes: row.ot_minutes_override !== null,
          ot_amount: row.ot_amount_override !== null,
          sunday_salary: row.sunday_salary_override !== null,
        },
        ...calculateRow(
          { ...row, ...fromMaster, loan_deduction: loans.get(row.employee_id) || 0 },
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
  'test_url', 'test_pass_percent', 'test_seconds_per_question',
  'status', 'opened_on', 'needed_by',
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

          if (code || minutes || anyTime) {
            const record = { period_id: period.id, employee_id: employeeId, day, code, minutes, ...times };
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
        public_url: null,
        test_configured: false,
        test_pass_percent: HIRING_DEFAULTS.passPercent,
        test_seconds_per_question: HIRING_DEFAULTS.secondsPerQuestion,
        whatsapp: null,
        offline: true,
      };
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
        const values = checkedTestUrl(pick(VACANCY_FIELDS, body));
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
        Object.assign(vacancy, checkedTestUrl(pick(VACANCY_FIELDS, body, vacancy)), {
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
        return {
          public: publicVacancy(joined),
          apply_url: null,
          broadcast: vacancyBroadcast(joined, { baseUrl: '' }),
          published: vacancy.status === 'published',
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
