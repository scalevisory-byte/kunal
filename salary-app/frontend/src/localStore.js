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
import { readPunchFile, punchesToMarks } from '../../shared/punches.js';
import { buildWorkbook } from '../../shared/workbook.js';
import { CSV_COLUMNS, statutoryReport, toCsv } from '../../shared/statutory.js';
import { TIME_FIELDS, parseTime } from '../../shared/timesheet.js';

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
  next_id: 1,
};

/**
 * The employee master baked in at build time (vite.config.js reads seed.json),
 * so the file opens with everybody already listed. It seeds only a browser that
 * has never stored anything - it never overwrites real data, and only the
 * master is seeded, so every month still starts with a blank attendance sheet.
 */
const SEED = typeof __SEED__ === 'undefined' ? null : __SEED__;

const freshStore = () => {
  const store = structuredClone(EMPTY);
  if (!SEED) return store;
  return {
    ...store,
    companies: structuredClone(SEED.companies || []),
    employees: structuredClone(SEED.employees || []),
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
      return {
        ...row,
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
        ...calculateRow({ ...row, loan_deduction: loans.get(row.employee_id) || 0 }, period, marks),
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

/* ---------------- the router ---------------- */

const ROW_FIELDS = [
  'salary', 'absent_days_override', 'sundays_override', 'ot_minutes_override',
  'ot_amount_override', 'addition', 'deduction', 'adjustment_note',
  'adjustment', 'esi', 'pf', 'sunday_salary_override',
  'payment_mode', 'status', 'sunday_status', 'sunday_mode', 'remark',
];

const EMPLOYEE_FIELDS = [
  'company_id', 'code', 'name', 'designation', 'religion', 'department',
  'dob', 'gender', 'phone', 'email', 'address',
  'pan', 'aadhaar', 'uan', 'esic_no', 'pf_no',
  'bank_name', 'bank_account', 'ifsc',
  'cl_quota', 'sl_quota', 'pl_quota',
  'monthly_salary', 'pf', 'esi', 'payment_mode', 'joined_on', 'left_on',
  'active', 'sort_order',
];

/** Answers an /api path the way the server would. */
export async function handle(method, path, body) {
  const db = load();
  const [, ...parts] = path.split('?')[0].split('/');
  const route = `${method} /${parts.join('/')}`;

  /* config */
  if (route === 'GET /config') {
    return {
      currency: 'INR',
      codes: ATTENDANCE_CODES,
      standalone: true,
      defaults: { working_days: STANDARD_WORKING_DAYS, hours_per_day: 9, pt_threshold: 12000, pt_amount: 200 },
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
      for (const key of ['name', 'sort_order']) if (key in (body || {})) company[key] = body[key];
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
    if (method === 'PATCH') {
      for (const key of EMPLOYEE_FIELDS) {
        if (!(key in (body || {}))) continue;
        employee[key] = key === 'active' ? (body[key] ? 1 : 0) : body[key];
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
        for (const key of ['label', 'hours_per_day', 'pt_threshold', 'pt_amount', 'locked']) {
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

    if (tail[0] === 'payroll' && method === 'GET') return buildPayroll(period.id);

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
        for (const entry of entries) {
          const employeeId = Number(entry.employee_id);
          const day = Number(entry.day);
          const code = String(entry.code || '').trim().toUpperCase();
          const minutes = Number(entry.minutes) || 0;
          if (!employeeId || !day) continue;
          const index = db.attendance.findIndex(
            (a) => a.period_id === period.id && a.employee_id === employeeId && a.day === day
          );
          // Each time is only touched by an entry that names it, so marking
          // somebody Present on the grid never wipes the hours typed on the
          // Time tab, and an import that knows nothing about lunch leaves the
          // lunch alone. Naming one with an empty value clears it.
          const stored = index >= 0 ? db.attendance[index] : null;
          const times = {};
          for (const field of TIME_FIELDS) {
            const value = field in entry ? entry[field] : stored?.[field];
            times[field] = value === undefined || value === null ? '' : String(value);
          }
          const anyTime = TIME_FIELDS.some((f) => times[f]);
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

  const match = path.match(/^\/periods\/(\d+)\/(export\.xlsx|export\.csv|bank\.csv|sunday\.csv)$/);
  if (!match) throw new Error(`not available offline: ${path}`);
  const payroll = buildPayroll(Number(match[1]));
  if (!payroll) throw new Error('period not found');

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
