import {
  audit,
  db,
  findPeriod,
  listAudit,
  getEmployee,
  leaveSummary,
  listLoans,
  updateEmployee,
} from './db.js';
import { buildPayroll } from './payroll.js';
import { log } from './logger.js';
import { settlement } from '../../shared/settlement.js';
import { codeProblem, nextCode, tidyCode } from '../../shared/assetCode.js';
import { looksDuplicate, ownership } from '../../shared/maintenance.js';

// The trail itself lives in db.js, because the payroll write paths there write
// to it too and db.js cannot import this file without a cycle.
export { audit, listAudit };

/*
 * The people registers: the paper trail around an employee that is not pay and
 * not attendance.
 *
 * Six tables, each one thing Dinesh named:
 *
 *   employee_notes    warnings and appreciations, on the record
 *   appraisals        a review, its rating, and the increment it led to
 *   assets            the laptop, the ID card, the SIM - who has it, is it back
 *   employee_exits    resignation, notice, last working day, full and final
 *   expense_claims    travel, food, petrol - raised, decided, paid
 *   audit_log         who changed what, and when
 *
 * Two rules hold across all of them.
 *
 * **Nothing decides itself.** A claim is approved by somebody, an increment is
 * applied by somebody, a settlement is marked paid by somebody. A pending row
 * changes nobody's pay, and a row that was never approved can never be paid.
 *
 * **Money only reaches the payroll through a button.** An approved claim does
 * not quietly appear in a month's additions; posting it is a separate act that
 * records where it went, and posting it twice does not pay it twice.
 */

db.exec(`
  /* ---------------- warnings and appreciations ---------------- */
  -- One table, because they are the same record with opposite signs, and a
  -- person's file should read in one order whichever kind it is.
  CREATE TABLE IF NOT EXISTS employee_notes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL DEFAULT 'note',   -- warning | appreciation | note
    severity     TEXT,                            -- verbal | written | final (warnings)
    dated        TEXT NOT NULL,
    subject      TEXT NOT NULL,
    detail       TEXT,
    issued_by    TEXT,
    -- A warning the person never saw is not much of a warning, so when it was
    -- acknowledged is part of the record.
    acknowledged_on TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notes_employee ON employee_notes(employee_id, dated);

  /* ---------------- appraisals and increments ---------------- */
  -- The salary change itself still goes through updateEmployee, so it lands in
  -- employee_history like any other. This holds the review it came out of:
  -- which cycle, what rating, what was agreed, and whether it has been applied.
  CREATE TABLE IF NOT EXISTS appraisals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle          TEXT,                 -- "2026-27", "H1 2026"
    reviewed_on    TEXT NOT NULL,
    reviewed_by    TEXT,
    rating         TEXT,
    summary        TEXT,
    from_salary    REAL,
    to_salary      REAL,
    effective_from TEXT,
    -- Null until somebody applies it. Applying writes the new salary onto the
    -- master; until then this is a proposal and nobody is paid differently.
    applied_at     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_appraisals_employee ON appraisals(employee_id, reviewed_on);

  /* ---------------- assets ---------------- */
  CREATE TABLE IF NOT EXISTS assets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    kind          TEXT NOT NULL DEFAULT 'other',
    label         TEXT NOT NULL,
    identifier    TEXT,                  -- serial number, IMEI, SIM number
    value         REAL NOT NULL DEFAULT 0,
    -- Who has it. Null means it is in the office, not that it is lost.
    employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    issued_on     TEXT,
    returned_on   TEXT,
    condition     TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_assets_employee ON assets(employee_id, returned_on);

  /*
   * Every handover, not just the current one.
   *
   * The assets table above holds who has it NOW, which is what every screen
   * asks. It does not hold who had it before: issuing to a second person used
   * to overwrite the first, so "asset history" had nothing behind it. This is
   * the log - append-only, written by the same calls that move the asset, and
   * never read back to work out the current holder. The two answer different
   * questions, so they cannot drift.
   */
  CREATE TABLE IF NOT EXISTS asset_handovers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id      INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    -- Kept as text as well, so a handover slip still reads correctly after
    -- somebody has left and their row is gone.
    employee_name TEXT,
    issued_on     TEXT,
    issued_by     TEXT,
    returned_on   TEXT,
    returned_by   TEXT,
    condition_out TEXT,
    condition_in  TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_handover_asset ON asset_handovers(asset_id, issued_on);
  CREATE INDEX IF NOT EXISTS idx_handover_open ON asset_handovers(asset_id, returned_on);

  /*
   * A stock take. One row per asset actually looked at, grouped by a round.
   *
   * What was NOT found is worked out from the absence of a row rather than
   * stored, so an asset added halfway through a round is simply not yet
   * verified rather than silently counted as missing.
   */
  CREATE TABLE IF NOT EXISTS asset_verifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    round       TEXT NOT NULL,
    found       INTEGER NOT NULL DEFAULT 1,
    verified_on TEXT NOT NULL,
    verified_by TEXT,
    held_by     TEXT,                    -- who had it when it was checked
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    -- One verdict per asset per round. Checking it again replaces the verdict
    -- rather than leaving two that disagree.
    UNIQUE (asset_id, round)
  );
  CREATE INDEX IF NOT EXISTS idx_verify_round ON asset_verifications(round, verified_on);

  /*
   * Photographs of an asset. The file lives on disk; this row only ever holds
   * a generated filename, never the one it was uploaded with.
   *
   * Several per asset on purpose, each with its own note and date: the whole
   * of most arguments about a laptop is what condition it was in when it went
   * out and what condition it came back in, and a line saying "scratched"
   * settles nothing.
   */
  CREATE TABLE IF NOT EXISTS asset_photos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    file_path   TEXT NOT NULL,
    note        TEXT,
    taken_on    TEXT,
    uploaded_by TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_asset_photos ON asset_photos(asset_id, created_at);

  /*
   * What was done to an asset, when, by whom, and what it cost.
   *
   * next_service_on is whatever the person doing the work said, not a date
   * this app works out - "service it again in six months" is a judgement, and
   * guessing one produces reminders nobody asked for and nobody trusts.
   */
  CREATE TABLE IF NOT EXISTS asset_services (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id        INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    serviced_on     TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'Service',
    work            TEXT,
    vendor          TEXT,
    invoice_no      TEXT,
    cost            REAL NOT NULL DEFAULT 0,
    -- Work done under warranty or an AMC still goes on the record, at whatever
    -- it actually cost (often nothing): an asset serviced four times for free
    -- is still an asset serviced four times.
    under_warranty  INTEGER NOT NULL DEFAULT 0,
    next_service_on TEXT,
    note            TEXT,
    logged_by       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_service_asset ON asset_services(asset_id, serviced_on);
  CREATE INDEX IF NOT EXISTS idx_service_due ON asset_services(next_service_on);

  /* ---------------- leaving ---------------- */
  CREATE TABLE IF NOT EXISTS employee_exits (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id       INTEGER NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
    type              TEXT NOT NULL DEFAULT 'resigned',
    resigned_on       TEXT,
    notice_days       INTEGER,
    last_working_day  TEXT,
    reason            TEXT,
    exit_interview    TEXT,
    -- The settlement is NOT stored as a figure: it is assembled from the same
    -- payroll row the payslip uses, so the two cannot disagree. What is stored
    -- is what somebody typed on top of it and when it was paid.
    extras            TEXT,              -- JSON [{label, amount}]
    rules             TEXT,              -- JSON overrides, for a negotiated exit
    settled_on        TEXT,
    settled_amount    REAL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* ---------------- expense claims ---------------- */
  CREATE TABLE IF NOT EXISTS expense_claims (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL DEFAULT 'other', -- travel | food | petrol | other
    spent_on     TEXT NOT NULL,
    amount       REAL NOT NULL DEFAULT 0,
    detail       TEXT,
    -- pending | approved | rejected | paid. Nothing moves to paid without
    -- having been approved first.
    status       TEXT NOT NULL DEFAULT 'pending',
    decided_by   TEXT,
    decided_at   TEXT,
    decision_note TEXT,
    -- Where it was paid from, once it was: the month it was posted into.
    paid_period_id INTEGER REFERENCES periods(id) ON DELETE SET NULL,
    paid_at      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_claims_employee ON expense_claims(employee_id, spent_on);
  CREATE INDEX IF NOT EXISTS idx_claims_status ON expense_claims(status);

`);

/* ================================================================= *
 * audit trail
 * ================================================================= */

/** The kinds of asset the pickers offer. Free text still works. */
/*
 * The asset register grew up.
 *
 * `code` is the human asset ID that goes on the label - a database id means
 * nothing written on a laptop. The purchase side (date, vendor, invoice,
 * warranty) was one `value` field doing two jobs: "what it cost" and "what it
 * is worth". `purchase_cost` is what it cost, and nothing else; a current
 * valuation is a different question nobody has asked for yet.
 */
const ASSET_COLUMNS = [
  ['code', 'TEXT'],
  ['branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],
  ['purchase_cost', 'REAL NOT NULL DEFAULT 0'],
  ['purchase_date', 'TEXT'],
  ['vendor', 'TEXT'],
  ['invoice_no', 'TEXT'],
  ['warranty_until', 'TEXT'],
  // An AMC is a separate contract from the warranty and runs out on its own
  // date, so it is its own column rather than being folded in.
  ['amc_until', 'TEXT'],
  ['amc_vendor', 'TEXT'],
  ['amc_cost', 'REAL'],
  // An asset that is gone keeps its row and its code, because an old service
  // bill and a signed handover slip still refer to it.
  ['written_off_on', 'TEXT'],
  ['written_off_why', 'TEXT'],
];

const assetColumns = () => db.prepare(`PRAGMA table_info(assets)`).all().map((c) => c.name);

for (const [column, type] of ASSET_COLUMNS) {
  if (!assetColumns().includes(column)) {
    db.exec(`ALTER TABLE assets ADD COLUMN ${column} ${type}`);
    log.info(`Migrated assets: added ${column}.`);
  }
}

// `value` meant the purchase cost everywhere it was used, so move it across
// and take the old column away - a column that must never be written again is
// exactly how two numbers end up disagreeing.
if (assetColumns().includes('value')) {
  db.exec(`UPDATE assets SET purchase_cost = value WHERE purchase_cost = 0 AND value <> 0`);
  db.exec(`ALTER TABLE assets DROP COLUMN value`);
  log.info('Migrated assets: value became purchase_cost.');
}

// One asset code, used once. Partial, because most rows carry no code yet.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_code ON assets(code) WHERE code IS NOT NULL`);

/** Today, as the app writes dates everywhere: YYYY-MM-DD. */
const dayNow = () => new Date().toISOString().slice(0, 10);

/*
 * Columns the People redesign asked for that no table had. Each is nullable
 * and none of them can move a rupee - they are things the office writes down,
 * not inputs to a calculation.
 */
const addColumns = (table, columns) => {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [column, type] of columns) {
    if (have.has(column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    log.info(`Migrated ${table}: added ${column}.`);
  }
};

addColumns('appraisals', [
  // When the next review is due. Without it "appraisal due" cannot be a
  // reminder, only a thing somebody remembers.
  ['next_review_on', 'TEXT'],
]);
addColumns('employee_notes', [
  /*
   * The KIND of warning, which is not its SEVERITY. "Written" says how
   * formally it was given; "Attendance" says what it was about. A record you
   * cannot group by subject is a record nobody reads back.
   */
  ['category', 'TEXT'],
]);
addColumns('employee_documents', [
  // Seen and checked against the original, by whom and when. A scan on file
  // is not the same as a document somebody has verified.
  ['verified_on', 'TEXT'],
  ['verified_by', 'TEXT'],
]);
addColumns('employee_exits', [
  // The clearance list, as JSON [{item, done, note}]. Kept with the exit
  // rather than as its own table: it exists only while somebody is leaving.
  ['clearance', 'TEXT'],
]);

export const ASSET_KINDS = [
  'Laptop',
  'Desktop',
  'Mobile',
  'SIM card',
  'ID card',
  'Access card',
  'Vehicle',
  'Tools',
  'Furniture',
  'Other',
];

export const CLAIM_KINDS = ['Travel', 'Food', 'Petrol', 'Lodging', 'Phone', 'Other'];
export const NOTE_KINDS = ['warning', 'appreciation', 'note'];
export const WARNING_LEVELS = ['verbal', 'written', 'final'];
export const CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'paid'];

/* ================================================================= *
 * warnings and appreciations
 * ================================================================= */

const nameOf = (employeeId) => getEmployee(employeeId)?.name || `#${employeeId}`;

export function listNotes(employeeId, { kind } = {}) {
  const params = [Number(employeeId)];
  let filter = '';
  if (kind) {
    filter = 'AND kind = ?';
    params.push(kind);
  }
  return db
    .prepare(
      `SELECT * FROM employee_notes WHERE employee_id = ? ${filter}
       ORDER BY dated DESC, id DESC`
    )
    .all(...params);
}

/** Everyone's, newest first - for the "on the record" list across the office. */
export function listAllNotes({ kind, limit = 200 } = {}) {
  const params = [];
  let filter = '';
  if (kind) {
    filter = 'WHERE n.kind = ?';
    params.push(kind);
  }
  return db
    .prepare(
      `SELECT n.*, e.name AS employee_name, c.name AS company_name
       FROM employee_notes n
       JOIN employees e ON e.id = n.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       ${filter}
       ORDER BY n.dated DESC, n.id DESC LIMIT ?`
    )
    .all(...params, Math.min(1000, Number(limit) || 200));
}

export function createNote(employeeId, input = {}) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new Error('employee not found');
  const kind = NOTE_KINDS.includes(input.kind) ? input.kind : 'note';
  const subject = String(input.subject || '').trim();
  if (!subject) throw new Error('say what it is about in a line');
  const dated = String(input.dated || '').trim() || new Date().toISOString().slice(0, 10);
  const info = db
    .prepare(
      `INSERT INTO employee_notes (employee_id, kind, severity, category, dated, subject, detail, issued_by, acknowledged_on)
       VALUES (@employee_id, @kind, @severity, @category, @dated, @subject, @detail, @issued_by, @acknowledged_on)`
    )
    .run({
      employee_id: employee.id,
      kind,
      severity: kind === 'warning' ? input.severity || 'verbal' : null,
      category: input.category || null,
      dated,
      subject,
      detail: input.detail || null,
      issued_by: input.issued_by || null,
      acknowledged_on: input.acknowledged_on || null,
    });
  audit({
    who: input.by,
    action: 'created',
    entity: 'employee_notes',
    entity_id: info.lastInsertRowid,
    label: `${kind} for ${employee.name}`,
    note: subject,
  });
  return getNote(info.lastInsertRowid);
}

export const getNote = (id) => db.prepare(`SELECT * FROM employee_notes WHERE id = ?`).get(id) || null;

export function updateNote(id, patch = {}) {
  const before = getNote(id);
  if (!before) throw new Error('not found');
  const fields = [];
  const values = [];
  for (const key of ['kind', 'severity', 'category', 'dated', 'subject', 'detail', 'issued_by', 'acknowledged_on']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(patch[key] === '' ? null : patch[key]);
  }
  if (!fields.length) return before;
  db.prepare(`UPDATE employee_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  audit({
    who: patch.by,
    action: 'changed',
    entity: 'employee_notes',
    entity_id: id,
    label: `${before.kind} for ${nameOf(before.employee_id)}`,
  });
  return getNote(id);
}

export function deleteNote(id, by) {
  const before = getNote(id);
  if (!before) return false;
  const gone = db.prepare(`DELETE FROM employee_notes WHERE id = ?`).run(id).changes > 0;
  if (gone) {
    audit({
      who: by,
      action: 'deleted',
      entity: 'employee_notes',
      entity_id: id,
      label: `${before.kind} for ${nameOf(before.employee_id)}`,
      note: before.subject,
    });
  }
  return gone;
}

/* ================================================================= *
 * appraisals and increments
 * ================================================================= */

export const getAppraisal = (id) => db.prepare(`SELECT * FROM appraisals WHERE id = ?`).get(id) || null;

export function listAppraisals(employeeId) {
  return db
    .prepare(`SELECT * FROM appraisals WHERE employee_id = ? ORDER BY reviewed_on DESC, id DESC`)
    .all(Number(employeeId))
    .map(withIncrement);
}

export function listAllAppraisals({ cycle, pending, limit = 300 } = {}) {
  const where = [];
  const params = [];
  if (cycle) {
    where.push('a.cycle = ?');
    params.push(cycle);
  }
  if (pending) where.push('a.applied_at IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT a.*, e.name AS employee_name, e.monthly_salary, c.name AS company_name
       FROM appraisals a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       ${clause}
       ORDER BY a.reviewed_on DESC, a.id DESC LIMIT ?`
    )
    .all(...params, Math.min(1000, Number(limit) || 300))
    .map(withIncrement);
}

/** The increment in rupees and per cent, worked out rather than stored. */
function withIncrement(row) {
  const from = Number(row.from_salary) || 0;
  const to = Number(row.to_salary) || 0;
  const rise = to - from;
  return {
    ...row,
    increment: rise,
    increment_pct: from > 0 ? Math.round((rise / from) * 1000) / 10 : null,
    applied: Boolean(row.applied_at),
  };
}

export function createAppraisal(employeeId, input = {}) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new Error('employee not found');
  const reviewed = String(input.reviewed_on || '').trim() || new Date().toISOString().slice(0, 10);
  // The salary it is measured against is what they are on now, unless somebody
  // says otherwise - so an increment can never be measured off a stale figure.
  const from = input.from_salary === undefined ? Number(employee.monthly_salary) || 0 : Number(input.from_salary) || 0;
  const to = input.to_salary === undefined || input.to_salary === '' ? null : Number(input.to_salary);
  if (to !== null && !(to >= 0)) throw new Error('the new salary must be a number');
  const info = db
    .prepare(
      `INSERT INTO appraisals (employee_id, cycle, reviewed_on, reviewed_by, rating, summary,
                               from_salary, to_salary, effective_from, next_review_on)
       VALUES (@employee_id, @cycle, @reviewed_on, @reviewed_by, @rating, @summary,
               @from_salary, @to_salary, @effective_from, @next_review_on)`
    )
    .run({
      employee_id: employee.id,
      cycle: input.cycle || null,
      reviewed_on: reviewed,
      reviewed_by: input.reviewed_by || null,
      rating: input.rating || null,
      summary: input.summary || null,
      from_salary: from,
      to_salary: to,
      effective_from: input.effective_from || null,
      next_review_on: input.next_review_on || null,
    });
  audit({
    who: input.by,
    action: 'created',
    entity: 'appraisals',
    entity_id: info.lastInsertRowid,
    label: `appraisal for ${employee.name}`,
    from_value: from,
    to_value: to,
  });
  return getAppraisal(info.lastInsertRowid);
}

export function updateAppraisal(id, patch = {}) {
  const before = getAppraisal(id);
  if (!before) throw new Error('not found');
  if (before.applied_at && ('to_salary' in patch || 'from_salary' in patch)) {
    throw new Error('this increment has been applied - raise a new appraisal rather than editing it');
  }
  const fields = [];
  const values = [];
  for (const key of ['cycle', 'reviewed_on', 'reviewed_by', 'rating', 'summary', 'from_salary', 'to_salary', 'effective_from', 'next_review_on']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(patch[key] === '' ? null : patch[key]);
  }
  if (!fields.length) return withIncrement(before);
  db.prepare(`UPDATE appraisals SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  audit({ who: patch.by, action: 'changed', entity: 'appraisals', entity_id: id, label: `appraisal for ${nameOf(before.employee_id)}` });
  return withIncrement(getAppraisal(id));
}

/**
 * Apply the increment: write the new salary onto the master.
 *
 * This is the only thing here that moves money, and it is a button rather than
 * a consequence of filling the form in. It refuses twice, and it refuses
 * without a new salary - an appraisal with no number is a review, not a rise.
 * The salary change itself goes through `updateEmployee`, so it lands in
 * employee_history like any other.
 */
export function applyAppraisal(id, { by } = {}) {
  const row = getAppraisal(id);
  if (!row) throw new Error('not found');
  if (row.applied_at) return { appraisal: withIncrement(row), employee: getEmployee(row.employee_id), applied: false };
  const to = Number(row.to_salary);
  if (!(to > 0)) throw new Error('set the new salary before applying it');

  const employee = updateEmployee(row.employee_id, {
    monthly_salary: to,
    history_note: `Appraisal${row.cycle ? ` ${row.cycle}` : ''}${row.rating ? `, rated ${row.rating}` : ''}`,
  });
  db.prepare(`UPDATE appraisals SET applied_at = datetime('now') WHERE id = ?`).run(id);
  audit({
    who: by,
    action: 'applied',
    entity: 'appraisals',
    entity_id: id,
    label: `increment for ${employee.name}`,
    field: 'monthly_salary',
    from_value: row.from_salary,
    to_value: to,
  });
  return { appraisal: withIncrement(getAppraisal(id)), employee, applied: true };
}

export function deleteAppraisal(id, by) {
  const before = getAppraisal(id);
  if (!before) return false;
  if (before.applied_at) throw new Error('this increment has been paid - it stays on the record');
  const gone = db.prepare(`DELETE FROM appraisals WHERE id = ?`).run(id).changes > 0;
  if (gone) audit({ who: by, action: 'deleted', entity: 'appraisals', entity_id: id, label: `appraisal for ${nameOf(before.employee_id)}` });
  return gone;
}

/* ================================================================= *
 * assets
 * ================================================================= */

export const getAsset = (id) =>
  db
    .prepare(
      `SELECT a.*, e.name AS employee_name, c.name AS company_name, br.name AS branch_name
       FROM assets a
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN companies c ON c.id = a.company_id
       LEFT JOIN branches br ON br.id = a.branch_id
       WHERE a.id = ?`
    )
    .get(id) || null;

export const getAssetByCode = (code) => {
  const row = db.prepare(`SELECT id FROM assets WHERE code = ?`).get(tidyCode(code));
  return row ? getAsset(row.id) : null;
};

export function listAssets({ employee_id, company_id, branch_id, out, written_off = false, round } = {}) {
  const where = [];
  const params = [];
  if (employee_id) {
    where.push('a.employee_id = ?');
    params.push(Number(employee_id));
  }
  if (company_id) {
    where.push('a.company_id = ?');
    params.push(Number(company_id));
  }
  if (branch_id) {
    where.push('a.branch_id = ?');
    params.push(Number(branch_id));
  }
  // "Out" means issued to somebody and not back yet.
  if (out) where.push('a.employee_id IS NOT NULL AND a.returned_on IS NULL');
  // Written-off assets keep their row and their code; they are just not on the
  // register any more unless asked for.
  if (!written_off) where.push('a.written_off_on IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // When a round is named, each asset carries that round's verdict - which is
  // how "what was not found" is worked out: no row means not checked yet.
  const verification = round
    ? `(SELECT v.found FROM asset_verifications v WHERE v.asset_id = a.id AND v.round = ?) AS verified_found,
       (SELECT v.verified_on FROM asset_verifications v WHERE v.asset_id = a.id AND v.round = ?) AS verified_on,`
    : '';
  const roundParams = round ? [round, round] : [];

  return db
    .prepare(
      `SELECT a.*, e.name AS employee_name, c.name AS company_name, br.name AS branch_name,
              ${verification}
              (SELECT COUNT(*) FROM asset_handovers h WHERE h.asset_id = a.id) AS handovers
       FROM assets a
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN companies c ON c.id = a.company_id
       LEFT JOIN branches br ON br.id = a.branch_id
       ${clause}
       ORDER BY (a.employee_id IS NOT NULL AND a.returned_on IS NULL) DESC, a.kind, a.code, a.label`
    )
    .all(...roundParams, ...params)
    .map((row) => ({
      ...row,
      verified_found: round ? (row.verified_found === null ? null : Boolean(row.verified_found)) : undefined,
      warranty_left_days: daysUntil(row.warranty_until),
    }));
}

/** Days until a date, or null. Negative means it has passed. */
function daysUntil(date) {
  if (!date) return null;
  const then = new Date(date);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((then - today) / (24 * 60 * 60 * 1000));
}

/** Every code in use, including written-off ones - a number is never reused. */
const codesInUse = () =>
  db.prepare(`SELECT code FROM assets WHERE code IS NOT NULL`).all().map((r) => r.code);

export function createAsset(input = {}) {
  const label = String(input.label || '').trim();
  if (!label) throw new Error('give the asset a name');
  const companyId = Number(input.company_id) || null;
  const company = companyId
    ? db.prepare(`SELECT name FROM companies WHERE id = ?`).get(companyId)?.name
    : null;
  const kind = input.kind || 'Other';

  /*
   * The code. Typed if somebody typed one - an office with stickers already on
   * the laptops should keep them - and worked out if not.
   */
  let code = null;
  if (input.code) {
    const problem = codeProblem(input.code);
    if (problem) throw new Error(problem);
    code = tidyCode(input.code);
    if (db.prepare(`SELECT 1 FROM assets WHERE code = ?`).get(code)) {
      throw new Error(`${code} is already on something else`);
    }
  } else {
    code = nextCode(company || 'GEN', kind, codesInUse());
  }

  const info = db
    .prepare(
      `INSERT INTO assets (code, company_id, branch_id, kind, label, identifier, purchase_cost,
                           purchase_date, vendor, invoice_no, warranty_until,
                           amc_until, amc_vendor, amc_cost,
                           employee_id, issued_on, returned_on, condition, note)
       VALUES (@code, @company_id, @branch_id, @kind, @label, @identifier, @purchase_cost,
               @purchase_date, @vendor, @invoice_no, @warranty_until,
               @amc_until, @amc_vendor, @amc_cost,
               @employee_id, @issued_on, @returned_on, @condition, @note)`
    )
    .run({
      code,
      company_id: companyId,
      branch_id: Number(input.branch_id) || null,
      kind,
      label,
      identifier: input.identifier || null,
      purchase_cost: Number(input.purchase_cost ?? input.value) || 0,
      purchase_date: input.purchase_date || null,
      vendor: input.vendor || null,
      invoice_no: input.invoice_no || null,
      warranty_until: input.warranty_until || null,
      amc_until: input.amc_until || null,
      amc_vendor: input.amc_vendor || null,
      amc_cost: input.amc_cost === undefined || input.amc_cost === '' ? null : Number(input.amc_cost) || 0,
      employee_id: Number(input.employee_id) || null,
      issued_on: input.issued_on || null,
      returned_on: input.returned_on || null,
      condition: input.condition || null,
      note: input.note || null,
    });
  const id = info.lastInsertRowid;
  audit({ who: input.by, action: 'created', entity: 'assets', entity_id: id, label: `${code} ${label}` });

  // Created already with somebody: that is a handover, so log it as one.
  if (Number(input.employee_id)) {
    logHandover(id, {
      employee_id: Number(input.employee_id),
      issued_on: input.issued_on || dayNow(),
      issued_by: input.by,
      condition_out: input.condition,
    });
  }
  return getAsset(id);
}

const ASSET_FIELDS = [
  'company_id',
  'branch_id',
  'kind',
  'label',
  'identifier',
  'purchase_cost',
  'purchase_date',
  'vendor',
  'invoice_no',
  'warranty_until',
  'amc_until',
  'amc_vendor',
  'amc_cost',
  'employee_id',
  'issued_on',
  'returned_on',
  'condition',
  'note',
];

export function updateAsset(id, patch = {}) {
  const before = getAsset(id);
  if (!before) throw new Error('not found');

  const fields = [];
  const values = [];
  // The code can be changed, but never onto one already in use.
  if ('code' in patch) {
    const problem = codeProblem(patch.code);
    if (problem) throw new Error(problem);
    const code = tidyCode(patch.code);
    const clash = db.prepare(`SELECT id FROM assets WHERE code = ? AND id <> ?`).get(code, id);
    if (clash) throw new Error(`${code} is already on something else`);
    fields.push('code = ?');
    values.push(code);
  }
  for (const key of ASSET_FIELDS) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(patch[key] === '' ? null : patch[key]);
  }
  if (!fields.length) return before;
  db.prepare(`UPDATE assets SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  const after = getAsset(id);

  if (before.employee_id !== after.employee_id || before.returned_on !== after.returned_on) {
    audit({
      who: patch.by,
      action: after.returned_on && !before.returned_on ? 'returned' : 'issued',
      entity: 'assets',
      entity_id: id,
      label: `${before.code || ''} ${before.label}`.trim(),
      from_value: before.employee_name || 'the office',
      to_value: after.returned_on ? 'the office' : after.employee_name || 'the office',
    });
  }
  return after;
}

/* ---------------- handovers, and their history ---------------- */

/** The open handover row for an asset, if it is out with somebody. */
const openHandover = (assetId) =>
  db
    .prepare(
      `SELECT * FROM asset_handovers WHERE asset_id = ? AND returned_on IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(assetId) || null;

function logHandover(assetId, { employee_id, issued_on, issued_by, condition_out, note } = {}) {
  const name = employee_id ? getEmployee(employee_id)?.name || null : null;
  db.prepare(
    `INSERT INTO asset_handovers (asset_id, employee_id, employee_name, issued_on, issued_by, condition_out, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(assetId, employee_id || null, name, issued_on || dayNow(), issued_by || null, condition_out || null, note || null);
}

/**
 * Hand it over.
 *
 * Issuing to somebody while it is already out with somebody else closes the
 * first handover rather than losing it - which is what used to happen, and is
 * why asset history had nothing behind it.
 */
export function issueAsset(id, { employee_id, issued_on, condition, note, by } = {}) {
  const asset = getAsset(id);
  if (!asset) throw new Error('not found');
  if (asset.written_off_on) throw new Error('that asset is written off');
  const employee = getEmployee(employee_id);
  if (!employee) throw new Error('employee not found');

  const open = openHandover(id);
  if (open) {
    if (open.employee_id === employee.id) return asset;
    db.prepare(
      `UPDATE asset_handovers SET returned_on = ?, returned_by = ?, condition_in = ? WHERE id = ?`
    ).run(issued_on || dayNow(), by || null, 'passed on directly', open.id);
  }

  logHandover(id, {
    employee_id: employee.id,
    issued_on: issued_on || dayNow(),
    issued_by: by,
    condition_out: condition,
    note,
  });
  return updateAsset(id, {
    employee_id: employee.id,
    issued_on: issued_on || dayNow(),
    returned_on: '',
    condition: condition || undefined,
    by,
  });
}

export function returnAsset(id, { returned_on, condition, note, by } = {}) {
  const asset = getAsset(id);
  if (!asset) throw new Error('not found');
  const open = openHandover(id);
  if (open) {
    db.prepare(
      `UPDATE asset_handovers SET returned_on = ?, returned_by = ?, condition_in = ?, note = COALESCE(?, note)
       WHERE id = ?`
    ).run(returned_on || dayNow(), by || null, condition || null, note || null, open.id);
  }
  return updateAsset(id, {
    returned_on: returned_on || dayNow(),
    condition: condition || undefined,
    by,
  });
}

export const listHandovers = ({ asset_id, employee_id, open } = {}) => {
  const where = [];
  const params = [];
  if (asset_id) {
    where.push('h.asset_id = ?');
    params.push(Number(asset_id));
  }
  if (employee_id) {
    where.push('h.employee_id = ?');
    params.push(Number(employee_id));
  }
  if (open) where.push('h.returned_on IS NULL');
  return db
    .prepare(
      `SELECT h.*, a.code, a.label, a.kind, a.purchase_cost,
              -- The serial is what identifies the actual object on a document
              -- somebody signs, so the slip needs it.
              a.identifier,
              c.name AS company_name
       FROM asset_handovers h
       JOIN assets a ON a.id = h.asset_id
       LEFT JOIN companies c ON c.id = a.company_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY h.issued_on DESC, h.id DESC`
    )
    .all(...params);
};

/**
 * Writing one off. The row and the code stay - an old service bill and a signed
 * handover slip still refer to them - and anything still out is brought back
 * first, so nobody is left holding something that no longer exists.
 */
export function writeOffAsset(id, { on, why, by } = {}) {
  const asset = getAsset(id);
  if (!asset) throw new Error('not found');
  if (asset.written_off_on) return asset;
  if (!String(why || '').trim()) throw new Error('say why it is being written off');
  if (asset.employee_id && !asset.returned_on) {
    returnAsset(id, { returned_on: on || dayNow(), condition: 'written off', by });
  }
  db.prepare(`UPDATE assets SET written_off_on = ?, written_off_why = ? WHERE id = ?`).run(
    on || dayNow(),
    String(why).trim(),
    id
  );
  audit({
    who: by,
    action: 'written off',
    entity: 'assets',
    entity_id: id,
    label: `${asset.code || ''} ${asset.label}`.trim(),
    note: String(why).trim(),
  });
  return getAsset(id);
}

export function deleteAsset(id, by) {
  const before = getAsset(id);
  if (!before) return false;
  /*
   * Anything with a HISTORY is written off, not deleted: deleting takes the
   * handovers, the service bills and the stock-take verdicts with it.
   *
   * It used to check handovers alone, so an asset that had been serviced but
   * never issued could be deleted - taking a bill that carries its code, and
   * freeing that code for the next thing. The comment already said "history";
   * now the check does too.
   */
  const history = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM asset_handovers WHERE asset_id = @id) AS handovers,
         (SELECT COUNT(*) FROM asset_services WHERE asset_id = @id) AS services,
         (SELECT COUNT(*) FROM asset_verifications WHERE asset_id = @id) AS checks`
    )
    .get({ id });
  if (history.handovers) {
    throw new Error('this asset has been issued to somebody - write it off instead of deleting it');
  }
  if (history.services) {
    throw new Error('this asset has a service on its record - write it off instead of deleting it');
  }
  if (history.checks) {
    throw new Error('this asset has been through a stock take - write it off instead of deleting it');
  }
  const gone = db.prepare(`DELETE FROM assets WHERE id = ?`).run(id).changes > 0;
  if (gone) {
    audit({ who: by, action: 'deleted', entity: 'assets', entity_id: id, label: `${before.code || ''} ${before.label}`.trim() });
  }
  return gone;
}

/* ---------------- a stock take ---------------- */

/**
 * Record one asset as seen, or not seen, in a round.
 *
 * Checking the same asset twice replaces the verdict rather than leaving two
 * that disagree.
 */
export function verifyAsset(id, { round, found = true, note, by, on } = {}) {
  const asset = getAsset(id);
  if (!asset) throw new Error('not found');
  const label = String(round || '').trim();
  if (!label) throw new Error('which round is this?');
  db.prepare(
    `INSERT INTO asset_verifications (asset_id, round, found, verified_on, verified_by, held_by, note)
     VALUES (@asset_id, @round, @found, @verified_on, @verified_by, @held_by, @note)
     ON CONFLICT(asset_id, round) DO UPDATE SET
       found = excluded.found, verified_on = excluded.verified_on,
       verified_by = excluded.verified_by, held_by = excluded.held_by, note = excluded.note`
  ).run({
    asset_id: id,
    round: label,
    found: found ? 1 : 0,
    verified_on: on || dayNow(),
    verified_by: by || null,
    held_by: asset.employee_name || null,
    note: note || null,
  });
  audit({
    who: by,
    action: found ? 'verified' : 'not found',
    entity: 'assets',
    entity_id: id,
    label: `${asset.code || ''} ${asset.label}`.trim(),
    note: label,
  });
  return getAsset(id);
}

export const listRounds = () =>
  db
    .prepare(
      `SELECT round, COUNT(*) AS checked, SUM(found) AS found,
              MIN(verified_on) AS started, MAX(verified_on) AS last
       FROM asset_verifications GROUP BY round ORDER BY MAX(verified_on) DESC`
    )
    .all()
    .map((r) => ({ ...r, missing: r.checked - r.found }));

/**
 * How a round is going: what was found, what was not, and what has not been
 * looked at yet. The third is the one that matters - "not checked" is not
 * "missing", and treating it as such is how a stock take invents losses.
 */
export function roundProgress(round) {
  const assets = listAssets({ round });
  const found = assets.filter((a) => a.verified_found === true);
  const missing = assets.filter((a) => a.verified_found === false);
  const todo = assets.filter((a) => a.verified_found === null);
  return {
    round,
    total: assets.length,
    found: found.length,
    missing: missing.length,
    not_checked: todo.length,
    missing_value: missing.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0),
    missing_assets: missing,
    not_checked_assets: todo,
  };
}

/* ---------------- maintenance ---------------- */

export function getService(id) {
  const row = db
    .prepare(
      `SELECT s.*, a.code, a.label, a.kind AS asset_kind, c.name AS company_name
       FROM asset_services s
       JOIN assets a ON a.id = s.asset_id
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE s.id = ?`
    )
    .get(id);
  // Same shape as listServices: SQLite stores a flag as 0/1 and the two used to
  // disagree, so the POST echo said 1 where the list said true.
  return row ? { ...row, under_warranty: Boolean(row.under_warranty) } : null;
}

export function listServices({ asset_id, company_id, from, to, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (asset_id) {
    where.push('s.asset_id = ?');
    params.push(Number(asset_id));
  }
  if (company_id) {
    where.push('a.company_id = ?');
    params.push(Number(company_id));
  }
  if (from) {
    where.push('s.serviced_on >= ?');
    params.push(from);
  }
  if (to) {
    where.push('s.serviced_on <= ?');
    params.push(to);
  }
  return db
    .prepare(
      `SELECT s.*, a.code, a.label,
              -- Aliased, and it matters: SELECT s.*, a.kind silently replaced
              -- the SERVICE's kind (Repair, Parts) with the ASSET's kind
              -- (Laptop), so the timeline read "Laptop" where it meant "Repair".
              a.kind AS asset_kind,
              c.name AS company_name
       FROM asset_services s
       JOIN assets a ON a.id = s.asset_id
       LEFT JOIN companies c ON c.id = a.company_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.serviced_on DESC, s.id DESC
       LIMIT ?`
    )
    .all(...params, Math.min(2000, Number(limit) || 500))
    .map((row) => ({ ...row, under_warranty: Boolean(row.under_warranty) }));
}

/**
 * Record a service.
 *
 * `force` is how a genuine second bill on the same day for the same amount gets
 * through: the duplicate check asks rather than refuses, because two identical
 * ₹500 repairs on one day do happen and a system that will not record the truth
 * gets worked around.
 */
export function logService(assetId, input = {}) {
  const asset = getAsset(assetId);
  if (!asset) throw new Error('asset not found');
  const on = String(input.serviced_on || '').trim() || dayNow();
  const cost = Number(input.cost) || 0;
  if (cost < 0) throw new Error('a cost is not a negative number');

  if (!input.force) {
    const twin = looksDuplicate({ serviced_on: on, cost }, listServices({ asset_id: assetId }));
    if (twin) {
      const err = new Error(
        `${asset.code} already has a ${cost ? `\u20b9${Math.round(cost).toLocaleString('en-IN')}` : 'no-cost'} service on ${on}` +
          `${twin.work ? ` (${twin.work})` : ''}. Add it anyway?`
      );
      err.duplicate = twin;
      throw err;
    }
  }

  const info = db
    .prepare(
      `INSERT INTO asset_services (asset_id, serviced_on, kind, work, vendor, invoice_no, cost,
                                   under_warranty, next_service_on, note, logged_by)
       VALUES (@asset_id, @serviced_on, @kind, @work, @vendor, @invoice_no, @cost,
               @under_warranty, @next_service_on, @note, @logged_by)`
    )
    .run({
      asset_id: asset.id,
      serviced_on: on,
      kind: input.kind || 'Service',
      work: input.work || null,
      vendor: input.vendor || null,
      invoice_no: input.invoice_no || null,
      cost,
      under_warranty: input.under_warranty ? 1 : 0,
      next_service_on: input.next_service_on || null,
      note: input.note || null,
      logged_by: input.by || null,
    });

  audit({
    who: input.by,
    action: 'serviced',
    entity: 'assets',
    entity_id: asset.id,
    label: `${asset.code || ''} ${asset.label}`.trim(),
    to_value: cost,
    note: [input.kind, input.work, input.vendor].filter(Boolean).join(' - ') || null,
  });
  return getService(info.lastInsertRowid);
}

export function updateService(id, patch = {}) {
  const before = getService(id);
  if (!before) throw new Error('not found');
  const fields = [];
  const values = [];
  for (const key of ['serviced_on', 'kind', 'work', 'vendor', 'invoice_no', 'cost', 'under_warranty', 'next_service_on', 'note']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(key === 'under_warranty' ? (patch[key] ? 1 : 0) : patch[key] === '' ? null : patch[key]);
  }
  if (!fields.length) return before;
  db.prepare(`UPDATE asset_services SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  audit({
    who: patch.by,
    action: 'changed',
    entity: 'assets',
    entity_id: before.asset_id,
    label: `${before.code || ''} ${before.label}`.trim(),
    field: 'service',
    from_value: before.cost,
    to_value: patch.cost ?? before.cost,
  });
  return getService(id);
}

export function deleteService(id, by) {
  const before = getService(id);
  if (!before) return false;
  const gone = db.prepare(`DELETE FROM asset_services WHERE id = ?`).run(id).changes > 0;
  if (gone) {
    audit({
      who: by,
      action: 'service removed',
      entity: 'assets',
      entity_id: before.asset_id,
      label: `${before.code || ''} ${before.label}`.trim(),
      from_value: before.cost,
      note: before.serviced_on,
    });
  }
  return gone;
}

/**
 * The register with each asset's running cost worked out, plus what is due.
 *
 * Services are fetched once and grouped, rather than a query per asset: a
 * register of a few hundred things is read on every visit to the page.
 */
export function assetsWithOwnership(opts = {}) {
  const assets = listAssets(opts);
  const byAsset = new Map();
  for (const service of listServices({ company_id: opts.company_id, limit: 2000 })) {
    if (!byAsset.has(service.asset_id)) byAsset.set(service.asset_id, []);
    byAsset.get(service.asset_id).push(service);
  }
  return assets.map((asset) => {
    const services = byAsset.get(asset.id) || [];
    return { ...asset, services, ownership: ownership(asset, services) };
  });
}

/* ---------------- one asset's whole life ---------------- */

/**
 * The timeline: bought, issued, returned, checked, written off — assembled from
 * the rows that already hold each of those, in date order. Nothing here is
 * stored twice.
 */
export function assetHistory(id) {
  const asset = getAsset(id);
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

  for (const h of listHandovers({ asset_id: id }).reverse()) {
    events.push({
      on: h.issued_on,
      what: 'Issued',
      who: h.employee_name,
      detail: h.condition_out || null,
      by: h.issued_by,
    });
    if (h.returned_on) {
      events.push({
        on: h.returned_on,
        what: 'Returned',
        who: h.employee_name,
        detail: h.condition_in || null,
        by: h.returned_by,
      });
    }
  }

  for (const service of listServices({ asset_id: id }).reverse()) {
    events.push({
      on: service.serviced_on,
      what: service.kind || 'Serviced',
      detail: [service.work, service.vendor, service.under_warranty ? 'under warranty' : null]
        .filter(Boolean)
        .join(', ') || null,
      amount: Number(service.cost) || 0,
      by: service.logged_by,
    });
  }

  for (const v of db
    .prepare(`SELECT * FROM asset_verifications WHERE asset_id = ? ORDER BY verified_on`)
    .all(id)) {
    events.push({
      on: v.verified_on,
      what: v.found ? 'Verified' : 'Not found',
      detail: [v.round, v.note].filter(Boolean).join(' — ') || null,
      by: v.verified_by,
    });
  }

  if (asset.written_off_on) {
    events.push({ on: asset.written_off_on, what: 'Written off', detail: asset.written_off_why });
  }

  events.sort((a, b) => String(a.on).localeCompare(String(b.on)));
  return { asset, events };
}

/* ================================================================= *
 * expense claims
 * ================================================================= */

export const getClaim = (id) =>
  db
    .prepare(
      `SELECT x.*, e.name AS employee_name, c.name AS company_name
       FROM expense_claims x
       JOIN employees e ON e.id = x.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       WHERE x.id = ?`
    )
    .get(id) || null;

export function listClaims({ employee_id, status, limit = 300 } = {}) {
  const where = [];
  const params = [];
  if (employee_id) {
    where.push('x.employee_id = ?');
    params.push(Number(employee_id));
  }
  if (status) {
    where.push('x.status = ?');
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT x.*, e.name AS employee_name, c.name AS company_name
       FROM expense_claims x
       JOIN employees e ON e.id = x.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       ${clause}
       ORDER BY CASE x.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                x.spent_on DESC, x.id DESC
       LIMIT ?`
    )
    .all(...params, Math.min(1000, Number(limit) || 300));
}

export function createClaim(employeeId, input = {}) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new Error('employee not found');
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('what did it cost?');
  const info = db
    .prepare(
      `INSERT INTO expense_claims (employee_id, kind, spent_on, amount, detail)
       VALUES (@employee_id, @kind, @spent_on, @amount, @detail)`
    )
    .run({
      employee_id: employee.id,
      kind: input.kind || 'Other',
      spent_on: String(input.spent_on || '').trim() || new Date().toISOString().slice(0, 10),
      amount,
      detail: input.detail || null,
    });
  audit({
    who: input.by || employee.name,
    action: 'created',
    entity: 'expense_claims',
    entity_id: info.lastInsertRowid,
    label: `${input.kind || 'Other'} claim by ${employee.name}`,
    to_value: amount,
  });
  return getClaim(info.lastInsertRowid);
}

/**
 * Approve or reject. A decision is taken once: a claim already decided is not
 * decided again, because "approved then rejected then approved" is not an audit
 * trail anybody can act on. Rejecting writes nothing but the decision.
 */
export function decideClaim(id, { status, by, note } = {}) {
  const claim = getClaim(id);
  if (!claim) throw new Error('not found');
  if (!['approved', 'rejected'].includes(status)) throw new Error('a claim is approved or rejected');
  if (claim.status === 'paid') throw new Error('this claim has already been paid');
  if (claim.status !== 'pending') throw new Error(`this claim was already ${claim.status}`);
  db.prepare(
    `UPDATE expense_claims SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ?
     WHERE id = ?`
  ).run(status, by || null, note || null, id);
  audit({
    who: by,
    action: status,
    entity: 'expense_claims',
    entity_id: id,
    label: `${claim.kind} claim by ${claim.employee_name}`,
    to_value: claim.amount,
    note: note || null,
  });
  return getClaim(id);
}

/**
 * Pay it through a month's payroll, as an addition on that person's row.
 *
 * Only an approved claim can be paid, it is added to whatever addition the row
 * already carries rather than replacing it, and paying it twice is refused -
 * so a double click cannot pay a petrol bill twice.
 */
export function payClaim(id, { period_id, by } = {}) {
  const claim = getClaim(id);
  if (!claim) throw new Error('not found');
  if (claim.status === 'paid') throw new Error('this claim has already been paid');
  if (claim.status !== 'approved') throw new Error('approve the claim before paying it');
  const period = db.prepare(`SELECT * FROM periods WHERE id = ?`).get(Number(period_id));
  if (!period) throw new Error('pick a month to pay it in');
  if (period.locked) throw new Error(`${period.label} is closed`);

  const row = db
    .prepare(`SELECT * FROM payroll_rows WHERE period_id = ? AND employee_id = ?`)
    .get(period.id, claim.employee_id);
  if (!row) throw new Error(`${claim.employee_name} has no row in ${period.label}`);

  const addition = (Number(row.addition) || 0) + Number(claim.amount);
  const remark = [row.adjustment_note, `${claim.kind} claim ${claim.spent_on}`]
    .filter(Boolean)
    .join('; ');
  db.prepare(`UPDATE payroll_rows SET addition = ?, adjustment_note = ? WHERE id = ?`).run(
    addition,
    remark,
    row.id
  );
  db.prepare(
    `UPDATE expense_claims SET status = 'paid', paid_period_id = ?, paid_at = datetime('now') WHERE id = ?`
  ).run(period.id, id);
  audit({
    who: by,
    action: 'paid',
    entity: 'expense_claims',
    entity_id: id,
    label: `${claim.kind} claim by ${claim.employee_name}`,
    to_value: claim.amount,
    note: `posted into ${period.label}`,
  });
  return getClaim(id);
}

export function deleteClaim(id, by) {
  const before = getClaim(id);
  if (!before) return false;
  if (before.status === 'paid') throw new Error('this claim has been paid - it stays on the record');
  const gone = db.prepare(`DELETE FROM expense_claims WHERE id = ?`).run(id).changes > 0;
  if (gone)
    audit({ who: by, action: 'deleted', entity: 'expense_claims', entity_id: id, label: `${before.kind} claim by ${before.employee_name}` });
  return gone;
}

/* ================================================================= *
 * leaving: the exit record and the full and final
 * ================================================================= */

const readJson = (text, fallback) => {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

export function getExit(employeeId) {
  const row = db.prepare(`SELECT * FROM employee_exits WHERE employee_id = ?`).get(Number(employeeId));
  if (!row) return null;
  return { ...row, extras: readJson(row.extras, []), rules: readJson(row.rules, {}) };
}

export function listExits({ settled } = {}) {
  const where = [];
  if (settled === true) where.push('x.settled_on IS NOT NULL');
  if (settled === false) where.push('x.settled_on IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT x.*, e.name AS employee_name, e.code AS employee_code, e.joined_on,
              e.monthly_salary, c.name AS company_name
       FROM employee_exits x
       JOIN employees e ON e.id = x.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       ${clause}
       ORDER BY COALESCE(x.last_working_day, x.resigned_on) DESC, x.id DESC`
    )
    .all()
    .map((row) => ({ ...row, extras: readJson(row.extras, []), rules: readJson(row.rules, {}) }));
}

/**
 * Record a resignation, or change one already recorded. One per employee.
 *
 * Writing a last working day also marks the employee as left, which takes them
 * off the active list the next month is opened from - but it is deliberately
 * NOT the same as paying them: the settlement is a separate act.
 */
export function saveExit(employeeId, input = {}) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new Error('employee not found');
  const existing = getExit(employee.id);

  const row = {
    employee_id: employee.id,
    type: input.type || existing?.type || 'resigned',
    resigned_on: 'resigned_on' in input ? input.resigned_on || null : existing?.resigned_on || null,
    notice_days: 'notice_days' in input ? (input.notice_days === '' ? null : Number(input.notice_days)) : existing?.notice_days ?? null,
    last_working_day: 'last_working_day' in input ? input.last_working_day || null : existing?.last_working_day || null,
    reason: 'reason' in input ? input.reason || null : existing?.reason || null,
    exit_interview: 'exit_interview' in input ? input.exit_interview || null : existing?.exit_interview || null,
    extras: JSON.stringify('extras' in input ? input.extras || [] : existing?.extras || []),
    rules: JSON.stringify('rules' in input ? input.rules || {} : existing?.rules || {}),
  };

  if (existing) {
    if (existing.settled_on && ('last_working_day' in input || 'type' in input)) {
      throw new Error('this settlement has been paid - the dates stay as they were');
    }
    db.prepare(
      `UPDATE employee_exits SET type = @type, resigned_on = @resigned_on, notice_days = @notice_days,
              last_working_day = @last_working_day, reason = @reason, exit_interview = @exit_interview,
              extras = @extras, rules = @rules
       WHERE employee_id = @employee_id`
    ).run(row);
  } else {
    db.prepare(
      `INSERT INTO employee_exits (employee_id, type, resigned_on, notice_days, last_working_day,
                                   reason, exit_interview, extras, rules)
       VALUES (@employee_id, @type, @resigned_on, @notice_days, @last_working_day,
               @reason, @exit_interview, @extras, @rules)`
    ).run(row);
  }

  // The master's own left_on is what every other tab reads, so keep them one.
  if (row.last_working_day && employee.left_on !== row.last_working_day) {
    updateEmployee(employee.id, {
      left_on: row.last_working_day,
      active: 0,
      history_note: `Left: ${row.type}${row.reason ? ` - ${row.reason}` : ''}`,
    });
  }

  audit({
    who: input.by,
    action: existing ? 'changed' : 'created',
    entity: 'employee_exits',
    entity_id: employee.id,
    label: `exit for ${employee.name}`,
    to_value: row.last_working_day,
    note: row.type,
  });
  return getExit(employee.id);
}

export function deleteExit(employeeId, by) {
  const existing = getExit(employeeId);
  if (!existing) return false;
  if (existing.settled_on) throw new Error('this settlement has been paid - it stays on the record');
  const gone = db.prepare(`DELETE FROM employee_exits WHERE employee_id = ?`).run(Number(employeeId)).changes > 0;
  if (gone) {
    // Bringing somebody back onto the list is its own decision, so this only
    // removes the exit record - it does not silently reactivate them.
    audit({ who: by, action: 'deleted', entity: 'employee_exits', entity_id: Number(employeeId), label: `exit for ${nameOf(employeeId)}` });
  }
  return gone;
}

export function markSettled(employeeId, { amount, settled_on, by } = {}) {
  const existing = getExit(employeeId);
  if (!existing) throw new Error('no exit recorded for this person');
  if (existing.settled_on) throw new Error('this settlement has already been paid');
  db.prepare(
    `UPDATE employee_exits SET settled_on = ?, settled_amount = ? WHERE employee_id = ?`
  ).run(settled_on || new Date().toISOString().slice(0, 10), Number(amount) || 0, Number(employeeId));
  audit({
    who: by,
    action: 'settled',
    entity: 'employee_exits',
    entity_id: Number(employeeId),
    label: `full and final for ${nameOf(employeeId)}`,
    to_value: Number(amount) || 0,
  });
  return getExit(employeeId);
}

/**
 * The full and final, assembled.
 *
 * Every figure comes from somewhere that already existed: the final month's
 * net out of `buildPayroll` (the same numbers the payslip prints), the leave
 * balance off the marks, the loan outstanding off the ledger, the claims off
 * their own table, the assets off theirs. Nothing here is a second opinion on
 * any of them.
 *
 * The final month is the one the last working day falls in. If that month has
 * not been opened, the settlement says so and values the leave off the master
 * salary rather than refusing to show anything.
 */
export function fullAndFinal(employeeId) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new Error('employee not found');
  const exit = getExit(employee.id);
  if (!exit) return null;

  let finalMonth = null;
  let finalLabel = null;
  const last = exit.last_working_day ? new Date(exit.last_working_day) : null;
  if (last && !Number.isNaN(last.getTime())) {
    const period = findPeriod(last.getFullYear(), last.getMonth() + 1);
    if (period) {
      finalLabel = period.label;
      // sync: false - reading a closed month to settle somebody must not
      // backdate new hires into it or post another loan instalment.
      const payroll = buildPayroll(period.id, { sync: false });
      finalMonth = payroll?.rows.find((r) => r.employee_id === employee.id) || null;
    }
  }

  const year = last && !Number.isNaN(last.getTime()) ? last.getFullYear() : new Date().getFullYear();
  const leave =
    leaveSummary(year).find((l) => l.employee_id === employee.id) ||
    // leaveSummary only lists active staff, and somebody leaving is usually
    // already inactive - so fall back to their quotas with nothing taken
    // rather than quietly encashing a full year nobody counted.
    leaveQuotasOf(employee, year);

  const loans = listLoans({ employee_id: employee.id, includeClosed: false });
  const claims = listClaims({ employee_id: employee.id, status: 'approved' });
  const assets = listAssets({ employee_id: employee.id, out: true });

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
      assets: assets.map((a) => ({ label: `${a.code || ''} ${a.label}`.trim(), value: a.purchase_cost })),
      extras: exit.extras,
    }),
    loans,
    claims,
    assets,
    leave,
  };
}

/** Leave counted off the marks for somebody no longer on the active list. */
function leaveQuotasOf(employee, year) {
  const taken = db
    .prepare(
      `SELECT a.code, COUNT(*) AS days
       FROM attendance a JOIN periods p ON p.id = a.period_id
       WHERE p.year = ? AND a.employee_id = ? AND a.code IN ('CL','SL','PL','UL')
       GROUP BY a.code`
    )
    .all(year, employee.id);
  const used = Object.fromEntries(taken.map((t) => [t.code, t.days]));
  return {
    employee_id: employee.id,
    name: employee.name,
    quotas: { CL: employee.cl_quota || 0, SL: employee.sl_quota || 0, PL: employee.pl_quota || 0 },
    taken: { CL: used.CL || 0, SL: used.SL || 0, PL: used.PL || 0, UL: used.UL || 0 },
  };
}

/* ================================================================= *
 * tasks, and the helpdesk
 * ================================================================= */

db.exec(`
  -- Work given to somebody, with a date it is wanted by. Not the same thing as
  -- Dinesh's WhatsApp task assistant, which reads his own messages; this is
  -- office work assigned to staff and visible to them.
  CREATE TABLE IF NOT EXISTS staff_tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id   INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    detail        TEXT,
    assigned_by   TEXT,
    due_on        TEXT,
    priority      TEXT NOT NULL DEFAULT 'normal',   -- low | normal | high
    -- open | done | dropped. A task is never deleted once it was done: what
    -- was asked for and whether it happened is the record.
    status        TEXT NOT NULL DEFAULT 'open',
    done_on       TEXT,
    done_note     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_employee ON staff_tasks(employee_id, status, due_on);

  -- What an employee has asked the office for, or complained about.
  CREATE TABLE IF NOT EXISTS tickets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    category      TEXT NOT NULL DEFAULT 'Other',
    subject       TEXT NOT NULL,
    detail        TEXT,
    -- open | answered | closed. "Answered" is not "closed": the person who
    -- raised it decides whether the answer settled it.
    status        TEXT NOT NULL DEFAULT 'open',
    assigned_to   TEXT,
    closed_on     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, created_at);

  CREATE TABLE IF NOT EXISTS ticket_replies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    -- 'office' or 'employee'. Who is talking matters more than their name here.
    side        TEXT NOT NULL DEFAULT 'office',
    author      TEXT,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_replies_ticket ON ticket_replies(ticket_id, created_at);
`);

/*
 * Declared here, below the second db.exec, because that is where `tickets` is
 * created - migrating it at the top of the file ran before the table existed
 * and took every test with it.
 */
addColumns('tickets', [
  // Tasks had a priority and the helpdesk did not, so a salary query and a
  // broken chair queued the same.
  ['priority', `TEXT NOT NULL DEFAULT 'normal'`],
]);

export const TASK_PRIORITIES = ['low', 'normal', 'high'];
export const TICKET_CATEGORIES = [
  'Salary',
  'Attendance',
  'Leave',
  'PF / ESI',
  'Bank details',
  'Documents',
  'Complaint',
  'Other',
];


/* ---------------- tasks ---------------- */

export const getTask = (id) =>
  db
    .prepare(
      `SELECT t.*, e.name AS employee_name, c.name AS company_name
       FROM staff_tasks t
       LEFT JOIN employees e ON e.id = t.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       WHERE t.id = ?`
    )
    .get(id) || null;

export function listTasks({ employee_id, status, limit = 300 } = {}) {
  const where = [];
  const params = [];
  if (employee_id) {
    where.push('t.employee_id = ?');
    params.push(Number(employee_id));
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT t.*, e.name AS employee_name, c.name AS company_name
       FROM staff_tasks t
       LEFT JOIN employees e ON e.id = t.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       ${clause}
       ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
                t.due_on IS NULL, t.due_on,
                CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                t.id DESC
       LIMIT ?`
    )
    .all(...params, Math.min(1000, Number(limit) || 300))
    .map((row) => ({
      ...row,
      // Worked out rather than stored, so it cannot go stale overnight.
      overdue: row.status === 'open' && Boolean(row.due_on) && row.due_on < dayNow(),
    }));
}

export function createTask(input = {}) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('what is the task?');
  const employee = input.employee_id ? getEmployee(input.employee_id) : null;
  if (input.employee_id && !employee) throw new Error('employee not found');
  const info = db
    .prepare(
      `INSERT INTO staff_tasks (employee_id, title, detail, assigned_by, due_on, priority)
       VALUES (@employee_id, @title, @detail, @assigned_by, @due_on, @priority)`
    )
    .run({
      employee_id: employee?.id || null,
      title,
      detail: input.detail || null,
      assigned_by: input.assigned_by || input.by || null,
      due_on: input.due_on || null,
      priority: TASK_PRIORITIES.includes(input.priority) ? input.priority : 'normal',
    });
  audit({
    who: input.by,
    action: 'created',
    entity: 'staff_tasks',
    entity_id: info.lastInsertRowid,
    label: employee ? `task for ${employee.name}` : 'task',
    note: title,
  });
  return getTask(info.lastInsertRowid);
}

export function updateTask(id, patch = {}) {
  const before = getTask(id);
  if (!before) throw new Error('not found');
  const fields = [];
  const values = [];
  for (const key of ['employee_id', 'title', 'detail', 'assigned_by', 'due_on', 'priority']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(patch[key] === '' ? null : patch[key]);
  }
  if (!fields.length) return before;
  db.prepare(`UPDATE staff_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  audit({ who: patch.by, action: 'changed', entity: 'staff_tasks', entity_id: id, label: before.title });
  return getTask(id);
}

/**
 * Done, or dropped. Reopening is allowed - somebody marks a thing done and then
 * it turns out it was not - but the trail carries each turn, so the history of
 * a task is not rewritten by its latest state.
 */
export function setTaskStatus(id, { status, note, by } = {}) {
  const task = getTask(id);
  if (!task) throw new Error('not found');
  if (!['open', 'done', 'dropped'].includes(status)) throw new Error('a task is open, done or dropped');
  db.prepare(
    `UPDATE staff_tasks SET status = ?, done_on = ?, done_note = ? WHERE id = ?`
  ).run(status, status === 'open' ? null : note?.date || dayNow(), note?.text || note || null, id);
  audit({
    who: by,
    action: status === 'done' ? 'done' : status === 'dropped' ? 'dropped' : 'reopened',
    entity: 'staff_tasks',
    entity_id: id,
    label: task.title,
    from_value: task.status,
    to_value: status,
  });
  return getTask(id);
}

export function deleteTask(id, by) {
  const before = getTask(id);
  if (!before) return false;
  if (before.status === 'done') throw new Error('a task that was done stays on the record — drop it instead');
  const gone = db.prepare(`DELETE FROM staff_tasks WHERE id = ?`).run(id).changes > 0;
  if (gone) audit({ who: by, action: 'deleted', entity: 'staff_tasks', entity_id: id, label: before.title });
  return gone;
}

/* ---------------- helpdesk ---------------- */

export function getTicket(id) {
  const ticket = db
    .prepare(
      `SELECT t.*, e.name AS employee_name, e.code AS employee_code, c.name AS company_name
       FROM tickets t
       JOIN employees e ON e.id = t.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       WHERE t.id = ?`
    )
    .get(id);
  if (!ticket) return null;
  return {
    ...ticket,
    replies: db
      .prepare(`SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at, id`)
      .all(id),
  };
}

export function listTickets({ employee_id, status, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (employee_id) {
    where.push('t.employee_id = ?');
    params.push(Number(employee_id));
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT t.*, e.name AS employee_name, c.name AS company_name,
              (SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id) AS replies,
              (SELECT MAX(r.created_at) FROM ticket_replies r WHERE r.ticket_id = t.id) AS last_reply_at,
              (SELECT r.side FROM ticket_replies r WHERE r.ticket_id = t.id
                ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS last_side
       FROM tickets t
       JOIN employees e ON e.id = t.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       ${clause}
       ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END,
                t.created_at DESC
       LIMIT ?`
    )
    .all(...params, Math.min(1000, Number(limit) || 200))
    .map((row) => ({
      ...row,
      // Waiting on the office: raised or last spoken to by the employee.
      waiting: row.status !== 'closed' && (!row.replies || row.last_side === 'employee'),
    }));
}

export function createTicket(employeeId, input = {}) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new Error('employee not found');
  const subject = String(input.subject || '').trim();
  if (!subject) throw new Error('say what it is about in a line');
  const info = db
    .prepare(
      `INSERT INTO tickets (employee_id, category, subject, detail, assigned_to, priority)
       VALUES (@employee_id, @category, @subject, @detail, @assigned_to, @priority)`
    )
    .run({
      employee_id: employee.id,
      category: input.category || 'Other',
      subject,
      detail: input.detail || null,
      assigned_to: input.assigned_to || null,
      priority: TASK_PRIORITIES.includes(input.priority) ? input.priority : 'normal',
    });
  audit({
    who: input.by || employee.name,
    action: 'created',
    entity: 'tickets',
    entity_id: info.lastInsertRowid,
    label: `${input.category || 'Other'} from ${employee.name}`,
    note: subject,
  });
  return getTicket(info.lastInsertRowid);
}

/**
 * Reply. The office answering moves it to `answered`, not to `closed` - whether
 * the answer settled it is the employee's call, and a helpdesk that closes its
 * own tickets measures nothing.
 */
export function replyToTicket(id, { side = 'office', author, body } = {}) {
  const ticket = getTicket(id);
  if (!ticket) throw new Error('not found');
  const text = String(body || '').trim();
  if (!text) throw new Error('nothing to say?');
  if (ticket.status === 'closed') throw new Error('this one is closed — raise a new one');
  db.prepare(
    `INSERT INTO ticket_replies (ticket_id, side, author, body) VALUES (?, ?, ?, ?)`
  ).run(id, side === 'employee' ? 'employee' : 'office', author || null, text);
  db.prepare(`UPDATE tickets SET status = ? WHERE id = ?`).run(
    side === 'employee' ? 'open' : 'answered',
    id
  );
  audit({
    who: author,
    action: 'replied',
    entity: 'tickets',
    entity_id: id,
    label: `${ticket.category} from ${ticket.employee_name}`,
    note: side === 'employee' ? 'from the employee' : 'from the office',
  });
  return getTicket(id);
}

export function closeTicket(id, { by, note } = {}) {
  const ticket = getTicket(id);
  if (!ticket) throw new Error('not found');
  if (ticket.status === 'closed') return ticket;
  db.prepare(`UPDATE tickets SET status = 'closed', closed_on = ? WHERE id = ?`).run(dayNow(), id);
  if (note) replyToTicketRaw(id, { side: 'office', author: by, body: note });
  audit({
    who: by,
    action: 'closed',
    entity: 'tickets',
    entity_id: id,
    label: `${ticket.category} from ${ticket.employee_name}`,
  });
  return getTicket(id);
}

/** The insert alone, for closing with a last word (which replyTo would refuse). */
function replyToTicketRaw(id, { side, author, body }) {
  db.prepare(`INSERT INTO ticket_replies (ticket_id, side, author, body) VALUES (?, ?, ?, ?)`).run(
    id,
    side,
    author || null,
    String(body).trim()
  );
}

export function reopenTicket(id, { by } = {}) {
  const ticket = getTicket(id);
  if (!ticket) throw new Error('not found');
  db.prepare(`UPDATE tickets SET status = 'open', closed_on = NULL WHERE id = ?`).run(id);
  audit({ who: by, action: 'reopened', entity: 'tickets', entity_id: id, label: `${ticket.category} from ${ticket.employee_name}` });
  return getTicket(id);
}

/* ---------------- asset photographs ---------------- */

export const listAssetPhotos = (assetId) =>
  db
    .prepare(`SELECT * FROM asset_photos WHERE asset_id = ? ORDER BY datetime(created_at) DESC, id DESC`)
    .all(assetId);

export const getAssetPhoto = (id) => db.prepare(`SELECT * FROM asset_photos WHERE id = ?`).get(id);

export function addAssetPhoto({ asset_id, file_path, note, taken_on, by }) {
  if (!getAsset(asset_id)) throw new Error('that asset is not on the register');
  if (!file_path) throw new Error('no photo was uploaded');
  const info = db
    .prepare(
      `INSERT INTO asset_photos (asset_id, file_path, note, taken_on, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(asset_id, file_path, note || null, taken_on || dayNow(), by || null);
  return getAssetPhoto(info.lastInsertRowid);
}

export const deleteAssetPhoto = (id) =>
  db.prepare(`DELETE FROM asset_photos WHERE id = ?`).run(id).changes;
