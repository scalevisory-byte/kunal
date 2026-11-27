/**
 * Somebody who has left, seen from a month.
 *
 * Dinesh: "Exit employee ka still attendance and salary register me dikh raha
 * he". A leaver's row was only cleared from a month when the grid held nothing
 * for them - and it almost always holds something, because the punch import
 * and Mark everyone Present write onto every row on screen. So somebody who
 * left in October sat on November's sheet, paid in full.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateRow } from '../../shared/calc.js';
import { leaverIn, leftLabel, paidAfterLeaving } from '../../shared/onStaff.js';
import { payrollExceptions } from '../../shared/payrollExceptions.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-leavers-'));
process.env.APP_PASSWORD = 'the-key';
process.env.LINK_SECRET = 'test-secret';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: 'Bearer the-key', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const NOV = { year: 2026, month: 11, hours_per_day: 9, pt_threshold: 12000, pt_amount: 200, late_policy: 'none' };

/* ------------------------------- the rule ------------------------------- */

test('a leaving date is read against the month: before it, during it, after it, or not on record', () => {
  assert.deepEqual(leaverIn({ left_on: '2026-10-20', active: 0 }, NOV), { left: 'before', on: '2026-10-20' });
  assert.deepEqual(leaverIn({ left_on: '2026-11-10', active: 0 }, NOV), { left: 'during', on: '2026-11-10', day: 10 });
  assert.equal(leaverIn({ left_on: '2026-11-30', active: 1 }, NOV).left, 'during', 'the last day of the month is in it');
  assert.equal(leaverIn({ left_on: '2026-12-05', active: 1 }, NOV).left, '', 'serving notice into next month');
  assert.equal(leaverIn({ active: 0 }, NOV).left, 'undated');
  assert.equal(leaverIn({ active: 1 }, NOV).left, '');
  assert.equal(leaverIn({}, NOV).left, '', 'no active field at all is not somebody who left');
});

test('days after the last working day that are still being paid are counted, never taken', () => {
  const person = { left_on: '2026-11-25', active: 0 };
  const attendance = {
    24: { code: 'P' }, 25: { code: 'P' },
    26: { code: 'P' }, // filled by a bulk press after they had gone
    27: { code: 'A' }, // somebody already stopped this one
    29: { code: 'S' }, // an off is not a paid working day to chase
    // 28 and 30 are blank - paid as present
  };
  const after = paidAfterLeaving(person, NOV, attendance);
  assert.deepEqual(after.days, [26, 28, 30]);
  assert.equal(after.from, 26);
  // Somebody still here, or gone before the month, has nothing to count.
  assert.deepEqual(paidAfterLeaving({ active: 1 }, NOV, attendance).days, []);
  assert.deepEqual(paidAfterLeaving({ left_on: '2026-10-01', active: 0 }, NOV, attendance).days, []);
});

test('the few words beside a name', () => {
  assert.equal(leftLabel({ left_on: '2026-11-12', active: 0 }, '2026-11-27'), 'left 12 Nov');
  assert.equal(leftLabel({ active: 0 }, '2026-11-27'), 'left, no date');
  assert.equal(leftLabel({ left_on: '2026-12-05', active: 1 }, '2026-11-27'), '', 'notice is not left');
  assert.equal(leftLabel({ active: 1 }, '2026-11-27'), '');
  assert.equal(leftLabel({}, '2026-11-27'), '');
});

test('the month’s checks name the days paid after leaving, and a leaver with no date', () => {
  const rowOf = (over) => ({
    id: 1, employee_id: 1, employee_name: 'RIYA PAL', company_name: 'BNF', salary: 26000, ...over,
  });
  const entry = (row) => ({ row, calc: calculateRow(row, NOV, row.attendance || {}), employee: {} });

  const during = rowOf({ left_on: '2026-11-25', active: 0, attendance: { 24: { code: 'P' }, 25: { code: 'P' } } });
  const flags = payrollExceptions([entry(during)], { period: NOV, today: '2026-11-30' });
  const paid = flags.find((f) => f.code === 'paid_after_leaving');
  assert.ok(paid, 'named');
  assert.match(paid.detail, /25th/);
  assert.match(paid.detail, /5 day\(s\) after it/);
  assert.equal(paid.amount, 5000, 'five days at 1,000 a day - what it is worth, not something taken');
  // Counted, not deducted: the sheet's own figures are untouched by any of this.
  assert.equal(entry(during).calc.net_salary, calculateRow({ ...during, left_on: null, active: 1 }, NOV, during.attendance).net_salary);

  const undated = rowOf({ active: 0, attendance: { 3: { code: 'P' } } });
  const named = payrollExceptions([entry(undated)], { period: NOV, today: '2026-11-30' });
  assert.ok(named.some((f) => f.code === 'left_no_date'));
  assert.ok(!named.some((f) => f.code === 'paid_after_leaving'));

  const here = rowOf({ active: 1, attendance: { 3: { code: 'P' } } });
  const quiet = payrollExceptions([entry(here)], { period: NOV, today: '2026-11-30' });
  assert.ok(!quiet.some((f) => f.code === 'paid_after_leaving' || f.code === 'left_no_date'));
});

/* --------------------------- through the server --------------------------- */

let period;
const people = {};
const onSheet = async () => {
  const pay = await api('GET', `/api/periods/${period.id}/payroll`);
  return pay.body.rows.map((r) => r.employee_name).sort();
};

test('a month with five people on it, every row carrying marks', async () => {
  const company = (await api('POST', '/api/companies', { name: 'BNF' })).body;
  for (const name of ['STAYS', 'LEFT OCTOBER', 'LEFT NOVEMBER', 'OCTOBER ARREAR', 'NO DATE']) {
    people[name] = (await api('POST', '/api/employees', {
      name, company_id: company.id, monthly_salary: 26000, joined_on: '2024-01-01',
    })).body;
  }
  period = (await api('POST', '/api/periods', { month: 11, year: 2026 })).body;
  assert.equal((await onSheet()).length, 5);

  // What a punch import and "Mark everyone Present" leave behind: marks on everybody.
  const entries = [];
  for (const who of Object.values(people)) for (const day of [2, 3, 4]) entries.push({ employee_id: who.id, day, code: 'P' });
  assert.equal((await api('POST', `/api/periods/${period.id}/attendance`, { entries })).status, 200);
});

test('gone before the month began: off the salary sheet and the grid, marks or no marks', async () => {
  await api('PATCH', `/api/employees/${people['LEFT OCTOBER'].id}`, { left_on: '2026-10-20', active: 0 });
  const names = await onSheet();
  assert.ok(!names.includes('LEFT OCTOBER'), 'they were only there because of marks written after they had gone');
  const grid = await api('GET', `/api/periods/${period.id}/attendance`);
  assert.ok(!grid.body.employees.some((e) => e.employee_id === people['LEFT OCTOBER'].id), 'the grid lists the month’s rows');
});

test('left during the month: stays, because the month owes them', async () => {
  await api('PATCH', `/api/employees/${people['LEFT NOVEMBER'].id}`, { left_on: '2026-11-10', active: 0 });
  const pay = await api('GET', `/api/periods/${period.id}/payroll`);
  const row = pay.body.rows.find((r) => r.employee_name === 'LEFT NOVEMBER');
  assert.ok(row, 'still on the month they worked part of');
  assert.equal(row.left_on, '2026-11-10', 'and the row carries the date, for the tag beside the name');
});

test('money typed on the row keeps somebody who left earlier - an arrear is deliberate', async () => {
  const pay = await api('GET', `/api/periods/${period.id}/payroll`);
  const row = pay.body.rows.find((r) => r.employee_name === 'OCTOBER ARREAR');
  const typed = await api('PATCH', `/api/periods/${period.id}/rows/${row.id}`, { addition: 2500, adjustment_note: 'October arrear' });
  assert.equal(typed.status, 200);
  await api('PATCH', `/api/employees/${people['OCTOBER ARREAR'].id}`, { left_on: '2026-10-28', active: 0 });
  assert.ok((await onSheet()).includes('OCTOBER ARREAR'), 'hiding a row with money on it would hide the money');
});

test('marked as left with no date: nobody can say which month, so they stay', async () => {
  await api('PATCH', `/api/employees/${people['NO DATE'].id}`, { active: 0 });
  const names = await onSheet();
  assert.ok(names.includes('NO DATE'));
  assert.deepEqual(names, ['LEFT NOVEMBER', 'NO DATE', 'OCTOBER ARREAR', 'STAYS']);
});

test('a locked month is never tidied', async () => {
  const other = (await api('POST', '/api/periods', { month: 12, year: 2026 })).body;
  const before = (await api('GET', `/api/periods/${other.id}/payroll`)).body.rows.length;
  await api('POST', `/api/periods/${other.id}/attendance`, {
    entries: [{ employee_id: people.STAYS.id, day: 1, code: 'P' }],
  });
  await api('PATCH', `/api/periods/${other.id}`, { locked: 1 });
  await api('PATCH', `/api/employees/${people.STAYS.id}`, { left_on: '2026-11-26', active: 0 });
  assert.equal((await api('GET', `/api/periods/${other.id}/payroll`)).body.rows.length, before, 'a month that has been closed keeps who it had');
});

test('both screens tag the name with one wording', () => {
  const read = (f) => fs.readFileSync(new URL(`../../frontend/src/components/${f}`, import.meta.url), 'utf8');
  for (const file of ['SalarySheet.jsx', 'Attendance.jsx']) {
    assert.match(read(file), /leftLabel\(row, todayIso\(\)\)/, file);
  }
  const css = fs.readFileSync(new URL('../../frontend/src/styles.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.pill.left-tag'), 'the tag has a rule');
});
