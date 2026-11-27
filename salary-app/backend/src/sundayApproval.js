/**
 * Sunday pay is approved by a manager before anybody is paid it.
 *
 * Dinesh: "sunday ka payment with approval of only manager". Sunday pay is
 * settled apart from the salary - its own register, its own Paid tick - and
 * until now anybody who could edit the sheet could tick it. Now the tick
 * needs an approval behind it, and only a login that carries the `approve`
 * ability can give one: the Manager and Admin roles. HR and Accounts can
 * prepare the register and pay it; they cannot approve it.
 *
 * AN APPROVAL IS OF AN AMOUNT. It records who, when and how much. If the
 * figure moves afterwards - a Sunday is added, the Amount is typed over - the
 * row is no longer what was approved, and it cannot be marked paid until
 * somebody approves the new figure. The amount is the payslip function's own
 * (`buildPayroll`, read with `sync: false` so approving cannot open rows or
 * post loan instalments into the month).
 *
 * NOTHING ALREADY PAID IS TOUCHED. A row ticked Paid before this release
 * stays paid; the guard is on the move TO paid, from now.
 */
import { db, getPeriod } from './db.js';
import { buildPayroll } from './payroll.js';

const rowsOf = (periodId) => {
  const payroll = buildPayroll(Number(periodId), { sync: false });
  if (!payroll) throw new Error('period not found');
  return payroll.rows;
};

const amountOf = (row) => Math.round(Number(row?.sunday_salary) || 0);

/** Is this row approved for the figure it carries NOW? */
export function approvalOf(row) {
  const amount = amountOf(row);
  if (!row?.sunday_approved_at) return { approved: false, stale: false, amount };
  const was = Math.round(Number(row.sunday_approved_amount) || 0);
  return {
    approved: was === amount,
    stale: was !== amount,
    amount,
    approved_amount: was,
    by: row.sunday_approved_by || '',
    at: row.sunday_approved_at,
  };
}

export function approveSundayPay(periodId, rowIds = [], { by } = {}) {
  const period = getPeriod(Number(periodId));
  if (!period) throw new Error('period not found');
  if (period.locked) throw new Error('period is locked');
  const ids = new Set((rowIds || []).map(Number).filter(Boolean));
  if (!ids.size) throw new Error('nothing was picked');
  const rows = rowsOf(periodId).filter((r) => ids.has(r.id));
  if (rows.length !== ids.size) throw new Error('row not found');
  const set = db.prepare(
    `UPDATE payroll_rows
     SET sunday_approved_by = ?, sunday_approved_at = datetime('now'), sunday_approved_amount = ?
     WHERE id = ?`
  );
  let approved = 0;
  let amount = 0;
  const skipped = [];
  db.transaction(() => {
    for (const row of rows) {
      const due = amountOf(row);
      // Nothing owed is nothing to approve - and an approval of nought would
      // read, later, as somebody having agreed to a figure.
      if (due <= 0) {
        skipped.push(row.employee_name);
        continue;
      }
      set.run(by || null, due, row.id);
      approved += 1;
      amount += due;
    }
  })();
  return { approved, amount, skipped };
}

export function withdrawSundayApproval(periodId, rowIds = [], { by } = {}) {
  const period = getPeriod(Number(periodId));
  if (!period) throw new Error('period not found');
  if (period.locked) throw new Error('period is locked');
  const ids = (rowIds || []).map(Number).filter(Boolean);
  if (!ids.length) throw new Error('nothing was picked');
  const get = db.prepare(`SELECT id, sunday_status FROM payroll_rows WHERE id = ? AND period_id = ?`);
  const clear = db.prepare(
    `UPDATE payroll_rows SET sunday_approved_by = NULL, sunday_approved_at = NULL, sunday_approved_amount = NULL WHERE id = ?`
  );
  let withdrawn = 0;
  db.transaction(() => {
    for (const id of ids) {
      const row = get.get(id, Number(periodId));
      if (!row) throw new Error('row not found');
      // Paid on the strength of it: taking the approval away now would leave
      // money out of the door with nothing behind it. Mark it Pending first.
      if (row.sunday_status === 'paid') throw new Error('that one is already marked paid - set it back to Pending first');
      withdrawn += clear.run(id).changes;
    }
  })();
  return { withdrawn, by: by || null };
}

/**
 * The guard on the Paid tick. Throws with the reason, or returns quietly.
 *
 * Called by the row PATCH only when the patch moves `sunday_status` to paid
 * on a row that is not paid already.
 */
export function assertSundayPayable(periodId, rowId) {
  const row = rowsOf(periodId).find((r) => r.id === Number(rowId));
  if (!row) return; // the PATCH will answer "row not found"
  if (row.sunday_status === 'paid') return;
  const state = approvalOf(row);
  if (state.amount <= 0 || state.approved) return;
  const err = new Error(
    state.stale
      ? `${row.employee_name}'s Sunday pay was approved for ${state.approved_amount} and is now ${state.amount} - a manager has to approve the new figure before it is paid`
      : `${row.employee_name}'s Sunday pay has not been approved - a manager approves it on the Sunday register before it can be marked paid`
  );
  err.status = 409;
  throw err;
}
