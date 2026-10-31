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
      `INSERT INTO employee_notes (employee_id, kind, severity, dated, subject, detail, issued_by, acknowledged_on)
       VALUES (@employee_id, @kind, @severity, @dated, @subject, @detail, @issued_by, @acknowledged_on)`
    )
    .run({
      employee_id: employee.id,
      kind,
      severity: kind === 'warning' ? input.severity || 'verbal' : null,
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
  for (const key of ['kind', 'severity', 'dated', 'subject', 'detail', 'issued_by', 'acknowledged_on']) {
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
                               from_salary, to_salary, effective_from)
       VALUES (@employee_id, @cycle, @reviewed_on, @reviewed_by, @rating, @summary,
               @from_salary, @to_salary, @effective_from)`
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
  for (const key of ['cycle', 'reviewed_on', 'reviewed_by', 'rating', 'summary', 'from_salary', 'to_salary', 'effective_from']) {
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
      `SELECT a.*, e.name AS employee_name, c.name AS company_name
       FROM assets a
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE a.id = ?`
    )
    .get(id) || null;

export function listAssets({ employee_id, company_id, out } = {}) {
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
  // "Out" means issued to somebody and not back yet.
  if (out) where.push('a.employee_id IS NOT NULL AND a.returned_on IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT a.*, e.name AS employee_name, c.name AS company_name
       FROM assets a
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN companies c ON c.id = a.company_id
       ${clause}
       ORDER BY (a.employee_id IS NOT NULL AND a.returned_on IS NULL) DESC, a.kind, a.label`
    )
    .all(...params);
}

export function createAsset(input = {}) {
  const label = String(input.label || '').trim();
  if (!label) throw new Error('give the asset a name');
  const info = db
    .prepare(
      `INSERT INTO assets (company_id, kind, label, identifier, value, employee_id, issued_on, returned_on, condition, note)
       VALUES (@company_id, @kind, @label, @identifier, @value, @employee_id, @issued_on, @returned_on, @condition, @note)`
    )
    .run({
      company_id: Number(input.company_id) || null,
      kind: input.kind || 'Other',
      label,
      identifier: input.identifier || null,
      value: Number(input.value) || 0,
      employee_id: Number(input.employee_id) || null,
      issued_on: input.issued_on || null,
      returned_on: input.returned_on || null,
      condition: input.condition || null,
      note: input.note || null,
    });
  audit({ who: input.by, action: 'created', entity: 'assets', entity_id: info.lastInsertRowid, label });
  return getAsset(info.lastInsertRowid);
}

export function updateAsset(id, patch = {}) {
  const before = getAsset(id);
  if (!before) throw new Error('not found');
  const fields = [];
  const values = [];
  for (const key of ['company_id', 'kind', 'label', 'identifier', 'value', 'employee_id', 'issued_on', 'returned_on', 'condition', 'note']) {
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
      label: before.label,
      from_value: before.employee_name || 'the office',
      to_value: after.returned_on ? 'the office' : after.employee_name || 'the office',
    });
  }
  return after;
}

/** Hand it over. Issuing to somebody else clears the previous return date. */
export function issueAsset(id, { employee_id, issued_on, by } = {}) {
  const employee = getEmployee(employee_id);
  if (!employee) throw new Error('employee not found');
  return updateAsset(id, {
    employee_id: employee.id,
    issued_on: issued_on || new Date().toISOString().slice(0, 10),
    returned_on: '',
    by,
  });
}

export function returnAsset(id, { returned_on, condition, by } = {}) {
  return updateAsset(id, {
    returned_on: returned_on || new Date().toISOString().slice(0, 10),
    condition: condition || undefined,
    by,
  });
}

export function deleteAsset(id, by) {
  const before = getAsset(id);
  if (!before) return false;
  const gone = db.prepare(`DELETE FROM assets WHERE id = ?`).run(id).changes > 0;
  if (gone) audit({ who: by, action: 'deleted', entity: 'assets', entity_id: id, label: before.label });
  return gone;
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
      assets: assets.map((a) => ({ label: a.label, value: a.value })),
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
