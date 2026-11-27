/**
 * What an appraisal is for, and the month's own sheet behind one.
 *
 * Dinesh: "Appraisal drop down list. appraisal means any salary increment? any
 * other target achieved, good work related?" and "auto appraisal list for
 * proper in uniform whole month, discipline, time, attendance, target".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APPRAISAL_KINDS, CRITERIA, appraisalKindLabel, appraisalSheet, scoreMonth } from '../../shared/appraisal.js';
import { calculateRow } from '../../shared/calc.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'appraisal-'));
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

const NOV = { year: 2026, month: 11, hours_per_day: 9, shift_in: '09:30', shift_out: '18:30', late_policy: 'none', pt_threshold: 12000, pt_amount: 200 };
const day = (over = {}) => ({ code: 'P', in_time: '09:30', out_time: '18:30', uniform: true, ...over });

test('an appraisal is a review, and a pay rise is only one thing it can be for', () => {
  assert.deepEqual(APPRAISAL_KINDS.map(([k]) => k), ['increment', 'target', 'good_work', 'promotion', 'annual', 'other']);
  assert.equal(appraisalKindLabel('target'), 'Target achieved');
  assert.equal(appraisalKindLabel('good_work'), 'Good work');
  assert.equal(appraisalKindLabel(''), '', 'an old appraisal with no kind says nothing rather than guessing "increment"');
});

test('the five criteria, read off the month - and "not known" is never a yes', () => {
  assert.deepEqual(CRITERIA.map(([k]) => k), ['uniform', 'discipline', 'time', 'attendance', 'target']);

  const clean = scoreMonth({ salary: 26000, target_met: 1, attendance: { 2: day(), 3: day(), 4: day() } }, NOV, { warnings: 0 });
  assert.deepEqual(Object.values(clean.marks).map((m) => m.ok), [true, true, true, true, true]);
  assert.equal(clean.passed, 5);

  const rough = scoreMonth(
    { salary: 26000, target_met: 0, attendance: { 2: day({ uniform: false }), 3: day({ in_time: '10:15' }), 4: { code: 'A' } } },
    NOV,
    { warnings: 2 }
  );
  assert.deepEqual(Object.values(rough.marks).map((m) => m.ok), [false, false, false, false, false]);
  assert.match(rough.marks.uniform.detail, /out of uniform on 1 of 2/);
  assert.match(rough.marks.time.detail, /late 1 time/);
  assert.match(rough.marks.attendance.detail, /1 day\(s\) of pay lost/);

  // Nothing on record at all: five dashes, not five ticks.
  const blank = scoreMonth({ salary: 26000, attendance: {} }, NOV, { warnings: null });
  assert.deepEqual(Object.values(blank.marks).map((m) => m.ok), [null, null, null, null, null]);
  assert.equal(blank.passed, 0);
  assert.equal(blank.unknown, 5);

  // A floor nobody walked is not a month in proper uniform.
  const unseen = scoreMonth({ salary: 26000, attendance: { 2: day({ uniform: null }) } }, NOV, { warnings: 0 });
  assert.equal(unseen.marks.uniform.ok, null);
  // A half day or leave was never a full day to be late for.
  const half = scoreMonth({ salary: 26000, attendance: { 2: { code: 'HF', in_time: '13:00', out_time: '18:30' }, 3: { code: 'CL' } } }, NOV, { warnings: 0 });
  assert.equal(half.marks.time.ok, null);
});

test('lateness is judged against the person’s own shift', () => {
  const evening = { salary: 26000, shift_in: '14:00', shift_out: '23:00', attendance: { 2: { code: 'P', in_time: '14:05', out_time: '23:00' } } };
  assert.equal(scoreMonth(evening, NOV, { warnings: 0 }).marks.time.ok, true, 'five minutes after their own start, inside the grace');
});

test('seven hours on a Sunday is not leaving early', () => {
  const row = { salary: 26000, attendance: { 2: day(), 8: { code: 'SP', in_time: '09:30', out_time: '16:30' } } };
  const time = scoreMonth(row, NOV, { warnings: 0 }).marks.time;
  assert.equal(time.ok, true, time.detail);
  assert.match(time.detail, /all 1 day/, 'the Sunday is not one of the days judged');
});

test('three piles that are three different statements', () => {
  const rows = [
    { id: 1, employee_id: 1, employee_name: 'CLEAR', salary: 26000, target_met: 1, attendance: { 2: day() } },
    { id: 2, employee_id: 2, employee_name: 'NOT TICKED', salary: 26000, attendance: { 2: day() } },
    { id: 3, employee_id: 3, employee_name: 'ABSENT', salary: 26000, target_met: 1, attendance: { 2: day(), 3: { code: 'A' } } },
  ];
  const sheet = appraisalSheet(rows, NOV, { warnings: { 1: 0, 2: 0, 3: 0 } });
  assert.deepEqual(sheet.clear.map((l) => l.name), ['CLEAR']);
  assert.deepEqual(sheet.soFar.map((l) => l.name), ['NOT TICKED'], 'nothing against them, but the target has not been said');
  assert.deepEqual(sheet.notClear.map((l) => l.name), ['ABSENT']);
  // And it moves nobody's pay: the row with a target ticked nets the same.
  assert.equal(
    calculateRow(rows[0], NOV, rows[0].attendance).net_salary,
    calculateRow({ ...rows[0], target_met: null }, NOV, rows[0].attendance).net_salary
  );
});

test('through the server: the kind is kept, a wrong one is refused, and the target tick is the month’s own', async () => {
  const company = (await api('POST', '/api/companies', { name: 'BNF' })).body;
  const riya = (await api('POST', '/api/employees', { name: 'Riya Pal', company_id: company.id, monthly_salary: 26000 })).body;

  const made = await api('POST', '/api/people/appraisals', { employee_id: riya.id, kind: 'good_work', summary: 'Handled the Dubai group alone' });
  assert.ok(made.status === 200 || made.status === 201, `status ${made.status}`);
  assert.equal(made.body.kind, 'good_work');
  assert.equal(made.body.to_salary, null, 'good work is not a pay rise');
  const wrong = await api('POST', '/api/people/appraisals', { employee_id: riya.id, kind: 'bonus-ish' });
  assert.equal(wrong.status, 400);

  const period = (await api('POST', '/api/periods', { month: 11, year: 2026 })).body;
  const row = (await api('GET', `/api/periods/${period.id}/payroll`)).body.rows.find((r) => r.employee_id === riya.id);
  assert.equal(row.target_met, null, 'nobody has said');
  const net = calculateRow(row, period, row.attendance).net_salary;
  assert.equal((await api('PATCH', `/api/periods/${period.id}/rows/${row.id}`, { target_met: 1 })).status, 200);
  const after = (await api('GET', `/api/periods/${period.id}/payroll`)).body.rows.find((r) => r.employee_id === riya.id);
  assert.equal(after.target_met, 1);
  assert.equal(calculateRow(after, period, after.attendance).net_salary, net, 'a tick is not money');
  // Handed back to "not said".
  await api('PATCH', `/api/periods/${period.id}/rows/${row.id}`, { target_met: null });
  assert.equal((await api('GET', `/api/periods/${period.id}/payroll`)).body.rows.find((r) => r.employee_id === riya.id).target_met, null);
});

test('the form has the dropdown and the sheet is a report', () => {
  const read = (f) => fs.readFileSync(new URL(`../../frontend/src/${f}`, import.meta.url), 'utf8');
  assert.match(read('components/people/Appraisals.jsx'), /APPRAISAL_KINDS\.map\(/);
  assert.match(read('components/Reports.jsx'), /'appraisal-sheet': \(\) =>/);
  const css = read('styles.css');
  for (const cls of ['appraisal-sheet', 'ap-yes', 'ap-no', 'ap-unknown']) assert.ok(css.includes(cls), `${cls} has a rule`);
});
