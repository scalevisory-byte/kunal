import { db, audit } from './db.js';
import { HK_KEYS, USUAL_AREAS, isDirection } from '../../shared/frontOffice.js';

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

export const listAreas = ({ all = false } = {}) =>
  db
    .prepare(`SELECT * FROM fo_areas ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, id`)
    .all()
    .map((a) => ({ ...a, active: !!a.active }));

export function createArea({ name, sort_order } = {}) {
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
  const info = db.prepare(`INSERT INTO fo_areas (name, sort_order) VALUES (?, ?)`).run(tidy, next);
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
    audit({
      who: clean(by) || 'office',
      what: 'front office: verdict changed',
      detail: `${area.name} on ${day}: ${before.status} → ${tidy}`,
    });
  }
  return db.prepare(`SELECT * FROM fo_inspections WHERE day = ? AND area_id = ?`).get(day, area.id);
}

/* ---------------- visitors ---------------- */

export const listVisitors = (day) =>
  db.prepare(`SELECT * FROM fo_visitors WHERE day = ? ORDER BY COALESCE(in_time, ''), id`).all(needDay(day));

export function addVisitor({ day, name, company, purpose, meeting, mobile, pass_no, remark, in_time, by } = {}) {
  needDay(day);
  if (!clean(name)) refuse('a visitor needs a name');
  const info = db
    .prepare(
      `INSERT INTO fo_visitors (day, in_time, name, company, purpose, meeting, mobile, pass_no, remark, logged_by)
       VALUES (@day, @in_time, @name, @company, @purpose, @meeting, @mobile, @pass_no, @remark, @by)`
    )
    .run({
      day,
      in_time: clean(in_time),
      name: clean(name),
      company: clean(company),
      purpose: clean(purpose),
      meeting: clean(meeting),
      mobile: clean(mobile),
      pass_no: clean(pass_no),
      remark: clean(remark),
      by: clean(by),
    });
  return db.prepare(`SELECT * FROM fo_visitors WHERE id = ?`).get(info.lastInsertRowid);
}

export function updateVisitor(id, patch = {}) {
  const row = db.prepare(`SELECT * FROM fo_visitors WHERE id = ?`).get(id);
  if (!row) return null;
  const fields = [];
  const values = [];
  for (const key of ['in_time', 'out_time', 'name', 'company', 'purpose', 'meeting', 'mobile', 'pass_no', 'remark']) {
    if (!(key in patch)) continue;
    fields.push(`${key} = ?`);
    values.push(clean(patch[key]));
  }
  if (fields.length) db.prepare(`UPDATE fo_visitors SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return db.prepare(`SELECT * FROM fo_visitors WHERE id = ?`).get(id);
}

export const deleteVisitor = (id) => db.prepare(`DELETE FROM fo_visitors WHERE id = ?`).run(id).changes > 0;

/* ---------------- courier ---------------- */

export const listCourier = (day) =>
  db.prepare(`SELECT * FROM fo_courier WHERE day = ? ORDER BY COALESCE(at_time, ''), id`).all(needDay(day));

export function addCourier({ day, direction, company, ref_no, party, handler, remark, at_time, by } = {}) {
  needDay(day);
  const way = clean(direction) || 'Inward';
  if (!isDirection(way)) refuse('a courier entry is Inward or Outward');
  /*
   * His own rule, kept: at least a courier company or a from/to name. An
   * entry with neither says nothing anybody can act on.
   */
  if (!clean(company) && !clean(party)) refuse('enter at least a courier company or a from/to name');
  const info = db
    .prepare(
      `INSERT INTO fo_courier (day, at_time, direction, company, ref_no, party, handler, remark, logged_by)
       VALUES (@day, @at_time, @direction, @company, @ref_no, @party, @handler, @remark, @by)`
    )
    .run({
      day,
      at_time: clean(at_time),
      direction: way,
      company: clean(company),
      ref_no: clean(ref_no),
      party: clean(party),
      handler: clean(handler),
      remark: clean(remark),
      by: clean(by),
    });
  return db.prepare(`SELECT * FROM fo_courier WHERE id = ?`).get(info.lastInsertRowid);
}

export const deleteCourier = (id) => db.prepare(`DELETE FROM fo_courier WHERE id = ?`).run(id).changes > 0;

/* ---------------- reading a day, and a month ---------------- */

export const frontOfficeDay = (day) => ({
  day: needDay(day),
  areas: listAreas(),
  inspections: listInspections(day),
  visitors: listVisitors(day),
  courier: listCourier(day),
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
 * Everything recorded on one day, gone.
 *
 * His tool had this and it is worth keeping - a day entered against the wrong
 * date is otherwise three screens of deleting. It names what it is taking
 * before it goes, and it goes on the audit trail, because this is the only
 * call in the module that destroys more than one row.
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
    db.prepare(`DELETE FROM fo_visitors WHERE day = ?`).run(day);
    db.prepare(`DELETE FROM fo_courier WHERE day = ?`).run(day);
  });
  wipe();
  audit({
    who: clean(by) || 'office',
    what: 'front office: day cleared',
    detail: `${day}: ${counts.inspections} check(s), ${counts.visitors} visitor(s), ${counts.courier} courier entr(y/ies)`,
  });
  return counts;
}
