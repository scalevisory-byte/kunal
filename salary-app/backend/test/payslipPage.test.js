/**
 * One person's own month, as a file you can send them.
 *
 * Dinesh asked to hand the month out WITHOUT deploying anything. The rule the
 * whole thing hangs on, and what most of this file is about:
 *
 *   ONE FILE HOLDS ONE PERSON. NOTHING ELSE GOES IN IT.
 *
 * The single-file build holds every salary in the company; forwarding that to
 * an employee hands them the lot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRow } from '../../shared/calc.js';
import { payslipFileName, payslipHtml } from '../../shared/payslipPage.js';

const period = {
  id: 1, year: 2026, month: 10, label: 'October 2026',
  working_days: 26, hours_per_day: 9, pt_threshold: 12000, pt_amount: 200,
};

const attendance = {};
for (let d = 1; d <= 26; d++) attendance[d] = { code: d === 11 ? 'A' : 'P', minutes: 0 };
attendance[18] = { code: 'CL', minutes: 0 };

const amit = {
  employee_id: 1,
  employee_name: 'Amit Shah',
  employee_code: 'BNF012',
  company_name: 'BOOKNFLY PRIVATE LIMITED',
  salary: 26000,
  pf: 1800,
  attendance,
  mark_counts: { P: 24, A: 1, CL: 1 },
  status: 'pending',
};

const pageFor = (row, extra = {}) => {
  const calc = calculateRow(row, period, row.attendance);
  return payslipHtml({
    employee: {
      name: row.employee_name,
      code: row.employee_code,
      company_name: row.company_name,
    },
    period,
    row: { ...row, ...calc },
    ...extra,
  });
};

test('the file carries that person and their figures', () => {
  const html = pageFor(amit);
  const calc = calculateRow(amit, period, attendance);

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Amit Shah/);
  assert.match(html, /BNF012/);
  assert.match(html, /October 2026/);
  // The net, the way a person reads it.
  assert.ok(html.includes(Math.round(calc.net_salary).toLocaleString('en-IN')));
  // And the working, not just the answer.
  assert.match(html, /How it was worked out/);
  assert.match(html, /Monthly salary/);
  assert.match(html, /Professional tax/);
  assert.match(html, /Day rate/);
});

test('NOBODY ELSE is in it', () => {
  const riya = {
    ...amit,
    employee_id: 2,
    employee_name: 'Riya Pal',
    employee_code: 'BNF099',
    salary: 48000,
  };
  const html = pageFor(amit);

  assert.equal(html.includes('Riya Pal'), false);
  assert.equal(html.includes('BNF099'), false);
  // Her salary, in any of the shapes this page prints numbers in.
  const rCalc = calculateRow(riya, period, attendance);
  assert.equal(html.includes(Math.round(rCalc.net_salary).toLocaleString('en-IN')), false);
  assert.equal(html.includes('48,000'), false);
  // And no company total either - a payslip is not a payroll.
  assert.equal(/total/i.test(html.replace(/Professional tax/gi, '')), false);
});

test('it needs nothing from the internet', () => {
  const html = pageFor(amit);
  // No script src, no stylesheet link, no image, no font, no fetch.
  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(/<link[^>]+href=/i.test(html), false);
  assert.equal(/https?:\/\//i.test(html), false);
  assert.equal(/<img/i.test(html), false);
  assert.equal(/fetch\(|XMLHttpRequest/i.test(html), false);
  // The one piece of script is the print button, and that is all it does.
  const scripts = html.match(/\son\w+="[^"]*"/g) || [];
  assert.deepEqual(scripts, [' onclick="window.print()"']);
});

test('a name with a quote or a bracket cannot break the page', () => {
  const awkward = {
    ...amit,
    employee_name: 'A"B <script>alert(1)</script> & O\'Brien',
  };
  const html = pageFor(awkward);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&#39;Brien/);
});

test('the file is named so it can be found again, and is small enough to send', () => {
  assert.equal(
    payslipFileName({ name: 'Amit Shah' }, period),
    'Amit-Shah-October-2026.html'
  );
  // A name with a slash in it must not make a path.
  assert.equal(payslipFileName({ name: 'A/B C' }, period).includes('/'), false);
  // WhatsApp-sized: this has to go to eighty people.
  const bytes = Buffer.byteLength(pageFor(amit), 'utf8');
  assert.ok(bytes < 20000, `a payslip should be a few KB, this is ${bytes}`);
});

test('the leave balance rides along when it is handed in', () => {
  const html = pageFor(amit, {
    leave: { quotas: { CL: 7, SL: 7, PL: 12 }, taken: { CL: 1, SL: 0, PL: 0 } },
  });
  assert.match(html, /Leave this year/);
  assert.match(html, /Casual Leave/);
});

test('Sunday duty is stated beside the net, never added into it', () => {
  const sunday = { ...amit, sundays_override: 2 };
  const calc = calculateRow(sunday, period, attendance);
  assert.ok(calc.sunday_salary > 0);
  const html = pageFor(sunday);
  assert.match(html, /paid on its own register/);
  // The headline is still the net, not net + Sunday.
  assert.ok(html.includes(Math.round(calc.net_salary).toLocaleString('en-IN')));
});

test('a line from the office goes on every slip when one is typed', () => {
  const html = pageFor(amit, { note: 'Salary credited on the 7th.' });
  assert.match(html, /Salary credited on the 7th\./);
});
