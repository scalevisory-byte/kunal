import { db, audit, getPeriod, listHolidays } from './db.js';
import { log } from './logger.js';
import { buildPayroll } from './payroll.js';
import { attendanceProgress, payrollExceptions } from '../../shared/payrollExceptions.js';

/*
 * THE MONTH, REVIEWED — and nothing about it changed.
 *
 * Dinesh's brief says it twice: *"Do not automatically correct or change any
 * salary amount"*. So this module reads the month exactly as the sheet
 * calculates it, runs the checks in shared/payrollExceptions.js over the
 * result, and keeps what somebody decided about each flag. There is no write
 * here that touches a payroll row — the only table it writes is its own.
 *
 * A FLAG IS A QUESTION, NOT A FAULT. A net of nought is right for somebody
 * who joined on the 30th. So a flag can be marked **ignored** with a reason
 * and it stays ignored, rather than having to be made to go away by changing
 * a figure that was correct all along.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS payroll_exception_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id   INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT 'open',
    remark      TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    UNIQUE (period_id, employee_id, code)
  );
`);

const STATES = ['open', 'resolved', 'ignored'];

/**
 * Every flag on a month, with what somebody decided about each.
 *
 * The flags are worked out fresh every time rather than stored: a figure
 * corrected this morning must stop being flagged this afternoon, and a list
 * of stale warnings is a list nobody reads. Only the DECISION is kept.
 */
export function reviewPeriod(periodId, { company_id, today } = {}) {
  const period = getPeriod(periodId);
  if (!period) return null;
  /* `sync: false`: looking at the exceptions must not post a loan instalment
     or backdate a new hire into the month - the same trap the trend hit. */
  const payroll = buildPayroll(periodId, { company_id, sync: false });
  if (!payroll) return null;

  /*
   * The month's holidays ride in, because a festival is not a day somebody
   * failed to mark. Without them the attendance check counted Diwali as a
   * gap and asked eighty-five people to explain a day the office was shut.
   */
  const holidays = listHolidays(periodId);
  const entries = payroll.rows.map((row) => ({ row, calc: row, employee: row }));
  const flags = payrollExceptions(entries, { period, today, holidays });
  /* In DAYS against days due, from the same function the warnings use - so
     the headline and the flags cannot say different things. */
  const attendance = attendanceProgress(entries, { period, today, holidays });

  const notes = db
    .prepare(`SELECT * FROM payroll_exception_notes WHERE period_id = ?`)
    .all(periodId);
  const byKey = new Map(notes.map((n) => [`${n.employee_id}::${n.code}`, n]));

  return {
    period,
    attendance,
    exceptions: flags.map((flag) => {
      const note = byKey.get(`${flag.employee_id}::${flag.code}`);
      return {
        ...flag,
        state: note?.state || 'open',
        remark: note?.remark || '',
        reviewed_by: note?.reviewed_by || '',
        reviewed_at: note?.reviewed_at || '',
      };
    }),
  };
}

/**
 * What somebody decided about one flag.
 *
 * Open / resolved / ignored, a remark, and who said so. Changing a decision
 * is on the audit trail with what it was before - "who said the zero net was
 * fine" has to have an answer.
 */
export function noteException({ period_id, employee_id, code, state, remark, by } = {}) {
  const want = String(state || 'open').toLowerCase();
  if (!STATES.includes(want)) {
    const err = new Error(`a state must be one of: ${STATES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const before = db
    .prepare(`SELECT * FROM payroll_exception_notes WHERE period_id = ? AND employee_id = ? AND code = ?`)
    .get(Number(period_id), Number(employee_id), String(code));

  db.prepare(
    `INSERT INTO payroll_exception_notes (period_id, employee_id, code, state, remark, reviewed_by, reviewed_at)
          VALUES (@period_id, @employee_id, @code, @state, @remark, @by, datetime('now'))
     ON CONFLICT(period_id, employee_id, code) DO UPDATE SET
          state = @state, remark = @remark, reviewed_by = @by, reviewed_at = datetime('now')`
  ).run({
    period_id: Number(period_id),
    employee_id: Number(employee_id),
    code: String(code),
    state: want,
    remark: remark || null,
    by: by || null,
  });

  audit({
    who: by,
    action: 'changed',
    entity: 'payroll_exception',
    entity_id: Number(employee_id),
    label: String(code),
    field: 'state',
    from_value: before?.state || 'open',
    to_value: want,
    note: remark || null,
  });

  return db
    .prepare(`SELECT * FROM payroll_exception_notes WHERE period_id = ? AND employee_id = ? AND code = ?`)
    .get(Number(period_id), Number(employee_id), String(code));
}

/**
 * One person's month, with everything the statement needs.
 *
 * It ASSEMBLES: the figures are what `calculateRow` returned for the row,
 * read with `sync: false`, and nothing here works out a salary of its own.
 */
export function employeeStatement(periodId, employeeId) {
  const payroll = buildPayroll(periodId, { sync: false });
  if (!payroll) return null;
  const row = payroll.rows.find((r) => r.employee_id === Number(employeeId));
  if (!row) return null;

  /*
   * Their months, for the payment history. Only what a payment is: the
   * month, what was payable, how and when it went. Read straight off the
   * rows, so the history and the sheet are the same record.
   */
  const payments = db
    .prepare(
      `SELECT p.period_id, pe.label, pe.year, pe.month, p.status, p.payment_mode,
              p.payment_date, p.payment_ref, p.remark
         FROM payroll_rows p
         JOIN periods pe ON pe.id = p.period_id
        WHERE p.employee_id = ?
        ORDER BY pe.year DESC, pe.month DESC`
    )
    .all(Number(employeeId));

  return { period: payroll.period, row, payments };
}

log.info('Payroll review ready: exceptions are reported, never corrected.');
