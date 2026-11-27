/**
 * One person's leave balance, for anybody who has to decide about their leave.
 *
 * Dinesh: *"employee ka leave balance uske reporting manager ko bhi dikhna
 * chahiye / employee ko bhi dikhna chahiye / hr ko approval ke time pe bhi
 * dikhna chahiye"*. The balance existed - on the Leave tab. It was not on any
 * of the three screens where a leave is actually asked for or decided, so a
 * manager approved five days for somebody who had two.
 *
 * ONE SUM. This is the same `ledgersFor` the Leave tab's balances and ledger
 * use, so the figure beside an Approve button and the figure on the register
 * cannot differ.
 */
import { ATTENDANCE_CODES } from '../../shared/calc.js';
import { ledgersFor } from '../../shared/leaveLedger.js';
import { getEmployee, leaveTaken, listLeaveCredits } from './db.js';
import { managerOf } from './attendanceSelf.js';
import { MANAGER_FIRST_KINDS, daysOf } from '../../shared/attendanceRequests.js';

export const LEAVE_CODES = ['CL', 'SL', 'PL', 'UL'];

export const TYPES = LEAVE_CODES.map((code) => ({
  code,
  label: ATTENDANCE_CODES[code]?.label || code,
  /* Unpaid leave has no balance to run down: it is docked as it is taken, so
     it is a count of what was taken, not an entitlement anybody has. */
  paid: !ATTENDANCE_CODES[code]?.absent,
}));

export const quotasOf = (employee) => ({
  CL: employee?.cl_quota || 0,
  SL: employee?.sl_quota || 0,
  PL: employee?.pl_quota || 0,
  UL: 0,
});

export const byCode = (rows) => {
  const out = {};
  for (const r of rows) (out[r.code] ||= []).push(r);
  return out;
};

/**
 * `{ year, types: [{ code, label, paid, left, taken }] }`. `left` is null for
 * unpaid leave - there is nothing to be left of it - never 0.
 */
export function leaveBalanceFor(employee, year = new Date().getFullYear()) {
  if (!employee) return null;
  const ledgers = ledgersFor({
    types: TYPES,
    credits: listLeaveCredits({ employee_id: employee.id, year }),
    takenByCode: byCode(leaveTaken({ year, employee_id: employee.id, codes: LEAVE_CODES })),
    quotas: quotasOf(employee),
    year,
  });
  return {
    year,
    types: ledgers.map((l) => {
      const type = TYPES.find((t) => t.code === l.code);
      return {
        code: l.code,
        label: type?.label || l.code,
        paid: Boolean(type?.paid),
        left: type?.paid ? l.summary.closing : null,
        taken: l.summary.availed,
      };
    }),
  };
}

/**
 * The same requests, each carrying what somebody deciding it needs to see:
 * the balance of the leave being asked for, how many days this takes, and
 * whose move it is.
 */
export function withLeaveContext(requests = []) {
  const balances = new Map();
  const managers = new Map();
  return requests.map((r) => {
    const out = { ...r };
    if (!managers.has(r.employee_id)) managers.set(r.employee_id, managerOf(r.employee_id));
    const manager = managers.get(r.employee_id);
    out.manager_name = manager.name || '';
    /* True while the office has to WAIT: a leave, still pending, for somebody
       whose manager can act. Anything else the office may decide itself. */
    out.needs_manager = r.status === 'pending' && MANAGER_FIRST_KINDS.has(r.kind) && manager.can_act;
    out.manager_cannot_act = Boolean(manager.name) && !manager.can_act;

    if (r.kind === 'leave' && r.code) {
      const key = `${r.employee_id}:${r.year || ''}`;
      if (!balances.has(key)) {
        balances.set(key, leaveBalanceFor(getEmployee(r.employee_id), Number(r.year) || undefined));
      }
      const balance = balances.get(key);
      const type = balance?.types.find((t) => t.code === r.code);
      const taking = daysOf(r).length;
      out.leave_balance = type
        ? {
            code: type.code,
            label: type.label,
            paid: type.paid,
            left: type.left,
            taking,
            // Once approved the days are already in "taken", so nothing is
            // subtracted a second time.
            after: type.left === null ? null : r.status === 'approved' ? type.left : type.left - taking,
          }
        : null;
    }
    return out;
  });
}
