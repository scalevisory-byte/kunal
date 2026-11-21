/**
 * WHAT TO CHECK BEFORE A MONTH IS PAID.
 *
 * Dinesh's brief: *"Create an exception detection system using existing
 * payroll data"* - and, twice over, *"Do not automatically correct or change
 * any salary amount."*
 *
 * SO THIS FILE CHANGES NOTHING. It reads the month as it has already been
 * calculated and says what looks wrong. Every line names the person, the
 * figure, and what somebody should go and look at. Not one of them edits a
 * row, and none of them can: there is no write in this file at all.
 *
 * THE SECOND RULE: A FLAG IS NOT A FAULT. A net of nought is right for
 * somebody who joined on the 30th; a zero salary is right for a director who
 * takes none. That is why each one is a question with a suggested check
 * rather than an error, and why a flag can be marked **Ignored** with a
 * reason instead of having to be made to go away.
 *
 * THREE LEVELS, and only one of them stands in the way of paying:
 *
 *   critical  the month cannot be paid as it stands - no salary, a day rate
 *             of nought, a net below nought, nothing payable, more absences
 *             than the month has days. Money that is wrong or missing.
 *   warning   pay it if you like, but look first - attendance unfinished,
 *             PF with no UAN, no bank details for a bank transfer, "paid"
 *             with nothing behind it.
 *   info      nothing is wrong. A row on hold, a month waiting for approval.
 *
 * ONE CAUSE, ONE FLAG. A day rate of nought makes the net nought as well, and
 * a net below nought is of course a large deduction - listing both says there
 * are two things wrong when there is one. `EXPLAINED_BY` names, for each
 * symptom, the causes that already account for it, and a symptom is dropped
 * when its cause is on the same person's list.
 *
 * Dependency-free except for the weekly-off rule, which has to be the SAME
 * rule the grid shades squares with or this would call a Sunday a gap.
 */

import { isWeeklyOff, policyFor } from './weeklyOff.js';

const n = (v) => Number(v) || 0;
const money = (v) => `₹${Math.round(n(v)).toLocaleString('en-IN')}`;

/** The three levels, loudest first, with how each one reads on screen. */
export const SEVERITIES = [
  ['critical', 'Critical', 'Blocks the payroll until it is settled or overridden'],
  ['warning', 'Warning', 'Worth a look before paying, but it does not block'],
  ['info', 'Informational', 'Nothing is wrong - this is a status'],
];

export const severityLabel = (key) => SEVERITIES.find(([k]) => k === key)?.[1] || key;

/**
 * The checks, in the order they matter.
 *
 * Only `critical` blocks approval, and even that can be overridden by a
 * manager with a reason: the office knows things this file does not.
 */
export const EXCEPTION_KINDS = [
  ['no_salary', 'No salary set', 'critical'],
  ['zero_per_day', 'Day rate is nought', 'critical'],
  ['negative_net', 'Net payable is below nought', 'critical'],
  ['zero_net', 'Net payable is nought', 'critical'],
  ['absent_over_days', 'Absent more days than the month has', 'critical'],
  ['no_attendance', 'Nothing marked all month', 'warning'],
  ['part_attendance', 'Attendance looks unfinished', 'warning'],
  ['paid_without_details', 'Marked paid with no payment details', 'warning'],
  ['duplicate_person', 'The same name twice on one company', 'warning'],
  ['pf_no_uan', 'PF deducted with no UAN', 'warning'],
  ['esi_over_limit', 'ESI deducted above the wage limit', 'warning'],
  ['big_deduction', 'Deductions are more than half the gross', 'warning'],
  ['no_bank_details', 'Bank transfer with no account or IFSC', 'warning'],
  ['on_hold', 'This row is on hold', 'info'],
  ['awaiting_approval', 'The month is waiting for approval', 'info'],
];

export const exceptionLabel = (code) => EXCEPTION_KINDS.find(([k]) => k === code)?.[1] || code;
export const exceptionSeverity = (code) => EXCEPTION_KINDS.find(([k]) => k === code)?.[2] || 'info';

/**
 * WHICH FLAG IS A SYMPTOM OF WHICH.
 *
 * Read as: this code is dropped when any of these is already on the same
 * person. Every pair here is one underlying problem that was being reported
 * twice - a nought day rate makes the net nought; a net below nought IS the
 * deduction being larger than the gross.
 */
export const EXPLAINED_BY = {
  zero_per_day: ['no_salary'],
  zero_net: ['no_salary', 'zero_per_day', 'negative_net', 'absent_over_days'],
  big_deduction: ['negative_net'],
  part_attendance: ['no_attendance'],
};

/** How many of the month's days have a mark against them. */
const markedDays = (attendance = {}) =>
  Object.values(attendance).filter((e) => String((typeof e === 'object' ? e?.code : e) || '').trim()).length;

const daysIn = (year, month) => new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();

/**
 * DAYS THIS PERSON WAS EXPECTED AT WORK - and not one day more.
 *
 * The old check compared marks against `today - 1` straight off the calendar,
 * so on the 21st it wanted twenty marks. Three Sundays had gone by, which the
 * office does not mark, so everybody was flagged every month; and a month
 * that had ENDED was never checked at all, because the running-month branch
 * was the only one there was.
 *
 * Four things come out of the count, and each one is somebody not being asked
 * to explain a day nobody was due to work:
 *
 *   - days that have not happened yet. During an open month the line is
 *     YESTERDAY: today's attendance is being marked while you read this.
 *   - that person's weekly off, by the same rule the grid shades squares
 *     with - which in Gujarat is often alternate Saturdays, not just Sunday.
 *   - the month's holidays, and only the ones that cover this person: a
 *     festival marked for the Hindu staff is a working day for everybody
 *     else, which is the whole reason holidays carry religions.
 *   - before they joined and after they left.
 *
 * Once the month is over the line is the last day of the month, so a closed
 * month is checked in full. That is the same function with a later `upTo` -
 * two rules would be two answers.
 */
export function expectedWorkingDays({
  period = {},
  today = '',
  employee = {},
  company = {},
  holidays = [],
} = {}) {
  const year = Number(period.year);
  const month = Number(period.month);
  if (!year || !month) return 0;

  const total = daysIn(year, month);
  const tag = `${year}-${String(month).padStart(2, '0')}`;
  const stamp = String(today || '').slice(0, 10);

  let upTo = total;
  if (stamp) {
    const sameMonth = stamp.slice(0, 7) === tag;
    if (sameMonth) {
      /* Today is being marked as you read this, so the line is yesterday. */
      upTo = Math.min(total, Number(stamp.slice(8, 10)) - 1);
    } else if (stamp.slice(0, 7) < tag) {
      /* The month has not started. Nothing is expected yet. */
      upTo = 0;
    }
  }
  if (upTo <= 0) return 0;

  const policy = policyFor(employee, company);
  const religion = String(employee.religion || '').trim().toLowerCase();
  const off = new Set();
  for (const holiday of holidays) {
    const day = Number(holiday?.day);
    if (!day) continue;
    const covers = holiday.religions || [];
    /* No religions on a holiday means the whole office; otherwise only the
       people it names. A day somebody was due to work is not a holiday. */
    if (covers.length && !covers.some((r) => String(r).trim().toLowerCase() === religion)) continue;
    off.add(day);
  }

  const dayOf = (value) => {
    const text = String(value || '').slice(0, 10);
    if (!text || text.slice(0, 7) !== tag) return null;
    return Number(text.slice(8, 10)) || null;
  };
  const from = dayOf(employee.joined_on) || 1;
  const to = dayOf(employee.left_on) || total;

  let count = 0;
  for (let day = Math.max(1, from); day <= Math.min(upTo, to); day += 1) {
    if (off.has(day)) continue;
    if (isWeeklyOff(year, month, day, policy)) continue;
    count += 1;
  }
  return count;
}

/**
 * HOW MUCH OF THE MONTH IS ACTUALLY MARKED.
 *
 * In DAYS, against the days people were due at work - not in people who have
 * at least one mark. The headline used to be the second of those and read
 * "13 of 13 (100%)" over a list of warnings saying the attendance was
 * unfinished, because one mark on the 2nd made somebody "marked".
 *
 * Counted with `expectedWorkingDays`, the same function the warnings come
 * from, so the figure and the flags cannot disagree.
 */
export function attendanceProgress(rows = [], { period = {}, today = '', holidays = [] } = {}) {
  let marked = 0;
  let expected = 0;
  let peopleMarked = 0;
  for (const entry of rows) {
    const row = entry?.row || entry || {};
    const employee = entry?.employee || {};
    const days = markedDays(row.attendance);
    const due = expectedWorkingDays({
      period,
      today,
      employee: { ...employee, ...row },
      company: { weekly_off: row.company_weekly_off ?? employee.company_weekly_off },
      holidays,
    });
    /* Never more than a hundred per cent: somebody marked on a Sunday too
       has not done more than the month asked of them. */
    marked += Math.min(days, due);
    expected += due;
    if (days > 0) peopleMarked += 1;
  }
  return {
    days_marked: marked,
    days_expected: expected,
    people_marked: peopleMarked,
    people: rows.length,
    percent: expected ? Math.round((marked / expected) * 100) : 0,
  };
}

/**
 * Every flag on one month.
 *
 * @param rows     [{ row, calc, employee }] - the row as stored, what
 *                 `calculateRow` returned for it, and the master
 * @param period   the month
 * @param today    for "is this month still running", so a half-marked month
 *                 in progress is not called unfinished
 * @param holidays the month's holidays, so a festival is not read as a gap
 */
export function payrollExceptions(rows = [], { period = {}, today = '', holidays = [] } = {}) {
  const out = [];
  const say = (entry, code, detail, amount) =>
    out.push({
      code,
      label: exceptionLabel(code),
      severity: exceptionSeverity(code),
      employee_id: entry?.row?.employee_id ?? entry?.employee?.id ?? null,
      row_id: entry?.row?.id ?? null,
      name: entry?.row?.employee_name || entry?.employee?.name || '',
      company: entry?.row?.company_name || entry?.employee?.company_name || '',
      detail,
      amount: amount === undefined ? null : n(amount),
    });

  /*
   * The same person entered twice is counted here rather than per row,
   * because it is a fact about the pair. The database cannot stop it: the
   * unique key is on employee + month, so two employee records with one
   * name are two perfectly legal rows - and two salaries.
   */
  const byName = new Map();
  for (const entry of rows) {
    const key = `${entry.row?.company_name || ''}::${String(entry.row?.employee_name || '').trim().toLowerCase()}`;
    if (!key.trim()) continue;
    byName.set(key, (byName.get(key) || 0) + 1);
  }

  const seenDuplicate = new Set();

  for (const entry of rows) {
    const { row = {}, calc = {}, employee = {} } = entry;

    if (!n(row.salary)) {
      say(entry, 'no_salary', 'No monthly salary on this row — check the employee master.', 0);
    }
    if (n(row.salary) && !n(calc.per_day)) {
      say(entry, 'zero_per_day', 'The day rate works out at nought. Check the salary and the month’s working days.', 0);
    }

    const net = n(calc.net_salary);
    if (net < 0) {
      say(entry, 'negative_net', 'Deductions come to more than the earnings. Verify the loan, penalty and deduction figures.', net);
    } else if (!net && n(row.salary)) {
      say(entry, 'zero_net', 'Nothing is payable this month. Verify the salary setup and the attendance.', 0);
    }

    const absent = n(calc.absent_days);
    if (absent > n(calc.working_days)) {
      say(entry, 'absent_over_days', `${absent} absent against ${calc.working_days} working days.`, absent);
    }

    /*
     * ATTENDANCE, AGAINST THE DAYS THIS PERSON WAS ACTUALLY DUE AT WORK.
     * A day marked as leave, a holiday or a weekly off IS marked - the gap
     * this looks for is a day nobody has said anything about at all.
     */
    const marked = markedDays(row.attendance);
    const expected = expectedWorkingDays({
      period,
      today,
      employee: { ...employee, ...row },
      company: { weekly_off: row.company_weekly_off ?? employee.company_weekly_off },
      holidays,
    });
    if (!marked && expected > 0) {
      say(entry, 'no_attendance', 'No day is marked, so the month pays in full. Import the machine’s file or mark the grid.', null);
    } else if (expected > 0 && marked < expected) {
      const running = String(today || '').slice(0, 7) ===
        `${period.year}-${String(period.month).padStart(2, '0')}`;
      say(
        entry,
        'part_attendance',
        running
          ? `${marked} of ${expected} working day(s) so far this month are marked. Days off and holidays are not counted.`
          : `${marked} of ${expected} working day(s) are marked for the whole month. Days off and holidays are not counted.`,
        null
      );
    }

    /*
     * PAID IS A CLAIM THAT MONEY LEFT THE BANK. Without a mode, a date or a
     * reference there is nothing to check it against - which is exactly the
     * row somebody queries three months later.
     */
    const status = String(row.status || '').toLowerCase();
    if (status === 'paid' && !(row.payment_mode && (row.payment_date || row.payment_ref))) {
      say(entry, 'paid_without_details', 'Marked paid with no payment date or reference against it.', net);
    }

    /* On hold is a DECISION somebody made, not a fault - so it is listed
       where it can be seen and never counted against the month. */
    if (status === 'hold') {
      say(entry, 'on_hold', `On hold${row.remark ? `: ${row.remark}` : ''}. Nothing goes out for this row until it is taken off hold.`, net);
    }

    const key = `${row.company_name || ''}::${String(row.employee_name || '').trim().toLowerCase()}`;
    if ((byName.get(key) || 0) > 1 && !seenDuplicate.has(key)) {
      seenDuplicate.add(key);
      say(entry, 'duplicate_person', `${byName.get(key)} people on this company share this name — check they are not the same person twice.`, net);
    }

    if (n(calc.pf) > 0 && !String(employee.uan || row.uan || '').trim()) {
      say(entry, 'pf_no_uan', 'PF is being deducted but there is no UAN on the record — the return cannot be filed.', calc.pf);
    }

    /*
     * A bank transfer needs an account and an IFSC. Cash does not, and a row
     * with no mode set has not been decided yet - neither is a problem.
     */
    const mode = String(row.payment_mode || '').trim().toLowerCase();
    if (mode && mode !== 'cash' && net > 0) {
      const account = String(employee.bank_account || row.bank_account || '').trim();
      const ifsc = String(employee.ifsc || row.ifsc || '').trim();
      if (!account || !ifsc) {
        say(entry, 'no_bank_details', `Paid by ${row.payment_mode} with ${!account && !ifsc ? 'no account number and no IFSC' : !account ? 'no account number' : 'no IFSC'} on the record.`, net);
      }
    }

    /*
     * ESI stops above the wage limit. The engine already handles that; a
     * deduction above it means a figure typed by hand, which is worth a look
     * rather than a correction nobody asked for.
     */
    if (n(calc.esi) > 0 && n(calc.gross_salary) > 21000) {
      say(entry, 'esi_over_limit', `ESI is being deducted on a gross of ${money(calc.gross_salary)}.`, calc.esi);
    }

    const deductions = n(calc.pt) + n(calc.esi) + n(calc.pf) + n(calc.loan_deduction) +
      n(calc.penalty_deduction) + n(calc.deduction);
    if (n(calc.gross_salary) > 0 && deductions > n(calc.gross_salary) / 2) {
      say(entry, 'big_deduction', `${money(deductions)} is coming off a gross of ${money(calc.gross_salary)}.`, deductions);
    }
  }

  /*
   * THE MONTH'S OWN STATUS, once - not once per person.
   *
   * "Pending approval" is a fact about the month. Said against all eighty-five
   * names it would be eighty-five lines saying the same thing, which is how a
   * list of things to check stops being read.
   */
  if (rows.length && !period.approved_at) {
    out.push({
      code: 'awaiting_approval',
      label: exceptionLabel('awaiting_approval'),
      severity: 'info',
      employee_id: null,
      row_id: null,
      name: '',
      company: '',
      detail: `${rows.length} salaries are calculated and waiting for somebody to approve the month.`,
      amount: null,
    });
  }

  return dropSymptoms(out);
}

/**
 * Drop a flag whose cause is already on the same person's list.
 *
 * The month-level flags carry no employee, so they are keyed apart and can
 * never be suppressed by somebody's zero salary.
 */
export function dropSymptoms(list = []) {
  const byPerson = new Map();
  for (const flag of list) {
    const key = flag.employee_id ?? `row:${flag.row_id ?? 'month'}`;
    if (!byPerson.has(key)) byPerson.set(key, new Set());
    byPerson.get(key).add(flag.code);
  }
  return list.filter((flag) => {
    const causes = EXPLAINED_BY[flag.code];
    if (!causes) return true;
    const held = byPerson.get(flag.employee_id ?? `row:${flag.row_id ?? 'month'}`) || new Set();
    return !causes.some((cause) => held.has(cause));
  });
}

/**
 * The flags grouped for the headline.
 *
 * Counted on what is still OPEN, per level, so the three chips add up to the
 * open total and the open total is what the KPI shows. `people` counts names,
 * not flags - a month-level line belongs to nobody.
 */
export function exceptionSummary(list = []) {
  const open = list.filter((e) => (e.state || 'open') === 'open');
  const level = (key) => open.filter((e) => e.severity === key).length;
  return {
    total: list.length,
    open: open.length,
    resolved: list.filter((e) => e.state === 'resolved').length,
    ignored: list.filter((e) => e.state === 'ignored').length,
    critical: level('critical'),
    warning: level('warning'),
    info: level('info'),
    people: new Set(open.map((e) => e.employee_id).filter((id) => id !== null)).size,
  };
}
