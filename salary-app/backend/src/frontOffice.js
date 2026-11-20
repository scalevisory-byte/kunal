import { db, audit } from './db.js';
import { log } from './logger.js';
import {
  COURIER_STATUSES,
  HK_KEYS,
  USUAL_AREAS,
  VISITOR_TYPES,
  cleanMobile,
  inwardNumber,
  isDirection,
  isMobile,
  passNumber,
  visitMinutes,
  visitorStatus,
} from '../../shared/frontOffice.js';

/*
 * The front desk, on the server.
 *
 * Dinesh built this as a single file keeping everything in one browser's
 * localStorage, and sent it over: *"need this all feature in this"*. Moving
 * it here is most of the point - a visitor register that lives in one
 * machine's browser is gone when that machine is reimaged, and the boss
 * cannot look at it from anywhere.
 *
 * ONE FRONT DESK, not one per company. These are four companies out of one
 * office with one reception, and splitting the visitor book four ways would
 * ask the person on the desk a question they cannot answer - whose visitor is
 * the courier from the bank. If that is ever wanted it is a column, not a
 * redesign.
 *
 * Everything is keyed on a DAY (YYYY-MM-DD) rather than on a payroll period:
 * the desk is a daily book, and it is read on a day nobody has opened a
 * month for.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS fo_areas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /*
   * One verdict per area per day. The unique index is what makes recording a
   * verdict idempotent - somebody changing their mind replaces the verdict
   * rather than leaving two rows that disagree.
   */
  CREATE TABLE IF NOT EXISTS fo_inspections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    day         TEXT NOT NULL,
    area_id     INTEGER NOT NULL REFERENCES fo_areas(id) ON DELETE CASCADE,
    status      TEXT NOT NULL,
    remark      TEXT,
    checked_by  TEXT,
    at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_fo_insp ON fo_inspections(day, area_id);

  CREATE TABLE IF NOT EXISTS fo_visitors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    day         TEXT NOT NULL,
    in_time     TEXT,
    out_time    TEXT,
    name        TEXT NOT NULL,
    company     TEXT,
    purpose     TEXT,
    meeting     TEXT,
    mobile      TEXT,
    pass_no     TEXT,
    remark      TEXT,
    logged_by   TEXT,
    at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_fo_vis_day ON fo_visitors(day);

  CREATE TABLE IF NOT EXISTS fo_courier (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    day         TEXT NOT NULL,
    at_time     TEXT,
    direction   TEXT NOT NULL,
    company     TEXT,
    ref_no      TEXT,
    party       TEXT,
    handler     TEXT,
    remark      TEXT,
    logged_by   TEXT,
    at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_fo_cou_day ON fo_courier(day);
`);


/* ---------------- the professional register (v1.50) ---------------- */

/*
 * EVERYTHING BELOW IS ADDED TO THE TABLES ABOVE, NOT INSTEAD OF THEM.
 *
 * Dinesh's brief for this pass says it plainly: work on the existing
 * database, preserve the records already in it, no duplicate tables. So the
 * visitor book keeps its id, its day and its times, and gains the columns a
 * proper register needs; the courier book keeps its rows and gains the
 * delivery half it never had.
 *
 * Two things are DERIVED rather than stored, and both for the same reason -
 * a figure in two places is a figure that will one day disagree with itself:
 *
 *   **A visitor's STATUS** is whether there is an out time. "Inside" and
 *   "checked out" are the same fact said twice.
 *
 *   **A visit's DURATION** is the difference between the two timestamps,
 *   worked out when it is read.
 *
 * A courier's status IS stored, because "returned" cannot be read off
 * anything else.
 */
const addColumns = (table, columns) => {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [column, type] of columns) {
    if (have.has(column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    log.info(`Migrated ${table}: added ${column}.`);
  }
};

addColumns('fo_areas', [
  /* Null means "the whole office", which is what every area is today. */
  ['company_id', 'INTEGER REFERENCES companies(id) ON DELETE SET NULL'],
  ['branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],
]);

addColumns('fo_visitors', [
  ['visitor_type', 'TEXT'],
  /* Who they are here to meet, as an employee rather than a typed name - a
     name goes stale and cannot be reported on. `meeting` stays for the rows
     already written and for a visitor meeting somebody who is not staff. */
  ['meet_employee_id', 'INTEGER REFERENCES employees(id) ON DELETE SET NULL'],
  /* Full timestamps beside the day and the HH:MM, so a duration can be
     worked out across midnight and a correction can be seen. */
  ['in_at', 'TEXT'],
  ['out_at', 'TEXT'],
  ['out_by', 'TEXT'],
  ['company_id', 'INTEGER REFERENCES companies(id) ON DELETE SET NULL'],
  ['branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],
  /* Soft delete. An operational record is archived, never destroyed. */
  ['archived_at', 'TEXT'],
  ['archived_by', 'TEXT'],
]);

addColumns('fo_courier', [
  ['inward_no', 'TEXT'],
  ['recipient_employee_id', 'INTEGER REFERENCES employees(id) ON DELETE SET NULL'],
  ['department', 'TEXT'],
  ['description', 'TEXT'],
  ['status', 'TEXT'],
  ['company_id', 'INTEGER REFERENCES companies(id) ON DELETE SET NULL'],
  ['branch_id', 'INTEGER REFERENCES branches(id) ON DELETE SET NULL'],
  ['archived_at', 'TEXT'],
  ['archived_by', 'TEXT'],
]);

db.exec(`
  /*
   * A number can never be handed out twice, whatever happens above this line.
   * The unique index is the guarantee; the transaction below is the thing
   * that stops it being hit in the first place.
   */
  CREATE UNIQUE INDEX IF NOT EXISTS idx_fo_pass ON fo_visitors(pass_no) WHERE pass_no IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_fo_inward ON fo_courier(inward_no) WHERE inward_no IS NOT NULL;

  /*
   * THE DELIVERY HALF OF A COURIER, which the register never had: a parcel
   * received is not a parcel delivered, and "who actually took it" is the
   * only question anybody asks a week later.
   *
   * A log, like the asset handovers next door - the courier row carries the
   * status, this carries what happened. The two answer different questions,
   * so they cannot drift.
   */
  CREATE TABLE IF NOT EXISTS fo_courier_handovers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    courier_id     INTEGER NOT NULL REFERENCES fo_courier(id) ON DELETE CASCADE,
    to_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    to_name        TEXT,
    handed_on      TEXT,
    handed_at      TEXT,
    handed_by      TEXT,
    acknowledged   INTEGER NOT NULL DEFAULT 0,
    remark         TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_fo_handover ON fo_courier_handovers(courier_id);
`);

/* Rows written before this pass carry no status; an inward parcel with
   nobody to give it to is simply "received". */
db.prepare(
  `UPDATE fo_courier SET status = CASE WHEN direction = 'Outward' THEN 'Sent' ELSE 'Received' END
    WHERE status IS NULL`
).run();

/** Today and the time now, by the clock on this machine (see db.js on UTC). */
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nowHHMM = () => new Date().toTimeString().slice(0, 5);

const clean = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const needDay = (day) => {
  if (!isDay(day)) {
    const err = new Error('a date is needed, as YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  return day;
};
const refuse = (message, status = 400) => {
  const err = new Error(message);
  err.status = status;
  throw err;
};

/* ---------------- the areas that get walked ---------------- */

/**
 * The areas walked, with the company and branch they belong to.
 *
 * NULL MEANS THE WHOLE OFFICE, which is what every area is today - so an
 * office that never fills this in behaves exactly as it does now, and one
 * that does gets a check list per branch without a second list to keep.
 */
export const listAreas = ({ all = false, company_id, branch_id } = {}) => {
  const where = [all ? '1 = 1' : 'a.active = 1'];
  const params = {};
  if (company_id) {
    where.push('(a.company_id IS NULL OR a.company_id = @company_id)');
    params.company_id = Number(company_id);
  }
  if (branch_id) {
    where.push('(a.branch_id IS NULL OR a.branch_id = @branch_id)');
    params.branch_id = Number(branch_id);
  }
  return db
    .prepare(
      `SELECT a.*, c.name AS company_name, b.name AS branch_name
         FROM fo_areas a
         LEFT JOIN companies c ON c.id = a.company_id
         LEFT JOIN branches b ON b.id = a.branch_id
        WHERE ${where.join(' AND ')} ORDER BY a.sort_order, a.id`
    )
    .all(params)
    .map((a) => ({ ...a, active: !!a.active }));
};

export function createArea({ name, sort_order, ...rest } = {}) {
  const tidy = clean(name);
  if (!tidy) refuse('an area needs a name');
  const existing = db.prepare(`SELECT * FROM fo_areas WHERE lower(name) = lower(?)`).get(tidy);
  /*
   * Adding one that is already there brings it BACK rather than making a
   * second of it - an area turned off in March and re-added in June is the
   * same area, and its flagged days should not be split across two names.
   */
  if (existing) {
    db.prepare(`UPDATE fo_areas SET active = 1 WHERE id = ?`).run(existing.id);
    return { ...existing, active: true };
  }
  const next = sort_order ?? (db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM fo_areas`).get().n);
  const info = db
    .prepare(`INSERT INTO fo_areas (name, sort_order, company_id, branch_id) VALUES (?, ?, ?, ?)`)
    .run(tidy, next, Number(rest.company_id) || null, Number(rest.branch_id) || null);
  return listAreas({ all: true }).find((a) => a.id === Number(info.lastInsertRowid));
}

export function updateArea(id, patch = {}) {
  const row = db.prepare(`SELECT * FROM fo_areas WHERE id = ?`).get(id);
  if (!row) return null;
  const fields = [];
  const values = [];
  if ('name' in patch) { fields.push('name = ?'); values.push(clean(patch.name) || row.name); }
  if ('sort_order' in patch) { fields.push('sort_order = ?'); values.push(Number(patch.sort_order) || 0); }
  if ('active' in patch) { fields.push('active = ?'); values.push(patch.active ? 1 : 0); }
  for (const key of ['company_id', 'branch_id']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(Number(patch[key]) || null);
  }
  if (fields.length) db.prepare(`UPDATE fo_areas SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  const after = db.prepare(`SELECT * FROM fo_areas WHERE id = ?`).get(id);
  return { ...after, active: !!after.active };
}

/**
 * Taking an area off the list TURNS IT OFF; it does not delete it.
 *
 * Deleting would take every verdict ever recorded against it with it, and
 * "the pantry was flagged eleven days in October" is the only reason any of
 * this is written down.
 */
export const retireArea = (id) => updateArea(id, { active: false });

/** The twelve he had, for an office starting with an empty list. */
export function addUsualAreas() {
  const added = [];
  for (const name of USUAL_AREAS) added.push(createArea({ name }));
  return added;
}

/* ---------------- the day's walk ---------------- */

export const listInspections = (day) =>
  db.prepare(`SELECT * FROM fo_inspections WHERE day = ? ORDER BY area_id`).all(needDay(day));

/**
 * Record (or change) one verdict.
 *
 * An empty status takes the verdict away again - "I ticked the wrong row" has
 * to be undoable, and a day with no verdict is "not checked", which is a real
 * state in this module and not a hole.
 */
export function setInspection({ day, area_id, status, remark, by } = {}) {
  needDay(day);
  const area = db.prepare(`SELECT * FROM fo_areas WHERE id = ?`).get(area_id);
  if (!area) refuse('no such area', 404);

  const tidy = clean(status);
  if (!tidy) {
    db.prepare(`DELETE FROM fo_inspections WHERE day = ? AND area_id = ?`).run(day, area.id);
    return null;
  }
  if (!HK_KEYS.includes(tidy)) refuse(`a verdict must be one of: ${HK_KEYS.join(', ')}`);

  const before = db.prepare(`SELECT * FROM fo_inspections WHERE day = ? AND area_id = ?`).get(day, area.id);
  db
    .prepare(
      `INSERT INTO fo_inspections (day, area_id, status, remark, checked_by)
            VALUES (@day, @area_id, @status, @remark, @by)
       ON CONFLICT(day, area_id) DO UPDATE SET
            status = @status, remark = @remark, checked_by = @by, at = datetime('now')`
    )
    .run({ day, area_id: area.id, status: tidy, remark: clean(remark), by: clean(by) });

  /*
   * A verdict CHANGED is on the trail; the first verdict of the day is not.
   * The same line this app has always drawn - filling in a blank is not a
   * change, and recording every tick would bury the one that matters.
   */
  if (before && before.status !== tidy) {
    /*
     * `audit()` takes action/entity/field/from_value/to_value. This passed
     * `what` and `detail`, which are not columns - so every front office
     * line landed on the trail as "changed / unknown" with nothing in it.
     */
    audit({
      who: clean(by) || 'office',
      action: 'changed',
      entity: 'fo_inspections',
      entity_id: area.id,
      label: `${area.name} on ${day}`,
      field: 'status',
      from_value: before.status,
      to_value: tidy,
    });
  }
  return db.prepare(`SELECT * FROM fo_inspections WHERE day = ? AND area_id = ?`).get(day, area.id);
}

/* ---------------- visitors ---------------- */

/*
 * The register as it is read: the person they came to see by name, the
 * status and the duration worked out rather than stored.
 */
const VISITOR_SELECT = `
  SELECT v.*, e.name AS meet_name, e.code AS meet_code, e.department AS meet_department,
         co.name AS company_name, b.name AS branch_name
    FROM fo_visitors v
    LEFT JOIN employees e ON e.id = v.meet_employee_id
    LEFT JOIN companies co ON co.id = v.company_id
    LEFT JOIN branches b ON b.id = v.branch_id
`;

const dressVisitor = (row) =>
  row && {
    ...row,
    status: visitorStatus(row),
    minutes: visitMinutes(row),
    /* The typed name is the fallback for a visitor meeting somebody who is
       not on the staff list, and for every row written before this pass. */
    meeting: row.meet_name || row.meeting || '',
  };

export const listVisitors = (day) =>
  db
    .prepare(`${VISITOR_SELECT} WHERE v.day = ? AND v.archived_at IS NULL ORDER BY COALESCE(v.in_time, ''), v.id`)
    .all(needDay(day))
    .map(dressVisitor);

export const getVisitor = (id) =>
  dressVisitor(db.prepare(`${VISITOR_SELECT} WHERE v.id = ?`).get(Number(id)));

/**
 * The next number in the year's series: VIS-2026-0001.
 *
 * Read off the HIGHEST NUMBER ALREADY USED, never off a count - the same
 * rule the asset codes follow. A number is never handed out twice, because
 * an archived visitor still holds theirs and a pass already printed still
 * says what it says.
 *
 * The whole insert runs inside one transaction, and there is a unique index
 * underneath it, so two people registering a visitor at the same moment
 * cannot be given one number between them.
 */
function nextNumber(table, column, prefix, year) {
  const like = `${prefix}${year}-%`;
  const highest = db
    .prepare(
      `SELECT MAX(CAST(substr(${column}, length(${column}) - 3) AS INTEGER)) AS n
         FROM ${table} WHERE ${column} LIKE ?`
    )
    .get(like).n;
  return (Number(highest) || 0) + 1;
}

const yearOf = (day) => String(day).slice(0, 4);

export const addVisitor = db.transaction((input = {}) => {
  const day = needDay(input.day);
  const name = clean(input.name);
  if (!name) refuse('a visitor needs a name');

  const purpose = clean(input.purpose);
  if (!purpose) refuse('what are they here for? the purpose is needed');

  /*
   * TEN DIGITS, and the register says so rather than storing whatever was
   * typed. A visitor book whose numbers cannot be rung is a visitor book
   * nobody can use after the fact.
   */
  const mobile = cleanMobile(input.mobile);
  if (!isMobile(mobile)) refuse('a 10-digit mobile number is needed');

  const type = clean(input.visitor_type);
  if (type && !VISITOR_TYPES.includes(type)) refuse(`a visitor type must be one of: ${VISITOR_TYPES.join(', ')}`);

  const meet = input.meet_employee_id ? Number(input.meet_employee_id) : null;
  const employee = meet ? db.prepare(`SELECT * FROM employees WHERE id = ?`).get(meet) : null;
  if (meet && !employee) refuse('no such employee to meet', 404);

  /*
   * THE SAME PERSON SIGNED IN TWICE AND NEVER SIGNED OUT is the accident
   * this stops - a second press of the button, or the desk writing somebody
   * up again after lunch. Refused by name and number while the first visit
   * is still open; once they have been signed out they can come back in.
   */
  const open = db
    .prepare(
      `SELECT * FROM fo_visitors
        WHERE day = ? AND mobile = ? AND lower(name) = lower(?)
          AND out_time IS NULL AND archived_at IS NULL`
    )
    .get(day, mobile, name);
  if (open) {
    const err = new Error(`${name} is already signed in today and has not been signed out (${open.pass_no || 'no pass'}).`);
    err.status = 409;
    err.visitor = dressVisitor(open);
    throw err;
  }

  const inTime = clean(input.in_time) || nowHHMM();
  const seq = nextNumber('fo_visitors', 'pass_no', 'VIS-', yearOf(day));
  const info = db
    .prepare(
      `INSERT INTO fo_visitors (day, in_time, in_at, name, company, purpose, meeting, meet_employee_id,
                                mobile, pass_no, visitor_type, remark, company_id, branch_id, logged_by)
       VALUES (@day, @in_time, @in_at, @name, @company, @purpose, @meeting, @meet_employee_id,
               @mobile, @pass_no, @visitor_type, @remark, @company_id, @branch_id, @by)`
    )
    .run({
      day,
      in_time: inTime,
      in_at: `${day}T${inTime}:00`,
      name,
      company: clean(input.company),
      purpose,
      meeting: clean(input.meeting) || employee?.name || null,
      meet_employee_id: meet,
      mobile,
      pass_no: passNumber(yearOf(day), seq),
      visitor_type: type,
      remark: clean(input.remark),
      /* Stamped from the person they came to see where there is one, so the
         register can be read company by company without anybody typing it. */
      company_id: Number(input.company_id) || employee?.company_id || null,
      branch_id: Number(input.branch_id) || employee?.branch_id || null,
      by: clean(input.by),
    });

  const visitor = getVisitor(info.lastInsertRowid);
  audit({
    who: input.by,
    action: 'created',
    entity: 'fo_visitors',
    entity_id: visitor.id,
    label: `${visitor.pass_no} ${visitor.name}`,
    to_value: `in ${visitor.in_time}`,
    note: visitor.purpose,
  });
  return visitor;
});

/** The fields the office may correct afterwards, and nothing else. */
const VISITOR_FIELDS = [
  'in_time', 'out_time', 'name', 'company', 'purpose', 'meeting',
  'mobile', 'pass_no', 'remark', 'visitor_type',
];

export function updateVisitor(id, patch = {}, { by } = {}) {
  const before = getVisitor(id);
  if (!before) return null;

  const fields = [];
  const values = [];
  const changes = [];
  for (const key of VISITOR_FIELDS) {
    if (!(key in patch)) continue;
    /* The pass number is handed out by the series and never retyped: an
       edited pass is a pass that no longer matches the one in somebody's
       hand. */
    if (key === 'pass_no') continue;
    let value = clean(patch[key]);
    if (key === 'mobile' && value) {
      value = cleanMobile(value);
      if (!isMobile(value)) refuse('a 10-digit mobile number is needed');
    }
    if (key === 'visitor_type' && value && !VISITOR_TYPES.includes(value)) {
      refuse(`a visitor type must be one of: ${VISITOR_TYPES.join(', ')}`);
    }
    if (String(before[key] ?? '') === String(value ?? '')) continue;
    fields.push(`${key} = ?`);
    values.push(value);
    changes.push([key, before[key], value]);
  }
  if ('meet_employee_id' in patch) {
    const meet = patch.meet_employee_id ? Number(patch.meet_employee_id) : null;
    if (meet !== (before.meet_employee_id ?? null)) {
      fields.push('meet_employee_id = ?');
      values.push(meet);
      changes.push(['meet_employee_id', before.meet_name, meet]);
    }
  }
  if (!fields.length) return before;

  /* An out time typed by hand has to move the timestamp with it, or the
     duration would be worked out from the old one. */
  if ('out_time' in patch) {
    fields.push('out_at = ?');
    values.push(clean(patch.out_time) ? `${before.day}T${clean(patch.out_time)}:00` : null);
  }
  db.prepare(`UPDATE fo_visitors SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);

  for (const [field, from, to] of changes) {
    audit({
      who: by,
      action: 'changed',
      entity: 'fo_visitors',
      entity_id: Number(id),
      label: `${before.pass_no || before.name}`,
      field,
      from_value: from,
      to_value: to,
    });
  }
  return getVisitor(id);
}

/**
 * Sign somebody out.
 *
 * The check-in is never touched - a correction changes the departure, and
 * the arrival is what it was. Who pressed the button is recorded, because
 * "it says I left at six and I did not" has to have an answer.
 */
export function checkOut(id, { time, by } = {}) {
  const before = getVisitor(id);
  if (!before) return null;
  if (before.archived_at) refuse('that visitor has been archived');

  const out = clean(time) || nowHHMM();
  db.prepare(`UPDATE fo_visitors SET out_time = ?, out_at = ?, out_by = ? WHERE id = ?`).run(
    out,
    `${before.day}T${out}:00`,
    clean(by),
    id
  );
  audit({
    who: by,
    action: before.out_time ? 'changed' : 'checked out',
    entity: 'fo_visitors',
    entity_id: Number(id),
    label: `${before.pass_no || before.name}`,
    field: 'out_time',
    from_value: before.out_time,
    to_value: out,
  });
  return getVisitor(id);
}

/**
 * Take a check-out back, for the one it was pressed on by mistake.
 *
 * The row goes back to Inside and the trail keeps both halves - the time
 * that was recorded and the fact that somebody undid it. Nothing is erased.
 */
export function undoCheckOut(id, { by } = {}) {
  const before = getVisitor(id);
  if (!before) return null;
  if (!before.out_time) return before;
  db.prepare(`UPDATE fo_visitors SET out_time = NULL, out_at = NULL, out_by = NULL WHERE id = ?`).run(id);
  audit({
    who: by,
    action: 'changed',
    entity: 'fo_visitors',
    entity_id: Number(id),
    label: `${before.pass_no || before.name}`,
    field: 'out_time',
    from_value: before.out_time,
    to_value: null,
    note: 'check-out taken back',
  });
  return getVisitor(id);
}

/**
 * ARCHIVED, NOT DELETED.
 *
 * A visitor book is a record of who was in the building. A row typed against
 * the wrong date has to be removable, but removing it must not mean the
 * building has no record of that afternoon - so it leaves the register and
 * stays in the table, with who archived it and when.
 */
export function archiveVisitor(id, { by } = {}) {
  const before = getVisitor(id);
  if (!before) return false;
  db.prepare(`UPDATE fo_visitors SET archived_at = datetime('now'), archived_by = ? WHERE id = ?`).run(
    clean(by),
    id
  );
  audit({
    who: by,
    action: 'archived',
    entity: 'fo_visitors',
    entity_id: Number(id),
    label: `${before.pass_no || before.name}`,
    note: `${before.day} ${before.in_time || ''}`,
  });
  return true;
}

/**
 * The register, searched and narrowed - the screen's own list and the
 * report's are the same query, so they cannot show different totals.
 *
 * Paged, because a year of a busy reception is tens of thousands of rows and
 * a register that fetches all of them is a register that stops opening.
 */
export function searchVisitors({
  from, to, day, q, employee_id, visitor_type, status, company_id, branch_id,
  archived = false, limit = 100, offset = 0,
} = {}) {
  const where = ['1 = 1'];
  const params = {};
  if (day) { where.push('v.day = @day'); params.day = day; }
  if (from) { where.push('v.day >= @from'); params.from = from; }
  if (to) { where.push('v.day <= @to'); params.to = to; }
  if (employee_id) { where.push('v.meet_employee_id = @employee_id'); params.employee_id = Number(employee_id); }
  if (visitor_type) { where.push('v.visitor_type = @visitor_type'); params.visitor_type = visitor_type; }
  if (company_id) { where.push('v.company_id = @company_id'); params.company_id = Number(company_id); }
  if (branch_id) { where.push('v.branch_id = @branch_id'); params.branch_id = Number(branch_id); }
  if (status === 'inside') where.push('v.out_time IS NULL');
  if (status === 'out') where.push('v.out_time IS NOT NULL');
  where.push(archived ? 'v.archived_at IS NOT NULL' : 'v.archived_at IS NULL');
  /* One box for the name, the mobile and the pass number: the person at the
     desk has one of the three and should not have to say which. */
  if (clean(q)) {
    where.push('(v.name LIKE @q OR v.mobile LIKE @q OR v.pass_no LIKE @q OR v.company LIKE @q)');
    params.q = `%${clean(q)}%`;
  }
  const clause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM fo_visitors v WHERE ${clause}`).get(params).n;
  const rows = db
    .prepare(
      `${VISITOR_SELECT} WHERE ${clause}
        ORDER BY v.day DESC, COALESCE(v.in_time, '') DESC, v.id DESC
        LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: Math.min(Number(limit) || 100, 500), offset: Number(offset) || 0 })
    .map(dressVisitor);
  return { rows, total };
}

/* ---------------- courier ---------------- */

const COURIER_SELECT = `
  SELECT c.*, e.name AS recipient_name, e.code AS recipient_code,
         e.department AS recipient_department,
         co.name AS company_name, b.name AS branch_name,
         (SELECT COUNT(*) FROM fo_courier_handovers h WHERE h.courier_id = c.id) AS handovers,
         (SELECT h.handed_on FROM fo_courier_handovers h WHERE h.courier_id = c.id
           ORDER BY h.id DESC LIMIT 1) AS handed_on,
         (SELECT h.to_name FROM fo_courier_handovers h WHERE h.courier_id = c.id
           ORDER BY h.id DESC LIMIT 1) AS handed_to
    FROM fo_courier c
    LEFT JOIN employees e ON e.id = c.recipient_employee_id
    LEFT JOIN companies co ON co.id = c.company_id
    LEFT JOIN branches b ON b.id = c.branch_id
`;

export const listCourier = (day) =>
  db
    .prepare(`${COURIER_SELECT} WHERE c.day = ? AND c.archived_at IS NULL ORDER BY COALESCE(c.at_time, ''), c.id`)
    .all(needDay(day));

export const getCourier = (id) => db.prepare(`${COURIER_SELECT} WHERE c.id = ?`).get(Number(id));

export const addCourier = db.transaction((input = {}) => {
  const day = needDay(input.day);
  const way = clean(input.direction) || 'Inward';
  if (!isDirection(way)) refuse('a courier entry is Inward or Outward');
  /*
   * His own rule, kept: at least a courier company or a from/to name. An
   * entry with neither says nothing anybody can act on.
   */
  if (!clean(input.company) && !clean(input.party)) refuse('enter at least a courier company or a from/to name');

  const recipient = input.recipient_employee_id ? Number(input.recipient_employee_id) : null;
  const employee = recipient ? db.prepare(`SELECT * FROM employees WHERE id = ?`).get(recipient) : null;
  if (recipient && !employee) refuse('no such employee', 404);

  /*
   * A parcel for somebody is PENDING until they take it. That is the whole
   * point of the register - "it came on Tuesday" is not the question anybody
   * asks, "where is it now" is.
   */
  const status = way === 'Outward' ? 'Sent' : recipient ? 'Pending handover' : 'Received';
  const seq = way === 'Inward' ? nextNumber('fo_courier', 'inward_no', 'CR-IN-', yearOf(day)) : 0;

  const info = db
    .prepare(
      `INSERT INTO fo_courier (day, at_time, direction, company, ref_no, party, handler, remark,
                               inward_no, recipient_employee_id, department, description, status,
                               company_id, branch_id, logged_by)
       VALUES (@day, @at_time, @direction, @company, @ref_no, @party, @handler, @remark,
               @inward_no, @recipient_employee_id, @department, @description, @status,
               @company_id, @branch_id, @by)`
    )
    .run({
      day,
      at_time: clean(input.at_time) || nowHHMM(),
      direction: way,
      company: clean(input.company),
      ref_no: clean(input.ref_no),
      party: clean(input.party),
      /* `handler` is who in this office took it in or sent it out - the
         column has always meant that, so it keeps its name and the screen
         calls it "Received by". */
      handler: clean(input.handler) || clean(input.received_by),
      remark: clean(input.remark),
      inward_no: way === 'Inward' ? inwardNumber(yearOf(day), seq) : null,
      recipient_employee_id: recipient,
      department: clean(input.department) || employee?.department || null,
      description: clean(input.description),
      status,
      company_id: Number(input.company_id) || employee?.company_id || null,
      branch_id: Number(input.branch_id) || employee?.branch_id || null,
      by: clean(input.by),
    });

  const row = getCourier(info.lastInsertRowid);
  audit({
    who: input.by,
    action: 'created',
    entity: 'fo_courier',
    entity_id: row.id,
    label: `${row.inward_no || row.direction} ${row.company || row.party || ''}`.trim(),
    to_value: row.status,
    note: row.description,
  });
  return row;
});

/**
 * Handing the parcel over, which is the half the register never had.
 *
 * Writing a handover is what makes it delivered - the status is not a box
 * somebody ticks. The log keeps every handover ever written; the row carries
 * only where it has got to.
 */
export function handOver(courierId, input = {}) {
  const row = getCourier(courierId);
  if (!row) return null;
  if (row.archived_at) refuse('that entry has been archived');
  if (row.direction !== 'Inward') refuse('only something received can be handed over');

  const to = input.to_employee_id ? Number(input.to_employee_id) : null;
  const employee = to ? db.prepare(`SELECT * FROM employees WHERE id = ?`).get(to) : null;
  if (to && !employee) refuse('no such employee', 404);
  const toName = clean(input.to_name) || employee?.name;
  if (!toName) refuse('who took it?');

  const done = db.transaction(() => {
    db.prepare(
      `INSERT INTO fo_courier_handovers (courier_id, to_employee_id, to_name, handed_on, handed_at,
                                         handed_by, acknowledged, remark)
       VALUES (@courier_id, @to_employee_id, @to_name, @handed_on, @handed_at, @handed_by, @ack, @remark)`
    ).run({
      courier_id: row.id,
      to_employee_id: to,
      to_name: toName,
      handed_on: clean(input.handed_on) || todayLocal(),
      handed_at: clean(input.handed_at) || nowHHMM(),
      handed_by: clean(input.by),
      ack: input.acknowledged ? 1 : 0,
      remark: clean(input.remark),
    });
    db.prepare(`UPDATE fo_courier SET status = 'Delivered' WHERE id = ?`).run(row.id);
  });
  done();

  audit({
    who: input.by,
    action: 'handed over',
    entity: 'fo_courier',
    entity_id: row.id,
    label: row.inward_no || `${row.company || ''} ${row.party || ''}`.trim(),
    from_value: row.status,
    to_value: `Delivered to ${toName}`,
  });
  return getCourier(row.id);
}

/** Every handover ever written against one parcel, newest last. */
export const listHandovers = (courierId) =>
  db
    .prepare(
      `SELECT h.*, e.name AS employee_name FROM fo_courier_handovers h
         LEFT JOIN employees e ON e.id = h.to_employee_id
        WHERE h.courier_id = ? ORDER BY h.id`
    )
    .all(Number(courierId));

/** Returned to the courier, or any other hand-written state change. */
export function setCourierStatus(courierId, status, { by, remark } = {}) {
  const row = getCourier(courierId);
  if (!row) return null;
  const want = clean(status);
  if (!COURIER_STATUSES.includes(want)) refuse(`a status must be one of: ${COURIER_STATUSES.join(', ')}`);
  if (want === row.status) return row;
  db.prepare(`UPDATE fo_courier SET status = ? WHERE id = ?`).run(want, courierId);
  audit({
    who: by,
    action: 'changed',
    entity: 'fo_courier',
    entity_id: Number(courierId),
    label: row.inward_no || row.company || '',
    field: 'status',
    from_value: row.status,
    to_value: want,
    note: clean(remark),
  });
  return getCourier(courierId);
}

export function archiveCourier(id, { by } = {}) {
  const row = getCourier(id);
  if (!row) return false;
  db.prepare(`UPDATE fo_courier SET archived_at = datetime('now'), archived_by = ? WHERE id = ?`).run(
    clean(by),
    id
  );
  audit({
    who: by,
    action: 'archived',
    entity: 'fo_courier',
    entity_id: Number(id),
    label: row.inward_no || row.company || '',
    note: `${row.day} ${row.at_time || ''}`,
  });
  return true;
}

/** The courier register, narrowed. Same query for the screen and the report. */
export function searchCourier({
  from, to, day, q, employee_id, status, direction, company_id, branch_id,
  archived = false, limit = 100, offset = 0,
} = {}) {
  const where = ['1 = 1'];
  const params = {};
  if (day) { where.push('c.day = @day'); params.day = day; }
  if (from) { where.push('c.day >= @from'); params.from = from; }
  if (to) { where.push('c.day <= @to'); params.to = to; }
  if (employee_id) { where.push('c.recipient_employee_id = @employee_id'); params.employee_id = Number(employee_id); }
  if (status) { where.push('c.status = @status'); params.status = status; }
  if (direction) { where.push('c.direction = @direction'); params.direction = direction; }
  if (company_id) { where.push('c.company_id = @company_id'); params.company_id = Number(company_id); }
  if (branch_id) { where.push('c.branch_id = @branch_id'); params.branch_id = Number(branch_id); }
  where.push(archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL');
  if (clean(q)) {
    where.push('(c.company LIKE @q OR c.ref_no LIKE @q OR c.party LIKE @q OR c.inward_no LIKE @q OR c.description LIKE @q)');
    params.q = `%${clean(q)}%`;
  }
  const clause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM fo_courier c WHERE ${clause}`).get(params).n;
  const rows = db
    .prepare(
      `${COURIER_SELECT} WHERE ${clause}
        ORDER BY c.day DESC, COALESCE(c.at_time, '') DESC, c.id DESC
        LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: Math.min(Number(limit) || 100, 500), offset: Number(offset) || 0 });
  return { rows, total };
}

/** Everything still in the drawer, for the alert and the report. */
export const pendingCourier = () =>
  db
    .prepare(`${COURIER_SELECT} WHERE c.status = 'Pending handover' AND c.archived_at IS NULL ORDER BY c.day, c.id`)
    .all();

/* ---------------- reading a day, and a month ---------------- */

export const frontOfficeDay = (day, { company_id, branch_id } = {}) => ({
  day: needDay(day),
  areas: listAreas({ company_id, branch_id }),
  inspections: listInspections(day),
  visitors: listVisitors(day),
  courier: listCourier(day),
  /* What is still in the drawer, whatever day is being looked at - a parcel
     from Tuesday is still undelivered on Friday. */
  pending_courier: pendingCourier().length,
});

/** Everything in a month, for the summary and the registers. */
export function frontOfficeMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) refuse('a month is needed, as YYYY-MM');
  const like = `${month}-%`;
  return {
    month,
    areas: listAreas({ all: true }),
    inspections: db.prepare(`SELECT * FROM fo_inspections WHERE day LIKE ? ORDER BY day, area_id`).all(like),
    visitors: db.prepare(`SELECT * FROM fo_visitors WHERE day LIKE ? ORDER BY day, id`).all(like),
    courier: db.prepare(`SELECT * FROM fo_courier WHERE day LIKE ? ORDER BY day, id`).all(like),
  };
}

/**
 * CLEARING A DAY DOES NOT DESTROY IT.
 *
 * His tool had a "delete this day" button and it is worth keeping - a day
 * entered against the wrong date is otherwise three screens of deleting.
 * But a visitor book is a record of who was in the building, so the two
 * books are ARCHIVED: they leave the register, they stay in the table, and
 * the trail says who cleared them and when.
 *
 * The housekeeping ticks are deleted, because a verdict is a tick and not a
 * record of a person - unticking one is already how the screen takes a
 * verdict back.
 */
export function clearDay(day, { by } = {}) {
  needDay(day);
  const counts = {
    inspections: listInspections(day).length,
    visitors: listVisitors(day).length,
    courier: listCourier(day).length,
  };
  const wipe = db.transaction(() => {
    db.prepare(`DELETE FROM fo_inspections WHERE day = ?`).run(day);
    db.prepare(
      `UPDATE fo_visitors SET archived_at = datetime('now'), archived_by = ?
        WHERE day = ? AND archived_at IS NULL`
    ).run(clean(by), day);
    db.prepare(
      `UPDATE fo_courier SET archived_at = datetime('now'), archived_by = ?
        WHERE day = ? AND archived_at IS NULL`
    ).run(clean(by), day);
  });
  wipe();
  audit({
    who: clean(by) || 'office',
    action: 'archived',
    entity: 'fo_day',
    label: day,
    to_value: `${counts.inspections} check(s), ${counts.visitors} visitor(s), ${counts.courier} courier entr(y/ies)`,
    note: 'cleared from the front office',
  });
  return counts;
}
