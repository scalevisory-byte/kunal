import Database from 'better-sqlite3';
import { MONTH_NAMES, STANDARD_WORKING_DAYS } from '../../shared/calc.js';
import { minutesForMark, timesToDay } from '../../shared/timesheet.js';
import { DEFAULT_POLICY_FOR_NEW_MONTHS, hoursForEmployee } from '../../shared/lateEarly.js';
import { config } from './config.js';
import { log } from './logger.js';

/**
 * Today, by the clock on this machine rather than in UTC.
 *
 * `toISOString()` is UTC, and in India that is yesterday's date until half
 * past five in the morning - which would leave somebody's last working day
 * unacted on for the first five hours of it.
 */
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
    device_code    TEXT,
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
    -- The salary breakup. Special allowance is deliberately NOT stored: it is
    -- whatever is left of monthly_salary, so the parts can never drift from
    -- the total and adding a breakup cannot change anybody's pay.
    basic          REAL NOT NULL DEFAULT 0,
    hra            REAL NOT NULL DEFAULT 0,
    conveyance     REAL NOT NULL DEFAULT 0,
    medical        REAL NOT NULL DEFAULT 0,
    cl_quota       REAL NOT NULL DEFAULT 0,
    sl_quota       REAL NOT NULL DEFAULT 0,
    pl_quota       REAL NOT NULL DEFAULT 0,
    monthly_salary REAL NOT NULL DEFAULT 0,
    pf             REAL NOT NULL DEFAULT 0,
    esi            REAL NOT NULL DEFAULT 0,
    -- 'fixed' deducts the amount above, exactly as before; 'auto' works it out
    -- from the rules each month. Everybody starts on 'fixed' on purpose.
    pf_mode        TEXT NOT NULL DEFAULT 'fixed',
    esi_mode       TEXT NOT NULL DEFAULT 'fixed',
    payment_mode   TEXT NOT NULL DEFAULT 'Bank',
    -- Who this person reports to. Another employee, so an org chart is a join
    -- rather than a free-text name that goes stale the day somebody leaves.
    reports_to_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    joined_on      TEXT,
    left_on        TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One payroll month. Each period freezes its own divisors so re-running an
  -- old month never picks up today's settings.
  -- Every change worth remembering about a person: what their salary was in
  -- March, when they were promoted, when they left. Append-only, because the
  -- point of a history is that it cannot be edited into something else.
  CREATE TABLE IF NOT EXISTS employee_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    field       TEXT NOT NULL,
    from_value  TEXT,
    to_value    TEXT,
    note        TEXT,
    changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_history_employee ON employee_history(employee_id, changed_at);

  -- The paper behind the KYC numbers. The file itself lives on disk; this
  -- row only ever holds a generated filename.
  CREATE TABLE IF NOT EXISTS employee_documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'other',
    file_path   TEXT NOT NULL,
    file_name   TEXT,
    number      TEXT,
    issued_on   TEXT,
    expires_on  TEXT,
    notes       TEXT,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_documents_employee ON employee_documents(employee_id);

  -- Where a punch counts as being at work. One or more per company; a punch
  -- is measured against the nearest.
  CREATE TABLE IF NOT EXISTS office_locations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    radius_m   INTEGER NOT NULL DEFAULT 200,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Every tap of in or out from a phone. Append-only: the day is derived from
  -- these, so editing one would make the grid and the log disagree.
  CREATE TABLE IF NOT EXISTS punch_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    at           TEXT NOT NULL,
    day          TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'in',
    lat          REAL,
    lng          REAL,
    accuracy_m   REAL,
    office_id    INTEGER REFERENCES office_locations(id) ON DELETE SET NULL,
    distance_m   INTEGER,
    -- NULL means "not known", which is not the same as "outside".
    inside_fence INTEGER,
    located      INTEGER NOT NULL DEFAULT 0,
    note         TEXT,
    source       TEXT NOT NULL DEFAULT 'phone',
    ip           TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_punch_day ON punch_events(employee_id, day);

  -- Missing punch and correction requests. A request never writes attendance;
  -- approving it does.
  CREATE TABLE IF NOT EXISTS attendance_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period_id   INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    day         INTEGER NOT NULL,
    -- Only a leave application spans days; null everywhere else.
    to_day      INTEGER,
    kind        TEXT NOT NULL DEFAULT 'missing_punch',
    code        TEXT,
    in_time     TEXT,
    lunch_out   TEXT,
    lunch_in    TEXT,
    out_time    TEXT,
    reason      TEXT,
    -- How long, for a few hours off. Null on every other kind.
    minutes     INTEGER,
    status      TEXT NOT NULL DEFAULT 'pending',
    decided_by  TEXT,
    decided_at  TEXT,
    decision_note TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_request_status ON attendance_requests(status, created_at);

  CREATE TABLE IF NOT EXISTS periods (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    year          INTEGER NOT NULL,
    month         INTEGER NOT NULL,
    label         TEXT NOT NULL,
    working_days  REAL NOT NULL DEFAULT 26,
    hours_per_day REAL NOT NULL DEFAULT 9,
    pt_threshold  REAL NOT NULL DEFAULT 12000,
    pt_amount     REAL NOT NULL DEFAULT 200,
    -- The late/early rule this month is paid on. 'hours' is the long-standing
    -- behaviour and the default: nothing is charged for lateness as such.
    lunch_paid              INTEGER NOT NULL DEFAULT 0,
    late_policy             TEXT NOT NULL DEFAULT 'hours',
    late_concession_minutes INTEGER NOT NULL DEFAULT 300,
    late_grace_minutes      INTEGER NOT NULL DEFAULT 0,
    shift_in                TEXT NOT NULL DEFAULT '09:30',
    shift_lunch_out         TEXT NOT NULL DEFAULT '',
    shift_lunch_in          TEXT NOT NULL DEFAULT '',
    shift_out               TEXT NOT NULL DEFAULT '18:30',
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
    -- Anything else, by hand. Both are entered positive.
    addition               REAL NOT NULL DEFAULT 0,
    deduction              REAL NOT NULL DEFAULT 0,
    adjustment_note        TEXT,
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
  -- The four clock times are what the Time tab records; the minutes above are
  -- worked out from them, or typed directly when nobody clocked the day.
  CREATE TABLE IF NOT EXISTS attendance (
    period_id   INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    day         INTEGER NOT NULL,
    code        TEXT NOT NULL DEFAULT '',
    minutes     REAL NOT NULL DEFAULT 0,
    in_time     TEXT,
    lunch_out   TEXT,
    lunch_in    TEXT,
    out_time    TEXT,
    -- Why somebody was not at work, and whether it was allowed. Asked for by
    -- name: "NEED ABSNET REASON ALSO / APPROVED AND NOTAPPROVED WHAT".
    -- approved is a THREE-state column on purpose: null is "nobody has
    -- decided", which is not the same as "not approved". A day nobody has
    -- looked at must not read as a refusal.
    -- NEITHER COLUMN MOVES A RUPEE. An approved absence is still an absence;
    -- paid time off is CL/SL/PL/PH, which it already was.
    reason      TEXT,
    approved    INTEGER,
    -- Was this person in proper uniform. Three-state for the same reason
    -- approved is: null is "nobody looked", which is not "turned up wrong".
    -- A floor nobody checked must not read as a floor full of offenders.
    -- This moves no money either; it is a record, not a fine.
    uniform     INTEGER,
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
if (!attendanceColumns.has('in_time')) {
  for (const column of ['in_time', 'lunch_out', 'lunch_in', 'out_time']) {
    db.exec(`ALTER TABLE attendance ADD COLUMN ${column} TEXT`);
  }
  log.info('Migrated attendance table: added in/lunch/out times.');
}
if (!attendanceColumns.has('reason')) {
  // Both nullable with no default, so every day already marked reads as "no
  // reason given, nobody has decided" rather than as an unapproved absence.
  db.exec(`ALTER TABLE attendance ADD COLUMN reason TEXT`);
  db.exec(`ALTER TABLE attendance ADD COLUMN approved INTEGER`);
  log.info('Migrated attendance table: added the absence reason and whether it was approved.');
}
if (!attendanceColumns.has('uniform')) {
  // Nullable, so every day already marked reads as "nobody looked" rather
  // than as a uniform failure nobody recorded.
  db.exec(`ALTER TABLE attendance ADD COLUMN uniform INTEGER`);
  log.info('Migrated attendance table: added the uniform check.');
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

/*
 * The personal half of a joining form. Dinesh listed these by name: a PF
 * Form 2 and an ESIC registration both ask for a father's or husband's name
 * and the marital status, and an emergency contact is the one field nobody
 * misses until the day it is needed.
 *
 * All free text and all nullable. Not one of them is read by the salary
 * engine, so adding them cannot move a rupee.
 */
for (const column of [
  'department', 'dob', 'gender', 'phone', 'email', 'address',
  'pan', 'aadhaar', 'uan', 'esic_no', 'pf_no',
  'bank_name', 'bank_account', 'ifsc',
  'father_name', 'mother_name', 'spouse_name', 'marital_status',
  'phone_alt', 'emergency_name', 'emergency_phone', 'emergency_relation',
  'blood_group',
]) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} TEXT`);
    log.info(`Migrated employees: added ${column}.`);
  }
}

const payrollHas = (name) =>
  db.prepare(`PRAGMA table_info(payroll_rows)`).all().some((c) => c.name === name);

if (!payrollHas('addition')) {
  db.exec(`ALTER TABLE payroll_rows ADD COLUMN addition REAL NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE payroll_rows ADD COLUMN deduction REAL NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE payroll_rows ADD COLUMN adjustment_note TEXT`);
  // The single signed adjustment becomes an addition or a deduction, whichever
  // way it pointed, and is zeroed so it is not counted twice.
  const moved = db
    .prepare(
      `UPDATE payroll_rows
       SET addition = MAX(adjustment, 0),
           deduction = MAX(-adjustment, 0),
           adjustment = 0
       WHERE adjustment <> 0`
    )
    .run().changes;
  log.info(`Migrated payroll_rows: split adjustment into addition/deduction (${moved} rows).`);
}

for (const column of ['cl_quota', 'sl_quota', 'pl_quota']) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
    log.info(`Migrated employees: added ${column}.`);
  }
}

for (const column of ['basic', 'hra', 'conveyance', 'medical']) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
    log.info(`Migrated employees: added ${column} for the salary breakup.`);
  }
}

if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === 'reports_to_id')) {
  db.exec(`ALTER TABLE employees ADD COLUMN reports_to_id INTEGER REFERENCES employees(id) ON DELETE SET NULL`);
  log.info('Migrated employees: added reports_to_id.');
}

// Existing staff default to 'fixed', so the migration cannot move a deduction.
for (const column of ['pf_mode', 'esi_mode']) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} TEXT NOT NULL DEFAULT 'fixed'`);
    log.info(`Migrated employees: added ${column}, defaulting to the typed amount.`);
  }
}

/*
 * A person's own shift. Different shifts are normal, and a night-shift worker
 * judged against the office's 09:30 would read as five hours late every day.
 * Null means "the office's usual day".
 */
for (const column of ['shift_in', 'shift_out']) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} TEXT`);
    log.info(`Migrated employees: added ${column} for their own shift.`);
  }
}

/*
 * The late/early policy, per month. `late_policy` defaults to 'hours' - what
 * this app has always done, where a late arrival only costs money if it made
 * the day short - so the migration cannot move a single rupee. 'concession'
 * switches on Dinesh's own rule: late and early minutes pooled for the month,
 * the first 300 free, the excess charged. Kept per period so a changed rule
 * never rewrites a month already paid.
 */
const periodLateColumns = [
  /*
   * Is the lunch break taken OFF the day, or is it inside it?
   *
   * Dinesh's office is "9 hrs including lunch" - the half hour sits within
   * the nine - so he wants the times recorded and NOT subtracted. Defaults
   * to 0, meaning deducted, which is what the app has always done, so the
   * migration cannot move a rupee on any month already paid. Held per month
   * like the rest, so switching it in December never rewrites October.
   */
  ['lunch_paid', 'INTEGER NOT NULL DEFAULT 0'],
  ["late_policy", "TEXT NOT NULL DEFAULT 'hours'"],
  ['late_concession_minutes', 'INTEGER NOT NULL DEFAULT 300'],
  ['late_grace_minutes', 'INTEGER NOT NULL DEFAULT 0'],
  /*
   * The third policy: the month owes nine hours times the days it was owed,
   * and only the total is charged. This is how much of that total a month may
   * fall short before anything comes off - ZERO by default, because a monthly
   * pool plus a daily allowance gives away a second concession nobody decided
   * on, the same reasoning as late_grace_minutes above.
   */
  ['monthly_hours_grace', 'INTEGER NOT NULL DEFAULT 0'],
  ['shift_in', "TEXT NOT NULL DEFAULT '09:30'"],
  ['shift_out', "TEXT NOT NULL DEFAULT '18:30'"],
  /*
   * The usual lunch, as a SETTING rather than a browser preference.
   *
   * These two lived only in localStorage, so the office's usual timings were
   * whatever each PC happened to remember - two people filling a month on
   * two machines got two different days, and neither could be seen or set in
   * Settings. Blank by default, which with lunch_paid = 0 is exactly what
   * the app did before, so no month can move.
   */
  ['shift_lunch_out', "TEXT NOT NULL DEFAULT ''"],
  ['shift_lunch_in', "TEXT NOT NULL DEFAULT ''"],
];
for (const [column, type] of periodLateColumns) {
  if (!db.prepare(`PRAGMA table_info(periods)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE periods ADD COLUMN ${column} ${type}`);
    log.info(`Migrated periods: added ${column} for the late/early policy.`);
  }
}

/*
 * Branches, beneath a company.
 *
 * Dinesh's answer when asked what "branch" meant here: *"branches under a
 * company"*, because the salary is already run across three or four separate
 * companies (BOOKNFLY PRIVATE LIMITED, BOOKNFLY, BOOKNFLY VENTURE LLP, SCALE)
 * and a branch is a place inside one of them - Vadodara, Surat.
 *
 * So companies stay exactly as they are and this is a second, optional level.
 * `branch_id` is nullable on purpose: nobody has to be in a branch, and every
 * existing employee carries null, so nothing that already works changes.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    city       TEXT,
    address    TEXT,
    phone      TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Two branches of the same company cannot share a name. Two different
    -- companies each having a "Surat" is normal.
    UNIQUE (company_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_branch_company ON branches(company_id, sort_order);
`);

if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === 'branch_id')) {
  db.exec(`ALTER TABLE employees ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL`);
  log.info('Migrated employees: added branch_id (null = not in a branch).');
}

/*
 * Which day of the week is the day off, as JSON. Null means Sunday, which is
 * what the app has always assumed and is right for most of the staff. A company
 * sets the house rule; a person can carry their own (a driver off on Thursday).
 * It changes which squares the grid treats as off days, not what any mark is
 * worth - the salary engine counts marks and never asks what day it is.
 */
if (!db.prepare(`PRAGMA table_info(companies)`).all().some((c) => c.name === 'weekly_off')) {
  db.exec(`ALTER TABLE companies ADD COLUMN weekly_off TEXT`);
  log.info('Migrated companies: added weekly_off.');
}
/*
 * The company's own logo, for the papers that leave the building - the offer
 * letter first. Only the generated file name is held here; the picture is on
 * disk under DATA_DIR/company-logos, like every other upload in this app.
 * Null means no logo, which is not a fault: the letter simply goes out with
 * the company's name set in type, as it always has.
 */
/*
 * WHEN THE MONEY ACTUALLY LEFT, AND WHAT IT LEFT AS.
 *
 * `status` has always said pending / paid / hold, which is a claim with
 * nothing behind it: three months later nobody can say which transfer a row
 * was. These two are what make "paid" checkable - and the exception report
 * names any row marked paid without them.
 *
 * Nothing is derived from them and no existing figure moves: a payslip, a
 * gross, a net and every total are exactly what they were.
 */
if (!db.prepare(`PRAGMA table_info(payroll_rows)`).all().some((c) => c.name === 'payment_date')) {
  db.exec(`ALTER TABLE payroll_rows ADD COLUMN payment_date TEXT`);
  log.info('Migrated payroll_rows: added payment_date.');
}
if (!db.prepare(`PRAGMA table_info(payroll_rows)`).all().some((c) => c.name === 'payment_ref')) {
  db.exec(`ALTER TABLE payroll_rows ADD COLUMN payment_ref TEXT`);
  log.info('Migrated payroll_rows: added payment_ref, for the UTR or cheque number.');
}

/*
 * WHO APPROVED THE MONTH, AND WHEN.
 *
 * `locked` has always been one flag: paid and filed, no more editing. His
 * brief asks for the step before it - management approval - and for a reopen
 * that has to give a reason. Both are facts about the month, so they live on
 * it; neither changes a single figure in it.
 */
for (const [column, type] of [
  ['approved_by', 'TEXT'],
  ['approved_at', 'TEXT'],
  ['approval_note', 'TEXT'],
  ['locked_by', 'TEXT'],
  ['locked_at', 'TEXT'],
  ['reopen_reason', 'TEXT'],
]) {
  if (db.prepare(`PRAGMA table_info(periods)`).all().some((c) => c.name === column)) continue;
  db.exec(`ALTER TABLE periods ADD COLUMN ${column} ${type}`);
  log.info(`Migrated periods: added ${column}.`);
}

if (!db.prepare(`PRAGMA table_info(companies)`).all().some((c) => c.name === 'logo_path')) {
  db.exec(`ALTER TABLE companies ADD COLUMN logo_path TEXT`);
  log.info('Migrated companies: added logo_path, for the letterhead.');
}

if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === 'weekly_off')) {
  db.exec(`ALTER TABLE employees ADD COLUMN weekly_off TEXT`);
  log.info('Migrated employees: added weekly_off, for anybody not off on the company day.');
}

if (!db.prepare(`PRAGMA table_info(attendance_requests)`).all().some((c) => c.name === 'to_day')) {
  db.exec(`ALTER TABLE attendance_requests ADD COLUMN to_day INTEGER`);
  log.info('Migrated attendance_requests: added to_day, so a leave application can cover a run of days.');
}
/*
 * Two-step approval: who backed it, and when.
 *
 * Kept apart from decided_by/decided_at rather than reusing them, because a
 * request that a manager backed and the office then approved has TWO people
 * and two times on it, and one pair of columns could only ever hold the
 * second - which is the half that answers "who said this was fine" worst.
 */
for (const [column, type] of [['recommended_by', 'TEXT'], ['recommended_at', 'TEXT']]) {
  if (!db.prepare(`PRAGMA table_info(attendance_requests)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE attendance_requests ADD COLUMN ${column} ${type}`);
    log.info(`Migrated attendance_requests: added ${column}, for a manager's recommendation.`);
  }
}

/*
 * Cancelling an approved leave. His brief: "Never permanently delete approved
 * leave transactions" - so the row stays and these say who called it off,
 * when, and why, with `cancel_requested_at` for the employee who asked.
 */
for (const column of ['cancelled_by', 'cancelled_at', 'cancel_reason', 'cancel_requested_at']) {
  if (!db.prepare(`PRAGMA table_info(attendance_requests)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE attendance_requests ADD COLUMN ${column} TEXT`);
    log.info(`Migrated attendance_requests: added ${column}, for cancelling an approved leave.`);
  }
}

if (!db.prepare(`PRAGMA table_info(attendance_requests)`).all().some((c) => c.name === 'minutes')) {
  db.exec(`ALTER TABLE attendance_requests ADD COLUMN minutes INTEGER`);
  log.info('Migrated attendance_requests: added minutes, so a few hours off can be asked for.');
}

for (const column of ['sunday_status', 'sunday_mode']) {
  if (!db.prepare(`PRAGMA table_info(payroll_rows)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE payroll_rows ADD COLUMN ${column} TEXT`);
    log.info(`Migrated payroll_rows: added ${column} for the Sunday register.`);
  }
}


db.exec(`
  /* The audit trail. */
  -- Append-only, and deliberately dumb: a row, a field, what it was, what it
  -- became. It is written by the write paths rather than by a trigger, so the
  -- entry can say who and why - a trigger knows neither.
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          TEXT NOT NULL DEFAULT (datetime('now')),
    who         TEXT,
    action      TEXT NOT NULL,          -- created | changed | deleted | approved | ...
    entity      TEXT NOT NULL,          -- the table or thing acted on
    entity_id   INTEGER,
    label       TEXT,                   -- readable: a name, not just an id
    field       TEXT,
    from_value  TEXT,
    to_value    TEXT,
    note        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id, at);
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`);

/**
 * Write one line of the trail. Never throws into the caller's path: a write
 * that succeeded must not be reported as failed because its audit line did not
 * fit, and a trail that can fail a save is a trail somebody turns off.
 */
/*
 * The date probation ends. Nullable and purely informational - nothing is
 * blocked by it - but without the date "probation completing" cannot be a
 * reminder, only something somebody is supposed to remember.
 */
/*
 * HAS SOMEBODY ACTUALLY LOOKED AT THIS DOCUMENT?
 *
 * Three states, not a tick box, for the same reason the attendance day's
 * `approved` and `uniform` are three-state: NULL is "nobody has checked",
 * which is NOT "rejected". A register that read every un-checked PAN card as
 * refused would be a page of red on the day it shipped, and nobody would
 * read it again.
 */
for (const [column, sql] of [
  ['verified', 'INTEGER'],
  ['verified_by', 'TEXT'],
  ['verified_on', 'TEXT'],
  ['verify_note', 'TEXT'],
]) {
  if (!db.prepare(`PRAGMA table_info(employee_documents)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employee_documents ADD COLUMN ${column} ${sql}`);
    log.info(`Migrated employee_documents: added ${column}.`);
  }
}

if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === 'probation_until')) {
  db.exec(`ALTER TABLE employees ADD COLUMN probation_until TEXT`);
  log.info('Migrated employees: added probation_until.');
}

/*
 * THE EMPLOYEE MASTER'S REMAINING COLUMNS.
 *
 * Dinesh's brief for a proper joining form: employment type, a head of
 * department beside the reporting manager, a work location, and a PRESENT
 * and PERMANENT address instead of one free-text box.
 *
 * `address` is left exactly as it is and is still read. Rewriting eighty-six
 * rows of typed address into guessed lines is the kind of migration that
 * cannot be undone, so the structured fields are ADDITIVE: `fullAddress()`
 * prefers them and falls back to the old box, and nothing already typed
 * moves. The same for `is_draft`, which defaults to 0, so every existing
 * person stays a real employee.
 *
 * None of these reaches `calculateRow`. Not one figure can move.
 */
for (const column of [
  'employment_type', 'work_location', 'nationality',
  'address_line1', 'address_line2', 'city', 'state', 'pincode',
  'perm_line1', 'perm_line2', 'perm_city', 'perm_state', 'perm_pincode',
  'emergency_phone_alt', 'emergency_address',
  /*
   * The number the punch reader knows somebody by.
   *
   * Dinesh: "essl ka employee code bhi hrms me dalna hota tha jisse name
   * match kar sake". The Bizcompass spool carries no names at all - only this
   * number - so without it a punch cannot be given to anybody.
   *
   * It is its OWN column and not a reuse of `code`, because they are two
   * different facts: `code` is what the office calls somebody on a payslip,
   * this is what a machine in the corridor calls them. They often match, and
   * the import falls back to `code` when this is blank, so an office that
   * uses one number for both types nothing. Folding them into one column
   * would mean a person could not be renumbered on the reader without their
   * payslip changing too.
   */
  'device_code',
]) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} TEXT`);
    log.info(`Migrated employees: added ${column}.`);
  }
}

for (const [column, sql] of [
  ['perm_same', 'INTEGER NOT NULL DEFAULT 0'],
  /* A record somebody started and has not finished. It stays OFF every
     payroll until it is saved properly, which is the whole point of it. */
  ['is_draft', 'INTEGER NOT NULL DEFAULT 0'],
  ['hod_id', 'INTEGER REFERENCES employees(id) ON DELETE SET NULL'],
]) {
  if (!db.prepare(`PRAGMA table_info(employees)`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE employees ADD COLUMN ${column} ${sql}`);
    log.info(`Migrated employees: added ${column}.`);
  }
}

/* A company's own prefix for the employee codes it hands out, so BOOKNFLY
   VENTURE does not have to be BVL just because its name says so. */
if (!db.prepare(`PRAGMA table_info(companies)`).all().some((c) => c.name === 'code_prefix')) {
  db.exec(`ALTER TABLE companies ADD COLUMN code_prefix TEXT`);
  log.info('Migrated companies: added code_prefix for the employee code series.');
}

export function audit(entry = {}) {
  try {
    return db
      .prepare(
        `INSERT INTO audit_log (who, action, entity, entity_id, label, field, from_value, to_value, note)
         VALUES (@who, @action, @entity, @entity_id, @label, @field, @from_value, @to_value, @note)`
      )
      .run({
        who: entry.who || null,
        action: String(entry.action || 'changed'),
        entity: String(entry.entity || 'unknown'),
        entity_id: entry.entity_id === undefined ? null : Number(entry.entity_id) || null,
        label: entry.label || null,
        field: entry.field || null,
        from_value: entry.from_value === undefined || entry.from_value === null ? null : String(entry.from_value),
        to_value: entry.to_value === undefined || entry.to_value === null ? null : String(entry.to_value),
        note: entry.note || null,
      }).lastInsertRowid;
  } catch (err) {
    log.error(`Could not write the audit line: ${err.message}`);
    return null;
  }
}

export function listAudit({ entity, entity_id, who, since, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (entity) {
    where.push('entity = ?');
    params.push(entity);
  }
  if (entity_id) {
    where.push('entity_id = ?');
    params.push(Number(entity_id));
  }
  if (who) {
    where.push('who LIKE ?');
    params.push(`%${who}%`);
  }
  if (since) {
    where.push('at >= ?');
    params.push(since);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM audit_log ${clause} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(...params, Math.min(1000, Math.max(1, Number(limit) || 200)));
}


const strayPeriods = db
  .prepare(`UPDATE periods SET working_days = ? WHERE working_days IS NOT ?`)
  .run(STANDARD_WORKING_DAYS, STANDARD_WORKING_DAYS).changes;
if (strayPeriods) {
  log.info(`Set ${strayPeriods} month(s) back to ${STANDARD_WORKING_DAYS} working days.`);
}

log.info(`SQLite ready at ${config.dbPath}`);

/* ---------------- companies ---------------- */

/**
 * The companies, with whether each has a logo on file.
 *
 * `logo_path` is a path on the server's disk and never travels: the browser is
 * told only that there is one, and asks for the picture itself by id. The same
 * rule the employee photographs and the candidate CVs already follow.
 */
export function listCompanies() {
  return db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id AND e.active = 1) AS employee_count,
              (c.logo_path IS NOT NULL) AS has_logo
       FROM companies c ORDER BY c.sort_order, c.name`
    )
    .all()
    .map(({ logo_path, ...company }) => ({ ...company, has_logo: !!company.has_logo }));
}

/** One company, as it is stored - logo_path included, for the server's own use. */
export const getCompany = (id) => db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);

/**
 * Point a company at an uploaded logo file, or at none.
 *
 * Only the file NAME is stored, never a path somebody sent: the directory is
 * the server's business, and a name that travelled could reach out of it.
 */
export function setCompanyLogo(id, filename) {
  db.prepare(`UPDATE companies SET logo_path = ? WHERE id = ?`).run(filename || null, id);
  return getCompany(id);
}

export function createCompany({ name, sort_order = 0 }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('company name is required');
  const info = db
    .prepare(`INSERT INTO companies (name, sort_order) VALUES (?, ?)`)
    .run(clean, Number(sort_order) || 0);
  return withoutPath(getCompany(info.lastInsertRowid));
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
  for (const key of ['name', 'sort_order', 'weekly_off']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(patch[key] === '' ? null : patch[key]);
  }
  /*
   * `logo_path` is deliberately not in that list and never will be. It is set
   * by uploading a file, not by sending a name - a patch that could write it
   * would let a caller point a company at any file on the disk.
   */
  if (!fields.length) return withoutPath(getCompany(id));
  db.prepare(`UPDATE companies SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return withoutPath(getCompany(id));
}

/** A company as the browser may see it: no server path, just whether there is one. */
const withoutPath = (company) =>
  company ? (({ logo_path, ...rest }) => ({ ...rest, has_logo: !!logo_path }))(company) : company;

/**
 * Who approved the month, and who locked it.
 *
 * Their own calls rather than a patch, because these are decisions: an
 * approval that could be set by a stray field in a body is an approval
 * nobody made. Neither touches a figure.
 */
export function setPeriodApproval(id, { approved_by, note = null, reopen_reason = null } = {}) {
  db.prepare(
    `UPDATE periods SET approved_by = ?, approved_at = ?, approval_note = ?, reopen_reason = ?
      WHERE id = ?`
  ).run(approved_by || null, approved_by ? nowStamp() : null, note, reopen_reason, id);
  return getPeriod(id);
}

export function setPeriodLock(id, { locked, by, reason = null } = {}) {
  db.prepare(
    `UPDATE periods SET locked = ?, locked_by = ?, locked_at = ?, reopen_reason = COALESCE(?, reopen_reason)
      WHERE id = ?`
  ).run(locked ? 1 : 0, locked ? by || null : null, locked ? nowStamp() : null, reason, id);
  return getPeriod(id);
}

/** A timestamp the whole app reads the same way. */
const nowStamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export function deleteCompany(id) {
  return db.prepare(`DELETE FROM companies WHERE id = ?`).run(id).changes > 0;
}

/* ---------------- employees ---------------- */

const EMPLOYEE_FIELDS = [
  'reports_to_id',
  /* What the punch reader knows them by. Not `code`: see the migration. */
  'device_code',
  /* The employee master's own fields. None of them reaches calculateRow:
     a joining form cannot move a rupee. */
  'hod_id',
  'employment_type',
  'work_location',
  'nationality',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'pincode',
  'perm_same',
  'perm_line1',
  'perm_line2',
  'perm_city',
  'perm_state',
  'perm_pincode',
  'emergency_phone_alt',
  'emergency_address',
  'is_draft',
  'pf_mode',
  'esi_mode',
  'shift_in',
  'shift_out',
  'weekly_off',
  'basic',
  'hra',
  'conveyance',
  'medical',
  'company_id',
  'branch_id',
  'code',
  'name',
  'designation',
  'religion',
  'department',
  'dob',
  'gender',
  'marital_status',
  'father_name',
  'mother_name',
  'spouse_name',
  'blood_group',
  'phone',
  'phone_alt',
  'email',
  'address',
  'emergency_name',
  'emergency_phone',
  'emergency_relation',
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
  // When probation ends. Informational: nothing is blocked by it, but the
  // reminder cannot exist without the date.
  'probation_until',
  'active',
  'sort_order',
];

export function listEmployees({ company_id, branch_id, active } = {}) {
  const where = [];
  const params = [];
  if (company_id) {
    where.push('e.company_id = ?');
    params.push(company_id);
  }
  if (branch_id) {
    where.push('e.branch_id = ?');
    params.push(branch_id);
  }
  if (active !== undefined) {
    where.push('e.active = ?');
    params.push(active ? 1 : 0);
  }
  return db
    .prepare(
      `SELECT e.*, c.name AS company_name, b.name AS branch_name,
              -- Whether there is a face to show, not the file itself. The
              -- picture is fetched per employee from its own route; asking the
              -- list for it would mean a photograph of everybody down the wire
              -- to draw eighty thumbnails.
              EXISTS (SELECT 1 FROM employee_documents d
                      WHERE d.employee_id = e.id AND d.kind = 'photo') AS has_photo
       FROM employees e
       JOIN companies c ON c.id = e.company_id
       LEFT JOIN branches b ON b.id = e.branch_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.sort_order, c.name, b.sort_order, b.name, e.sort_order, e.name`
    )
    .all(...params);
}

/* ---------------- branches ---------------- */

export function listBranches({ company_id, active } = {}) {
  const where = [];
  const params = [];
  if (company_id) {
    where.push('b.company_id = ?');
    params.push(company_id);
  }
  if (active !== undefined) {
    where.push('b.active = ?');
    params.push(active ? 1 : 0);
  }
  return db
    .prepare(
      `SELECT b.*, c.name AS company_name,
              (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id AND e.active = 1) AS people
       FROM branches b JOIN companies c ON c.id = b.company_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.sort_order, c.name, b.sort_order, b.name`
    )
    .all(...params);
}

export const getBranch = (id) =>
  db
    .prepare(
      `SELECT b.*, c.name AS company_name FROM branches b
       JOIN companies c ON c.id = b.company_id WHERE b.id = ?`
    )
    .get(id) || null;

export function createBranch(input = {}) {
  const companyId = Number(input.company_id);
  const name = String(input.name || '').trim();
  if (!companyId) throw new Error('a branch belongs to a company');
  if (!db.prepare(`SELECT 1 FROM companies WHERE id = ?`).get(companyId)) {
    throw new Error('company not found');
  }
  if (!name) throw new Error('give the branch a name');
  if (db.prepare(`SELECT 1 FROM branches WHERE company_id = ? AND name = ?`).get(companyId, name)) {
    throw new Error(`that company already has a branch called ${name}`);
  }
  const id = db
    .prepare(
      `INSERT INTO branches (company_id, name, city, address, phone, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(companyId, name, input.city || null, input.address || null, input.phone || null, Number(input.sort_order) || 0)
    .lastInsertRowid;
  return getBranch(id);
}

export function updateBranch(id, patch = {}) {
  const before = getBranch(id);
  if (!before) throw new Error('not found');
  const fields = [];
  const values = [];
  for (const key of ['name', 'city', 'address', 'phone', 'sort_order', 'active']) {
    if (!(key in patch)) continue;
    if (key === 'name' && !String(patch.name || '').trim()) throw new Error('give the branch a name');
    fields.push(`${key} = ?`);
    values.push(key === 'active' ? (patch[key] ? 1 : 0) : patch[key] === '' ? null : patch[key]);
  }
  if (!fields.length) return before;
  db.prepare(`UPDATE branches SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getBranch(id);
}

/**
 * Deleting a branch does NOT delete its people - `branch_id` goes null and they
 * stay on their company's payroll. A mistyped branch name must never be able to
 * take fourteen employees with it.
 */
export function deleteBranch(id) {
  const branch = getBranch(id);
  if (!branch) return false;
  const moved = db.prepare(`UPDATE employees SET branch_id = NULL WHERE branch_id = ?`).run(id).changes;
  db.prepare(`DELETE FROM branches WHERE id = ?`).run(id);
  if (moved) log.info(`Branch "${branch.name}" removed; ${moved} employee(s) left in ${branch.company_name}.`);
  return true;
}

export function getEmployee(id) {
  return (
    db
      .prepare(
        `SELECT e.*, c.name AS company_name, b.name AS branch_name
         FROM employees e
         JOIN companies c ON c.id = e.company_id
         LEFT JOIN branches b ON b.id = e.branch_id
         WHERE e.id = ?`
      )
      .get(id) || null
  );
}

export function createEmployee(input) {
  const row = {
    company_id: Number(input.company_id),
    // Null means "not in a branch", which is where everybody starts.
    branch_id: Number(input.branch_id) || null,
    code: input.code || null,
    name: String(input.name || '').trim(),
    designation: input.designation || null,
    religion: input.religion || null,
    department: input.department || null,
    dob: input.dob || null,
    gender: input.gender || null,
    phone: input.phone || null,
    marital_status: input.marital_status || null,
    father_name: input.father_name || null,
    mother_name: input.mother_name || null,
    spouse_name: input.spouse_name || null,
    blood_group: input.blood_group || null,
    phone_alt: input.phone_alt || null,
    email: input.email || null,
    address: input.address || null,
    emergency_name: input.emergency_name || null,
    emergency_phone: input.emergency_phone || null,
    emergency_relation: input.emergency_relation || null,
    pan: input.pan || null,
    aadhaar: input.aadhaar || null,
    uan: input.uan || null,
    esic_no: input.esic_no || null,
    pf_no: input.pf_no || null,
    bank_name: input.bank_name || null,
    bank_account: input.bank_account || null,
    ifsc: input.ifsc || null,
    reports_to_id: Number(input.reports_to_id) || null,
    /* The head of department, which is NOT always the reporting manager -
       five people on a desk report to a supervisor who reports to the HOD,
       and a leave approval has to know which of the two it means. */
    hod_id: Number(input.hod_id) || null,
    employment_type: input.employment_type || null,
    work_location: input.work_location || null,
    nationality: input.nationality || null,
    /* Present address, in parts. The old free-text `address` is kept and
       still read: rewriting eighty-six typed addresses into guessed lines
       cannot be undone. */
    address_line1: input.address_line1 || null,
    address_line2: input.address_line2 || null,
    city: input.city || null,
    state: input.state || null,
    pincode: input.pincode || null,
    perm_same: input.perm_same ? 1 : 0,
    perm_line1: input.perm_line1 || null,
    perm_line2: input.perm_line2 || null,
    perm_city: input.perm_city || null,
    perm_state: input.perm_state || null,
    perm_pincode: input.perm_pincode || null,
    emergency_phone_alt: input.emergency_phone_alt || null,
    emergency_address: input.emergency_address || null,
    /* A record somebody started and has not finished. It is off every
       payroll until it is saved properly. */
    is_draft: input.is_draft ? 1 : 0,
    // 'none' means PF (or ESI) does not apply to this person at all: nothing
    // is deducted and they are left off the register. 'fixed' stays the
    // default, so an existing row and a new one behave exactly as before.
    pf_mode: ['auto', 'none'].includes(input.pf_mode) ? input.pf_mode : 'fixed',
    esi_mode: ['auto', 'none'].includes(input.esi_mode) ? input.esi_mode : 'fixed',
    /* The number the punch reader knows them by. Null means "ask `code`" -
       the import falls back to it, so an office using one number for both
       types nothing here. */
    device_code: input.device_code ? String(input.device_code).trim() : null,
    // Null means "the office's usual day", which is what almost everybody works.
    shift_in: input.shift_in || null,
    shift_out: input.shift_out || null,
    // Null means "the company's day off", which is almost everybody.
    weekly_off: input.weekly_off || null,
    basic: Number(input.basic) || 0,
    hra: Number(input.hra) || 0,
    conveyance: Number(input.conveyance) || 0,
    medical: Number(input.medical) || 0,
    cl_quota: Number(input.cl_quota) || 0,
    sl_quota: Number(input.sl_quota) || 0,
    pl_quota: Number(input.pl_quota) || 0,
    monthly_salary: Number(input.monthly_salary) || 0,
    pf: Number(input.pf) || 0,
    esi: Number(input.esi) || 0,
    payment_mode: input.payment_mode || 'Bank',
    joined_on: input.joined_on || null,
    left_on: input.left_on || null,
    // When probation ends. Informational: nothing is blocked by it, but the
    // reminder cannot exist without the date.
    probation_until: input.probation_until || null,
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

/**
 * The changes worth keeping a record of. Not every field: a corrected spelling
 * or a new phone number is housekeeping, while a salary, a designation or a
 * departure is something somebody will ask about a year later.
 */
export const TRACKED_FIELDS = {
  monthly_salary: 'Salary',
  branch_id: 'Branch',
  designation: 'Designation',
  department: 'Department',
  company_id: 'Company',
  reports_to_id: 'Reports to',
  hod_id: 'Head of department',
  employment_type: 'Employment type',
  work_location: 'Work location',
  basic: 'Basic',
  hra: 'HRA',
  pf_mode: 'PF',
  esi_mode: 'ESI',
  active: 'Status',
  left_on: 'Left on',
  joined_on: 'Joining date',
  /*
   * Where the money goes.
   *
   * Not tracked until staff logins existed, because only the office could
   * change it. Now the employee can - which is right, they are the ones who
   * know their account number - and a bank account that changes the week
   * before payday is exactly the change somebody has to be able to look back
   * at. The history records who, when, and what it was before.
   */
  bank_account: 'Bank account',
  ifsc: 'IFSC',
  /*
   * THE NUMBERS A RETURN IS FILED WITH.
   *
   * Tracked from the release that let employees fill in their own record.
   * The office usually took these off the card itself; now somebody can
   * supply a missing one from their phone, and when a PF return bounces the
   * first question is who put this UAN on the record and when. Changing one
   * that is already set is refused on that side (`shared/selfRecord.js`), so
   * what lands here from an employee is always a blank being filled.
   */
  pan: 'PAN',
  aadhaar: 'Aadhaar',
  uan: 'UAN',
  pf_no: 'PF member ID',
  esic_no: 'ESIC number',
  dob: 'Date of birth',
};

/** Readable in the timeline rather than an id nobody can place. */
const historyValue = (field, value) => {
  if (value === null || value === undefined || value === '') return '';
  if (field === 'company_id') {
    return db.prepare(`SELECT name FROM companies WHERE id = ?`).get(Number(value))?.name || String(value);
  }
  if (field === 'reports_to_id') {
    return db.prepare(`SELECT name FROM employees WHERE id = ?`).get(Number(value))?.name || String(value);
  }
  if (field === 'active') return Number(value) ? 'Active' : 'Left';
  return String(value);
};

export const listEmployeeHistory = (employeeId) =>
  db
    .prepare(`SELECT * FROM employee_history WHERE employee_id = ? ORDER BY changed_at DESC, id DESC`)
    .all(employeeId)
    .map((row) => ({ ...row, label: TRACKED_FIELDS[row.field] || row.field }));

export function recordHistory(employeeId, field, from, to, note) {
  return db
    .prepare(
      `INSERT INTO employee_history (employee_id, field, from_value, to_value, note)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(employeeId, field, historyValue(field, from), historyValue(field, to), note || null)
    .lastInsertRowid;
}

/**
 * Nobody may report to themselves, or to somebody who already reports to them.
 * A loop here would hang any walk up the chain, and an org chart that cannot be
 * drawn is worse than none.
 */
export function wouldLoop(employeeId, managerId) {
  if (!managerId) return false;
  if (Number(managerId) === Number(employeeId)) return true;
  const seen = new Set([Number(employeeId)]);
  let at = Number(managerId);
  while (at) {
    if (seen.has(at)) return true;
    seen.add(at);
    at = db.prepare(`SELECT reports_to_id FROM employees WHERE id = ?`).get(at)?.reports_to_id || 0;
  }
  return false;
}

export function updateEmployee(id, patch) {
  const before = getEmployee(id);
  if (!before) return null;

  /*
   * A LAST WORKING DAY THAT HAS PASSED MEANS THEY HAVE LEFT.
   *
   * Dinesh: *"exited employee abhi bhi dikha rahe he current list me"*.
   * Typing a leaving date used to record the date and nothing else - the
   * person stayed on the payroll, in every picker and on the next month's
   * sheet, until somebody also remembered to untick Active. Two switches for
   * one fact is how one of them gets forgotten.
   *
   * A date in the FUTURE does not: somebody serving notice is still here, is
   * still paid, and must stay on this month's sheet. And an `active` sent in
   * the same patch always wins, so putting somebody back on is still one
   * tick.
   */
  if ('left_on' in patch && !('active' in patch)) {
    const date = String(patch.left_on || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayLocal()) {
      patch = { ...patch, active: 0 };
    }
  }

  if ('reports_to_id' in patch) {
    const manager = patch.reports_to_id ? Number(patch.reports_to_id) : null;
    if (manager && wouldLoop(id, manager)) {
      throw new Error('That would make the reporting line circle back on itself.');
    }
  }

  const fields = [];
  const values = [];
  for (const key of EMPLOYEE_FIELDS) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'active') value = value ? 1 : 0;
    if (key === 'reports_to_id') value = Number(value) || null;
    if (value === '') value = null;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (!fields.length) return before;
  db.prepare(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  const after = getEmployee(id);

  // Recorded after the fact, from what actually changed, so a patch that sets
  // a field to the value it already had leaves no entry.
  for (const field of Object.keys(TRACKED_FIELDS)) {
    if (!(field in patch)) continue;
    const from = before[field];
    const to = after[field];
    if (String(from ?? '') === String(to ?? '')) continue;
    recordHistory(id, field, from, to, patch.history_note);
  }
  return after;
}

/* ---------------- employee documents ---------------- */

/**
 * The photograph to show for somebody: the newest one on file.
 *
 * A replacement is a new upload rather than an overwrite, so the old one is
 * still on the record - an ID card printed last year is allowed to look like
 * the person did last year.
 */
export const newestPhoto = (employeeId) =>
  db
    .prepare(
      `SELECT * FROM employee_documents
       WHERE employee_id = ? AND kind = 'photo'
       ORDER BY uploaded_at DESC, id DESC LIMIT 1`
    )
    .get(Number(employeeId)) || null;

export const listDocuments = (employeeId) =>
  db
    .prepare(`SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC, id DESC`)
    .all(employeeId);

export const getDocument = (id) =>
  db.prepare(`SELECT * FROM employee_documents WHERE id = ?`).get(id) || null;

export function addDocument(employeeId, values) {
  const id = db
    .prepare(
      `INSERT INTO employee_documents (employee_id, kind, file_path, file_name, number, issued_on, expires_on, notes)
       VALUES (@employee_id, @kind, @file_path, @file_name, @number, @issued_on, @expires_on, @notes)`
    )
    .run({
      employee_id: employeeId,
      kind: values.kind || 'other',
      file_path: values.file_path,
      file_name: values.file_name || null,
      number: values.number || null,
      issued_on: values.issued_on || null,
      expires_on: values.expires_on || null,
      notes: values.notes || null,
    }).lastInsertRowid;
  return getDocument(id);
}

/**
 * Checked, or sent back.
 *
 * `verified` is three-state on the way in too: true, false, or null to hand
 * the decision back to nobody-has-looked. A rejection must say why - a
 * document refused with no reason is one nobody can put right.
 */
export function verifyDocument(id, { verified, note, by } = {}) {
  const doc = getDocument(id);
  if (!doc) return null;
  if (verified === false && !String(note || '').trim()) {
    throw new Error('say what is wrong with it');
  }
  db.prepare(
    `UPDATE employee_documents
     SET verified = ?, verified_by = ?, verified_on = ?, verify_note = ?
     WHERE id = ?`
  ).run(
    verified === null || verified === undefined ? null : verified ? 1 : 0,
    verified === null || verified === undefined ? null : by || null,
    verified === null || verified === undefined ? null : new Date().toISOString().slice(0, 10),
    note || null,
    Number(id)
  );
  audit({
    who: by,
    action: verified === null || verified === undefined ? 'changed' : verified ? 'verified' : 'rejected',
    entity: 'employee_documents',
    entity_id: Number(id),
    label: `${getEmployee(doc.employee_id)?.name || ''} — ${doc.kind}`,
    note: note || null,
  });
  return getDocument(id);
}

export const deleteDocument = (id) =>
  db.prepare(`DELETE FROM employee_documents WHERE id = ?`).run(id).changes > 0;

/** Who reports to this person, for the team view. */
export const listDirectReports = (employeeId) =>
  db
    .prepare(
      `SELECT e.id, e.name, e.designation, e.department, c.name AS company_name
       FROM employees e JOIN companies c ON c.id = e.company_id
       WHERE e.reports_to_id = ? AND e.active = 1 ORDER BY e.name`
    )
    .all(employeeId);

/**
 * WHAT GOES WITH THEM.
 *
 * Dinesh: "employee me se wrongly added employee delete kaise hoga". The
 * button was already there and the confirmation said "and all their payroll
 * history" - true, and no use at all for telling the two cases apart. Added
 * by mistake this morning and a cashier of four years look exactly alike on
 * that screen, and only one of them should be deleted.
 *
 * So it COUNTS first. Somebody added by mistake comes back as zeroes, which
 * is the whole answer; a real employee comes back with months, attendance
 * and documents against their name, which is the other.
 */
export function employeeDeleteSummary(id) {
  const employee = getEmployee(id);
  if (!employee) return null;
  const one = (sql) => db.prepare(sql).get(id)?.n || 0;
  return {
    id,
    name: employee.name,
    months: one(`SELECT COUNT(*) n FROM payroll_rows WHERE employee_id = ?`),
    locked_months: one(
      `SELECT COUNT(*) n FROM payroll_rows r JOIN periods p ON p.id = r.period_id
        WHERE r.employee_id = ? AND p.locked = 1`
    ),
    attendance_days: one(`SELECT COUNT(*) n FROM attendance WHERE employee_id = ?`),
    documents: one(`SELECT COUNT(*) n FROM employee_documents WHERE employee_id = ?`),
    loans: one(`SELECT COUNT(*) n FROM loans WHERE employee_id = ?`),
    reports: one(`SELECT COUNT(*) n FROM employees WHERE reports_to_id = ?`),
  };
}

/**
 * The one line that is drawn: A MONTH THAT HAS BEEN CLOSED.
 *
 * A locked month has been paid and filed - it is behind a PF return, an ESI
 * contribution and a payslip somebody is holding. Deleting a person out of it
 * rewrites a figure that was already reported, and the register stops adding
 * up. Somebody who has LEFT is marked as left, which the app already has;
 * deleting is for a row that should never have existed.
 *
 * An open month is not blocked. That is exactly where a wrongly added person
 * sits, and it is the case this was asked for.
 */
/**
 * Somebody with an exit recorded is a PAST EMPLOYEE, and that is a record.
 *
 * Dinesh: *"Past employe k data bhi proper rehne chaiye"*. Once the leaving
 * has been written down - the date, the notice, the settlement, the letters
 * issued from it - deleting them does not tidy anything up, it throws away
 * the only account of somebody who worked here. The table is read at call
 * time and only if it exists, because db.js is loaded before people.js
 * builds it.
 */
function hasExitRecorded(id) {
  const there = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'employee_exits'`)
    .get();
  if (!there) return false;
  return Boolean(db.prepare(`SELECT 1 FROM employee_exits WHERE employee_id = ?`).get(id));
}

export function employeeDeleteProblem(id) {
  const summary = employeeDeleteSummary(id);
  if (!summary) return 'not found';
  if (hasExitRecorded(id)) {
    return `${summary.name} has left and their exit is on the record — the dates, the settlement and the letters issued from it. That is the account of somebody who worked here, so it stays. They are already off the active list.`;
  }
  if (summary.locked_months > 0) {
    return `${summary.name} has been paid in ${summary.locked_months} closed month${
      summary.locked_months === 1 ? '' : 's'
    }. Those are filed against a PF return and a payslip, so deleting them would rewrite a figure already reported — set their status to Left instead.`;
  }
  return '';
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
    /*
     * The rule a new month starts on. Named explicitly rather than left to
     * the column's own default, so there is one place that decides it and
     * the offline build reads the same constant. A month already in the
     * table is never rewritten - see the note on the constant.
     */
    late_policy: input.late_policy || DEFAULT_POLICY_FOR_NEW_MONTHS,
  };
  if (!row.year || !row.month) throw new Error('year and month are required');
  if (row.month < 1 || row.month > 12) throw new Error('month must be 1-12');
  if (!row.label) row.label = `${MONTH_NAMES[row.month - 1]} ${row.year}`;
  const info = db
    .prepare(
      `INSERT INTO periods (year, month, label, working_days, hours_per_day, pt_threshold, pt_amount, late_policy)
       VALUES (@year, @month, @label, @working_days, @hours_per_day, @pt_threshold, @pt_amount, @late_policy)`
    )
    .run(row);
  return getPeriod(info.lastInsertRowid);
}

export function updatePeriod(id, patch) {
  const fields = [];
  const values = [];
  // working_days is deliberately absent: it is fixed at 26 and not editable.
  for (const key of [
    'label',
    'hours_per_day',
    'pt_threshold',
    'pt_amount',
    'lunch_paid',
    'late_policy',
    'late_concession_minutes',
    'late_grace_minutes',
    'monthly_hours_grace',
    'shift_in',
    'shift_out',
    'shift_lunch_out',
    'shift_lunch_in',
    'locked',
  ]) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    /*
     * The policy is one of four and nothing else. An unrecognised value
     * falls back to 'hours' - what every existing month runs on - so a typo
     * or a stale form cannot land a month on a rule nobody chose.
     */
    if (key === 'late_policy') {
      const asked = String(patch[key] || '').toLowerCase();
      values.push(
        ['concession', 'monthly', 'monthly_late'].includes(asked) ? asked : 'hours'
      );
      continue;
    }
    values.push(key === 'locked' || key === 'lunch_paid' ? (patch[key] ? 1 : 0) : patch[key]);
  }
  if (!fields.length) return getPeriod(id);
  const before = getPeriod(id);
  db.prepare(`UPDATE periods SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  const after = getPeriod(id);
  // Closing a month, moving the PT slab or switching the late/early rule all
  // change what somebody is paid, so each one goes on the trail by name.
  for (const key of Object.keys(patch)) {
    if (!before || !after || String(before[key] ?? '') === String(after[key] ?? '')) continue;
    audit({
      who: patch.by,
      action: key === 'locked' ? (after.locked ? 'closed' : 'reopened') : 'changed',
      entity: 'periods',
      entity_id: id,
      label: after.label,
      field: key,
      from_value: before[key],
      to_value: after[key],
    });
  }
  return after;
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
              e.religion, e.department, e.uan, e.esic_no, e.pf_no, e.pan,
              e.bank_name, e.bank_account, e.ifsc,
              -- the salary breakup, and the master salary it was typed against
              e.basic, e.hra, e.conveyance, e.medical, e.monthly_salary,
              e.pf_mode, e.esi_mode,
              -- their own shift, so the late/early line is judged against the
              -- hours they actually work, not the office's default
              e.shift_in, e.shift_out,
              -- the weekly off, theirs then the company's, so the grid knows
              -- which squares were never working days for this person
              e.weekly_off, c.weekly_off AS company_weekly_off,
              -- When they arrived and when they went, so the attendance check
              -- never asks somebody to explain a day before they joined.
              e.joined_on, e.left_on,
              -- Still on this month because they are OWED something, while no
              -- longer on the staff list. Without this the grid shows a name
              -- that the Employees tab and the Excel both say is gone, and it
              -- reads as a fault rather than as money still to pay.
              e.active,
              e.branch_id, b.name AS branch_name,
              e.company_id, c.name AS company_name
       FROM payroll_rows p
       JOIN employees e ON e.id = p.employee_id
       JOIN companies c ON c.id = e.company_id
       LEFT JOIN branches b ON b.id = e.branch_id
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
                e.basic, e.hra, e.conveyance, e.medical, e.monthly_salary,
                e.pf_mode, e.esi_mode, e.shift_in, e.shift_out,
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
  'addition',
  'deduction',
  'adjustment_note',
  'adjustment',
  'esi',
  'pf',
  'sunday_salary_override',
  'payment_mode',
  'status',
  'sunday_status',
  'sunday_mode',
  'remark',
  /* When it was paid and what it was paid as. See the migration above. */
  'payment_date',
  'payment_ref',
];

/** The ones that hold words. Everything else in PAYROLL_FIELDS is a number. */
const PAYROLL_TEXT_FIELDS = new Set([
  'adjustment_note',
  'payment_mode',
  'payment_date',
  'payment_ref',
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
  const before = getPayrollRow(id);
  fields.push(`updated_at = datetime('now')`);
  db.prepare(`UPDATE payroll_rows SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  const after = getPayrollRow(id);

  /*
   * The salary sheet's own trail. One line per column that actually moved -
   * typing a figure and typing it again does not count as a change - so the
   * trail answers "who put 2,363 in Suleman's Sunday pay" without filling up
   * with lines that say nothing happened.
   */
  if (before && after) {
    for (const key of PAYROLL_FIELDS) {
      if (!(key in patch)) continue;
      const was = before[key];
      const now = after[key];
      if (String(was ?? '') === String(now ?? '')) continue;
      audit({
        who: patch.by,
        action: 'changed',
        entity: 'payroll_rows',
        entity_id: id,
        label: `${before.employee_name}, ${before.company_name || ''}`.trim().replace(/,$/, ''),
        field: key,
        from_value: was === null || was === undefined ? '(formula)' : was,
        to_value: now === null || now === undefined ? '(formula)' : now,
      });
    }
  }
  return after;
}

/**
 * Make sure every active employee has a row in this period. Existing rows are
 * left alone so re-running never wipes entered overtime or deductions; only
 * their salary is refreshed when it is still untouched at 0.
 */
/*
 * A ROW THAT NOTHING HAS BEEN RECORDED AGAINST.
 *
 * Opening a month puts every active employee on the sheet. Untick Active
 * afterwards - which is exactly what the Employees screen tells somebody to
 * do when a person leaves - and the row that was already created just stays:
 * sync only ever ADDED. So Dinesh removed his leavers, saw them gone from the
 * staff list and the Excel, and found them still on the attendance grid.
 *
 * They cannot simply be deleted. SOMEBODY WHO LEFT ON THE 10TH IS STILL OWED
 * TEN DAYS, and their row carries the marks that pay them. So only a row that
 * nothing has been recorded against goes - no attendance, no clock times, no
 * typed-over figure, no addition or deduction, nothing paid. There is, by
 * definition, nothing to lose.
 *
 * AND NOT EVEN THEN, IF THEY WORKED ANY OF THIS MONTH. An unmarked month
 * pays a full month, so an untouched row is not an empty row - it is this
 * month's pay with nothing deducted. Somebody whose last working day falls
 * on or after the first of this month worked part of it and is owed
 * something, so their row stays whatever is or is not marked on it; only a
 * row for somebody who was already gone before the month began can go.
 *
 * `salary` is NOT on this list. Sync writes it itself when it creates the
 * row, so counting it as "recorded" would mean nothing ever qualified.
 */
const UNTOUCHED_OVERRIDES = [
  'absent_days_override', 'sundays_override', 'ot_minutes_override',
  'ot_amount_override', 'sunday_salary_override',
];

const strandedRows = db.prepare(`
  SELECT r.id, r.employee_id FROM payroll_rows r
    JOIN employees e ON e.id = r.employee_id
   WHERE r.period_id = @period_id
     AND e.active = 0
     AND (e.left_on IS NULL OR e.left_on < @starts)
     AND r.status = 'pending'
     AND COALESCE(r.sunday_status, 'pending') = 'pending'
     AND r.addition = 0 AND r.deduction = 0 AND r.adjustment = 0
     AND COALESCE(r.remark, '') = '' AND COALESCE(r.adjustment_note, '') = ''
     AND ${UNTOUCHED_OVERRIDES.map((c) => `r.${c} IS NULL`).join(' AND ')}
     AND NOT EXISTS (
       SELECT 1 FROM attendance a
        WHERE a.period_id = r.period_id AND a.employee_id = r.employee_id
     )
`);

export const syncPayrollRows = db.transaction((periodId) => {
  /*
   * A LOCKED MONTH IS NEVER TOUCHED. It has been paid and filed; taking a
   * name off it afterwards changes a figure that was already reported.
   */
  const period = db.prepare(`SELECT locked, year, month FROM periods WHERE id = ?`).get(periodId);

  /*
   * Anybody whose last working day has gone comes off the active list here.
   *
   * A date typed in advance - resigned, serving a month's notice - leaves
   * them on the payroll until that day actually passes, which is what the
   * office means by it. This is the sweep that catches up afterwards, so
   * opening December cannot put November's leaver on the sheet.
   */
  db.prepare(
    `UPDATE employees SET active = 0
      WHERE active = 1 AND left_on IS NOT NULL AND left_on <> '' AND left_on <= ?`
  ).run(todayLocal());

  const starts = `${period?.year}-${String(period?.month).padStart(2, '0')}-01`;
  if (!period?.locked) {
    for (const row of strandedRows.all({ period_id: periodId, starts })) {
      db.prepare(`DELETE FROM payroll_rows WHERE id = ?`).run(row.id);
    }
  }

  /*
   * A DRAFT IS NOT ON THE PAYROLL.
   *
   * "Save draft" exists so somebody can start a joining form and finish it
   * on Monday. A half-typed record landing on the salary sheet - with no
   * salary, no joining date and nothing marked - would produce a payslip for
   * a person who has not started, and that is exactly the surprise the draft
   * is meant to avoid.
   */
  const employees = db
    .prepare(`SELECT * FROM employees WHERE active = 1 AND COALESCE(is_draft, 0) = 0`)
    .all();
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

/* ----------------------------------------------------------------- *
 * Penalties, recovered the way a loan is.
 *
 * Asked for as "ek loan ki tarah penalty deduction ka option banavo - jo add
 * kiya ho wo salary me se auto deduct ho jaye". Until now recording a penalty
 * deducted NOTHING and somebody had to press a button, month by month, for
 * every running penalty - which is why one gets recorded and then forgotten.
 *
 * These two live HERE rather than in people.js, where the penalty tables are
 * created, for one reason: people.js imports buildPayroll from payroll.js, so
 * payroll.js importing people.js would be a cycle. Loans sit in this file for
 * the same reason, and the penalty now rides exactly their rails.
 *
 * The table is created by people.js, so a caller that has not loaded it yet
 * (a test importing payroll.js on its own) would otherwise throw and take the
 * whole salary sheet down. It reports no penalties instead, which is true.
 * ----------------------------------------------------------------- */

let penaltyTablesChecked = null;
const havePenaltyTables = () => {
  if (penaltyTablesChecked === null) {
    penaltyTablesChecked = Boolean(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type = 'table' AND name IN ('penalties', 'penalty_recoveries')`
        )
        .get().n === 2
    );
  }
  return penaltyTablesChecked;
};

/**
 * Makes sure every running penalty has a recovery row for this month, set to
 * the instalment or whatever is left of it, whichever is smaller.
 *
 * Rows that already exist are left alone, so a month set to nothing by hand
 * stays nothing - the same promise the loan ledger makes. A penalty that is
 * waived or on hold posts nothing.
 */
export const postPenaltyRecoveries = (periodId) => {
  if (!havePenaltyTables()) return 0;
  return db.transaction((pid) => {
    const penalties = db
      .prepare(
        `SELECT p.*,
                (SELECT COALESCE(SUM(r.amount), 0) FROM penalty_recoveries r WHERE r.penalty_id = p.id) AS taken
         FROM penalties p WHERE p.status = 'open'`
      )
      .all();
    const existing = new Set(
      db.prepare(`SELECT penalty_id FROM penalty_recoveries WHERE period_id = ?`).all(pid)
        .map((r) => r.penalty_id)
    );
    const insert = db.prepare(
      `INSERT INTO penalty_recoveries (penalty_id, period_id, amount, by_whom, in_deduction)
       VALUES (?, ?, ?, 'automatic', 0)`
    );
    let added = 0;
    for (const penalty of penalties) {
      if (existing.has(penalty.id)) continue;
      const outstanding = Number(penalty.amount) - (Number(penalty.taken) || 0);
      if (outstanding <= 0) continue;
      const months = Math.max(1, Number(penalty.months) || 1);
      // The last month carries the rounding, so the instalments add up to the
      // penalty exactly rather than leaving a rupee behind for ever.
      const instalment = Math.round(Number(penalty.amount) / months);
      const amount = Math.min(instalment > 0 ? instalment : outstanding, outstanding);
      if (amount <= 0) continue;
      insert.run(penalty.id, pid, amount);
      added++;
    }
    // Anything now fully taken stops being open, so it posts nothing next month.
    db.exec(`
      UPDATE penalties SET status = 'recovered'
      WHERE status = 'open'
        AND amount <= (SELECT COALESCE(SUM(r.amount), 0) FROM penalty_recoveries r
                       WHERE r.penalty_id = penalties.id)
    `);
    return added;
  })(periodId);
};

/**
 * employee_id -> what comes off their salary this month, and what for.
 *
 * `in_deduction = 1` marks the rows taken BEFORE this was automatic, whose
 * money was written straight into payroll_rows.deduction by the old button.
 * Counting those here would charge an already-closed month a second time, so
 * they are left where they are and only the ledger's own rows are summed.
 */
export function penaltyDeductions(periodId) {
  if (!havePenaltyTables()) return new Map();
  const rows = db
    .prepare(
      `SELECT p.employee_id, r.amount, p.note, p.kind
       FROM penalty_recoveries r JOIN penalties p ON p.id = r.penalty_id
       WHERE r.period_id = ? AND COALESCE(r.in_deduction, 0) = 0`
    )
    .all(periodId);
  const out = new Map();
  for (const r of rows) {
    const at = out.get(r.employee_id) || { amount: 0, notes: [] };
    at.amount += Number(r.amount) || 0;
    if (r.note) at.notes.push(r.note);
    out.set(r.employee_id, at);
  }
  return out;
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

/**
 * Every repayment ever posted, with the month it came out of.
 *
 * `listRepayments` above answers "what is coming out THIS month", which the
 * salary sheet needs. The settlement report needs the other question - the
 * whole history of a loan - because that is where the month it finished in
 * actually lives. Closure is never stored: the repayments ARE the record,
 * and a second `closed_on` column would disagree with them the first time an
 * instalment was edited, which the office is allowed to do.
 */
export function allRepayments() {
  return db
    .prepare(
      `SELECT r.loan_id, r.amount, p.year, p.month, p.label AS period_label
         FROM loan_repayments r
         JOIN periods p ON p.id = r.period_id
        ORDER BY p.year, p.month`
    )
    .all();
}

/* ------------------------------------------------------------------
 * Settings, and the leave bonus.
 * ------------------------------------------------------------------ */

db.exec(`
  -- Office-wide settings that decide money. Deliberately NOT localStorage:
  -- a rule that says what a bonus pays must not live in one person's
  -- browser, where the next person running it would get another answer.
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    by_whom    TEXT
  );

  -- One row per person per month the bonus was actually paid in. This is
  -- the ledger; the addition on the payroll row is the money. The same
  -- split as a penalty and its recovery, so the two cannot drift, and the
  -- unique index is what stops a second click paying twice.
  CREATE TABLE IF NOT EXISTS bonus_payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id   INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'leave',
    amount      REAL NOT NULL,
    days_off    REAL NOT NULL DEFAULT 0,
    note        TEXT,
    by_whom     TEXT,
    paid_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bonus_once
    ON bonus_payments(period_id, employee_id, kind);
`);

export const getSetting = (key, fallback = null) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
};

export function setSetting(key, value, by) {
  db.prepare(
    `INSERT INTO settings (key, value, by_whom) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = datetime('now'), by_whom = excluded.by_whom`
  ).run(key, JSON.stringify(value), by || null);
  audit({
    who: by,
    action: 'changed',
    entity: 'settings',
    label: key,
    to_value: JSON.stringify(value),
  });
  return getSetting(key);
}

export const listBonusPayments = (periodId, kind = 'leave') =>
  db
    .prepare(
      `SELECT b.*, e.name AS employee_name, e.code AS employee_code
         FROM bonus_payments b
         JOIN employees e ON e.id = b.employee_id
        WHERE b.period_id = ? AND b.kind = ?
        ORDER BY e.name`
    )
    .all(periodId, kind);

/**
 * PAY THE BONUS INTO A NAMED MONTH.
 *
 * The one call that moves money, exactly like `payClaim` and a penalty
 * recovery beside it: the amount is ADDED to whatever the row already
 * carries, never replacing it, and the ledger row is what stops the same
 * month being paid twice.
 *
 * It takes the lines it was SHOWN, so what the office read on the screen is
 * what goes out - not a second run of the rule that might have moved under
 * them while they were looking at it.
 */
export function payBonus(periodId, lines = [], { by, kind = 'leave', note } = {}) {
  const period = db.prepare(`SELECT * FROM periods WHERE id = ?`).get(Number(periodId));
  if (!period) throw new Error('pick a month to pay it in');
  if (period.locked) throw new Error(`${period.label} is closed`);

  const paid = [];
  const skipped = [];
  const run = db.transaction(() => {
    for (const line of lines) {
      const employeeId = Number(line.employee_id);
      const amount = Math.round(Number(line.amount) || 0);
      if (!employeeId || amount <= 0) continue;

      const already = db
        .prepare(
          `SELECT id FROM bonus_payments WHERE period_id = ? AND employee_id = ? AND kind = ?`
        )
        .get(period.id, employeeId, kind);
      if (already) {
        skipped.push({ employee_id: employeeId, why: 'already paid this month' });
        continue;
      }

      const row = db
        .prepare(`SELECT * FROM payroll_rows WHERE period_id = ? AND employee_id = ?`)
        .get(period.id, employeeId);
      if (!row) {
        skipped.push({ employee_id: employeeId, why: `no row in ${period.label}` });
        continue;
      }

      const remark = [row.adjustment_note, note || 'leave bonus'].filter(Boolean).join('; ');
      db.prepare(`UPDATE payroll_rows SET addition = ?, adjustment_note = ? WHERE id = ?`).run(
        (Number(row.addition) || 0) + amount,
        remark,
        row.id
      );
      db.prepare(
        `INSERT INTO bonus_payments (period_id, employee_id, kind, amount, days_off, note, by_whom)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(period.id, employeeId, kind, amount, Number(line.days_off) || 0, note || null, by || null);
      paid.push({ employee_id: employeeId, amount });
    }
  });
  run();

  if (paid.length) {
    audit({
      who: by,
      action: 'paid',
      entity: 'bonus_payments',
      label: `${period.label} — ${paid.length} people`,
      to_value: String(paid.reduce((t, p) => t + p.amount, 0)),
      note: note || 'leave bonus',
    });
  }
  return { paid, skipped, period };
}

/** Taking one back, when it was paid by mistake. */
export function unpayBonus(id, by) {
  const row = db.prepare(`SELECT * FROM bonus_payments WHERE id = ?`).get(Number(id));
  if (!row) throw new Error('not found');
  const period = db.prepare(`SELECT * FROM periods WHERE id = ?`).get(row.period_id);
  if (period?.locked) throw new Error(`${period.label} is closed`);
  const payroll = db
    .prepare(`SELECT * FROM payroll_rows WHERE period_id = ? AND employee_id = ?`)
    .get(row.period_id, row.employee_id);
  if (payroll) {
    /* Take back exactly what was added, never below zero - the row may
       carry other additions and they are not this module's to remove. */
    db.prepare(`UPDATE payroll_rows SET addition = ? WHERE id = ?`).run(
      Math.max(0, (Number(payroll.addition) || 0) - Number(row.amount)),
      payroll.id
    );
  }
  db.prepare(`DELETE FROM bonus_payments WHERE id = ?`).run(row.id);
  audit({
    who: by,
    action: 'deleted',
    entity: 'bonus_payments',
    entity_id: row.id,
    label: `${period?.label || ''} bonus taken back`,
    from_value: String(row.amount),
  });
  return true;
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
/* ---------------- the leave ledger ---------------- */

/*
 * A CREDIT IS A DECISION; A DEBIT IS A MARK.
 *
 * Only credits are stored. What somebody has TAKEN is counted off the
 * attendance marks every time it is asked for, because those marks are what
 * the salary sheet is paid from - and two records of the same fact is how
 * two answers to "how much leave has she had" come to exist.
 *
 * Nothing here can move a rupee: `calculateRow` never reads this table.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS leave_credits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    -- CL, SL, PL... the same codes the grid marks and the sheet pays from.
    code        TEXT NOT NULL,
    -- opening | annual | monthly | carry_forward | adjustment | encashed | expiry
    kind        TEXT NOT NULL DEFAULT 'adjustment',
    on_date     TEXT NOT NULL,
    days        REAL NOT NULL,
    note        TEXT,
    reference   TEXT,
    by_whom     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_leave_credits ON leave_credits(employee_id, code, on_date);
`);

export const listLeaveCredits = ({ employee_id, code, year } = {}) => {
  const where = [];
  const params = [];
  if (employee_id) {
    where.push('employee_id = ?');
    params.push(Number(employee_id));
  }
  if (code) {
    where.push('code = ?');
    params.push(String(code).toUpperCase());
  }
  if (year) {
    where.push("substr(on_date, 1, 4) = ?");
    params.push(String(year));
  }
  return db
    .prepare(
      `SELECT * FROM leave_credits ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY on_date, id`
    )
    .all(...params);
};

export function addLeaveCredit(input = {}, by) {
  const employee = getEmployee(Number(input.employee_id));
  if (!employee) throw new Error('employee not found');
  const code = String(input.code || '').trim().toUpperCase();
  if (!code) throw new Error('which kind of leave?');
  const days = Number(input.days);
  if (!Number.isFinite(days) || days === 0) throw new Error('how many days?');
  /* A reason is required on an adjustment and on nothing else: the other
     kinds say what they are by their name. */
  if (input.kind === 'adjustment' && !String(input.note || '').trim()) {
    throw new Error('say why it is being adjusted');
  }
  const info = db
    .prepare(
      `INSERT INTO leave_credits (employee_id, code, kind, on_date, days, note, reference, by_whom)
       VALUES (@employee_id, @code, @kind, @on_date, @days, @note, @reference, @by_whom)`
    )
    .run({
      employee_id: employee.id,
      code,
      kind: input.kind || 'adjustment',
      on_date: input.on_date || new Date().toISOString().slice(0, 10),
      days: Math.abs(days),
      note: input.note || null,
      reference: input.reference || null,
      by_whom: by || null,
    });
  audit({
    who: by,
    action: 'created',
    entity: 'leave_credits',
    entity_id: info.lastInsertRowid,
    label: `${employee.name} — ${code}`,
    to_value: String(days),
    note: input.note || input.kind || null,
  });
  return db.prepare(`SELECT * FROM leave_credits WHERE id = ?`).get(info.lastInsertRowid);
}

export function deleteLeaveCredit(id, by) {
  const before = db.prepare(`SELECT * FROM leave_credits WHERE id = ?`).get(Number(id));
  if (!before) return false;
  const gone = db.prepare(`DELETE FROM leave_credits WHERE id = ?`).run(Number(id)).changes > 0;
  if (gone) {
    audit({
      who: by,
      action: 'deleted',
      entity: 'leave_credits',
      entity_id: Number(id),
      label: `${nameOfEmployee(before.employee_id)} — ${before.code}`,
      from_value: String(before.days),
    });
  }
  return gone;
}

const nameOfEmployee = (id) => getEmployee(id)?.name || `#${id}`;

/**
 * WHAT SOMEBODY HAS TAKEN, off the marks - never stored.
 *
 * One row per person, per code, per month, carrying the days of the month it
 * was taken on so the ledger can print "18, 19, 20 October" rather than a
 * bare count nobody can check.
 */
export function leaveTaken({ year, employee_id, codes = ['CL', 'SL', 'PL', 'UL'] } = {}) {
  const marks = codes.map(() => '?').join(', ');
  const params = [Number(year), ...codes];
  let filter = '';
  if (employee_id) {
    filter = 'AND a.employee_id = ?';
    params.push(Number(employee_id));
  }
  return db
    .prepare(
      `SELECT a.employee_id, a.code, p.id AS period_id, p.label AS period_label,
              p.year, p.month, COUNT(*) AS days,
              GROUP_CONCAT(a.day, ', ') AS days_of_month
       FROM attendance a JOIN periods p ON p.id = a.period_id
       WHERE p.year = ? AND a.code IN (${marks}) ${filter}
       GROUP BY a.employee_id, a.code, p.id
       ORDER BY p.year, p.month`
    )
    .all(...params)
    .map((r) => ({
      ...r,
      dates: r.days_of_month,
      /* A date the ledger can sort on: the first of the month it was marked
         in. The exact days are in `dates`; a leave taken on the 18th and one
         on the 20th of the same month are one line, as a ledger would. */
      date: `${r.year}-${String(r.month).padStart(2, '0')}-01`,
    }));
}

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

/** The clock-time columns on an attendance row, in the order they happen. */
const TIME_COLUMNS = ['in_time', 'lunch_out', 'lunch_in', 'out_time'];

/**
 * Marks the clock times are allowed to overwrite. Everything else - leave, a
 * holiday, a Sunday - was a deliberate decision and keeps its mark; the hours
 * are still recorded against it. The same set the Time tab uses.
 */
const AUTO_MARKS = new Set(['', 'P', 'A', 'HF']);

export function listAttendance(periodId, { company_id } = {}) {
  const params = [periodId];
  let filter = '';
  if (company_id) {
    filter = 'AND e.company_id = ?';
    params.push(company_id);
  }
  return db
    .prepare(
      `SELECT a.employee_id, a.day, a.code, a.minutes,
              a.in_time, a.lunch_out, a.lunch_in, a.out_time,
              a.reason, a.approved, a.uniform
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
    map.get(row.employee_id)[row.day] = {
      code: row.code || '',
      minutes: row.minutes || 0,
      in_time: row.in_time || '',
      lunch_out: row.lunch_out || '',
      lunch_in: row.lunch_in || '',
      out_time: row.out_time || '',
      reason: row.reason || '',
      // null stays null: "nobody has decided" is not "not approved", and
      // "nobody looked at the uniform" is not "turned up wrong".
      approved: row.approved === null || row.approved === undefined ? null : Boolean(row.approved),
      uniform: row.uniform === null || row.uniform === undefined ? null : Boolean(row.uniform),
    };
  }
  return map;
}

export const setAttendance = db.transaction((periodId, entries) => {
  const upsert = db.prepare(
    `INSERT INTO attendance
       (period_id, employee_id, day, code, minutes, in_time, lunch_out, lunch_in, out_time,
        reason, approved, uniform)
     VALUES (@period_id, @employee_id, @day, @code, @minutes,
             @in_time, @lunch_out, @lunch_in, @out_time, @reason, @approved, @uniform)
     ON CONFLICT(period_id, employee_id, day)
     DO UPDATE SET code = excluded.code, minutes = excluded.minutes,
                   in_time = excluded.in_time, lunch_out = excluded.lunch_out,
                   lunch_in = excluded.lunch_in, out_time = excluded.out_time,
                   reason = excluded.reason, approved = excluded.approved,
                   uniform = excluded.uniform`
  );
  const existing = db.prepare(
    `SELECT code, minutes, in_time, lunch_out, lunch_in, out_time, reason, approved, uniform
     FROM attendance
     WHERE period_id = ? AND employee_id = ? AND day = ?`
  );
  // The month's own hours, so the half-day line and the shortfall are judged
  // against the day this month is actually paid on.
  const month = db
    .prepare(`SELECT hours_per_day, lunch_paid, shift_in, shift_out FROM periods WHERE id = ?`)
    .get(periodId);
  const hoursPerDay = Number(month?.hours_per_day) || 9;
  /*
   * ...and HOW LONG THIS PERSON'S OWN DAY IS.
   *
   * Shifts were already held per person and already judged late and early
   * against - but the short hours were worked out against the month's figure
   * for everybody, so only WHEN a shift started was personal and never how
   * long it ran. A ten-hour shift collected an hour of overtime for simply
   * being worked; a six-hour part-timer was docked three hours a day for
   * finishing on time.
   *
   * Looked up once per person, not per mark: a bulk change is two thousand
   * rows. Somebody on the office day gets the month's figure exactly as
   * before, so no existing month can move.
   */
  const shiftHours = new Map();
  const hoursFor = (id) => {
    if (!shiftHours.has(id)) {
      const employee = db
        .prepare(`SELECT shift_in, shift_out FROM employees WHERE id = ?`)
        .get(id);
      shiftHours.set(id, hoursForEmployee(employee || {}, { period: month || {} }));
    }
    return shiftHours.get(id);
  };
  // ...and whether the lunch break comes off it. Off by default, so no month
  // already paid moves; see the column's note above.
  const deductLunch = !month?.lunch_paid;
  /*
   * The attendance trail. A mark REPLACED by a different mark is recorded; a
   * blank day being filled in is not. That is the line worth drawing: "Mark
   * everyone Present" and the punch import only ever fill blanks, so they stay
   * out of the trail, while a correction - somebody's absence turned into a
   * paid leave after the fact - is exactly what anybody would come looking for.
   * Names are looked up once, not per mark: a bulk change is two thousand rows.
   */
  const names = new Map();
  const nameOf = (id) => {
    if (!names.has(id)) names.set(id, db.prepare(`SELECT name FROM employees WHERE id = ?`).get(id)?.name || `#${id}`);
    return names.get(id);
  };
  const monthLabel = db.prepare(`SELECT label FROM periods WHERE id = ?`).get(periodId)?.label || `period ${periodId}`;
  const changes = [];
  const remove = db.prepare(
    `DELETE FROM attendance WHERE period_id = ? AND employee_id = ? AND day = ?`
  );
  for (const entry of entries) {
    const employeeId = Number(entry.employee_id);
    const day = Number(entry.day);
    if (!employeeId || !day) continue;

    /*
     * The grid saves marks, the Time tab saves clock times and the punch import
     * saves in and out, all through here. EVERY column is only touched by an
     * entry that actually names it, so marking somebody Present never wipes
     * their hours and an import that knows nothing about lunch leaves the lunch
     * that was typed. Naming one with an empty value clears it.
     *
     * `code` and `minutes` were once outside that rule, and it cost: a punch
     * names only a time, so `code` arrived as '' and the upsert wrote it - a
     * punch on a day marked Paid Holiday or Casual Leave silently cleared the
     * mark, taking the leave off the register with it.
     */
    const stored = existing.get(periodId, employeeId, day);
    const times = {};
    for (const column of TIME_COLUMNS) {
      const value = column in entry ? entry[column] : stored?.[column];
      times[column] = value === undefined || value === null || value === '' ? null : String(value);
    }
    const anyTime = TIME_COLUMNS.some((c) => times[c]);

    let code =
      'code' in entry
        ? String(entry.code || '').trim().toUpperCase()
        : String(stored?.code || '').trim().toUpperCase();
    let minutes = 'minutes' in entry ? Number(entry.minutes) || 0 : Number(stored?.minutes) || 0;

    /*
     * The reason somebody was not at work, and whether it was allowed.
     *
     * Same per-field rule as the times: only an entry that NAMES one touches
     * it, so "Mark everyone Present" cannot wipe a reason typed that morning
     * and a punch import cannot un-approve an absence.
     *
     * `approved` carries three states. null is "nobody has decided", which is
     * NOT "not approved" - a day nobody has looked at must not read as a
     * refusal. Naming it with null hands the decision back.
     */
    const reason =
      'reason' in entry
        ? String(entry.reason ?? '').trim() || null
        : stored?.reason || null;
    const approved =
      'approved' in entry
        ? entry.approved === null || entry.approved === undefined || entry.approved === ''
          ? null
          : Number(Boolean(entry.approved))
        : stored?.approved === null || stored?.approved === undefined
          ? null
          : Number(stored.approved);
    /*
     * The uniform check. Three-state for the same reason: a floor nobody
     * checked must not read as a floor full of offenders. It moves no money -
     * it is a record, not a fine.
     */
    const uniform =
      'uniform' in entry
        ? entry.uniform === null || entry.uniform === undefined || entry.uniform === ''
          ? null
          : Number(Boolean(entry.uniform))
        : stored?.uniform === null || stored?.uniform === undefined
          ? null
          : Number(stored.uniform);

    /*
     * Clock times become money HERE, not in the browser.
     *
     * The rule used to live only in the Time tab, so hours typed there were
     * paid and the identical hours arriving from a phone punch or an approved
     * missing-punch request were not - the Time tab would show "-32m" for a day
     * the salary sheet charged nothing for. Any caller that names times and
     * does not work out the minutes itself now gets them worked out here, from
     * the same `timesToDay` the Time tab uses.
     *
     * A caller that DOES name minutes (the grid, the biometric importer) is
     * left alone: it has already applied the rule and may have its own.
     */
    if (anyTime && !('minutes' in entry)) {
      const judged = timesToDay(times, { hoursPerDay: hoursFor(employeeId), deductLunch });
      minutes = judged.minutes;
      /*
       * The mark is only set from the hours when the day is blank or carries a
       * plain P/A/HF - leave, a holiday or a Sunday keeps its own mark and just
       * records what was worked, which is the rule the Time tab already
       * followed. And a day punched in but never out is marked Present with no
       * minutes: somebody was here, and nothing invents a departure.
       */
      if (!('code' in entry) && AUTO_MARKS.has(code)) {
        if (judged.code) code = judged.code;
        else if (times.in_time) code = 'P';
      }

      /*
       * "A half day is already paid at half" only holds if the day IS a half
       * day.
       *
       * timesToDay zeroes the shortfall once the hours fall under the
       * half-day line, because charging the missing hours on top of half a
       * day's pay would be double. That reasoning disappears the moment a
       * CALLER names a full-day mark: the eSSL Basic Work Duration export
       * marks the day P off the device's own shift rules, we write that P,
       * and the person is then paid a whole day for two hours and fifty-eight
       * minutes with nothing deducted - neither the machine's answer nor
       * ours. In Dinesh's 14-day November file that is 24 days and 149 hours.
       *
       * So when the hours say half day and the mark says full day, the
       * shortfall is charged. Re-asked of the same function with the half-day
       * line removed, rather than re-stating the grace rule here, so there is
       * still one rule.
       *
       * Only for P. A, UL and AD already dock a day; leave, a holiday and a
       * Sunday are paid without hours being expected; SP and HP are paid by
       * the day on the Sunday register, outside the salary this would come
       * out of.
       */
      minutes = minutesForMark(times, { hoursPerDay: hoursFor(employeeId), code, deductLunch });
    }

    // A day with no mark, no minutes and no times has nothing left to record.
    const was = stored?.code || '';
    if (was && was !== code) {
      changes.push({
        who: entry.by || null,
        action: 'changed',
        entity: 'attendance',
        entity_id: employeeId,
        label: `${nameOf(employeeId)}, ${monthLabel} day ${day}`,
        field: 'code',
        from_value: was,
        to_value: code || '(cleared)',
      });
    }

    /*
     * An approval is a DECISION, so the first one is recorded too - unlike a
     * blank mark being filled in, which is not. Somebody deciding that an
     * absence was allowed is exactly what anybody would come looking for
     * later, and "who said this was fine" has to have an answer.
     *
     * A reason is recorded only when it REPLACES one: typing the first reason
     * on a day that had none is filling a blank.
     */
    const wasApproved =
      stored?.approved === null || stored?.approved === undefined ? null : Number(stored.approved);
    if ('approved' in entry && approved !== wasApproved) {
      const say = (v) => (v === null ? 'not decided' : v ? 'approved' : 'not approved');
      changes.push({
        who: entry.by || null,
        action: 'changed',
        entity: 'attendance',
        entity_id: employeeId,
        label: `${nameOf(employeeId)}, ${monthLabel} day ${day}`,
        field: 'approved',
        from_value: say(wasApproved),
        to_value: say(approved),
      });
    }
    const wasUniform =
      stored?.uniform === null || stored?.uniform === undefined ? null : Number(stored.uniform);
    if ('uniform' in entry && uniform !== wasUniform) {
      const say = (v) => (v === null ? 'not checked' : v ? 'proper uniform' : 'not in uniform');
      changes.push({
        who: entry.by || null,
        action: 'changed',
        entity: 'attendance',
        entity_id: employeeId,
        label: `${nameOf(employeeId)}, ${monthLabel} day ${day}`,
        field: 'uniform',
        from_value: say(wasUniform),
        to_value: say(uniform),
      });
    }
    if (stored?.reason && reason !== stored.reason) {
      changes.push({
        who: entry.by || null,
        action: 'changed',
        entity: 'attendance',
        entity_id: employeeId,
        label: `${nameOf(employeeId)}, ${monthLabel} day ${day}`,
        field: 'reason',
        from_value: stored.reason,
        to_value: reason || '(cleared)',
      });
    }

    // A reason or a decision is worth a row of its own: somebody rang in to
    // say they would be out before anybody marked the day.
    if (code || minutes || anyTime || reason || approved !== null || uniform !== null) {
      upsert.run({
        period_id: periodId,
        employee_id: employeeId,
        day,
        code,
        minutes,
        ...times,
        reason,
        approved,
        uniform,
      });
    } else {
      remove.run(periodId, employeeId, day);
    }
  }
  for (const change of changes) audit(change);
  return entries.length;
});

export function clearAttendance(periodId, employeeId) {
  const sql = employeeId
    ? `DELETE FROM attendance WHERE period_id = ? AND employee_id = ?`
    : `DELETE FROM attendance WHERE period_id = ?`;
  const args = employeeId ? [periodId, employeeId] : [periodId];
  return db.prepare(sql).run(...args).changes;
}
