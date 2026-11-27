/**
 * What an employee typed about themselves, waiting for HR.
 *
 * Dinesh: "employee khud employee master banane ke liye jo details chahiye wo
 * bhar sake - wo rights employee ko do" and, on the next line, "profile
 * approve karne ka right HR ke paas". Both, in that order: the employee fills
 * it in, and it becomes the record when HR says so.
 *
 * Until v2.31 the portal wrote straight through. That was right for a phone
 * number and wrong for the thing he is describing - a UAN mistyped on a phone
 * was on the record the instant the box was left, and the first anybody heard
 * of it was a return that would not file.
 *
 * THE RULE, AND IT IS THE ONE THE LEAVE QUEUE FOLLOWS: what the employee
 * sends never writes the record; an approval does. A change waits here with
 * what the record says now and what they want it to say. HR approves it - one
 * person's changes in one press - or turns it down with a reason they read.
 *
 * ONE WAITING CHANGE PER FIELD. Typing the box again replaces what is waiting
 * rather than queueing a second opinion about the same line, and typing the
 * record's own value back withdraws it.
 *
 * NOTHING HERE CAN MOVE MONEY. The fields are `selfRecord.FILLABLE` - the
 * same whitelist as before, refused by name outside it - and not one of them
 * is an input to `calculateRow`. Approval goes through `updateEmployee`, so it
 * lands in `employee_history` with who typed it and who let it through.
 */
import { db, getEmployee, updateEmployee } from './db.js';
import { FILLABLE, ONCE_ONLY, applySelf } from '../../shared/selfRecord.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS profile_changes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    field        TEXT NOT NULL,
    from_value   TEXT,
    to_value     TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    decided_by   TEXT,
    decided_at   TEXT,
    decide_note  TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS profile_changes_one_waiting
    ON profile_changes(employee_id, field) WHERE status = 'pending';
  CREATE INDEX IF NOT EXISTS profile_changes_status ON profile_changes(status, employee_id);
`);

const LABELS = new Map(FILLABLE.map((f) => [f.field, f.label]));
export const labelOf = (field) => LABELS.get(field) || field;

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
/* Stored as JSON so a tick box comes back as a tick box, not the word "true". */
const pack = (v) => JSON.stringify(v === undefined ? null : v);
const unpack = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
/* 1 and true and "1" are one answer: a tick box must not read as a change. */
const same = (a, b) => {
  const flat = (v) => (v === true ? '1' : v === false ? '0' : text(v));
  return flat(a) === flat(b);
};

const waitingFor = db.prepare(
  `SELECT * FROM profile_changes WHERE employee_id = ? AND status = 'pending' ORDER BY id`
);

/** Their waiting changes, as { field: value }. */
export function pendingValues(employeeId) {
  const out = {};
  for (const row of waitingFor.all(Number(employeeId))) out[row.field] = unpack(row.to_value);
  return out;
}

/** The record as they will see it: what is on it, plus what they have sent. */
export const withPending = (employee) => ({ ...employee, ...pendingValues(employee.id) });

/** What was turned down lately, so the form can say why. Newest per field. */
export function recentlyRefused(employeeId) {
  const rows = db
    .prepare(
      `SELECT field, to_value, decide_note, decided_at FROM profile_changes
       WHERE employee_id = ? AND status = 'rejected' AND decided_at >= datetime('now', '-30 days')
       ORDER BY id DESC`
    )
    .all(Number(employeeId));
  const seen = new Set();
  const waiting = pendingValues(employeeId);
  const out = [];
  for (const row of rows) {
    // Sent again since: the old refusal is not the news any more.
    if (seen.has(row.field) || row.field in waiting) continue;
    seen.add(row.field);
    out.push({ field: row.field, label: labelOf(row.field), value: unpack(row.to_value), note: row.decide_note, decided_at: row.decided_at });
  }
  return out;
}

/**
 * The employee's own save. Returns `{ waiting, withdrawn, refused }`.
 *
 * `applySelf` is asked against the RECORD, not against what is waiting: a UAN
 * they sent yesterday and want to correct today is not on the record yet, so
 * it is still theirs to retype.
 */
export function proposeChanges(employeeId, body = {}) {
  const employee = getEmployee(employeeId);
  if (!employee) throw new Error('not found');
  const { patch, refused } = applySelf(employee, body);
  const waiting = [];
  const withdrawn = [];
  const drop = db.prepare(`DELETE FROM profile_changes WHERE employee_id = ? AND field = ? AND status = 'pending'`);
  const put = db.prepare(
    `INSERT INTO profile_changes (employee_id, field, from_value, to_value) VALUES (?, ?, ?, ?)`
  );
  db.transaction(() => {
    for (const [field, value] of Object.entries(patch)) {
      const had = drop.run(employee.id, field).changes > 0;
      if (same(employee[field], value)) {
        // Back to what the record already says: nothing to ask HR.
        if (had) withdrawn.push(field);
        continue;
      }
      put.run(employee.id, field, pack(employee[field] ?? null), pack(value));
      waiting.push(field);
    }
  })();
  return { waiting, withdrawn, refused, touched: Object.keys(patch).length };
}

/** The office's queue: one block per person, oldest waiting first. */
export function listProfileChanges({ company_id } = {}) {
  const rows = db
    .prepare(
      `SELECT p.*, e.name AS employee_name, e.code AS employee_code, e.company_id, c.name AS company_name
       FROM profile_changes p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN companies c ON c.id = e.company_id
       WHERE p.status = 'pending' ${company_id ? 'AND e.company_id = ?' : ''}
       ORDER BY p.created_at, p.id`
    )
    .all(...(company_id ? [Number(company_id)] : []));
  const people = new Map();
  for (const row of rows) {
    const person =
      people.get(row.employee_id) ||
      people
        .set(row.employee_id, {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          employee_code: row.employee_code,
          company_name: row.company_name,
          since: row.created_at,
          changes: [],
        })
        .get(row.employee_id);
    person.changes.push({
      id: row.id,
      field: row.field,
      label: labelOf(row.field),
      from: unpack(row.from_value),
      to: unpack(row.to_value),
      created_at: row.created_at,
    });
  }
  return [...people.values()];
}

export function profileChangesWaiting() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS changes, COUNT(DISTINCT employee_id) AS people FROM profile_changes WHERE status = 'pending'`
    )
    .get();
  const names = db
    .prepare(
      `SELECT DISTINCT e.name FROM profile_changes p JOIN employees e ON e.id = p.employee_id
       WHERE p.status = 'pending' ORDER BY p.created_at LIMIT 4`
    )
    .all()
    .map((r) => r.name);
  return { changes: row.changes, people: row.people, names };
}

/**
 * HR decides. Approving writes the record; turning down writes a reason.
 *
 * Decided once. A statutory number that has ARRIVED on the record some other
 * way since they typed theirs is not overwritten - by then two sources
 * disagree about a PAN, and that is settled with the card, not by whichever
 * was approved last.
 */
export function decideProfileChanges(ids = [], { approve, note, by } = {}) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!list.length) throw new Error('nothing was picked');
  const reason = text(note);
  if (!approve && !reason) throw new Error('say why - they will read it on their own page');

  const rows = list.map((id) => db.prepare(`SELECT * FROM profile_changes WHERE id = ?`).get(id));
  if (rows.some((r) => !r)) throw new Error('not found');
  if (rows.some((r) => r.status !== 'pending')) throw new Error('one of these has already been decided');

  const close = db.prepare(
    `UPDATE profile_changes SET status = ?, decided_by = ?, decided_at = datetime('now'), decide_note = ? WHERE id = ?`
  );
  const result = { approved: 0, rejected: 0, held: [] };

  db.transaction(() => {
    if (!approve) {
      for (const row of rows) close.run('rejected', by || null, reason, row.id);
      result.rejected = rows.length;
      return;
    }
    const byEmployee = new Map();
    for (const row of rows) byEmployee.set(row.employee_id, [...(byEmployee.get(row.employee_id) || []), row]);
    for (const [employeeId, theirs] of byEmployee) {
      const employee = getEmployee(employeeId);
      if (!employee) throw new Error('employee not found');
      const patch = {};
      const going = [];
      for (const row of theirs) {
        const value = unpack(row.to_value);
        if (ONCE_ONLY.includes(row.field) && text(employee[row.field]) && !same(employee[row.field], value)) {
          result.held.push({
            id: row.id,
            employee_name: employee.name,
            label: labelOf(row.field),
            why: `the record already says ${employee[row.field]} - correct it there, with the card, then turn this one down`,
          });
          continue;
        }
        patch[row.field] = value;
        going.push(row);
      }
      if (!going.length) continue;
      updateEmployee(employeeId, {
        ...patch,
        by: employee.name,
        history_note: `Filled in by the employee from their own login, approved by ${by || 'the office'}`,
      });
      for (const row of going) close.run('approved', by || null, reason || null, row.id);
      result.approved += going.length;
    }
  })();
  return result;
}
