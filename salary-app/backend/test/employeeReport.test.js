import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTH_COLUMNS, employeeReport, leaveOf } from '../../shared/employeeReport.js';

const employee = {
  id: 7,
  code: '12',
  name: 'ROHIT TAYADE',
  company_name: 'BNF',
  designation: 'Accountant',
  monthly_salary: 20000,
  cl_quota: 7,
  sl_quota: 7,
  pl_quota: 12,
};

const marks = (pairs) => {
  const out = {};
  for (const [range, code] of pairs) {
    const [from, to] = String(range).split('-').map(Number);
    for (let d = from; d <= (to || from); d += 1) out[d] = code;
  }
  return out;
};

/** A month in the shape buildPayroll hands over. */
const month = (m, attendance, pay = {}) => ({
  period: { id: m, year: 2026, month: m, label: `Month ${m}` },
  row: {
    employee_id: 7,
    company_id: 1,
    company_name: 'BNF',
    employee_code: '12',
    employee_name: 'ROHIT TAYADE',
    attendance,
    mark_counts: Object.values(attendance).reduce((c, k) => {
      c[k] = (c[k] || 0) + 1;
      return c;
    }, {}),
    present_days: pay.present_days ?? 26,
    absent_days: pay.absent_days ?? 0,
    overrides: {},
    salary: 20000,
    gross_salary: pay.gross ?? 20000,
    net_salary: pay.net ?? 19800,
    pf: pay.pf ?? 0,
    esi: pay.esi ?? 0,
    pt: pay.pt ?? 200,
    loan_deduction: pay.loan ?? 0,
    sunday_salary: pay.sunday ?? 0,
    status: pay.status ?? 'Paid',
    payment_mode: 'Bank',
  },
});

test('the months come back oldest first, whatever order they were given', () => {
  const report = employeeReport({
    employee,
    months: [month(3, marks([['1-20', 'P']])), month(1, marks([['1-20', 'P']])), month(2, marks([['1-20', 'P']]))],
  });
  assert.deepEqual(report.months.map((m) => m.month), [1, 2, 3]);
  assert.equal(report.totals.months, 3);
});

test('the money is summed, and the average is over the months actually paid', () => {
  const report = employeeReport({
    employee,
    months: [
      month(1, marks([['1-20', 'P']]), { net: 19800 }),
      month(2, marks([['1-20', 'P']]), { net: 18000 }),
    ],
  });
  assert.equal(report.totals.net_salary, 37800);
  // Not divided by twelve: they were paid for two months.
  assert.equal(report.totals.average_net, 18900);
  assert.equal(report.totals.pt, 400);
});

test('Sunday pay is shown beside the net and never added into it', () => {
  const report = employeeReport({
    employee,
    months: [month(1, marks([['1-20', 'P'], ['25', 'SP']]), { net: 19800, sunday: 770 })],
  });
  assert.equal(report.months[0].net_salary, 19800);
  assert.equal(report.months[0].sunday_salary, 770);
  assert.equal(report.totals.net_salary, 19800);
  assert.equal(report.totals.sunday_salary, 770);
});

test('leave is counted off the marks and set against the quota', () => {
  const report = employeeReport({
    employee,
    months: [
      month(1, marks([['1-18', 'P'], ['19-21', 'CL']])),
      month(2, marks([['1-18', 'P'], ['19-20', 'SL'], ['21', 'UL']])),
    ],
  });
  assert.equal(report.leave.taken.CL, 3);
  assert.equal(report.leave.taken.SL, 2);
  assert.equal(report.leave.unpaid, 1);
  assert.equal(report.leave.balance.CL, 4);
  assert.equal(report.leave.balance.SL, 5);
  assert.equal(report.leave.balance.PL, 12);
  assert.deepEqual(report.leave.over, []);
});

test('leave past the quota is named rather than hidden in a negative', () => {
  const taken = Array.from({ length: 9 }, (_, i) => [String(i + 1), 'CL']);
  const report = employeeReport({ employee, months: [month(1, marks(taken))] });
  assert.equal(report.leave.taken.CL, 9);
  assert.equal(report.leave.balance.CL, -2);
  assert.deepEqual(report.leave.over, ['CL']);
});

test('unpaid leave has no quota, because it was taken anyway and docked', () => {
  const summary = leaveOf([{ casual_leave: 0, sick_leave: 0, paid_leave: 0, unpaid_leave: 4 }], employee);
  assert.equal(summary.unpaid, 4);
  assert.equal(summary.quotas.CL, 7);
  assert.ok(!('UL' in summary.balance));
});

test('attendance across the year is out of days expected, not the calendar', () => {
  const report = employeeReport({
    employee,
    months: [
      month(1, marks([['1-20', 'P'], ['21-22', 'A']]), { present_days: 24, absent_days: 2 }),
      month(2, marks([['1-22', 'P']]), { present_days: 26, absent_days: 0 }),
    ],
  });
  // 42 days at work, 2 lost: 42 of 44.
  assert.equal(report.totals.worked_days, 42);
  assert.equal(report.totals.days_lost, 2);
  assert.equal(report.totals.attendance_percent, Math.round((42 / 44) * 1000) / 10);
});

test('the footer percentage is the same sum a single month does', () => {
  // The bug this pins: the footer was worked out off payable_days, which
  // counts an unmarked day as worked, so one month read 73.7% and the total
  // under it read 80.8% for the same person.
  const one = month(1, marks([['1-14', 'P'], ['15-19', 'A']]), { present_days: 21, absent_days: 5 });
  const report = employeeReport({ employee, months: [one] });
  assert.equal(report.months[0].attendance_percent, report.totals.attendance_percent);
  assert.equal(report.totals.attendance_percent, Math.round((14 / 19) * 1000) / 10);
  // And payable_days is still carried, it just is not what the % is made of.
  assert.equal(report.totals.payable_days, 21);
});

test('somebody with no months at all does not throw', () => {
  const report = employeeReport({ employee, months: [] });
  assert.deepEqual(report.months, []);
  assert.equal(report.totals.months, 0);
  assert.equal(report.totals.average_net, 0);
  assert.equal(report.totals.attendance_percent, null);
  assert.equal(report.employee.name, 'ROHIT TAYADE');
});

test('a half-built month is skipped rather than breaking the report', () => {
  const report = employeeReport({
    employee,
    months: [month(1, marks([['1-20', 'P']])), null, { period: null, row: {} }, { period: {}, row: null }],
  });
  assert.equal(report.months.length, 1);
});

test('the export names every column it writes', () => {
  const [row] = employeeReport({ employee, months: [month(1, marks([['1-5', 'P']]))] }).months;
  for (const [label, key] of MONTH_COLUMNS) {
    assert.ok(label, 'a column with no heading');
    assert.ok(key in row, `the export asks for ${key}, which the month does not carry`);
  }
});
