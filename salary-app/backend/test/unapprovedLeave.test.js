/**
 * Leave taken without approval costs double - as a priced tool.
 *
 * Dinesh: "leave approved nahi ki aur leave li hai to sandwich leave katni
 * chahiye / 1 leave to 2 leave deduct / 2 to 4 leave" and "sudden leave with
 * proper proof only allowed / if proof not submitted sandwich leave".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateRow } from '../../shared/calc.js';
import { entriesToDouble, standingOf, unapprovedLeave } from '../../shared/unapprovedLeave.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'unapproved-'));
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

const NOV = { year: 2026, month: 11, hours_per_day: 9, late_policy: 'none', pt_threshold: 12000, pt_amount: 200 };
const person = (id, name, attendance, over = {}) => ({ id, employee_id: id, employee_name: name, salary: 26000, attendance, ...over });

test('three standings, and nobody-has-decided is not a refusal', () => {
  assert.equal(standingOf({ approved: 1 }), 'approved');
  assert.equal(standingOf({ approved: true }), 'approved');
  assert.equal(standingOf({ approved: 0 }), 'refused');
  assert.equal(standingOf({ approved: false }), 'refused');
  assert.equal(standingOf({ approved: null }), 'undecided');
  assert.equal(standingOf({}), 'undecided');
});

test('one day costs two, two cost four - priced by the function that pays', () => {
  const rows = [
    person(1, 'ONE DAY', { 3: { code: 'A', approved: 0, reason: 'no call' } }),
    person(2, 'TWO DAYS', { 3: { code: 'A', approved: 0 }, 4: { code: 'UL', approved: 0 } }),
    person(3, 'WITH PROOF', { 3: { code: 'A', approved: 1, reason: 'hospital slip' } }),
    person(4, 'NOT LOOKED AT', { 3: { code: 'A' } }),
    person(5, 'PAID LEAVE', { 3: { code: 'CL', approved: 0 }, 4: { code: 'HF', approved: 0 }, 5: { code: 'AD', approved: 0 } }),
  ];
  const report = unapprovedLeave(rows, NOV);
  assert.deepEqual(report.people.map((p) => p.employee_name), ['TWO DAYS', 'ONE DAY']);
  assert.equal(report.refused, 3);
  assert.equal(report.undecided, 1);
  assert.equal(report.approved, 1, 'the one with proof was looked at, and stays single');
  assert.equal(report.already, 1);
  assert.deepEqual(report.waiting.map((w) => [w.employee_name, w.days]), [['NOT LOOKED AT', [3]]]);

  // The price is the payslip's own: net now, less net with those days at AD.
  for (const p of report.people) {
    const row = rows.find((r) => r.employee_id === p.employee_id);
    const before = calculateRow(row, NOV, row.attendance);
    const after = { ...row.attendance };
    for (const d of p.days) after[d.day] = { ...after[d.day], code: 'AD' };
    const then = calculateRow(row, NOV, after);
    assert.equal(p.amount, before.net_salary - then.net_salary);
    assert.equal(then.absent_days, before.absent_days + p.days.length, 'each day now costs one more');
    assert.equal(p.amount, p.days.length * 1000, '26,000 over 26 days');
  }
  assert.equal(report.amount, 3000);

  // The entries name the mark and nothing else, so the reason and the decision stay.
  const entries = entriesToDouble(report);
  assert.equal(entries.length, 3);
  for (const e of entries) assert.deepEqual(Object.keys(e).sort(), ['code', 'day', 'employee_id']);
  assert.ok(entries.every((e) => e.code === 'AD'));

  // Counting the undecided is the office's own tick, never the default.
  const harsh = unapprovedLeave(rows, NOV, { countUndecided: true });
  assert.equal(harsh.days, 4);
  assert.equal(harsh.waiting.length, 0);
  assert.equal(harsh.people.find((p) => p.employee_name === 'NOT LOOKED AT').days[0].standing, 'undecided');
});

test('a day that has not happened, and a day after somebody left, are not leave without approval', () => {
  const rows = [
    person(1, 'FUTURE', { 3: { code: 'A', approved: 0 }, 28: { code: 'A', approved: 0 } }),
    person(2, 'LEFT', { 3: { code: 'A', approved: 0 }, 20: { code: 'A', approved: 0 } }, { left_on: '2026-11-10', active: 0 }),
  ];
  const report = unapprovedLeave(rows, NOV, { upTo: 15 });
  assert.deepEqual(report.people.map((p) => [p.employee_name, p.days.map((d) => d.day)]).sort(), [['FUTURE', [3]], ['LEFT', [3]]]);
});

test('through the server: nothing doubles by itself, the press does, and the reason survives it', async () => {
  const company = (await api('POST', '/api/companies', { name: 'BNF' })).body;
  const riya = (await api('POST', '/api/employees', { name: 'Riya Pal', company_id: company.id, monthly_salary: 26000 })).body;
  const period = (await api('POST', '/api/periods', { month: 10, year: 2026 })).body;
  await api('PATCH', `/api/periods/${period.id}`, { late_policy: 'none' });
  const save = (entries) => api('POST', `/api/periods/${period.id}/attendance`, { entries });
  assert.equal((await save([{ employee_id: riya.id, day: 6, code: 'A', reason: 'did not call', approved: false }])).status, 200);

  const load = async () => (await api('GET', `/api/periods/${period.id}/payroll`)).body;
  let month = await load();
  let row = month.rows.find((r) => r.employee_id === riya.id);
  assert.equal(row.attendance[6].code, 'A');
  const single = calculateRow(row, month.period, row.attendance).net_salary;

  const report = unapprovedLeave(month.rows, month.period);
  assert.equal(report.days, 1);
  // Reading it again has changed nothing.
  assert.equal((await load()).rows.find((r) => r.employee_id === riya.id).attendance[6].code, 'A');

  await save(entriesToDouble(report));
  month = await load();
  row = month.rows.find((r) => r.employee_id === riya.id);
  assert.equal(row.attendance[6].code, 'AD');
  assert.equal(row.attendance[6].reason, 'did not call', 'the reason is the record of why it cost two');
  assert.equal(standingOf(row.attendance[6]), 'refused');
  assert.equal(calculateRow(row, month.period, row.attendance).net_salary, single - report.amount);

  // And it is not found a second time.
  const again = unapprovedLeave(month.rows, month.period);
  assert.equal(again.days, 0);
  assert.equal(again.already, 1);
});

test('it is a tab under Leave, beside the sandwich tool', () => {
  const leave = fs.readFileSync(new URL('../../frontend/src/components/Leave.jsx', import.meta.url), 'utf8');
  assert.match(leave, /\['unapproved', 'Without approval'\]/);
  assert.match(leave, /<UnapprovedLeave /);
  const panel = fs.readFileSync(new URL('../../frontend/src/components/UnapprovedLeave.jsx', import.meta.url), 'utf8');
  assert.match(panel, /window\.confirm\(/, 'it asks, with the figure');
  assert.ok(!/calculateRow/.test(panel), 'the screen prices nothing itself');
});
