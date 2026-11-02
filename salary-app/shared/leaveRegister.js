import { ATTENDANCE_CODES, LEAVE_TYPES, countMarks } from './calc.js';

/**
 * The leave register: what each kind of leave cost, apart from the salary.
 *
 * Dinesh: "unpaid ka alag se gina jayega, paid leave ka alag se — alag hi
 * register banega dono ka."
 *
 * Two different things sit in here, and keeping them apart is the point:
 *
 *   PAID LEAVE (CL/SL/PL)  the day is paid in full. It costs the company a
 *                          day's wage and costs the employee nothing, and it
 *                          is ALREADY inside the month's salary.
 *   UNPAID LEAVE (UL)      the day is not paid. It is already deducted from
 *                          the month's salary.
 *
 * So both figures here are **what the salary sheet already did**, pulled out
 * and shown on their own. This register REPORTS; it does not re-price
 * anything and it moves no money. That matters: a register that worked the
 * amounts out for itself would, the first time somebody typed a net salary
 * over the formula, disagree with the payslip — and then nobody could say
 * which was right.
 *
 * Every amount is `days × that person's own per-day rate`, and `per_day` came
 * out of `calculateRow`, which is what the payslip was built from.
 */

/** Paid leave + unpaid, for one calculated row. */
export function leaveLine(row = {}) {
  const counts = countMarks(row.attendance || {});
  const perDay = Number(row.per_day) || 0;

  const paid = LEAVE_TYPES.map((kind) => {
    const days = Number(counts[kind.code]) || 0;
    return { ...kind, days, amount: Math.round(days * perDay) };
  });

  const paidDays = paid.reduce((n, k) => n + k.days, 0);
  const unpaidDays = Number(counts.UL) || 0;

  return {
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    employee_code: row.employee_code,
    company_name: row.company_name,
    per_day: Math.round(perDay),
    paid,
    paid_days: paidDays,
    // What the company paid for days nobody worked. Inside the salary already.
    paid_amount: paid.reduce((n, k) => n + k.amount, 0),
    unpaid_days: unpaidDays,
    // What the employee lost. Already deducted from the salary.
    unpaid_amount: Math.round(unpaidDays * perDay),
    // Plain absence is NOT leave and is deliberately kept out of both figures.
    // Somebody who simply did not come in has not taken leave, and folding the
    // two together is how an absence record turns into a leave balance.
    absent_days: Number(counts.A || 0) + Number(counts.AD || 0) * 2,
  };
}

export function leaveRegister(rows = []) {
  const lines = rows
    .map(leaveLine)
    // Only people who took something. A register of eighty-five zeroes buries
    // the nine lines that matter.
    .filter((l) => l.paid_days > 0 || l.unpaid_days > 0)
    .sort(
      (a, b) =>
        b.paid_days + b.unpaid_days - (a.paid_days + a.unpaid_days) ||
        String(a.employee_name || '').localeCompare(String(b.employee_name || ''))
    );

  const totals = {
    people: lines.length,
    paid_days: 0,
    paid_amount: 0,
    unpaid_days: 0,
    unpaid_amount: 0,
    by_kind: Object.fromEntries(LEAVE_TYPES.map((k) => [k.code, { days: 0, amount: 0 }])),
  };
  for (const line of lines) {
    totals.paid_days += line.paid_days;
    totals.paid_amount += line.paid_amount;
    totals.unpaid_days += line.unpaid_days;
    totals.unpaid_amount += line.unpaid_amount;
    for (const kind of line.paid) {
      totals.by_kind[kind.code].days += kind.days;
      totals.by_kind[kind.code].amount += kind.amount;
    }
  }
  return { lines, totals };
}

const esc = (v) => {
  const text = String(v ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function leaveRegisterCsv(rows = []) {
  const { lines, totals } = leaveRegister(rows);
  const head = [
    'Employee code', 'Employee', 'Company', 'Per day',
    ...LEAVE_TYPES.flatMap((k) => [`${k.label} days`, `${k.label} ₹`]),
    'Paid leave days', 'Paid leave ₹',
    'Unpaid leave days', 'Unpaid leave ₹',
    'Absent days',
  ];
  const body = lines.map((l) =>
    [
      l.employee_code, l.employee_name, l.company_name, l.per_day,
      ...l.paid.flatMap((k) => [k.days, k.amount]),
      l.paid_days, l.paid_amount,
      l.unpaid_days, l.unpaid_amount,
      l.absent_days,
    ].map(esc).join(',')
  );
  const foot = [
    '', 'TOTAL', '', '',
    ...LEAVE_TYPES.flatMap((k) => [totals.by_kind[k.code].days, totals.by_kind[k.code].amount]),
    totals.paid_days, totals.paid_amount,
    totals.unpaid_days, totals.unpaid_amount,
    '',
  ].map(esc).join(',');
  // A BOM, so Excel opens the rupee amounts without mangling them.
  return `﻿${[head.map(esc).join(','), ...body, foot].join('\n')}\n`;
}

export const LEAVE_CODES = {
  paid: LEAVE_TYPES.map((k) => k.code),
  unpaid: ['UL'],
  label: (code) => ATTENDANCE_CODES[code]?.label || code,
};
