/**
 * TWO LEAVE REPORTS THE CATALOGUE LISTED AND NOBODY COULD OPEN.
 *
 * `leave-by-department` stood as `planned` with the note *"Department is on
 * the master and leave is on the marks. Nothing joins the two."* That had
 * stopped being true: `listPayrollRows` carries `e.department` on every row,
 * so the join is already in the month being read. And `leave-status` stood
 * as `partial` - it opened the approvals queue, which is a place to DECIDE
 * things, not a report that says how long somebody has been waiting.
 *
 * ---------------------------------------------------------------------------
 * NEITHER COUNTS ANYTHING OF ITS OWN.
 *
 * The days come off the same attendance marks the salary sheet is paid from,
 * handed in already calculated. A report that re-counted them would be a
 * second answer to "how much leave did Sales take", and there is no way to
 * tell which of two answers a payslip used.
 * ---------------------------------------------------------------------------
 */

import { isOpen, kindLabel } from './attendanceRequests.js';
import { leaveLine } from './leaveRegister.js';
import { todayIso } from './today.js';

const NO_DEPARTMENT = 'No department set';

const n = (v) => Number(v) || 0;
const round1 = (v) => Math.round(n(v) * 10) / 10;

/** The codes a department summary counts, in the order it shows them. */
export const SUMMARY_CODES = ['CL', 'SL', 'PL', 'UL'];

/**
 * LEAVE BY DEPARTMENT, for one month.
 *
 * `rows` are calculated rows - whatever `calculateRow` returned, merged onto
 * the payroll row, exactly as every other report here takes them.
 *
 * `people` counts everybody in the department, not only those who took
 * something, because "4 days across 3 people" and "4 days across 40" are
 * different months and a report that leaves the headcount out cannot tell
 * them apart.
 */
export function leaveByDepartment(rows = []) {
  const byName = new Map();
  for (const row of rows) {
    const name = String(row.department || '').trim() || NO_DEPARTMENT;
    if (!byName.has(name)) {
      byName.set(name, {
        department: name,
        people: 0,
        took: 0,
        CL: 0, SL: 0, PL: 0, UL: 0,
        paid_days: 0,
        unpaid_days: 0,
        total_days: 0,
        paid_amount: 0,
        unpaid_amount: 0,
      });
    }
    const d = byName.get(name);
    /* THE SAME LINE THE LEAVE REGISTER PRINTS, grouped. Counting the marks
       again here would be a second answer to "how many days did Sales
       take", and the amounts are already priced off each person's own
       per-day rate, which came out of `calculateRow`. */
    const line = leaveLine(row);
    d.people += 1;
    for (const kind of line.paid) {
      if (d[kind.code] === undefined) d[kind.code] = 0;
      d[kind.code] += kind.days;
    }
    d.UL += line.unpaid_days;
    d.paid_days += line.paid_days;
    d.unpaid_days += line.unpaid_days;
    d.total_days += line.paid_days + line.unpaid_days;
    d.paid_amount += line.paid_amount;
    d.unpaid_amount += line.unpaid_amount;
    if (line.paid_days + line.unpaid_days > 0) d.took += 1;
  }

  const lines = [...byName.values()]
    .map((d) => ({
      ...d,
      CL: round1(d.CL), SL: round1(d.SL), PL: round1(d.PL), UL: round1(d.UL),
      paid_days: round1(d.paid_days),
      unpaid_days: round1(d.unpaid_days),
      total_days: round1(d.total_days),
      paid_amount: Math.round(d.paid_amount),
      unpaid_amount: Math.round(d.unpaid_amount),
      /* Days per head, so a big department taking a lot does not read as a
         problem next to a small one taking more each. */
      per_head: d.people ? Math.round((d.total_days / d.people) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.total_days - a.total_days || a.department.localeCompare(b.department));

  const totals = lines.reduce(
    (t, d) => {
      t.people += d.people;
      t.took += d.took;
      for (const code of SUMMARY_CODES) t[code] = round1(t[code] + d[code]);
      t.paid_days = round1(t.paid_days + d.paid_days);
      t.unpaid_days = round1(t.unpaid_days + d.unpaid_days);
      t.total_days = round1(t.total_days + d.total_days);
      t.paid_amount += d.paid_amount;
      t.unpaid_amount += d.unpaid_amount;
      return t;
    },
    {
      people: 0, took: 0, CL: 0, SL: 0, PL: 0, UL: 0,
      paid_days: 0, unpaid_days: 0, total_days: 0, paid_amount: 0, unpaid_amount: 0,
    }
  );
  totals.per_head = totals.people
    ? Math.round((totals.total_days / totals.people) * 100) / 100
    : 0;

  return { lines, totals };
}

export const DEPARTMENT_COLUMNS = [
  ['Department', 'department'],
  ['People', 'people'],
  ['Took leave', 'took'],
  ['CL', 'CL'],
  ['SL', 'SL'],
  ['PL', 'PL'],
  ['Unpaid (UL)', 'UL'],
  ['Paid days', 'paid_days'],
  ['Unpaid days', 'unpaid_days'],
  ['Total days', 'total_days'],
  ['Days per head', 'per_head'],
  ['Paid leave cost', 'paid_amount'],
  ['Unpaid leave saved', 'unpaid_amount'],
];

/* ------------------------------------------------------------------ */

/** How long something has been waiting, in whole days. */
export const waitingDays = (since, today) => {
  if (!since) return null;
  const a = new Date(`${String(since).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
};

/** The buckets, oldest first. An ageing report is the buckets. */
export const AGE_BUCKETS = [
  ['today', 'Raised today', (d) => d === 0],
  ['1-2', '1–2 days', (d) => d >= 1 && d <= 2],
  ['3-7', '3–7 days', (d) => d >= 3 && d <= 7],
  ['over-7', 'More than a week', (d) => d > 7],
];

export const bucketOf = (d) =>
  d == null ? null : (AGE_BUCKETS.find(([, , hit]) => hit(d)) || [])[0] || null;

/**
 * LEAVE APPLICATION STATUS, with ageing.
 *
 * `requests` are rows from `attendance_requests` as the queue reads them.
 *
 * Two things this says that the queue could not. **Who it is waiting on** -
 * a `pending` request with a manager is waiting on the MANAGER, and the same
 * request once recommended is waiting on the OFFICE; lumping them together
 * is how a week goes by with each side thinking the other has it. And **how
 * long** - with no ageing, a request raised this morning and one raised a
 * fortnight ago are one line each and look identical.
 *
 * A decided request keeps its line, because "nothing is pending" and
 * "nothing was ever applied for" are different months.
 */
export function applicationStatus(requests = [], { today, managedIds } = {}) {
  const now = String(today || todayIso()).slice(0, 10);
  const managed = managedIds instanceof Set ? managedIds : null;

  const lines = requests.map((r) => {
    const open = isOpen(r);
    const waited = waitingDays(
      /* Ageing runs from the LAST thing that happened to it, not from when
         it was raised: a request a manager backed yesterday has been with
         the office for one day, however long it sat before that. */
      (open && r.status === 'recommended' ? r.recommended_at : r.created_at) || r.created_at,
      now
    );
    /* Whose move it is. A request nobody manages can only ever be the
       office's - which is why HR can finish a `pending` one outright. */
    const withWhom = !open
      ? ''
      : r.status === 'recommended'
        ? 'Office'
        : managed && managed.has(Number(r.employee_id))
          ? 'Manager'
          : 'Office';
    return {
      id: r.id,
      employee_id: r.employee_id,
      name: r.employee_name || '',
      code: r.employee_code || '',
      company_name: r.company_name || '',
      department: r.department || '',
      kind: kindLabel(r.kind),
      mark: r.code || '',
      from_day: r.day,
      to_day: r.to_day || r.day,
      days: r.to_day ? Math.max(1, n(r.to_day) - n(r.day) + 1) : 1,
      reason: r.reason || '',
      status: r.status,
      open,
      raised_on: String(r.created_at || '').slice(0, 10),
      with_whom: withWhom,
      recommended_by: r.recommended_by || '',
      decided_by: r.decided_by || '',
      decided_on: String(r.decided_at || '').slice(0, 10),
      waiting_days: open ? waited : null,
      bucket: open ? bucketOf(waited) : null,
    };
  });

  /* Open first, oldest wait at the top: a list of things to do, in the order
     they should be done. */
  lines.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    if (a.open) return (b.waiting_days ?? 0) - (a.waiting_days ?? 0);
    return String(b.raised_on).localeCompare(String(a.raised_on));
  });

  const open = lines.filter((l) => l.open);
  const totals = {
    all: lines.length,
    open: open.length,
    with_manager: open.filter((l) => l.with_whom === 'Manager').length,
    with_office: open.filter((l) => l.with_whom === 'Office').length,
    approved: lines.filter((l) => l.status === 'approved').length,
    rejected: lines.filter((l) => l.status === 'rejected').length,
    withdrawn: lines.filter((l) => l.status === 'withdrawn').length,
    /* The figure the report exists for. */
    oldest: open.reduce((m, l) => Math.max(m, l.waiting_days ?? 0), 0),
    buckets: AGE_BUCKETS.map(([key, label]) => ({
      key,
      label,
      count: open.filter((l) => l.bucket === key).length,
    })),
  };

  return { lines, totals };
}

export const STATUS_COLUMNS = [
  ['Name', 'name'],
  ['Code', 'code'],
  ['Company', 'company_name'],
  ['Department', 'department'],
  ['What', 'kind'],
  ['Mark', 'mark'],
  ['From', 'from_day'],
  ['To', 'to_day'],
  ['Days', 'days'],
  ['Reason', 'reason'],
  ['Raised on', 'raised_on'],
  ['Status', 'status'],
  ['Waiting on', 'with_whom'],
  ['Days waiting', 'waiting_days'],
  ['Recommended by', 'recommended_by'],
  ['Decided by', 'decided_by'],
  ['Decided on', 'decided_on'],
];
