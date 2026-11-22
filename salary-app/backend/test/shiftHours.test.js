import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_SHIFT_MINUTES,
  hoursForEmployee,
  shiftLengthProblem,
  shiftMinutes,
} from '../../shared/lateEarly.js';
import { MAX_DAY_MINUTES, minutesForMark, timesToDay } from '../../shared/timesheet.js';
import { calculateRow } from '../../shared/calc.js';

const period = { hours_per_day: 9, shift_in: '09:30', shift_out: '18:30', pt_threshold: 12000, pt_amount: 200 };

/* ================================================================= *
 * how long is a shift
 * ================================================================= */

test('a shift that crosses midnight is eight hours, not minus sixteen', () => {
  assert.equal(shiftMinutes('22:00', '06:00'), 8 * 60);
  assert.equal(shiftMinutes('09:30', '18:30'), 9 * 60);
  assert.equal(shiftMinutes('10:00', '16:00'), 6 * 60);
});

test('equal times are unreadable, not zero and not twenty-four', () => {
  // Nobody means either, and guessing which would be a guess about money.
  assert.equal(shiftMinutes('09:00', '09:00'), null);
  assert.equal(shiftMinutes('', '18:00'), null);
  assert.equal(shiftMinutes('nonsense', '18:00'), null);
});

/* ================================================================= *
 * whose day is it
 * ================================================================= */

test('somebody on the office day gets the month’s hours, exactly as before', () => {
  assert.equal(hoursForEmployee({}, { period }), 9);
  assert.equal(hoursForEmployee({ shift_in: '09:30', shift_out: '18:30' }, { period }), 9);
  assert.equal(hoursForEmployee({}, { period: { hours_per_day: 8 } }), 8);
});

test('a shift at another time of day but the SAME length does not move', () => {
  /*
   * This is what keeps the change small. Most people with their own shift
   * work the same nine hours in the afternoon or at night; only a different
   * LENGTH can move a figure.
   */
  assert.equal(hoursForEmployee({ shift_in: '14:00', shift_out: '23:00' }, { period }), 9);
  assert.equal(hoursForEmployee({ shift_in: '22:00', shift_out: '07:00' }, { period }), 9);
});

test('a shorter or longer shift is judged against its own length', () => {
  assert.equal(hoursForEmployee({ shift_in: '10:00', shift_out: '16:00' }, { period }), 6);
  assert.equal(hoursForEmployee({ shift_in: '09:00', shift_out: '19:00' }, { period }), 10);
  assert.equal(hoursForEmployee({ shift_in: '22:00', shift_out: '06:00' }, { period }), 8);
});

test('a typo falls back to the month and is NAMED', () => {
  /*
   * 09:00-09:30 taken literally makes a half-hour day the standard and pays
   * eight and a half hours of overtime every single day. Falling back is not
   * enough on its own - silence is how it would stay wrong.
   */
  const typo = { shift_in: '09:00', shift_out: '09:30' };
  assert.equal(hoursForEmployee(typo, { period }), 9);
  assert.match(shiftLengthProblem(typo, { period }), /under two hours/);

  const silly = { shift_in: '06:00', shift_out: '23:30' };
  assert.equal(hoursForEmployee(silly, { period }), 9);
  assert.match(shiftLengthProblem(silly, { period }), /over sixteen hours/);

  assert.equal(shiftLengthProblem({}, { period }), null);
  assert.equal(shiftLengthProblem({ shift_in: '14:00', shift_out: '23:00' }, { period }), null);
});

test('the bounds are the same two numbers the day reader uses', () => {
  assert.equal(MIN_SHIFT_MINUTES, 120);
  assert.equal(MAX_DAY_MINUTES, 16 * 60);
});

/* ================================================================= *
 * what it costs
 * ================================================================= */

const day = (inT, outT) => ({ in_time: inT, out_time: outT });

test('a six-hour shift finishing on time is charged NOTHING', () => {
  const them = { shift_in: '10:00', shift_out: '16:00' };
  const hours = hoursForEmployee(them, { period });
  assert.equal(minutesForMark(day('10:00', '16:00'), { hoursPerDay: hours, code: 'P' }), 0);
  // What it used to do, and the whole reason for this change: three hours a
  // day docked for finishing exactly on time.
  assert.equal(minutesForMark(day('10:00', '16:00'), { hoursPerDay: 9, code: 'P' }), -180);
});

test('a ten-hour shift worked in full earns NO overtime', () => {
  const them = { shift_in: '09:00', shift_out: '19:00' };
  const hours = hoursForEmployee(them, { period });
  assert.equal(minutesForMark(day('09:00', '19:00'), { hoursPerDay: hours, code: 'P' }), 0);
  assert.equal(minutesForMark(day('09:00', '19:00'), { hoursPerDay: 9, code: 'P' }), 60);
});

test('their half-day line follows their own day too', () => {
  // Half of six is three, not four and a half.
  const six = hoursForEmployee({ shift_in: '10:00', shift_out: '16:00' }, { period });
  assert.equal(timesToDay(day('10:00', '12:30'), { hoursPerDay: six }).code, 'HF');
  assert.equal(timesToDay(day('10:00', '13:30'), { hoursPerDay: six }).code, 'P');
});

/* ================================================================= *
 * the month, through the engine the payslip is printed from
 * ================================================================= */

/*
 * THE PIPELINE, MODELLED HONESTLY.
 *
 * `calculateRow` does NOT read clock times - it sums the `minutes` already
 * stored on each day, which `setAttendance` worked out on the way in. A
 * fixture carrying times and no minutes therefore proves nothing at all; the
 * first draft of these tests asserted against a month whose OT was zero
 * whatever the shift was. So the minutes are worked out here the way the
 * server works them out, and the end-to-end API test below does it for real.
 */
const monthOf = (employee, times, { forceHours = null } = {}) => {
  const hours = forceHours ?? hoursForEmployee(employee, { period });
  const attendance = {};
  for (let d = 1; d <= 26; d += 1) {
    attendance[d] = {
      code: 'P',
      ...times,
      minutes: times.in_time ? minutesForMark(times, { hoursPerDay: hours, code: 'P' }) : 0,
    };
  }
  return calculateRow({ salary: 26000, ...employee }, period, attendance);
};

test('NOTHING MOVES for somebody without a shift of their own', () => {
  const plain = monthOf({}, day('09:30', '18:30'));
  const sameLength = monthOf({ shift_in: '14:00', shift_out: '23:00' }, day('14:00', '23:00'));
  for (const key of ['gross_salary', 'net_salary', 'final_payable', 'pt', 'ot_minutes', 'per_hour']) {
    assert.equal(sameLength[key], plain[key], key);
  }
  assert.equal(plain.ot_minutes, 0);
});

test('a part-timer finishing on time is paid in full', () => {
  const them = { shift_in: '10:00', shift_out: '16:00' };
  const now = monthOf(them, day('10:00', '16:00'));
  assert.equal(now.ot_minutes, 0);
  assert.equal(now.net_salary, monthOf({}, {}).net_salary);

  /* What it used to do: six hours worked against a nine-hour expectation,
     three hours docked a day, every day, for finishing on time. */
  const before = monthOf(them, day('10:00', '16:00'), { forceHours: 9 });
  assert.equal(before.ot_minutes, -26 * 180);
  assert.ok(before.net_salary < now.net_salary);

  /*
   * The rate follows the day as well, and it has to: an hour missing from a
   * six-hour day is worth a sixth of that day. Expecting six hours and
   * charging the shortfall at a ninth would be incoherent.
   */
  assert.equal(Math.round(now.per_hour * 100), Math.round((26000 / 26 / 6) * 100));
});

test('a long shift does not quietly collect an hour of overtime a day', () => {
  const them = { shift_in: '09:00', shift_out: '19:00' };
  const now = monthOf(them, day('09:00', '19:00'));
  assert.equal(now.ot_minutes, 0);

  // Before this: 26 days x 60 minutes of overtime nobody had earned.
  const before = monthOf(them, day('09:00', '19:00'), { forceHours: 9 });
  assert.equal(before.ot_minutes, 26 * 60);
  assert.ok(before.net_salary > now.net_salary);
});

test('a typed shift that cannot be read leaves the month exactly where it was', () => {
  const typo = monthOf({ shift_in: '09:00', shift_out: '09:30' }, day('09:30', '18:30'));
  const plain = monthOf({}, day('09:30', '18:30'));
  assert.equal(typo.net_salary, plain.net_salary);
  assert.equal(typo.ot_minutes, plain.ot_minutes);
});

/* ================================================================= *
 * end to end, through the real server
 * ================================================================= */

process.env.DATA_DIR = (await import('node:fs')).mkdtempSync(
  (await import('node:path')).join((await import('node:os')).tmpdir(), 'shifthours-')
);
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';
process.env.APP_PASSWORD = 'open-sesame';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: 'Bearer open-sesame',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('the server charges each person against their own shift', async () => {
  const company = (await call('POST', '/api/companies', { name: 'BOOKNFLY' })).body;
  const make = async (name, extra) =>
    (await call('POST', '/api/employees', {
      company_id: company.id, name, monthly_salary: 26000, joined_on: '2024-01-01', ...extra,
    })).body;

  // Same salary, three different days.
  const office = await make('Office Day', {});
  const part = await make('Part Timer', { shift_in: '10:00', shift_out: '16:00' });
  const long = await make('Long Shift', { shift_in: '09:00', shift_out: '19:00' });

  const periodId = (await call('POST', '/api/periods', { year: 2026, month: 10 })).body.id;
  await call('GET', `/api/periods/${periodId}/payroll`);

  /* Each one works exactly their own shift, every working day. */
  const entries = [];
  for (let d = 1; d <= 26; d += 1) {
    entries.push({ employee_id: office.id, day: d, code: 'P', in_time: '09:30', out_time: '18:30' });
    entries.push({ employee_id: part.id, day: d, code: 'P', in_time: '10:00', out_time: '16:00' });
    entries.push({ employee_id: long.id, day: d, code: 'P', in_time: '09:00', out_time: '19:00' });
  }
  const wrote = await call('POST', `/api/periods/${periodId}/attendance`, { entries });
  assert.equal(wrote.status < 300, true, `attendance write said ${wrote.status}`);

  const payroll = (await call('GET', `/api/periods/${periodId}/payroll`)).body;
  const rowOf = (id) => payroll.rows.find((r) => r.employee_id === id);

  /*
   * THE CLAIM: everybody who worked their own shift in full is paid in full,
   * and nobody is charged or paid for hours they did not miss or work.
   */
  for (const who of [office, part, long]) {
    const row = rowOf(who.id);
    assert.equal(row.ot_minutes, 0, `${who.name} came out with ${row.ot_minutes} minutes`);
  }
  assert.equal(rowOf(part.id).net_salary, rowOf(office.id).net_salary);
  assert.equal(rowOf(long.id).net_salary, rowOf(office.id).net_salary);
});

test('the part-timer IS charged when they genuinely leave early', async () => {
  const company = (await call('POST', '/api/companies', { name: 'SCALE' })).body;
  const part = (await call('POST', '/api/employees', {
    company_id: company.id, name: 'Half Day Hiren', monthly_salary: 26000,
    joined_on: '2024-01-01', shift_in: '10:00', shift_out: '16:00',
  })).body;
  const periodId = (await call('POST', '/api/periods', { year: 2026, month: 9 })).body.id;
  await call('GET', `/api/periods/${periodId}/payroll`);

  // Six hours expected, five worked: an hour short, once.
  await call('POST', `/api/periods/${periodId}/attendance`, {
    entries: [{ employee_id: part.id, day: 3, code: 'P', in_time: '10:00', out_time: '15:00' }],
  });
  const payroll = (await call('GET', `/api/periods/${periodId}/payroll`)).body;
  const row = payroll.rows.find((r) => r.employee_id === part.id);
  assert.equal(row.ot_minutes, -60);
  // And it is charged at THEIR hourly rate, a sixth of their day.
  assert.equal(Math.round(row.per_hour), Math.round(26000 / 26 / 6));
});
