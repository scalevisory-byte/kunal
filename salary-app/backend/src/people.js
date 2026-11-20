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
import {
  codeProblem,
  nextCode,
  SERIES_WORD,
  formatSeriesCode,
  nextSeriesCode,
  nextSeriesNumber,
  prefixFor,
  prefixProblem,
  tidyCode,
  tidyPrefix,
} from '../../shared/assetCode.js';
import { looksDuplicate, ownership } from '../../shared/maintenance.js';
import {
  LICENSE_KINDS,
  LICENSE_TERMS,
  cleanTerm,
  dressLicense,
  licenseAlerts,
  licenseProblem,
  licenseTotals,
  seatProblem,
  termLabel,
} from '../../shared/licenses.js';
import { STATE_KEYS, allocationProblem } from '../../shared/assetStatus.js';
import { setOwnGroups } from '../../shared/assetGroups.js';
import { CLEARANCE_STEPS, cleanState, exitClearance } from '../../shared/exitClearance.js';
import {
  instalmentOf,
  kindLabel as penaltyKindLabel,
  outstandingOf,
  validatePenalty,
  wageCheck,
} from '../../shared/penalties.js';

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

  -- Fines, losses and damage recovered from somebody's salary.
  --
  -- Its own table rather than a bigger Deduct box, because the box remembers
  -- a number and a line of remark: not what broke, not when, not who decided,
  -- not whether the person was ever told, and not whether it was meant to come
  -- out over five months. The next argument about it has only the remark.
  --
  -- Recording one deducts NOTHING. Recovery is a separate call that names the
  -- month it comes out of, like the expense claim above it.
  CREATE TABLE IF NOT EXISTS penalties (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL DEFAULT 'fine',
    amount        REAL NOT NULL,
    -- What was damaged or lost. Free text, with the asset's code in it where
    -- there is one: the register is the asset's record, this is the money.
    what          TEXT,
    asset_id      INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    -- WHY it is being deducted. Required - a deduction nobody can explain six
    -- months later is the one that becomes a dispute.
    note          TEXT NOT NULL,
    happened_on   TEXT,
    -- When they were told, and when they accepted it. Both nullable: "nobody
    -- has done this yet" is not "they refused".
    told_on       TEXT,
    acknowledged_on TEXT,
    months        INTEGER NOT NULL DEFAULT 1,
    status        TEXT NOT NULL DEFAULT 'open',
    waived_note   TEXT,
    raised_by     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_penalties_employee ON penalties(employee_id, happened_on);
  CREATE INDEX IF NOT EXISTS idx_penalties_status ON penalties(status);

  -- One row per month actually recovered. This is the ledger; the penalty row
  -- carries the headline. They answer different questions, so they cannot
  -- drift - the same split as the asset register and its handovers.
  CREATE TABLE IF NOT EXISTS penalty_recoveries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    penalty_id  INTEGER NOT NULL REFERENCES penalties(id) ON DELETE CASCADE,
    period_id   INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    amount      REAL NOT NULL,
    by_whom     TEXT,
    posted_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_penalty_recoveries ON penalty_recoveries(penalty_id);
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

  /*
   * What the thing IS, beyond its kind. A register that says "Laptop" and
   * nothing else cannot be matched against an invoice or a service bill.
   */
  ['brand', 'TEXT'],
  ['model', 'TEXT'],
  ['description', 'TEXT'],

  /* Where it is, which is not the same as who has it. */
  ['department', 'TEXT'],
  ['location', 'TEXT'],
  ['floor_room', 'TEXT'],

  /* The warranty's own details. `warranty_until` held only the end. */
  ['warranty_from', 'TEXT'],
  ['warranty_provider', 'TEXT'],
  ['purchase_remarks', 'TEXT'],

  /*
   * ONLY the four states nothing in the data can tell us: under maintenance,
   * damaged, missing, disposed. Available / Assigned / Written off are facts
   * this database already holds and are worked out every time, never stored -
   * a column saying "Assigned" beside an employee_id of null is not a status,
   * it is a second opinion. See shared/assetStatus.js.
   */
  ['state', 'TEXT'],
  ['state_note', 'TEXT'],
  ['state_since', 'TEXT'],
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

/* True only on the run that adds in_deduction - see the back-fill below. */
const penaltyLedgerWasManual = !db
  .prepare(`PRAGMA table_info(penalty_recoveries)`)
  .all()
  .some((c) => c.name === 'in_deduction');

const addColumns = (table, columns) => {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [column, type] of columns) {
    if (have.has(column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    log.info(`Migrated ${table}: added ${column}.`);
  }
};

/*
 * The asset masters: categories, the types under them, brands and vendors.
 *
 * ONE table with a `kind` column rather than four, because they are four
 * lists of names and four tables would be four screens, four routes and four
 * places to fix the same typo. A type belongs to a category through
 * `parent_id`; the other three have no parent.
 *
 * Nothing is forced to come from here. An asset still stores its category,
 * brand and vendor as TEXT, so a name typed before the master existed keeps
 * working and nobody is blocked at six in the evening because the vendor is
 * not on a list yet. The master makes the pickers useful; it is not a gate.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS asset_masters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,           -- category | type | brand | vendor
    name       TEXT NOT NULL,
    parent_id  INTEGER REFERENCES asset_masters(id) ON DELETE CASCADE,
    note       TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_master_name
    ON asset_masters(kind, COALESCE(parent_id, 0), name);
`);

/*
 * A vendor is a company you ring up; the other three are just names.
 *
 * The contact columns live on the same table and stay null for a category, a
 * type or a brand. A separate `vendors` table would mean a second screen, a
 * second set of routes and a second place for the same name to be typed - and
 * the one thing a vendor shares with the other three is exactly what this
 * table is for: being offered in a picker.
 */
addColumns('asset_masters', [
  ['contact_person', 'TEXT'],
  ['phone', 'TEXT'],
  ['email', 'TEXT'],
  ['address', 'TEXT'],
  // What an invoice has to carry to be claimed against.
  ['gstin', 'TEXT'],
]);

export const MASTER_KINDS = ['category', 'type', 'brand', 'vendor'];

/** Only a vendor has these; the rest keep them null. */
export const VENDOR_FIELDS = ['contact_person', 'phone', 'email', 'address', 'gstin'];

export const listMasters = (kind) =>
  db
    .prepare(
      `SELECT m.*, p.name AS parent_name FROM asset_masters m
       LEFT JOIN asset_masters p ON p.id = m.parent_id
       ${kind ? 'WHERE m.kind = ?' : ''}
       ORDER BY m.kind, m.sort_order, m.name`
    )
    .all(...(kind ? [kind] : []));

/*
 * THE OFFICE'S OWN CATEGORIES ARE GROUPS, on the server too.
 *
 * Every report that names a group - the statement, the register export, the
 * service report - runs here, so the engine has to be told the same lists
 * the browser was told. One process, one database, one map; it is refreshed
 * whenever a master changes rather than read per row.
 */
export function refreshOwnGroups() {
  const all = listMasters();
  setOwnGroups(
    all.filter((m) => m.kind === 'category'),
    all.filter((m) => m.kind === 'type')
  );
}
refreshOwnGroups();

export function createMaster(input = {}) {
  const kind = String(input.kind || '').trim();
  if (!MASTER_KINDS.includes(kind)) throw new Error(`a master is one of ${MASTER_KINDS.join(', ')}`);
  const name = String(input.name || '').trim();
  if (!name) throw new Error('give it a name');
  // A type under no category is a type of nothing.
  const parentId = kind === 'type' ? Number(input.parent_id) || null : null;
  if (kind === 'type' && !parentId) throw new Error('which category is this a type of?');
  const twin = db
    .prepare(`SELECT id FROM asset_masters WHERE kind = ? AND COALESCE(parent_id, 0) = ? AND name = ?`)
    .get(kind, parentId || 0, name);
  if (twin) throw new Error(`${name} is already on the list`);
  const info = db
    .prepare(
      `INSERT INTO asset_masters (kind, name, parent_id, note, sort_order,
                                  contact_person, phone, email, address, gstin)
       VALUES (@kind, @name, @parent_id, @note, @sort_order,
               @contact_person, @phone, @email, @address, @gstin)`
    )
    .run({
      kind,
      name,
      parent_id: parentId,
      note: input.note || null,
      sort_order: Number(input.sort_order) || 0,
      // Kept only for a vendor: a brand has no phone number.
      ...Object.fromEntries(
        VENDOR_FIELDS.map((f) => [f, kind === 'vendor' ? input[f] || null : null])
      ),
    });
  // A new Category is a new GROUP, so the engine hears about it now.
  refreshOwnGroups();
  return db.prepare(`SELECT * FROM asset_masters WHERE id = ?`).get(info.lastInsertRowid);
}

export function updateMaster(id, patch = {}) {
  const row = db.prepare(`SELECT * FROM asset_masters WHERE id = ?`).get(id);
  if (!row) throw new Error('not found');
  const next = {
    name: 'name' in patch ? String(patch.name || '').trim() || row.name : row.name,
    note: 'note' in patch ? patch.note || null : row.note,
    active: 'active' in patch ? (patch.active ? 1 : 0) : row.active,
    sort_order: 'sort_order' in patch ? Number(patch.sort_order) || 0 : row.sort_order,
    ...Object.fromEntries(
      VENDOR_FIELDS.map((f) => [
        f,
        row.kind === 'vendor' && f in patch ? patch[f] || null : row[f] ?? null,
      ])
    ),
  };
  db.prepare(
    `UPDATE asset_masters SET name = @name, note = @note, active = @active, sort_order = @sort_order,
       contact_person = @contact_person, phone = @phone, email = @email,
       address = @address, gstin = @gstin
     WHERE id = @id`
  ).run({ ...next, id });
  // Renaming a Category renames a group, which the reports read by name.
  refreshOwnGroups();
  return db.prepare(`SELECT * FROM asset_masters WHERE id = ?`).get(id);
}

/**
 * Taking a name off the list does NOT touch the assets that carry it.
 *
 * The asset stores the name as text, so an old laptop keeps saying "Dell"
 * after Dell comes off the vendor list. That is the point: a master is a
 * convenience for typing, not a foreign key that can rewrite history.
 */
export const deleteMaster = (id) => {
  const gone = db.prepare(`DELETE FROM asset_masters WHERE id = ?`).run(id).changes > 0;
  /*
   * A deleted Category stops being a group, and its assets fall back to
   * where the built-in table puts them - or to Other, which is honest:
   * nobody has said where they belong any more. No asset is touched.
   */
  if (gone) refreshOwnGroups();
  return gone;
};

/** Today, as the app writes dates everywhere: YYYY-MM-DD. */
const dayNow = () => new Date().toISOString().slice(0, 10);

/*
 * Columns the People redesign asked for that no table had. Each is nullable
 * and none of them can move a rupee - they are things the office writes down,
 * not inputs to a calculation.
 */

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

export const getAsset = (id) => {
  const row = db
    .prepare(
      `SELECT a.*, e.name AS employee_name, c.name AS company_name, br.name AS branch_name
       FROM assets a
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN companies c ON c.id = a.company_id
       LEFT JOIN branches br ON br.id = a.branch_id
       WHERE a.id = ?`
    )
    .get(id);
  /*
   * The same `warranty_left_days` the list carries.
   *
   * Without it a PATCH echo was missing the one field that says whether the
   * warranty has run out - so typing a new date into the register's cell left
   * the row still marked red against the OLD date until the page was
   * reloaded. A detail read and a list read answering differently about the
   * same asset is the shape of bug this file keeps hitting.
   */
  return row ? { ...row, warranty_left_days: daysUntil(row.warranty_until) } : null;
};

/**
 * Scanned or typed, found either way.
 *
 * Also by the code the asset came in with. His stickers read BNF-Assets-2456
 * and the register now calls that asset BNF-ASSETS-000551 - somebody holding
 * the mouse has only the sticker, so looking it up has to work.
 */
/** Letters and digits only, so punctuation cannot keep two spellings apart. */
const plainCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const getAssetByCode = (code) => {
  const tidied = tidyCode(code);
  const exact =
    db.prepare(`SELECT id FROM assets WHERE UPPER(code) = ?`).get(tidied) ||
    db.prepare(`SELECT id FROM assets WHERE UPPER(old_code) = ?`).get(tidied);
  if (exact) return getAsset(exact.id);

  /*
   * THE OLD CODE IS KEPT EXACTLY AS THE SHEET SPELLED IT - brackets, spaces
   * and all - because that is what the sticker on the desk reads. So looking
   * one up has to ignore punctuation: somebody types
   * "BNF-AST-Big Storage (Almari)-0006" and the stored value has to match
   * however either of them was punctuated.
   */
  const wanted = plainCode(code);
  if (!wanted) return null;
  const row = db
    .prepare(`SELECT id, code, old_code FROM assets WHERE code IS NOT NULL OR old_code IS NOT NULL`)
    .all()
    .find((a) => plainCode(a.code) === wanted || plainCode(a.old_code) === wanted);
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
              (SELECT COUNT(*) FROM asset_handovers h WHERE h.asset_id = a.id) AS handovers,
              -- On the register so the paperwork is VISIBLE. It was reachable
              -- only by clicking an asset's code, which reads as a code and
              -- not as a way in, so Dinesh reported the invoice upload as
              -- missing when it had been there all along.
              (SELECT COUNT(*) FROM asset_documents d WHERE d.asset_id = a.id) AS documents,
              (SELECT COUNT(*) FROM asset_photos ph WHERE ph.asset_id = a.id) AS photos
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

/*
 * EACH COMPANY'S OWN PREFIX, and a code that cannot be issued twice.
 *
 * The prefix lives on the company rather than in a settings blob, because it
 * belongs to the company the way its name does, and because a blob with one
 * key per company is a thing that silently keeps rows for companies that were
 * deleted. Blank means nobody has chosen one, and the initials are used -
 * never a refusal, because an asset still has to be addable.
 */
addColumns('companies', [['asset_prefix', 'TEXT']]);

/*
 * THE CODE THE SHEET CAME IN WITH.
 *
 * Dinesh: "imported assets ko bhi naya code do". So an imported asset is
 * given one from its company's series - but the ID its own spreadsheet
 * carried is KEPT, for two reasons that both bite hard if it is thrown away:
 *
 *   The sticker is already on the desk. Somebody reading BNF-Assets-2456 off
 *   a mouse has to be able to find it, and the app would no longer know that
 *   code at all.
 *
 *   The import RECOGNISES rows by their code. Drop it and importing the same
 *   file a second time matches nothing and creates a thousand duplicates.
 */
addColumns('assets', [['old_code', 'TEXT']]);
db.exec(`CREATE INDEX IF NOT EXISTS idx_assets_old_code ON assets (UPPER(old_code))`);

/*
 * THE UNIQUE INDEX IS THE REAL PROTECTION.
 *
 * Dinesh asked that simultaneous users cannot generate the same code. Working
 * out the next number and then inserting leaves a gap between the two, however
 * small, and a typed code can collide with a generated one in a way no
 * sequence table would catch. The database refusing a second row is the only
 * answer that holds in every case.
 *
 * Built only once the existing rows allow it. A migration that throws takes
 * the whole server down at startup, which is a far worse fault than two
 * assets sharing a code - so a clash is NAMED and the index is left for the
 * next start, when it has been sorted out.
 */
const codeClashes = () =>
  db
    .prepare(
      `SELECT UPPER(code) code, COUNT(*) n FROM assets
        WHERE code IS NOT NULL AND TRIM(code) <> ''
        GROUP BY UPPER(code) HAVING n > 1`
    )
    .all();

try {
  const clashes = codeClashes();
  if (clashes.length) {
    log.warn(
      `Assets: ${clashes.length} code(s) are on more than one asset, so they cannot be made unique yet - ` +
        clashes.slice(0, 5).map((c) => c.code).join(', ')
    );
  } else {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_code_unique
         ON assets (UPPER(code)) WHERE code IS NOT NULL AND TRIM(code) <> ''`
    );
  }
} catch (err) {
  log.warn(`Assets: could not make codes unique - ${err.message}`);
}

/*
 * A HIGH-WATER MARK, so a deleted code is never handed out again.
 *
 * Reading the highest code still ON the register is not enough: delete the
 * newest asset and its number comes free, which is exactly what must not
 * happen. An old service bill, a signed handover slip and a sticker in a
 * drawer still name BNF-ASSETS-000005, and giving it to a second laptop makes
 * both histories wrong. Written-off assets keep their row so they were
 * already safe; a deletion was the hole.
 *
 * One row per series head ("BNF-ASSETS-"), and it only ever goes UP.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS asset_code_series (
    head   TEXT PRIMARY KEY,
    issued INTEGER NOT NULL DEFAULT 0
  );
`);

const seriesHead = (prefix) => `${String(prefix || 'GEN').toUpperCase()}-${SERIES_WORD}-`;

const markIssued = (prefix, n) =>
  db
    .prepare(
      `INSERT INTO asset_code_series (head, issued) VALUES (@head, @n)
       ON CONFLICT(head) DO UPDATE SET issued = MAX(issued, @n)`
    )
    .run({ head: seriesHead(prefix), n: Number(n) || 0 });

const highWater = (prefix) =>
  db.prepare(`SELECT issued FROM asset_code_series WHERE head = ?`).get(seriesHead(prefix))?.issued || 0;

/** Every code already issued, however it was spelled. */
const codesTaken = () =>
  db.prepare(`SELECT code FROM assets WHERE code IS NOT NULL`).all().map((r) => r.code);

/**
 * The next number in a company's series: the higher of what is on the
 * register and what has ever been handed out.
 *
 * Both halves are needed. The register carries his imported stickers, which
 * the high-water mark has never seen; the mark carries the ones that have
 * since been deleted, which the register no longer has.
 */
const nextNumberFor = (prefix) =>
  Math.max(nextSeriesNumber(prefix, codesTaken()), highWater(prefix) + 1);

/**
 * The next code for a company, in his series.
 *
 * Exported so the Add Asset form can SHOW it before anything is saved. What
 * it shows is a preview and nothing is reserved by looking - the code is
 * drawn again inside the insert, and the unique index decides.
 */
export function nextAssetCode(companyId) {
  const prefix = prefixOf(companyId);
  return formatSeriesCode(prefix, nextNumberFor(prefix));
}

const prefixOf = (companyId) =>
  prefixFor(
    (companyId
      ? db.prepare(`SELECT name, asset_prefix FROM companies WHERE id = ?`).get(companyId)
      : null) || {}
  );

/**
 * Every company, its prefix, and where its series has got to.
 *
 * `issued` is how many codes that series has handed out, which is NOT how
 * many assets the company has: a written-off asset keeps its code and its
 * number is never handed to anybody else. Saying "next: BNF-ASSETS-002457"
 * is the useful part - it is what the next sticker will read.
 */
export function assetPrefixes() {
  const taken = codesTaken();
  return db
    .prepare(`SELECT id, name, asset_prefix FROM companies ORDER BY name`)
    .all()
    .map((company) => {
      const prefix = prefixFor(company);
      const next = nextSeriesCode(prefix, taken);
      return {
        id: company.id,
        name: company.name,
        prefix,
        /* Blank means nobody chose one and the initials are being used. The
         * screen says so rather than showing a value somebody never typed. */
        chosen: tidyPrefix(company.asset_prefix),
        issued: db
          .prepare(`SELECT COUNT(*) n FROM assets WHERE company_id = ? AND code IS NOT NULL`)
          .get(company.id).n,
        next,
      };
    });
}

/**
 * Change a company's prefix.
 *
 * CODES ALREADY ISSUED ARE NOT TOUCHED - they are on stickers, on handover
 * slips and on service bills. Changing the prefix only changes what the NEXT
 * one reads, and the new series starts at 1 because it is a new series.
 */
export function setAssetPrefix(companyId, value, { by = 'office' } = {}) {
  const company = db.prepare(`SELECT id, name, asset_prefix FROM companies WHERE id = ?`).get(companyId);
  if (!company) throw new Error('no such company');
  const problem = prefixProblem(value);
  if (problem) throw new Error(problem);

  const clean = tidyPrefix(value);
  const was = tidyPrefix(company.asset_prefix);
  if (clean === was) return assetPrefixes().find((c) => c.id === companyId);

  // A prefix another company is already using would merge two series into
  // one, and the next code drawn would depend on which company asked.
  const clash = db
    .prepare(`SELECT name FROM companies WHERE id <> ? AND UPPER(COALESCE(asset_prefix, '')) = ?`)
    .get(companyId, clean);
  if (clean && clash) throw new Error(`${clean} is already ${clash.name}'s prefix`);

  db.prepare(`UPDATE companies SET asset_prefix = ? WHERE id = ?`).run(clean || null, companyId);
  audit({
    who: by, action: 'changed', entity: 'companies', entity_id: companyId,
    label: company.name, field: 'asset_prefix', from_value: was, to_value: clean,
    note: 'codes already issued are unchanged',
  });
  return assetPrefixes().find((c) => c.id === companyId);
}

/**
 * ASSETS STILL CARRYING THEIR SPREADSHEET'S ID, and what renumbering them
 * would do.
 *
 * Dinesh imported a thousand rows before the series existed, so they wear
 * his sheet's own IDs - BNF-Assets-2456 beside BNF-AST-BIG-STORAGE-ALMARI-0006.
 * He asked for one uniform series.
 *
 * This COUNTS, it does not change anything. Renumbering a thousand stickers
 * is not something to discover after the fact, so the screen says how many
 * and shows a few before the button is pressed.
 */
export function renumberPreview({ company_id } = {}) {
  const rows = db
    .prepare(
      `SELECT a.id, a.code, a.old_code, a.label, a.company_id, c.name AS company_name,
              c.asset_prefix
         FROM assets a LEFT JOIN companies c ON c.id = a.company_id
        WHERE a.written_off_on IS NULL
          ${company_id ? 'AND a.company_id = @company_id' : ''}
        ORDER BY a.id`
    )
    .all(company_id ? { company_id: Number(company_id) } : {});

  const already = (row) => {
    const head = `${prefixFor({ name: row.company_name, asset_prefix: row.asset_prefix })}-${SERIES_WORD}-`;
    const code = String(row.code || '').toUpperCase();
    return code.startsWith(head) && /^\d+$/.test(code.slice(head.length));
  };

  const toChange = rows.filter((r) => !already(r));
  return {
    total: rows.length,
    /* Already in their company's series: nothing to do, and saying so stops
     * somebody pressing the button a second time wondering if it worked. */
    already: rows.length - toChange.length,
    changing: toChange.length,
    /* Named, because "1,004 will change" is a number and these are things. */
    examples: toChange.slice(0, 6).map((r) => ({
      id: r.id,
      label: r.label,
      from: r.code || '(no code)',
      company: r.company_name || '(no company)',
    })),
    /* An asset with no company has no series to join. Named rather than
     * given a GEN- code nobody asked for. */
    no_company: toChange.filter((r) => !r.company_id).length,
  };
}

/**
 * Give every asset a code from its company's series, keeping the old one.
 *
 * ONE TRANSACTION. A renumber that stops half way leaves a register where
 * some stickers have been reprinted and some have not, with nothing saying
 * where the line is.
 *
 * A WRITTEN-OFF ASSET IS LEFT ALONE: its code is on a disposal note and a
 * final service bill, and it will never have a sticker reprinted.
 */
export const renumberAssets = db.transaction(({ company_id, by = 'office' } = {}) => {
  const preview = renumberPreview({ company_id });
  const rows = db
    .prepare(
      `SELECT a.id, a.code, a.old_code, a.company_id, c.name AS company_name, c.asset_prefix
         FROM assets a LEFT JOIN companies c ON c.id = a.company_id
        WHERE a.written_off_on IS NULL AND a.company_id IS NOT NULL
          ${company_id ? 'AND a.company_id = @company_id' : ''}
        ORDER BY a.id`
    )
    .all(company_id ? { company_id: Number(company_id) } : {});

  let changed = 0;
  for (const row of rows) {
    const prefix = prefixFor({ name: row.company_name, asset_prefix: row.asset_prefix });
    const head = `${prefix}-${SERIES_WORD}-`;
    const current = String(row.code || '').toUpperCase();
    if (current.startsWith(head) && /^\d+$/.test(current.slice(head.length))) continue;

    const code = formatSeriesCode(prefix, nextNumberFor(prefix));
    db.prepare(`UPDATE assets SET code = ?, old_code = COALESCE(old_code, ?) WHERE id = ?`)
      .run(code, row.code || null, row.id);
    markIssued(prefix, Number(code.slice(head.length)));
    audit({
      who: by, action: 'changed', entity: 'assets', entity_id: row.id,
      label: `${code} (was ${row.code || 'no code'})`, field: 'code',
      from_value: row.code || '', to_value: code,
      note: 'renumbered into the company series; the old code is kept',
    });
    changed += 1;
  }
  return { ...preview, changed };
});

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
    // Case-insensitively, because the unique index is on UPPER(code) and a
    // check that disagreed with it would let a clash reach the insert and
    // come back as a database error nobody can read.
    const twin = db.prepare(`SELECT code FROM assets WHERE UPPER(code) = ?`).get(code.toUpperCase());
    if (twin) throw new Error(`${code} is already on something else`);
  } else {
    /*
     * His series, per company: BNF-ASSETS-000001. The older per-kind series
     * is left in place for codes already on labels - nothing is renumbered.
     */
    code = nextAssetCode(companyId);
  }

  /*
   * A serial number that is already on the register.
   *
   * It ASKS rather than refuses, like the duplicate service does: serials get
   * retyped off a sticker, two devices really do ship with the same number on
   * the box, and a register that will not record the truth gets worked
   * around. The 409 carries the row it clashes with so the screen can show it.
   */
  const serial = String(input.identifier || '').trim();
  if (serial && !input.force) {
    const twin = db
      .prepare(`SELECT * FROM assets WHERE identifier = ? COLLATE NOCASE LIMIT 1`)
      .get(serial);
    if (twin) {
      const err = new Error(
        `Serial ${serial} is already on ${twin.code || 'another asset'} (${twin.label}). Add it anyway?`
      );
      err.duplicate = twin;
      throw err;
    }
  }

  /*
   * IF THE DATABASE REFUSES THE CODE, DRAW ANOTHER ONE.
   *
   * Two people pressing Add in the same second both work out 000042, and the
   * unique index lets exactly one of them through. The loser must not see an
   * error - nothing is wrong with their asset, the number simply moved on. A
   * code somebody TYPED is different: that collision is theirs to resolve and
   * was already reported above.
   */
  const insert = db.prepare(
      `INSERT INTO assets (code, old_code, company_id, branch_id, kind, label, identifier, purchase_cost,
                           purchase_date, vendor, invoice_no, warranty_until,
                           amc_until, amc_vendor, amc_cost,
                           employee_id, issued_on, returned_on, condition, note,
                           brand, model, description, department, location, floor_room,
                           warranty_from, warranty_provider, purchase_remarks)
       VALUES (@code, @old_code, @company_id, @branch_id, @kind, @label, @identifier, @purchase_cost,
               @purchase_date, @vendor, @invoice_no, @warranty_until,
               @amc_until, @amc_vendor, @amc_cost,
               @employee_id, @issued_on, @returned_on, @condition, @note,
               @brand, @model, @description, @department, @location, @floor_room,
               @warranty_from, @warranty_provider, @purchase_remarks)`
  );

  const values = {
      code,
      old_code: input.old_code || null,
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
      brand: input.brand || null,
      model: input.model || null,
      description: input.description || null,
      department: input.department || null,
      location: input.location || null,
      floor_room: input.floor_room || null,
      warranty_from: input.warranty_from || null,
      warranty_provider: input.warranty_provider || null,
      purchase_remarks: input.purchase_remarks || null,
      amc_until: input.amc_until || null,
      amc_vendor: input.amc_vendor || null,
      amc_cost: input.amc_cost === undefined || input.amc_cost === '' ? null : Number(input.amc_cost) || 0,
      employee_id: Number(input.employee_id) || null,
      issued_on: input.issued_on || null,
      returned_on: input.returned_on || null,
      condition: input.condition || null,
      note: input.note || null,
    };

  let info;
  for (let attempt = 0; ; attempt += 1) {
    try {
      info = insert.run(values);
      break;
    } catch (err) {
      const clash = /UNIQUE constraint failed/i.test(String(err?.message));
      // Only a code WE drew is redrawn, and only a few times: a loop that
      // never gives up would spin for ever against a broken index.
      if (!clash || input.code || attempt >= 5) throw err;
      values.code = nextAssetCode(companyId);
      code = values.code;
    }
  }

  const id = info.lastInsertRowid;

  /*
   * Record the number against its series, so it can never come round again -
   * including a code somebody TYPED, because his imported BNF-ASSETS-002456
   * has to push the mark past 2456 as surely as a generated one does.
   */
  const head = `${prefixOf(companyId)}-${SERIES_WORD}-`;
  if (String(code || '').toUpperCase().startsWith(head)) {
    const tail = String(code).toUpperCase().slice(head.length);
    if (/^\d+$/.test(tail)) markIssued(prefixOf(companyId), Number(tail));
  }

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
  'old_code',
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
  'brand',
  'model',
  'description',
  'department',
  'location',
  'floor_room',
  'warranty_from',
  'warranty_provider',
  'purchase_remarks',
  'state_note',
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

function logHandover(
  assetId,
  { employee_id, issued_on, issued_by, condition_out, note, expected_return_on, accessories } = {}
) {
  const name = employee_id ? getEmployee(employee_id)?.name || null : null;
  db.prepare(
    `INSERT INTO asset_handovers (asset_id, employee_id, employee_name, issued_on, issued_by,
                                  condition_out, note, expected_return_on, accessories)
     VALUES (@asset_id, @employee_id, @employee_name, @issued_on, @issued_by,
             @condition_out, @note, @expected_return_on, @accessories)`
  ).run({
    asset_id: assetId,
    employee_id: employee_id || null,
    employee_name: name,
    issued_on: issued_on || dayNow(),
    issued_by: issued_by || null,
    condition_out: condition_out || null,
    note: note || null,
    expected_return_on: expected_return_on || null,
    accessories: accessories || null,
  });
}

/**
 * The employee signing for it.
 *
 * A slip nobody signed settles nothing, which is the whole reason a handover
 * is recorded. Kept on the handover rather than the asset, because what was
 * agreed was agreed about THAT handover - the next one is signed again.
 */
export function acknowledgeHandover(id, { on, by } = {}) {
  const row = db.prepare(`SELECT * FROM asset_handovers WHERE id = ?`).get(id);
  if (!row) throw new Error('not found');
  if (row.acknowledged_on) return row;
  db.prepare(`UPDATE asset_handovers SET acknowledged_on = ?, acknowledged_by = ? WHERE id = ?`).run(
    on || dayNow(),
    by || row.employee_name || null,
    id
  );
  audit({
    who: by,
    action: 'acknowledged',
    entity: 'asset_handovers',
    entity_id: id,
    label: `${row.employee_name || 'somebody'} signed for it`,
  });
  return db.prepare(`SELECT * FROM asset_handovers WHERE id = ?`).get(id);
}

/**
 * Hand it over.
 *
 * Issuing to somebody while it is already out with somebody else closes the
 * first handover rather than losing it - which is what used to happen, and is
 * why asset history had nothing behind it.
 */
export function issueAsset(
  id,
  { employee_id, issued_on, condition, note, by, expected_return_on, accessories } = {}
) {
  const asset = getAsset(id);
  if (!asset) throw new Error('not found');
  if (asset.written_off_on) throw new Error('that asset is written off');
  /*
   * Only an AVAILABLE asset can go out. Passing it straight on from the
   * person who has it is the one exception and is handled below; everything
   * else - away being repaired, damaged, missing - is refused with the reason,
   * because "no" on its own sends people hunting.
   */
  if (asset.state && STATE_KEYS.includes(asset.state)) {
    throw new Error(allocationProblem(asset));
  }
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
    expected_return_on,
    accessories,
  });
  return updateAsset(id, {
    employee_id: employee.id,
    issued_on: issued_on || dayNow(),
    returned_on: '',
    condition: condition || undefined,
    by,
  });
}

/**
 * PASSING THINGS STRAIGHT FROM ONE PERSON TO ANOTHER.
 *
 * Dinesh: *"ledger me se direct asset transfer karne ka option do"*. Until
 * now a move was two jobs on two screens - take it back on the ledger, then
 * find the row on the register and issue it again - and between the two the
 * asset sat in an office nobody had carried it to.
 *
 * Three things this is careful about:
 *
 *   **ONE DATE FOR BOTH SIDES.** The return and the new issue carry the same
 *   day, which is exactly what makes both ledgers read "Transferred" rather
 *   than a return and an unrelated issue. The ledger derives that from the
 *   dates lining up, so the dates have to line up.
 *
 *   **ONE TRANSACTION.** A half-done move leaves an asset with nobody, or
 *   on two people's pages at once.
 *
 *   **IT MOVES WHAT IT WAS ASKED TO MOVE.** Anything not actually with the
 *   person it is being taken from is refused by name, not silently skipped -
 *   a stale screen is the commonest reason for that, and "it did nothing"
 *   with no reason sends people hunting.
 */
export function transferAssets(ids = [], { from_employee_id: fromId, to_employee_id: toId, on, condition, note, by } = {}) {
  const to = getEmployee(toId);
  if (!to) throw new Error('who is it going to?');
  if (fromId && Number(fromId) === Number(to.id)) throw new Error(`${to.name} already has it`);
  const day = String(on || dayNow()).slice(0, 10);
  const wanted = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  if (!wanted.length) throw new Error('nothing was chosen to transfer');

  const moved = [];
  const refused = [];

  const run = db.transaction(() => {
    for (const id of wanted) {
      const asset = getAsset(id);
      if (!asset) {
        refused.push({ id, why: 'not on the register' });
        continue;
      }
      const label = `${asset.code || ''} ${asset.label || ''}`.trim();
      if (asset.written_off_on) {
        refused.push({ id, label, why: 'written off' });
        continue;
      }
      if (fromId && Number(asset.employee_id) !== Number(fromId)) {
        refused.push({ id, label, why: `not with them any more — ${whoHasIt(asset)}` });
        continue;
      }
      if (Number(asset.employee_id) === Number(to.id) && !asset.returned_on) {
        refused.push({ id, label, why: `${to.name} already has it` });
        continue;
      }
      try {
        // issueAsset closes whatever handover is open, on the same day, and
        // opens the new one. The transfer is those two facts, dated alike.
        issueAsset(id, { employee_id: to.id, issued_on: day, condition, note, by });
        moved.push({ id, label, from: asset.employee_name || 'the office', to: to.name });
      } catch (err) {
        refused.push({ id, label, why: err.message });
      }
    }
  });
  run();

  return { moved, refused, on: day, to: { id: to.id, name: to.name } };
}

/** Where an asset actually is, for a refusal that tells somebody something. */
const whoHasIt = (asset) =>
  asset.returned_on || !asset.employee_id ? 'it is in the office' : `${asset.employee_name} has it`;

export function returnAsset(id, { returned_on, condition, note, by } = {}) {
  const asset = getAsset(id);
  if (!asset) throw new Error('not found');
  const on = returned_on || dayNow();
  const open = openHandover(id);
  if (open) {
    db.prepare(
      `UPDATE asset_handovers SET returned_on = ?, returned_by = ?, condition_in = ?, note = COALESCE(?, note)
       WHERE id = ?`
    ).run(on, by || null, condition || null, note || null, open.id);
  } else if (asset.employee_id && !asset.returned_on) {
    /*
     * TAKING SOMETHING BACK IS AN EVENT, AND THE LOG HAS TO CARRY IT.
     *
     * Anything issued before the handover log existed - or imported with a
     * holder - has no row to close. Without one, returning it only set a date
     * on the register, and the asset then vanished from that person's ledger
     * altogether: it was no longer held, and nothing said it ever had been.
     * Found by driving a return on exactly such an asset.
     *
     * So a closed handover is written from what IS known: who had it, from
     * when the register says, back today. It is marked as recorded at the
     * return rather than at the handover, because nobody signed for it going
     * out and the trail should not pretend otherwise.
     */
    db.prepare(
      `INSERT INTO asset_handovers (asset_id, employee_id, employee_name, issued_on, issued_by,
                                    returned_on, returned_by, condition_in, note)
       VALUES (@asset_id, @employee_id, @employee_name, @issued_on, NULL,
               @returned_on, @returned_by, @condition_in, @note)`
    ).run({
      asset_id: asset.id,
      employee_id: asset.employee_id,
      employee_name: asset.employee_name || null,
      issued_on: asset.issued_on || null,
      returned_on: on,
      returned_by: by || null,
      condition_in: condition || null,
      note: note || 'recorded when it came back — no slip was on file',
    });
  }
  return updateAsset(id, {
    returned_on: on,
    condition: condition || undefined,
    by,
  });
}

/**
 * TAKING SEVERAL THINGS BACK AT ONCE — somebody leaving, or handing over.
 *
 * Dinesh: *"koi employee chhod ke ja raha he uski asset, ya kisi se vapas le
 * rahe he, uska kya he"*. One at a time through the register meant finding
 * each row and answering a prompt; for somebody holding six things that is
 * six searches on the day they are walking out of the door.
 *
 * Three things it will not do:
 *
 *   **It never takes back what it was not asked to.** Only the ids passed,
 *   and anything already back is reported as such rather than re-dated — a
 *   second return would move the date on a handover that closed months ago.
 *
 *   **It never writes anything off.** Not returned is not the same as lost,
 *   and the difference is somebody's decision.
 *
 *   **It never touches pay.** An unreturned asset is named and valued on the
 *   full and final and deducted nowhere, which is the rule this app has had
 *   since the settlement was written.
 *
 * One transaction: a half-finished handover at exit is worse than none,
 * because the slip in somebody's hand and the register would disagree.
 */
export function returnAssets(ids = [], { returned_on, condition, note, by } = {}) {
  const on = String(returned_on || dayNow()).slice(0, 10);
  const wanted = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  const done = [];
  const already = [];
  const missing = [];

  const run = db.transaction(() => {
    for (const id of wanted) {
      const asset = getAsset(id);
      if (!asset) {
        missing.push(id);
        continue;
      }
      if (!asset.employee_id || asset.returned_on) {
        already.push({ id, code: asset.code || '', label: asset.label || '' });
        continue;
      }
      returnAsset(id, { returned_on: on, condition, note, by });
      done.push({ id, code: asset.code || '', label: asset.label || '', from: asset.employee_name || '' });
    }
  });
  run();

  return { returned: done, already, missing, returned_on: on };
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

/**
 * Mark it under maintenance, damaged, missing - or back to normal.
 *
 * Its own call rather than a field on the edit form, for the same reason
 * issuing and writing off are: it is a decision somebody takes about the
 * thing, and it belongs on the trail with a date and a reason. Passing no
 * state (or 'available') clears it, which is how something comes back from
 * the repair shop.
 */
export function setAssetState(id, { state, note, on, by } = {}) {
  const asset = getAsset(id);
  if (!asset) throw new Error('not found');
  if (asset.written_off_on) throw new Error('that asset is written off');
  const wanted = String(state || '').trim();
  const next = wanted && wanted !== 'available' ? wanted : null;
  if (next && !STATE_KEYS.includes(next)) {
    throw new Error(`a state is one of ${STATE_KEYS.join(', ')}, or blank for none`);
  }
  if (next === asset.state) return getAsset(id);

  db.prepare(`UPDATE assets SET state = ?, state_note = ?, state_since = ? WHERE id = ?`).run(
    next,
    next ? note || null : null,
    next ? on || dayNow() : null,
    id
  );
  audit({
    who: by,
    action: next || 'back in use',
    entity: 'assets',
    entity_id: id,
    label: `${asset.code || ''} ${asset.label}`.trim(),
    from_value: asset.state || 'in use',
    to_value: next || 'in use',
    note: note || null,
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

/** Every verdict recorded in a round, for the dashboard's two alerts. */
export const listVerifications = (round) =>
  round
    ? db
        .prepare(`SELECT * FROM asset_verifications WHERE round = ?`)
        .all(round)
        .map((v) => ({ ...v, found: Boolean(v.found) }))
    : [];

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

/* ---------------- exit clearance ---------------- */

/*
 * WHO HAS SIGNED OFF WHAT, on somebody's way out.
 *
 * Only the steps a PERSON signs live here. Assets still out, a loan still
 * owed, a claim unpaid and a login still working are worked out from the
 * registers that already hold them every time the checklist is read - a tick
 * box saying "assets: cleared" beside a register listing three things still
 * out is exactly the disagreement this app keeps avoiding.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS exit_clearances (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    step        TEXT NOT NULL,
    -- pending | given | blocked | na. Nobody having looked reads as pending,
    -- which is a third state and not a refusal. (No backticks in here: one
    -- inside a comment inside a template literal closes the literal, which is
    -- the third time this file has been taken down by it.)
    state       TEXT NOT NULL DEFAULT 'pending',
    by_whom     TEXT,
    cleared_on  TEXT,
    note        TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (employee_id, step)
  );
  CREATE INDEX IF NOT EXISTS idx_exit_clearance ON exit_clearances(employee_id);
`);

export const listClearances = (employeeId) =>
  db.prepare(`SELECT * FROM exit_clearances WHERE employee_id = ?`).all(Number(employeeId));

/**
 * The whole checklist: what somebody signed, and what the registers say.
 *
 * Everything on the computed half is read fresh, so taking an asset back or
 * paying a claim clears its line without anybody touching this screen.
 */
export function clearanceFor(employeeId) {
  const id = Number(employeeId);
  const login = db
    .prepare(`SELECT id, username, active FROM users WHERE employee_id = ?`)
    .get(id) || null;
  return exitClearance({
    signed: listClearances(id),
    assets_out: listAssets({ employee_id: id, out: true }),
    loans: listLoans({ employee_id: id }),
    penalties: listPenalties({ employee_id: id }),
    claims: listClaims({ employee_id: id }),
    login,
  });
}

/**
 * One step, signed.
 *
 * The name and the date are the point: "who said this was fine" has to have
 * an answer, so both go on the row and on the audit trail. Handing it back to
 * `pending` is allowed and recorded too - somebody clears a step by mistake.
 */
export function setClearance(employeeId, step, { state, by, note, on } = {}) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new Error('employee not found');
  if (!CLEARANCE_STEPS.some(([key]) => key === step)) throw new Error(`unknown clearance step: ${step}`);
  const want = cleanState(state);

  db.prepare(
    `INSERT INTO exit_clearances (employee_id, step, state, by_whom, cleared_on, note, updated_at)
     VALUES (@employee_id, @step, @state, @by_whom, @cleared_on, @note, datetime('now'))
     ON CONFLICT (employee_id, step) DO UPDATE SET
       state = @state,
       by_whom = @by_whom,
       -- A step handed back to "not looked at" keeps no date: there is
       -- nothing it is the date OF.
       cleared_on = @cleared_on,
       note = @note,
       updated_at = datetime('now')`
  ).run({
    employee_id: employee.id,
    step,
    state: want,
    by_whom: want === 'pending' ? null : by || null,
    cleared_on: want === 'pending' ? null : String(on || dayNow()).slice(0, 10),
    note: String(note || '').trim() || null,
  });

  audit({
    who: by,
    action: 'changed',
    entity: 'exits',
    entity_id: employee.id,
    label: employee.name,
    field: `clearance: ${step}`,
    to_value: want,
    note: note || null,
  });
  return clearanceFor(employee.id);
}

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
/*
 * Penalties used to be recovered by hand, one press per month, and that press
 * wrote the money straight into payroll_rows.deduction - the same box a
 * one-off is typed into. Now they post themselves every month like a loan
 * instalment and are summed off this ledger instead.
 *
 * Which makes the rows taken under the old rule dangerous: their money is
 * ALREADY inside payroll_rows.deduction, so summing them here too would
 * charge a closed month twice. in_deduction marks them, and every row that
 * existed when this shipped is marked - back-filled in the UPDATE below,
 * which can only ever run once, because the column does not exist until then.
 */
addColumns('penalty_recoveries', [['in_deduction', 'INTEGER NOT NULL DEFAULT 0']]);
if (penaltyLedgerWasManual) {
  const marked = db.prepare(`UPDATE penalty_recoveries SET in_deduction = 1`).run().changes;
  if (marked) log.info(`Migrated penalty_recoveries: ${marked} already inside the Deduct column.`);
}

addColumns('asset_handovers', [
  // When it is due back. Null is open-ended, which is how most allocations
  // are - and why an overdue alert must only count the ones that said a date.
  ['expected_return_on', 'TEXT'],
  // The bag, the charger, the SIM. On the slip somebody signs, so it is on
  // the handover and not on the asset.
  ['accessories', 'TEXT'],
  // A slip nobody signed is a slip that settles nothing.
  ['acknowledged_on', 'TEXT'],
  ['acknowledged_by', 'TEXT'],
]);

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

/* ---------------- the paperwork for an asset ---------------- */

/*
 * The invoice, the warranty card, the delivery note.
 *
 * Its own table rather than a column on the asset, because an asset really
 * does collect several over its life - the purchase invoice, then an AMC
 * renewal, then a repair bill - and a single `invoice_file` column would mean
 * the second one overwriting the first.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS asset_documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'invoice',
    file_path   TEXT NOT NULL,
    -- What it was called when it was uploaded, kept ONLY to show on screen.
    -- The path is the generated name; this never touches the filesystem.
    file_name   TEXT,
    number      TEXT,
    dated       TEXT,
    note        TEXT,
    uploaded_by TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_asset_docs ON asset_documents(asset_id, created_at);
`);

export const ASSET_DOC_KINDS = [
  ['invoice', 'Invoice'],
  ['warranty', 'Warranty card'],
  ['delivery', 'Delivery note'],
  ['amc', 'AMC contract'],
  ['other', 'Something else'],
];

export const listAssetDocs = (assetId) =>
  db
    .prepare(`SELECT * FROM asset_documents WHERE asset_id = ? ORDER BY datetime(created_at) DESC, id DESC`)
    .all(assetId);

export const getAssetDoc = (id) => db.prepare(`SELECT * FROM asset_documents WHERE id = ?`).get(id);

export function addAssetDoc({ asset_id, file_path, file_name, kind, number, dated, note, by }) {
  const asset = getAsset(asset_id);
  if (!asset) throw new Error('that asset is not on the register');
  if (!file_path) throw new Error('no file was uploaded');
  const info = db
    .prepare(
      `INSERT INTO asset_documents (asset_id, kind, file_path, file_name, number, dated, note, uploaded_by)
       VALUES (@asset_id, @kind, @file_path, @file_name, @number, @dated, @note, @by)`
    )
    .run({
      asset_id,
      kind: ASSET_DOC_KINDS.some(([k]) => k === kind) ? kind : 'invoice',
      file_path,
      file_name: file_name || null,
      // Defaults to what the asset already says, so the commonest case - the
      // purchase invoice - needs nothing typed at all.
      number: number || (kind === 'invoice' || !kind ? asset.invoice_no : null) || null,
      dated: dated || (kind === 'invoice' || !kind ? asset.purchase_date : null) || null,
      note: note || null,
      by: by || null,
    });
  audit({
    who: by,
    action: 'attached',
    entity: 'assets',
    entity_id: asset_id,
    label: `${asset.code || ''} ${asset.label}`.trim(),
    note: file_name || kind || 'document',
  });
  return getAssetDoc(info.lastInsertRowid);
}

export const deleteAssetDoc = (id) =>
  db.prepare(`DELETE FROM asset_documents WHERE id = ?`).run(id).changes > 0;

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

/* ================================================================= *
 * Penalties — fines, losses and damage recovered from salary
 * ================================================================= *
 *
 * Two rules, the same two the rest of this file holds:
 *   - recording one deducts NOTHING; recovery is a separate call that names
 *     the month the money comes out of;
 *   - the law's limits are REPORTED, never enforced silently.
 */

/** One penalty, with what has come out of it so far. */
const PENALTY_SELECT = `
  SELECT p.*, e.name AS employee_name, e.code AS employee_code, c.name AS company_name,
         a.code AS asset_code,
         COALESCE((SELECT SUM(r.amount) FROM penalty_recoveries r WHERE r.penalty_id = p.id), 0)
           AS recovered,
         (SELECT COUNT(*) FROM penalty_recoveries r WHERE r.penalty_id = p.id)
           AS recoveries_count
  FROM penalties p
  JOIN employees e ON e.id = p.employee_id
  LEFT JOIN companies c ON c.id = e.company_id
  LEFT JOIN assets a ON a.id = p.asset_id
`;

const dressPenalty = (row) =>
  row && {
    ...row,
    recovered: Math.round((Number(row.recovered) || 0) * 100) / 100,
    outstanding: outstandingOf(row),
    kind_label: penaltyKindLabel(row.kind),
    instalment: instalmentOf(row),
  };

export function listPenalties({ employee_id, status, company_id } = {}) {
  const where = [];
  const params = [];
  if (employee_id) {
    where.push('p.employee_id = ?');
    params.push(Number(employee_id));
  }
  if (status) {
    where.push('p.status = ?');
    params.push(String(status));
  }
  if (company_id) {
    where.push('e.company_id = ?');
    params.push(Number(company_id));
  }
  return db
    .prepare(
      `${PENALTY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.status = 'open' DESC, p.happened_on DESC, p.id DESC`
    )
    .all(...params)
    .map(dressPenalty);
}

export const getPenalty = (id) =>
  dressPenalty(db.prepare(`${PENALTY_SELECT} WHERE p.id = ?`).get(Number(id)));

export const listRecoveries = (penaltyId) =>
  db
    .prepare(
      `SELECT r.*, pe.label AS period_label, pe.year, pe.month
       FROM penalty_recoveries r
       JOIN periods pe ON pe.id = r.period_id
       WHERE r.penalty_id = ?
       ORDER BY pe.year, pe.month, r.id`
    )
    .all(Number(penaltyId));

export function createPenalty(body = {}, by) {
  const { ok, problems } = validatePenalty(body);
  if (!ok) throw new Error(problems.join('; '));
  const employee = getEmployee(Number(body.employee_id));
  if (!employee) throw new Error('not found');

  const id = db
    .prepare(
      `INSERT INTO penalties
        (employee_id, kind, amount, what, asset_id, note, happened_on, told_on,
         acknowledged_on, months, raised_by)
       VALUES (@employee_id, @kind, @amount, @what, @asset_id, @note, @happened_on, @told_on,
               @acknowledged_on, @months, @raised_by)`
    )
    .run({
      employee_id: Number(body.employee_id),
      kind: String(body.kind),
      amount: Number(body.amount),
      what: String(body.what || '').trim() || null,
      asset_id: Number(body.asset_id) || null,
      note: String(body.note).trim(),
      happened_on: body.happened_on || dayNow(),
      told_on: body.told_on || null,
      acknowledged_on: body.acknowledged_on || null,
      months: Number(body.months) || 1,
      raised_by: by || null,
    }).lastInsertRowid;

  audit({
    who: by,
    action: 'created',
    entity: 'penalties',
    entity_id: id,
    label: `${penaltyKindLabel(body.kind)} — ${employee.name}`,
    to_value: Number(body.amount),
    note: String(body.note).trim(),
  });
  return getPenalty(id);
}

export function updatePenalty(id, patch = {}, by) {
  const before = getPenalty(id);
  if (!before) throw new Error('not found');
  if (before.recovered > 0 && 'amount' in patch && Number(patch.amount) < before.recovered) {
    throw new Error(`${before.recovered} has already come out — it cannot be worth less than that`);
  }
  /*
   * Hold and resume, which is a loan's On hold: a month somebody cannot pay,
   * or a penalty being argued about. Only those two values are settable here
   * - 'recovered' is reached by the ledger adding up and 'waived' is a
   * decision with its own route and its own required reason, so neither may
   * be reachable by a PATCH that could be sent by mistake.
   */
  if ('status' in patch) {
    const want = String(patch.status || '').trim();
    if (want !== 'open' && want !== 'held') {
      throw new Error('a penalty can only be put on hold or taken off it here');
    }
    if (before.status === 'waived') throw new Error('this penalty was waived');
    if (before.status === 'recovered') throw new Error('this has been recovered in full');
    db.prepare(`UPDATE penalties SET status = ? WHERE id = ?`).run(want, id);
  }

  const fields = [];
  const values = [];
  for (const key of ['kind', 'amount', 'what', 'note', 'happened_on', 'told_on', 'acknowledged_on', 'months']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(
      key === 'amount' || key === 'months'
        ? Number(patch[key]) || (key === 'months' ? 1 : 0)
        : patch[key] === '' || patch[key] === null
          ? null
          : String(patch[key]).trim()
    );
  }
  // A status-only change has already been written above, so this must read
  // the row back rather than hand out the copy taken before it.
  if (!fields.length) return getPenalty(id);
  db.prepare(`UPDATE penalties SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  const after = getPenalty(id);
  audit({
    who: by,
    action: 'changed',
    entity: 'penalties',
    entity_id: id,
    label: `${after.kind_label} — ${after.employee_name}`,
    from_value: before.amount,
    to_value: after.amount,
  });
  return after;
}

/**
 * Written off rather than deleted, once anything has come out of it.
 *
 * Waiving leaves the record standing and stops the collecting - the money
 * already recovered is NOT handed back here, because that is a payment and
 * payments go through the month they are made in.
 */
export function waivePenalty(id, { note, by } = {}) {
  const penalty = getPenalty(id);
  if (!penalty) throw new Error('not found');
  if (penalty.status === 'waived') throw new Error('this was already waived');
  if (!String(note || '').trim()) throw new Error('say why it is being waived');
  db.prepare(`UPDATE penalties SET status = 'waived', waived_note = ? WHERE id = ?`).run(
    String(note).trim(),
    id
  );
  audit({
    who: by,
    action: 'changed',
    entity: 'penalties',
    entity_id: id,
    label: `${penalty.kind_label} — ${penalty.employee_name}`,
    from_value: penalty.status,
    to_value: 'waived',
    note: String(note).trim(),
  });
  return getPenalty(id);
}

export function deletePenalty(id, by) {
  const before = getPenalty(id);
  if (!before) return false;
  if (before.recovered > 0) {
    throw new Error('money has already come out of this — waive it instead, so the record stands');
  }
  const gone = db.prepare(`DELETE FROM penalties WHERE id = ?`).run(id).changes > 0;
  if (gone) {
    audit({
      who: by,
      action: 'deleted',
      entity: 'penalties',
      entity_id: id,
      label: `${before.kind_label} — ${before.employee_name}`,
    });
  }
  return gone;
}

/**
 * What a recovery WOULD do, before anybody does it.
 *
 * The amount it would take, what is already coming out of that row, and what
 * the Payment of Wages Act says about the total. Said before the click,
 * because a deduction is easy to make and hard to undo.
 */
export function previewRecovery(id, { period_id, amount } = {}) {
  const penalty = getPenalty(id);
  if (!penalty) throw new Error('not found');
  const period = db.prepare(`SELECT * FROM periods WHERE id = ?`).get(Number(period_id));
  if (!period) throw new Error('pick a month');

  const payroll = buildPayroll(period.id, { sync: false });
  const row = payroll?.rows.find((r) => r.employee_id === penalty.employee_id) || null;
  const take = Math.min(
    Number(amount) > 0 ? Number(amount) : penalty.instalment,
    penalty.outstanding
  );

  // What is already coming out of this row BEFORE this penalty.
  const already = row
    ? (Number(row.pt) || 0) +
      (Number(row.pf) || 0) +
      (Number(row.esi) || 0) +
      (Number(row.loan_deduction) || 0) +
      (Number(row.deduction) || 0)
    : 0;

  const check = wageCheck({
    amount: take,
    wages: row ? row.gross_salary : 0,
    otherDeductions: already,
    kind: penalty.kind,
  });

  return {
    penalty,
    period: { id: period.id, label: period.label, locked: Boolean(period.locked) },
    has_row: Boolean(row),
    amount: take,
    gross: row ? row.gross_salary : null,
    net_now: row ? row.net_salary : null,
    net_after: row ? Math.round(row.net_salary - take) : null,
    other_deductions: Math.round(already),
    ...check,
  };
}

/**
 * Take it out of a named month, as a deduction on that person's row.
 *
 * The same shape as paying an expense claim: added to whatever the row already
 * carries rather than replacing it, the reason appended to the remark so it is
 * on the payslip, and refused once there is nothing left to recover - so a
 * double click cannot fine somebody twice.
 */
export function recoverPenalty(id, { period_id, amount, by } = {}) {
  const penalty = getPenalty(id);
  if (!penalty) throw new Error('not found');
  if (penalty.status === 'waived') throw new Error('this penalty was waived');
  if (penalty.outstanding <= 0) throw new Error('this has been recovered in full');

  const period = db.prepare(`SELECT * FROM periods WHERE id = ?`).get(Number(period_id));
  if (!period) throw new Error('pick a month to take it from');
  if (period.locked) throw new Error(`${period.label} is closed`);

  const already = db
    .prepare(`SELECT COUNT(*) AS n FROM penalty_recoveries WHERE penalty_id = ? AND period_id = ?`)
    .get(id, period.id).n;
  if (already) throw new Error(`already taken from ${period.label}`);

  const row = db
    .prepare(`SELECT * FROM payroll_rows WHERE period_id = ? AND employee_id = ?`)
    .get(period.id, penalty.employee_id);
  if (!row) throw new Error(`${penalty.employee_name} has no row in ${period.label}`);

  const take = Math.min(
    Number(amount) > 0 ? Number(amount) : penalty.instalment,
    penalty.outstanding
  );
  if (!(take > 0)) throw new Error('nothing to take');

  /*
   * The LEDGER, and nothing else.
   *
   * This used to add the money to payroll_rows.deduction and append the
   * reason to the remark. It no longer does, because the recovery is now
   * summed off this table into its own penalty_deduction column - writing
   * both would take it twice. It also means a recovery can be undone by
   * removing its row, instead of un-picking one number somebody may since
   * have typed into by hand.
   *
   * Taking it early, by hand, is still allowed: it posts the row this month
   * that the monthly run would otherwise post, which is why the run then
   * skips the month (a row already exists for it).
   */
  db.prepare(
    `INSERT INTO penalty_recoveries (penalty_id, period_id, amount, by_whom, in_deduction)
     VALUES (?, ?, ?, ?, 0)`
  ).run(id, period.id, take, by || null);

  const after = getPenalty(id);
  if (after.outstanding <= 0) {
    db.prepare(`UPDATE penalties SET status = 'recovered' WHERE id = ?`).run(id);
  }
  audit({
    who: by,
    action: 'changed',
    entity: 'penalties',
    entity_id: id,
    label: `${penalty.kind_label} — ${penalty.employee_name}`,
    to_value: take,
    note: `recovered from ${period.label}: ${penalty.note}`,
  });
  return getPenalty(id);
}

/* ================================================================= *
 * SOFTWARE LICENCES
 *
 * Dinesh's mock-up had a License tab with nothing behind it; asked what
 * belonged in it he said *"license me software license ki detail rahegi"*.
 * Tally, Windows, Office, the antivirus, eTimeTrackLite, the domain, the SSL
 * certificate - what we are licensed to run, on how many machines, and when it
 * has to be paid again.
 *
 * THREE TABLES, THE SAME SPLIT AS THE ASSET REGISTER.
 *
 *   licenses          the licence itself: what it is now
 *   license_seats     who or which machine is using it - the allocation log
 *   license_renewals  what was paid, when, for which period - the ledger
 *
 * Seats in use are COUNTED off the seats table, never stored on the licence,
 * so the two cannot drift. And `license_key` is never selected: every read
 * takes whether there IS a key and its last four characters. The whole key
 * comes back from one route, which writes to the audit trail.
 * ================================================================= */
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    kind          TEXT,
    publisher     TEXT,
    version       TEXT,
    -- perpetual | subscription | amc | trial | free. See shared/licenses.js;
    -- it decides whether a blank date means "never expires" or "nobody knows".
    term          TEXT NOT NULL DEFAULT 'subscription',
    -- The secret. Never selected by any list or detail read - see licenseRead
    -- below - and never in an export.
    license_key   TEXT,
    -- The login a subscription sits under, which is the other thing nobody can
    -- find when a renewal is due and the person who bought it has left.
    account_email TEXT,
    -- NULL means nobody is counting: a site licence, or a count genuinely
    -- unknown. That is a third answer, not zero.
    seats         INTEGER,
    purchased_on  TEXT,
    expires_on    TEXT,
    cost          REAL NOT NULL DEFAULT 0,
    renew_every_months INTEGER,
    amc_until     TEXT,
    amc_cost      REAL,
    vendor        TEXT,
    invoice_no    TEXT,
    note          TEXT,
    -- Cancelled keeps its row: an old invoice still refers to it, and "we used
    -- to pay for this" is a question that gets asked.
    cancelled_on  TEXT,
    cancelled_why TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expires_on);
  CREATE INDEX IF NOT EXISTS idx_licenses_company ON licenses(company_id);

  /*
   * One row per seat handed out. Released rather than deleted, so "who had
   * Office in March" still has an answer - the same reason asset_handovers
   * exists beside the asset register.
   */
  CREATE TABLE IF NOT EXISTS license_seats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id    INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    -- Kept as text as well, so the log still reads correctly once somebody has
    -- left and their row is gone.
    employee_name TEXT,
    asset_id      INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    -- The machine by name, for a PC that is not on the asset register.
    device        TEXT,
    assigned_on   TEXT,
    assigned_by   TEXT,
    released_on   TEXT,
    released_by   TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_license_seats ON license_seats(license_id, released_on);
  CREATE INDEX IF NOT EXISTS idx_license_seats_employee ON license_seats(employee_id, released_on);

  CREATE TABLE IF NOT EXISTS license_renewals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id  INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    renewed_on  TEXT NOT NULL,
    period_from TEXT,
    period_to   TEXT,
    cost        REAL NOT NULL DEFAULT 0,
    vendor      TEXT,
    invoice_no  TEXT,
    note        TEXT,
    by_whom     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_license_renewals ON license_renewals(license_id, renewed_on);
`);

/*
 * The columns every read takes.
 *
 * `license_key` is NOT among them, on purpose. What comes back is whether
 * there is one and its last four characters, which is enough for somebody
 * holding an invoice to tell it is the same key and not enough to install
 * anything. One route returns the key itself and writes to the trail.
 */
const LICENSE_SELECT = `
  l.id, l.company_id, l.name, l.kind, l.publisher, l.version, l.term,
  l.account_email, l.seats, l.purchased_on, l.expires_on, l.cost,
  l.renew_every_months, l.amc_until, l.amc_cost, l.vendor, l.invoice_no,
  l.note, l.cancelled_on, l.cancelled_why, l.created_at,
  CASE WHEN l.license_key IS NOT NULL AND TRIM(l.license_key) <> '' THEN 1 ELSE 0 END AS has_key,
  CASE WHEN l.license_key IS NOT NULL AND TRIM(l.license_key) <> '' THEN substr(l.license_key, -4) ELSE NULL END AS key_tail,
  c.name AS company_name
`;

/** The seats of one licence, newest first, with the person and asset named. */
export function listLicenseSeats({ license_id, employee_id, open_only = false } = {}) {
  const where = [];
  const params = [];
  if (license_id) {
    where.push('s.license_id = ?');
    params.push(Number(license_id));
  }
  if (employee_id) {
    where.push('s.employee_id = ?');
    params.push(Number(employee_id));
  }
  if (open_only) where.push('s.released_on IS NULL');
  return db
    .prepare(
      `SELECT s.*, l.name AS license_name, l.term AS license_term,
              CASE WHEN l.license_key IS NOT NULL AND TRIM(l.license_key) <> '' THEN 1 ELSE 0 END AS has_key,
              e.name AS employee_now, a.code AS asset_code, a.label AS asset_label
       FROM license_seats s
       JOIN licenses l ON l.id = s.license_id
       LEFT JOIN employees e ON e.id = s.employee_id
       LEFT JOIN assets a ON a.id = s.asset_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.released_on IS NOT NULL, date(s.assigned_on) DESC, s.id DESC`
    )
    .all(...params)
    .map((row) => ({
      ...row,
      has_key: Boolean(row.has_key),
      // The live name wins where there is one, so a corrected spelling shows;
      // the stored one is what is left after somebody's row has gone.
      employee_name: row.employee_now || row.employee_name || '',
    }));
}

export const listLicenseRenewals = (licenseId) =>
  db
    .prepare(`SELECT * FROM license_renewals WHERE license_id = ? ORDER BY date(renewed_on) DESC, id DESC`)
    .all(licenseId);

/**
 * The register, with every figure worked out.
 *
 * Seats are fetched once for the whole register and grouped here rather than
 * per licence: eleven licences would otherwise be twelve queries, and the
 * figures have to agree with the seat list anyway.
 */
export function listLicenses({ company_id, include_cancelled = true, soon = 30, today } = {}) {
  const where = [];
  const params = [];
  if (company_id) {
    where.push('l.company_id = ?');
    params.push(Number(company_id));
  }
  if (!include_cancelled) where.push('l.cancelled_on IS NULL');

  const rows = db
    .prepare(
      `SELECT ${LICENSE_SELECT}
       FROM licenses l
       LEFT JOIN companies c ON c.id = l.company_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY l.cancelled_on IS NOT NULL, l.name COLLATE NOCASE`
    )
    .all(...params);

  const seats = db.prepare(`SELECT * FROM license_seats`).all();
  const byLicense = new Map();
  for (const seat of seats) {
    if (!byLicense.has(seat.license_id)) byLicense.set(seat.license_id, []);
    byLicense.get(seat.license_id).push(seat);
  }

  const when = today || dayNow();
  return rows.map((row) =>
    dressLicense({ ...row, has_key: Boolean(row.has_key) }, byLicense.get(row.id) || [], when, { soon })
  );
}

export function getLicense(id, { soon = 30, today } = {}) {
  const row = db
    .prepare(
      `SELECT ${LICENSE_SELECT}
       FROM licenses l
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE l.id = ?`
    )
    .get(id);
  if (!row) return null;
  const seats = listLicenseSeats({ license_id: id });
  return {
    ...dressLicense({ ...row, has_key: Boolean(row.has_key) }, seats, today || dayNow(), { soon }),
    seats_list: seats,
    renewals: listLicenseRenewals(id),
  };
}

/**
 * The whole key, once, for somebody who has asked for it.
 *
 * ON THE AUDIT TRAIL, deliberately. A key that has been read out cannot be
 * called back, so "who has this key" has to have an answer - and the reason
 * is asked for, because "I needed it" is not one.
 */
export function revealLicenseKey(id, { by, why } = {}) {
  const row = db.prepare(`SELECT id, name, license_key FROM licenses WHERE id = ?`).get(id);
  if (!row) throw new Error('that licence is not on the register');
  const key = String(row.license_key || '').trim();
  if (!key) return { key: '', had: false };
  audit({
    who: by,
    action: 'key read',
    entity: 'licenses',
    entity_id: row.id,
    label: row.name,
    note: why ? `key shown: ${why}` : 'key shown',
  });
  return { key, had: true };
}

const LICENSE_FIELDS = [
  'company_id', 'name', 'kind', 'publisher', 'version', 'term', 'account_email',
  'seats', 'purchased_on', 'expires_on', 'cost', 'renew_every_months',
  'amc_until', 'amc_cost', 'vendor', 'invoice_no', 'note',
];

/** Blank means "not known" for every one of these, never zero and never today. */
const licenseValue = (key, value) => {
  /*
   * Except the term, which is NOT NULL and has to mean something: a licence
   * saved with nothing chosen is a subscription, the reading that still
   * reminds. Before the blank check, or a form that leaves it alone writes a
   * null and the insert fails - which is exactly what a test caught.
   */
  if (key === 'term') return cleanTerm(value);
  if (value === '' || value === null || value === undefined) {
    return key === 'cost' ? 0 : null;
  }
  if (key === 'company_id' || key === 'seats' || key === 'renew_every_months') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  if (key === 'cost' || key === 'amc_cost') return Number(value) || 0;
  if (key === 'term') return cleanTerm(value);
  return String(value).trim() || null;
};

export function createLicense(input = {}) {
  const problem = licenseProblem(input);
  if (problem) throw new Error(problem);

  const values = {};
  for (const field of LICENSE_FIELDS) values[field] = licenseValue(field, input[field]);
  values.license_key = String(input.key ?? input.license_key ?? '').trim() || null;

  const info = db
    .prepare(
      `INSERT INTO licenses (${LICENSE_FIELDS.join(', ')}, license_key)
       VALUES (${LICENSE_FIELDS.map((f) => `@${f}`).join(', ')}, @license_key)`
    )
    .run(values);

  audit({
    who: input.by,
    action: 'created',
    entity: 'licenses',
    entity_id: info.lastInsertRowid,
    label: values.name,
    note: [termLabel(values.term), values.expires_on ? `expires ${values.expires_on}` : null]
      .filter(Boolean)
      .join(' - ') || null,
  });
  return getLicense(info.lastInsertRowid);
}

export function updateLicense(id, patch = {}) {
  const before = getLicense(id);
  if (!before) throw new Error('that licence is not on the register');

  // Validated against the licence as it would BE, so a patch that sets the
  // expiry alone is still checked against the purchase date already stored.
  const problem = licenseProblem({ ...before, ...patch });
  if (problem) throw new Error(problem);

  const fields = [];
  const values = [];
  for (const field of LICENSE_FIELDS) {
    if (!(field in patch)) continue;
    fields.push(`${field} = ?`);
    values.push(licenseValue(field, patch[field]));
  }
  // The key is patched only when it is actually sent, so a form that does not
  // carry it (which is every form, since no read returns it) cannot blank it.
  if ('key' in patch || 'license_key' in patch) {
    fields.push('license_key = ?');
    values.push(String(patch.key ?? patch.license_key ?? '').trim() || null);
  }
  if (!fields.length) return before;

  db.prepare(`UPDATE licenses SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);

  for (const field of ['name', 'seats', 'expires_on', 'cost', 'term']) {
    if (!(field in patch)) continue;
    const to = licenseValue(field, patch[field]);
    if (String(before[field] ?? '') === String(to ?? '')) continue;   // not a change.
    audit({
      who: patch.by,
      action: 'changed',
      entity: 'licenses',
      entity_id: id,
      label: before.name,
      field,
      from_value: before[field] ?? null,
      to_value: to,
    });
  }
  if ('key' in patch || 'license_key' in patch) {
    audit({
      who: patch.by,
      action: 'changed',
      entity: 'licenses',
      entity_id: id,
      label: before.name,
      field: 'key',
      note: 'the licence key was replaced',
    });
  }
  return getLicense(id);
}

/**
 * Stop paying for it - and keep the row.
 *
 * Cancelling releases nothing: the software is still installed on those
 * machines the morning after somebody stops paying, and a seat list that
 * emptied itself would say the opposite. Uninstalling is a job somebody does,
 * and releasing each seat is how they record it.
 */
export function cancelLicense(id, { on, why, by } = {}) {
  const before = getLicense(id);
  if (!before) throw new Error('that licence is not on the register');
  if (before.cancelled_on) throw new Error('that licence is already cancelled');
  db.prepare(`UPDATE licenses SET cancelled_on = ?, cancelled_why = ? WHERE id = ?`).run(
    String(on || dayNow()).slice(0, 10),
    String(why || '').trim() || null,
    id
  );
  audit({
    who: by,
    action: 'cancelled',
    entity: 'licenses',
    entity_id: id,
    label: before.name,
    note: why || null,
  });
  return getLicense(id);
}

/** Back in use. The counterpart, because a cancellation gets typed by mistake. */
export function uncancelLicense(id, by) {
  const before = getLicense(id);
  if (!before) throw new Error('that licence is not on the register');
  db.prepare(`UPDATE licenses SET cancelled_on = NULL, cancelled_why = NULL WHERE id = ?`).run(id);
  audit({ who: by, action: 'changed', entity: 'licenses', entity_id: id, label: before.name, field: 'cancelled', to_value: 'in use' });
  return getLicense(id);
}

/**
 * Delete - and only something nothing has happened to.
 *
 * A licence that has been renewed or handed to somebody refuses, the same way
 * an asset that has ever been issued refuses: deleting it would take its
 * renewals and its seat history with it, and those answer "what did we pay"
 * and "who was using it". Cancelling is the way to retire one.
 */
export function deleteLicense(id, by) {
  const before = getLicense(id);
  if (!before) return false;
  if (before.renewals.length) {
    throw new Error(
      `${before.name} has ${before.renewals.length} renewal${before.renewals.length === 1 ? '' : 's'} recorded, which is what it cost. Cancel it instead — the row stays and it stops being counted.`
    );
  }
  if (before.seats_list.length) {
    throw new Error(
      `${before.name} has been handed to ${before.seats_list.length} seat${before.seats_list.length === 1 ? '' : 's'}. Cancel it instead — the row stays and the history with it.`
    );
  }
  const gone = db.prepare(`DELETE FROM licenses WHERE id = ?`).run(id).changes > 0;
  if (gone) {
    audit({ who: by, action: 'deleted', entity: 'licenses', entity_id: id, label: before.name });
  }
  return gone;
}

/**
 * Put somebody - or a machine - on a seat.
 *
 * OVER-ALLOCATION IS RECORDED AND REPORTED, NEVER REFUSED. The eleventh
 * install on a ten-seat licence exists whether or not this register admits it,
 * and refusing it only moves the fact into somebody's head. What comes back
 * says so, so the screen can say it too.
 */
export function assignSeat(licenseId, input = {}) {
  const license = getLicense(licenseId);
  if (!license) throw new Error('that licence is not on the register');
  const problem = seatProblem(input);
  if (problem) throw new Error(problem);
  if (license.cancelled_on) {
    throw new Error(`${license.name} was cancelled on ${license.cancelled_on}. Put it back in use first, then hand out the seat.`);
  }

  const employee = Number(input.employee_id) > 0 ? getEmployee(Number(input.employee_id)) : null;
  if (Number(input.employee_id) > 0 && !employee) throw new Error('that employee is not on the master');

  // Already on it? Giving the same person the same licence twice is a typo,
  // and two open seats for one person makes the count wrong for ever.
  const twin = license.seats_list.find(
    (s) =>
      !s.released_on &&
      ((employee && Number(s.employee_id) === Number(employee.id)) ||
        (Number(input.asset_id) > 0 && Number(s.asset_id) === Number(input.asset_id)))
  );
  if (twin) {
    throw new Error(
      `${twin.employee_name || twin.asset_label || 'that seat'} already has ${license.name}. Release the seat first if it has moved.`
    );
  }

  const info = db
    .prepare(
      `INSERT INTO license_seats (license_id, employee_id, employee_name, asset_id, device,
                                  assigned_on, assigned_by, note)
       VALUES (@license_id, @employee_id, @employee_name, @asset_id, @device,
               @assigned_on, @assigned_by, @note)`
    )
    .run({
      license_id: license.id,
      employee_id: employee?.id || null,
      employee_name: employee?.name || null,
      asset_id: Number(input.asset_id) > 0 ? Number(input.asset_id) : null,
      device: String(input.device || '').trim() || null,
      assigned_on: String(input.assigned_on || dayNow()).slice(0, 10),
      assigned_by: input.by || null,
      note: String(input.note || '').trim() || null,
    });

  const after = getLicense(licenseId);
  audit({
    who: input.by,
    action: 'changed',
    entity: 'licenses',
    entity_id: license.id,
    label: license.name,
    field: 'seat',
    to_value: employee?.name || input.device || `asset ${input.asset_id}`,
    note: after.seat_use.over ? `over its ${after.seat_use.seats} seats by ${after.seat_use.over_by}` : null,
  });
  return { license: after, seat: listLicenseSeats({ license_id: licenseId }).find((s) => s.id === info.lastInsertRowid) };
}

export function releaseSeat(seatId, { on, by, note } = {}) {
  const seat = db.prepare(`SELECT * FROM license_seats WHERE id = ?`).get(seatId);
  if (!seat) throw new Error('that seat is not on the register');
  if (seat.released_on) throw new Error('that seat was already released');
  const license = getLicense(seat.license_id);
  db.prepare(
    `UPDATE license_seats SET released_on = ?, released_by = ?, note = COALESCE(?, note) WHERE id = ?`
  ).run(String(on || dayNow()).slice(0, 10), by || null, String(note || '').trim() || null, seatId);
  audit({
    who: by,
    action: 'changed',
    entity: 'licenses',
    entity_id: seat.license_id,
    label: license?.name || '',
    field: 'seat released',
    from_value: seat.employee_name || seat.device || null,
  });
  return getLicense(seat.license_id);
}

/**
 * Record a renewal: what was paid, for which period.
 *
 * The licence row then carries the new expiry; this table carries every period
 * ever paid for. The same split as the asset register and its handovers - one
 * answers "when is it next due", the other answers "what has it cost us".
 *
 * A period that ENDS BEFORE the licence already expires is refused, because
 * that is a typed date nine times out of ten and it would move a live licence
 * backwards into being expired. The message says what to do instead.
 */
export function renewLicense(id, input = {}) {
  const before = getLicense(id);
  if (!before) throw new Error('that licence is not on the register');
  const to = String(input.period_to || '').slice(0, 10);
  if (!to) throw new Error('what date does it now run until?');
  if (before.expires_on && to < String(before.expires_on).slice(0, 10)) {
    throw new Error(
      `${before.name} already runs to ${before.expires_on}, so a renewal ending ${to} would move it backwards. Check the date — or edit the licence directly if you are correcting it.`
    );
  }
  const cost = Number(input.cost) || 0;
  if (cost < 0) throw new Error('a cost is not a negative number');

  db.prepare(
    `INSERT INTO license_renewals (license_id, renewed_on, period_from, period_to, cost, vendor, invoice_no, note, by_whom)
     VALUES (@license_id, @renewed_on, @period_from, @period_to, @cost, @vendor, @invoice_no, @note, @by_whom)`
  ).run({
    license_id: before.id,
    renewed_on: String(input.renewed_on || dayNow()).slice(0, 10),
    period_from: String(input.period_from || '').slice(0, 10) || null,
    period_to: to,
    cost,
    vendor: String(input.vendor || before.vendor || '').trim() || null,
    invoice_no: String(input.invoice_no || '').trim() || null,
    note: String(input.note || '').trim() || null,
    by_whom: input.by || null,
  });

  /*
   * The licence now runs to the new date, and carries what this period cost -
   * so next year's "what are we paying" is this year's figure and not the one
   * from whenever it was first bought.
   *
   * A trial that has been paid for is no longer a trial: left as one, it would
   * keep reading "not a licence to carry on using it" on a licence somebody
   * has now bought.
   */
  db.prepare(
    `UPDATE licenses SET expires_on = ?, cost = ?, term = CASE WHEN term = 'trial' THEN 'subscription' ELSE term END
     WHERE id = ?`
  ).run(to, cost || before.cost || 0, id);

  audit({
    who: input.by,
    action: 'changed',
    entity: 'licenses',
    entity_id: id,
    label: before.name,
    field: 'renewed to',
    from_value: before.expires_on || null,
    to_value: to,
    note: cost ? `paid ${Math.round(cost)}` : null,
  });
  return getLicense(id);
}

/** Everything the License tab needs in one call. */
export function licenseRegister({ company_id, soon = 30, today } = {}) {
  const licenses = listLicenses({ company_id, soon, today });
  return {
    licenses,
    totals: licenseTotals(licenses),
    alerts: licenseAlerts(licenses, today || dayNow(), { soon }),
    kinds: LICENSE_KINDS,
    terms: LICENSE_TERMS,
    soon,
  };
}
