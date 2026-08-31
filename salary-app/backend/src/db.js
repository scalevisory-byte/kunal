import Database from 'better-sqlite3';
import { MONTH_NAMES, STANDARD_WORKING_DAYS } from '../../shared/calc.js';
import { config } from './config.js';
import { log } from './logger.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code           TEXT,
    name           TEXT NOT NULL,
    designation    TEXT,
    -- Drives which festivals are a paid holiday for this person. Free text with
    -- suggestions rather than a fixed list, so nobody is forced into a box.
    religion       TEXT,
    department     TEXT,
    -- Personal
    dob            TEXT,
    gender         TEXT,
    phone          TEXT,
    email          TEXT,
    address        TEXT,
    -- Statutory identifiers, needed for the PF and ESI returns
    pan            TEXT,
    aadhaar        TEXT,
    uan            TEXT,
    esic_no        TEXT,
    pf_no          TEXT,
    -- Where the salary goes
    bank_name      TEXT,
    bank_account   TEXT,
    ifsc           TEXT,
    -- Yearly leave entitlement, counted against the CL/SL/PL marks
    cl_quota       REAL NOT NULL DEFAULT 0,
    sl_quota       REAL NOT NULL DEFAULT 0,
    pl_quota       REAL NOT NULL DEFAULT 0,
    monthly_salary REAL NOT NULL DEFAULT 0,
    pf             REAL NOT NULL DEFAULT 0,
    esi            REAL NOT NULL DEFAULT 0,
    payment_mode   TEXT NOT NULL DEFAULT 'Bank',
    joined_on      TEXT,
    left_on        TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One payroll month. Each period freezes its own divisors so re-running an
  -- old month never picks up today's settings.
  CREATE TABLE IF NOT EXISTS periods (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    year          INTEGER NOT NULL,
    month         INTEGER NOT NULL,
    label         TEXT NOT NULL,
    working_days  REAL NOT NULL DEFAULT 26,
    hours_per_day REAL NOT NULL DEFAULT 9,
    pt_threshold  REAL NOT NULL DEFAULT 12000,
    pt_amount     REAL NOT NULL DEFAULT 200,
    locked        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (year, month)
  );

  -- One row per employee per month: the sheet's AH..BE columns, inputs only.
  -- Everything derived is computed on read by shared/calc.js.
  CREATE TABLE IF NOT EXISTS payroll_rows (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id              INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    employee_id            INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    salary                 REAL NOT NULL DEFAULT 0,
    absent_days_override   REAL,
    sundays_override       REAL,
    ot_minutes_override    REAL,
    ot_amount_override     REAL,
    adjustment             REAL NOT NULL DEFAULT 0,
    esi                    REAL NOT NULL DEFAULT 0,
    pf                     REAL NOT NULL DEFAULT 0,
    sunday_salary_override REAL,
    payment_mode           TEXT,
    status                 TEXT NOT NULL DEFAULT 'pending',
    -- Sunday pay is settled on its own register, so it tracks its own
    -- payment separately from the month's salary.
    sunday_status          TEXT,
    sunday_mode            TEXT,
    remark                 TEXT,
    updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (period_id, employee_id)
  );

  -- minutes is that day's short hours (negative) or overtime (positive).
  -- A day can carry minutes with no mark, and a mark with no minutes.
  CREATE TABLE IF NOT EXISTS attendance (
    period_id   INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    day         INTEGER NOT NULL,
    code        TEXT NOT NULL DEFAULT '',
    minutes     REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (period_id, employee_id, day)
  );

  -- A festival or a shutdown: one day, one mark, and who it applies to.
  -- religions is a comma-separated list; empty means everybody.
  CREATE TABLE IF NOT EXISTS holidays (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id  INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    day        INTEGER NOT NULL,
    name       TEXT NOT NULL,
    religions  TEXT,
    code       TEXT NOT NULL DEFAULT 'PH',
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A loan or salary advance, and what has been repaid against it.
  CREATE TABLE IF NOT EXISTS loans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount       REAL NOT NULL,
    instalment   REAL NOT NULL DEFAULT 0,
    given_on     TEXT,
    reason       TEXT,
    -- 'active' takes an instalment each month; 'held' skips until resumed.
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per loan per month. Written when the month is opened, then
  -- editable - somebody who cannot pay this month gets it set to zero.
  CREATE TABLE IF NOT EXISTS loan_repayments (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id   INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    period_id INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    amount    REAL NOT NULL DEFAULT 0,
    UNIQUE (loan_id, period_id)
  );

  CREATE INDEX IF NOT EXISTS idx_loans_employee ON loans(employee_id, status);
  CREATE INDEX IF NOT EXISTS idx_repayments_period ON loan_repayments(period_id);
  CREATE INDEX IF NOT EXISTS idx_holidays_period ON holidays(period_id);
  CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id, active);
  CREATE INDEX IF NOT EXISTS idx_payroll_period    ON payroll_rows(period_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_period ON attendance(period_id, employee_id);
`);

/* ---------------- migrations ---------------- */

const attendanceColumns = new Set(db.prepare(`PRAGMA table_info(attendance)`).all().map((c) => c.name));
if (!attendanceColumns.has('minutes')) {
  db.exec(`ALTER TABLE attendance ADD COLUMN minutes REAL NOT NULL DEFAULT 0`);
  log.info('Migrated attendance table: added per-day minutes.');
}

// ot_minutes was NOT NULL DEFAULT 0 and named without the _override suffix. It
// is now ot_minutes_override, nullable, where null means "use the minutes marked
// on the days" - the same shape as every other override column. SQLite cannot
// drop NOT NULL in place, so the table is rebuilt. A stored 0 becomes null: it
// contributed nothing to the pay either way, and leaving it would block
// day-by-day entry on every row that came in from an import.
const payrollColumns = db.prepare(`PRAGMA table_info(payroll_rows)`).all();
if (payrollColumns.some((c) => c.name === 'ot_minutes')) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    ALTER TABLE payroll_rows RENAME TO payroll_rows_old;
    CREATE TABLE payroll_rows (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      period_id              INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
      employee_id            INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      salary                 REAL NOT NULL DEFAULT 0,
      absent_days_override   REAL,
      sundays_override       REAL,
      ot_minutes_override    REAL,
      ot_amount_override     REAL,
      adjustment             REAL NOT NULL DEFAULT 0,
      esi                    REAL NOT NULL DEFAULT 0,
      pf                     REAL NOT NULL DEFAULT 0,
      sunday_salary_override REAL,
      payment_mode           TEXT,
      status                 TEXT NOT NULL DEFAULT 'pending',
      remark                 TEXT,
      updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (period_id, employee_id)
    );
    INSERT INTO payroll_rows
      SELECT id, period_id, employee_id, salary, absent_days_override, sundays_override,
             NULLIF(ot_minutes, 0), ot_amount_override, adjustment, esi, pf,
             sunday_salary_override, payment_mode, status, remark, updated_at
      FROM payroll_rows_old;
    DROP TABLE payroll_rows_old;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_rows(period_id)`);
  log.info('Migrated payroll_rows: ot_minutes is now ot_minutes_override over the days.');
}

const employeeColumns = db.prepare(`PRAGMA table_info(employees)`).all().map((c) => c.name);
if (!employeeColumns.includes('religion')) {
  db.exec(`ALTER TABLE employees ADD COLUMN religion TEXT`);
  // The column was called group_name for a day, and people were told to put
  // their religion in it, so carry anything already there across.
  if (employeeColumns.includes('group_name')) {
    const moved = db.prepare(`UPDATE employees SET religion = group_name WHERE group_name IS NOT NULL`).run().changes;
    if (moved) log.info(`Migrated employees: moved ${moved} group_name values into religion.`);
  }
  log.info('Migrated employees: added religion.');
}

for (const column of [
  'department', 'dob', 'gender', 'phone', 'email', 'address',
  'pan', 'aadhaar', 'uan', 'esic_no', 'pf_no',
  'bank_name', 'bank_account', 'ifsc',
]) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} TEXT`);
    log.info(`Migrated employees: added ${column}.`);
  }
}

for (const column of ['cl_quota', 'sl_quota', 'pl_quota']) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
    log.info(`Migrated employees: added ${column}.`);
  }
}

for (const column of ['sunday_status', 'sunday_mode']) {
  if (!db.prepare(`PRAGMA table_info(payroll_rows)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE payroll_rows ADD COLUMN ${column} TEXT`);
    log.info(`Migrated payroll_rows: added ${column} for the Sunday register.`);
  }
}

const strayPeriods = db
  .prepare(`UPDATE periods SET working_days = ? WHERE working_days IS NOT ?`)
  .run(STANDARD_WORKING_DAYS, STANDARD_WORKING_DAYS).changes;
if (strayPeriods) {
  log.info(`Set ${strayPeriods} month(s) back to ${STANDARD_WORKING_DAYS} working days.`);
}

log.info(`SQLite ready at ${config.dbPath}`);

/* ---------------- companies ---------------- */

export function listCompanies() {
  return db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id AND e.active = 1) AS employee_count
       FROM companies c ORDER BY c.sort_order, c.name`
    )
    .all();
}

export function createCompany({ name, sort_order = 0 }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('company name is required');
  const info = db
    .prepare(`INSERT INTO companies (name, sort_order) VALUES (?, ?)`)
    .run(clean, Number(sort_order) || 0);
  return db.prepare(`SELECT * FROM companies WHERE id = ?`).get(info.lastInsertRowid);
}

/** Used by the importer and the seeder: get by name, create if missing. */
export function upsertCompany(name, sortOrder = 0) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('company name is required');
  const existing = db.prepare(`SELECT * FROM companies WHERE name = ?`).get(clean);
  if (existing) return existing;
  return createCompany({ name: clean, sort_order: sortOrder });
}

export function updateCompany(id, patch) {
  const fields = [];
  const values = [];
  for (const key of ['name', 'sort_order']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(patch[key]);
  }
  if (!fields.length) return db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
  db.prepare(`UPDATE companies SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
}

export function deleteCompany(id) {
  return db.prepare(`DELETE FROM companies WHERE id = ?`).run(id).changes > 0;
}

/* ---------------- employees ---------------- */

const EMPLOYEE_FIELDS = [
  'company_id',
  'code',
  'name',
  'designation',
  'religion',
  'department',
  'dob',
  'gender',
  'phone',
  'email',
  'address',
  'pan',
  'aadhaar',
  'uan',
  'esic_no',
  'pf_no',
  'bank_name',
  'bank_account',
  'ifsc',
  'cl_quota',
  'sl_quota',
  'pl_quota',
  'monthly_salary',
  'pf',
  'esi',
  'payment_mode',
  'joined_on',
  'left_on',
  'active',
  'sort_order',
];

export function listEmployees({ company_id, active } = {}) {
  const where = [];
  const params = [];
  if (company_id) {
    where.push('e.company_id = ?');
    params.push(company_id);
  }
  if (active !== undefined) {
    where.push('e.active = ?');
    params.push(active ? 1 : 0);
  }
  return db
    .prepare(
      `SELECT e.*, c.name AS company_name
       FROM employees e JOIN companies c ON c.id = e.company_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.sort_order, c.name, e.sort_order, e.name`
    )
    .all(...params);
}

export function getEmployee(id) {
  return (
    db
      .prepare(
        `SELECT e.*, c.name AS company_name
         FROM employees e JOIN companies c ON c.id = e.company_id WHERE e.id = ?`
      )
      .get(id) || null
  );
}

export function createEmployee(input) {
  const row = {
    company_id: Number(input.company_id),
    code: input.code || null,
    name: String(input.name || '').trim(),
    designation: input.designation || null,
    religion: input.religion || null,
    department: input.department || null,
    dob: input.dob || null,
    gender: input.gender || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    pan: input.pan || null,
    aadhaar: input.aadhaar || null,
    uan: input.uan || null,
    esic_no: input.esic_no || null,
    pf_no: input.pf_no || null,
    bank_name: input.bank_name || null,
    bank_account: input.bank_account || null,
    ifsc: input.ifsc || null,
    cl_quota: Number(input.cl_quota) || 0,
    sl_quota: Number(input.sl_quota) || 0,
    pl_quota: Number(input.pl_quota) || 0,
    monthly_salary: Number(input.monthly_salary) || 0,
    pf: Number(input.pf) || 0,
    esi: Number(input.esi) || 0,
    payment_mode: input.payment_mode || 'Bank',
    joined_on: input.joined_on || null,
    left_on: input.left_on || null,
    active: input.active === undefined ? 1 : input.active ? 1 : 0,
    sort_order: Number(input.sort_order) || 0,
  };
  if (!row.name) throw new Error('employee name is required');
  if (!row.company_id) throw new Error('company_id is required');
  const info = db
    .prepare(
      `INSERT INTO employees (${EMPLOYEE_FIELDS.join(', ')})
       VALUES (${EMPLOYEE_FIELDS.map((f) => `@${f}`).join(', ')})`
    )
    .run(row);
  return getEmployee(info.lastInsertRowid);
}

export function updateEmployee(id, patch) {
  const fields = [];
  const values = [];
  for (const key of EMPLOYEE_FIELDS) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'active') value = value ? 1 : 0;
    if (value === '') value = null;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (!fields.length) return getEmployee(id);
  db.prepare(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getEmployee(id);
}

export function deleteEmployee(id) {
  return db.prepare(`DELETE FROM employees WHERE id = ?`).run(id).changes > 0;
}

/* ---------------- periods ---------------- */

export function listPeriods() {
  return db.prepare(`SELECT * FROM periods ORDER BY year DESC, month DESC`).all();
}

export function getPeriod(id) {
  return db.prepare(`SELECT * FROM periods WHERE id = ?`).get(id) || null;
}

export function findPeriod(year, month) {
  return db.prepare(`SELECT * FROM periods WHERE year = ? AND month = ?`).get(year, month) || null;
}

export function createPeriod(input) {
  const row = {
    year: Number(input.year),
    month: Number(input.month),
    label: String(input.label || '').trim(),
    // Always 26 - the app pays every month on 26 days. Stored per period only
    // so the export and the payslip can print it without a special case.
    working_days: STANDARD_WORKING_DAYS,
    hours_per_day: Number(input.hours_per_day) || config.hoursPerDay,
    pt_threshold: input.pt_threshold === undefined ? config.ptThreshold : Number(input.pt_threshold),
    pt_amount: input.pt_amount === undefined ? config.ptAmount : Number(input.pt_amount),
  };
  if (!row.year || !row.month) throw new Error('year and month are required');
  if (row.month < 1 || row.month > 12) throw new Error('month must be 1-12');
  if (!row.label) row.label = `${MONTH_NAMES[row.month - 1]} ${row.year}`;
  const info = db
    .prepare(
      `INSERT INTO periods (year, month, label, working_days, hours_per_day, pt_threshold, pt_amount)
       VALUES (@year, @month, @label, @working_days, @hours_per_day, @pt_threshold, @pt_amount)`
    )
    .run(row);
  return getPeriod(info.lastInsertRowid);
}

export function updatePeriod(id, patch) {
  const fields = [];
  const values = [];
  // working_days is deliberately absent: it is fixed at 26 and not editable.
  for (const key of ['label', 'hours_per_day', 'pt_threshold', 'pt_amount', 'locked']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(key === 'locked' ? (patch[key] ? 1 : 0) : patch[key]);
  }
  if (!fields.length) return getPeriod(id);
  db.prepare(`UPDATE periods SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getPeriod(id);
}

export function deletePeriod(id) {
  return db.prepare(`DELETE FROM periods WHERE id = ?`).run(id).changes > 0;
}

/* ---------------- payroll rows ---------------- */

export function listPayrollRows(periodId, { company_id } = {}) {
  const params = [periodId];
  let filter = '';
  if (company_id) {
    filter = 'AND e.company_id = ?';
    params.push(company_id);
  }
  return db
    .prepare(
      `SELECT p.*, e.name AS employee_name, e.code AS employee_code, e.designation,
              e.religion, e.company_id, c.name AS company_name
       FROM payroll_rows p
       JOIN employees e ON e.id = p.employee_id
       JOIN companies c ON c.id = e.company_id
       WHERE p.period_id = ? ${filter}
       ORDER BY c.sort_order, c.name, e.sort_order, e.name`
    )
    .all(...params);
}

export function getPayrollRow(id) {
  return (
    db
      .prepare(
        `SELECT p.*, e.name AS employee_name, e.code AS employee_code, e.designation,
                e.company_id, c.name AS company_name
         FROM payroll_rows p
         JOIN employees e ON e.id = p.employee_id
         JOIN companies c ON c.id = e.company_id
         WHERE p.id = ?`
      )
      .get(id) || null
  );
}

const PAYROLL_FIELDS = [
  'salary',
  'absent_days_override',
  'sundays_override',
  'ot_minutes_override',
  'ot_amount_override',
  'adjustment',
  'esi',
  'pf',
  'sunday_salary_override',
  'payment_mode',
  'status',
  'sunday_status',
  'sunday_mode',
  'remark',
];

/** The ones that hold words. Everything else in PAYROLL_FIELDS is a number. */
const PAYROLL_TEXT_FIELDS = new Set([
  'payment_mode',
  'status',
  'sunday_status',
  'sunday_mode',
  'remark',
]);

export function updatePayrollRow(id, patch) {
  const fields = [];
  const values = [];
  for (const key of PAYROLL_FIELDS) {
    if (!(key in patch)) continue;
    let value = patch[key];
    // Blank on an override column means "go back to the formula", not zero.
    if (value === '') value = null;
    if (value !== null && !PAYROLL_TEXT_FIELDS.has(key)) {
      value = Number(value);
      if (!Number.isFinite(value)) continue;
    }
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (!fields.length) return getPayrollRow(id);
  fields.push(`updated_at = datetime('now')`);
  db.prepare(`UPDATE payroll_rows SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getPayrollRow(id);
}

/**
 * Make sure every active employee has a row in this period. Existing rows are
 * left alone so re-running never wipes entered overtime or deductions; only
 * their salary is refreshed when it is still untouched at 0.
 */
export const syncPayrollRows = db.transaction((periodId) => {
  const employees = db.prepare(`SELECT * FROM employees WHERE active = 1`).all();
  const existing = new Set(
    db.prepare(`SELECT employee_id FROM payroll_rows WHERE period_id = ?`).all(periodId).map((r) => r.employee_id)
  );
  const insert = db.prepare(
    `INSERT INTO payroll_rows (period_id, employee_id, salary, esi, pf, payment_mode)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const bumpSalary = db.prepare(
    `UPDATE payroll_rows SET salary = ? WHERE period_id = ? AND employee_id = ? AND salary = 0`
  );
  let added = 0;
  for (const emp of employees) {
    if (existing.has(emp.id)) {
      bumpSalary.run(emp.monthly_salary, periodId, emp.id);
      continue;
    }
    insert.run(periodId, emp.id, emp.monthly_salary, emp.esi, emp.pf, emp.payment_mode);
    added++;
  }
  return added;
});

/* ---------------- loans and advances ---------------- */

const loanRow = (row) => ({
  ...row,
  repaid: row.repaid || 0,
  outstanding: Math.round((row.amount - (row.repaid || 0)) * 100) / 100,
});

export function listLoans({ employee_id, includeClosed = true } = {}) {
  const where = [];
  const params = [];
  if (employee_id) {
    where.push('l.employee_id = ?');
    params.push(employee_id);
  }
  const rows = db
    .prepare(
      `SELECT l.*, e.name AS employee_name, c.name AS company_name,
              (SELECT COALESCE(SUM(r.amount), 0) FROM loan_repayments r WHERE r.loan_id = l.id) AS repaid
       FROM loans l
       JOIN employees e ON e.id = l.employee_id
       JOIN companies c ON c.id = e.company_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY l.created_at DESC`
    )
    .all(...params)
    .map(loanRow);
  return includeClosed ? rows : rows.filter((l) => l.outstanding > 0);
}

export function getLoan(id) {
  const rows = db
    .prepare(
      `SELECT l.*, (SELECT COALESCE(SUM(r.amount), 0) FROM loan_repayments r WHERE r.loan_id = l.id) AS repaid
       FROM loans l WHERE l.id = ?`
    )
    .get(id);
  return rows ? loanRow(rows) : null;
}

export function createLoan(input) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('the amount must be more than zero');
  if (!getEmployee(Number(input.employee_id))) throw new Error('employee not found');
  const info = db
    .prepare(
      `INSERT INTO loans (employee_id, amount, instalment, given_on, reason, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(input.employee_id),
      amount,
      Number(input.instalment) || 0,
      input.given_on || null,
      input.reason || null,
      input.status === 'held' ? 'held' : 'active'
    );
  return getLoan(info.lastInsertRowid);
}

export function updateLoan(id, patch) {
  const fields = [];
  const values = [];
  for (const key of ['amount', 'instalment', 'given_on', 'reason', 'status']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(patch[key] === '' ? null : patch[key]);
  }
  if (!fields.length) return getLoan(id);
  db.prepare(`UPDATE loans SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getLoan(id);
}

export function deleteLoan(id) {
  return db.prepare(`DELETE FROM loans WHERE id = ?`).run(id).changes > 0;
}

/**
 * Makes sure every active loan has a repayment row for this month, set to the
 * instalment or whatever is left of the loan, whichever is smaller. Rows that
 * already exist are left alone, so a month set to zero by hand stays zero.
 */
export const postRepayments = db.transaction((periodId) => {
  const loans = db
    .prepare(
      `SELECT l.*, (SELECT COALESCE(SUM(r.amount), 0) FROM loan_repayments r WHERE r.loan_id = l.id) AS repaid
       FROM loans l WHERE l.status = 'active'`
    )
    .all();
  const existing = new Set(
    db.prepare(`SELECT loan_id FROM loan_repayments WHERE period_id = ?`).all(periodId).map((r) => r.loan_id)
  );
  const insert = db.prepare(
    `INSERT INTO loan_repayments (loan_id, period_id, amount) VALUES (?, ?, ?)`
  );
  let added = 0;
  for (const loan of loans) {
    if (existing.has(loan.id)) continue;
    const outstanding = loan.amount - (loan.repaid || 0);
    if (outstanding <= 0) continue;
    const amount = Math.min(Number(loan.instalment) || 0, outstanding);
    if (amount <= 0) continue;
    insert.run(loan.id, periodId, amount);
    added++;
  }
  return added;
});

/** employee_id -> what comes off their salary this month. */
export function loanDeductions(periodId) {
  const rows = db
    .prepare(
      `SELECT l.employee_id, COALESCE(SUM(r.amount), 0) AS amount
       FROM loan_repayments r JOIN loans l ON l.id = r.loan_id
       WHERE r.period_id = ?
       GROUP BY l.employee_id`
    )
    .all(periodId);
  return new Map(rows.map((r) => [r.employee_id, r.amount]));
}

/** This month's instalments, loan by loan, for the ledger screen. */
export function listRepayments(periodId) {
  return db
    .prepare(
      `SELECT r.*, l.employee_id, l.amount AS loan_amount, l.reason, e.name AS employee_name
       FROM loan_repayments r
       JOIN loans l ON l.id = r.loan_id
       JOIN employees e ON e.id = l.employee_id
       WHERE r.period_id = ?
       ORDER BY e.name`
    )
    .all(periodId);
}

export function setRepayment(loanId, periodId, amount) {
  db.prepare(
    `INSERT INTO loan_repayments (loan_id, period_id, amount) VALUES (?, ?, ?)
     ON CONFLICT(loan_id, period_id) DO UPDATE SET amount = excluded.amount`
  ).run(loanId, periodId, Math.max(0, Number(amount) || 0));
  return getLoan(loanId);
}

/* ---------------- leave ---------------- */

/**
 * Everyone's leave for a calendar year: what they are entitled to, what they
 * have taken, and what is left. Taken is counted from the marks themselves
 * across every month of that year, so it can never drift from the grid.
 */
export function leaveSummary(year) {
  const taken = db
    .prepare(
      `SELECT a.employee_id, a.code, COUNT(*) AS days
       FROM attendance a JOIN periods p ON p.id = a.period_id
       WHERE p.year = ? AND a.code IN ('CL', 'SL', 'PL', 'UL')
       GROUP BY a.employee_id, a.code`
    )
    .all(year);

  const byEmployee = new Map();
  for (const row of taken) {
    if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, {});
    byEmployee.get(row.employee_id)[row.code] = row.days;
  }

  return listEmployees({ active: true }).map((emp) => {
    const used = byEmployee.get(emp.id) || {};
    return {
      employee_id: emp.id,
      name: emp.name,
      company_name: emp.company_name,
      department: emp.department,
      quotas: { CL: emp.cl_quota || 0, SL: emp.sl_quota || 0, PL: emp.pl_quota || 0 },
      taken: { CL: used.CL || 0, SL: used.SL || 0, PL: used.PL || 0, UL: used.UL || 0 },
    };
  });
}

/* ---------------- holidays ---------------- */

export function listHolidays(periodId) {
  return db
    .prepare(`SELECT * FROM holidays WHERE period_id = ? ORDER BY day, name`)
    .all(periodId)
    .map((h) => ({ ...h, religions: h.religions ? h.religions.split(',').filter(Boolean) : [] }));
}

export function getHoliday(id) {
  const row = db.prepare(`SELECT * FROM holidays WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, religions: row.religions ? row.religions.split(',').filter(Boolean) : [] };
}

export function createHoliday(periodId, input) {
  const name = String(input.name || '').trim();
  const day = Number(input.day);
  if (!name) throw new Error('the festival needs a name');
  if (!day || day < 1 || day > 31) throw new Error('pick a date in the month');
  const religions = Array.isArray(input.religions)
    ? input.religions.map((r) => String(r).trim()).filter(Boolean)
    : [];
  const info = db
    .prepare(`INSERT INTO holidays (period_id, day, name, religions, code) VALUES (?, ?, ?, ?, ?)`)
    .run(periodId, day, name, religions.join(','), String(input.code || 'PH').toUpperCase());
  return getHoliday(info.lastInsertRowid);
}

export function deleteHoliday(id) {
  return db.prepare(`DELETE FROM holidays WHERE id = ?`).run(id).changes > 0;
}

/** Everyone the holiday covers: all active staff, or those of its religions. */
export function employeesForHoliday(holiday) {
  if (!holiday.religions.length) {
    return db.prepare(`SELECT * FROM employees WHERE active = 1`).all();
  }
  const marks = holiday.religions.map(() => '?').join(', ');
  return db
    .prepare(`SELECT * FROM employees WHERE active = 1 AND religion IN (${marks})`)
    .all(...holiday.religions);
}

/**
 * Writes the holiday's mark onto that day for everyone it covers. Running it
 * again is harmless - it simply sets the same marks - so it can be re-applied
 * after the staff list changes.
 */
export const applyHoliday = db.transaction((holiday) => {
  const people = employeesForHoliday(holiday);
  const upsert = db.prepare(
    `INSERT INTO attendance (period_id, employee_id, day, code, minutes) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(period_id, employee_id, day) DO UPDATE SET code = excluded.code`
  );
  for (const person of people) upsert.run(holiday.period_id, person.id, holiday.day, holiday.code);
  db.prepare(`UPDATE holidays SET applied_at = datetime('now') WHERE id = ?`).run(holiday.id);
  return people.length;
});

/** The religions in use, for the pickers. */
export function listReligions() {
  return db
    .prepare(`SELECT DISTINCT religion FROM employees WHERE religion IS NOT NULL AND religion <> '' ORDER BY religion`)
    .all()
    .map((r) => r.religion);
}

/* ---------------- attendance ---------------- */

export function listAttendance(periodId, { company_id } = {}) {
  const params = [periodId];
  let filter = '';
  if (company_id) {
    filter = 'AND e.company_id = ?';
    params.push(company_id);
  }
  return db
    .prepare(
      `SELECT a.employee_id, a.day, a.code, a.minutes
       FROM attendance a JOIN employees e ON e.id = a.employee_id
       WHERE a.period_id = ? ${filter}`
    )
    .all(...params);
}

/** employee_id -> { day: { code, minutes } }, the shape calculateRow() wants. */
export function attendanceByEmployee(periodId, opts) {
  const map = new Map();
  for (const row of listAttendance(periodId, opts)) {
    if (!map.has(row.employee_id)) map.set(row.employee_id, {});
    map.get(row.employee_id)[row.day] = { code: row.code || '', minutes: row.minutes || 0 };
  }
  return map;
}

export const setAttendance = db.transaction((periodId, entries) => {
  const upsert = db.prepare(
    `INSERT INTO attendance (period_id, employee_id, day, code, minutes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(period_id, employee_id, day)
     DO UPDATE SET code = excluded.code, minutes = excluded.minutes`
  );
  const remove = db.prepare(
    `DELETE FROM attendance WHERE period_id = ? AND employee_id = ? AND day = ?`
  );
  for (const entry of entries) {
    const employeeId = Number(entry.employee_id);
    const day = Number(entry.day);
    const code = String(entry.code || '').trim().toUpperCase();
    const minutes = Number(entry.minutes) || 0;
    if (!employeeId || !day) continue;
    // A day with neither a mark nor minutes has nothing left to record.
    if (code || minutes) upsert.run(periodId, employeeId, day, code, minutes);
    else remove.run(periodId, employeeId, day);
  }
  return entries.length;
});

export function clearAttendance(periodId, employeeId) {
  const sql = employeeId
    ? `DELETE FROM attendance WHERE period_id = ? AND employee_id = ?`
    : `DELETE FROM attendance WHERE period_id = ?`;
  const args = employeeId ? [periodId, employeeId] : [periodId];
  return db.prepare(sql).run(...args).changes;
}
