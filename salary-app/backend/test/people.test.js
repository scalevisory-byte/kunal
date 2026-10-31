/**
 * The people registers, end to end: warnings, appraisals, assets, claims,
 * leaving and the audit trail.
 *
 * What these tests are really pinning: nothing decides itself, nothing is paid
 * twice, and nothing reaches the payroll except through the one call that says
 * which month it came out of.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-people-'));
process.env.APP_PASSWORD = '';
process.env.SERVE_FRONTEND = 'false';

const { createServer } = await import('../src/server.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let companyId;
let employeeId;
let periodId;

test('set the scene: a company, a person, and an open month', async () => {
  const company = await api('POST', '/api/companies', { name: 'BOOKNFLY' });
  companyId = company.body.id;
  const employee = await api('POST', '/api/employees', {
    company_id: companyId,
    name: 'Vaibhav Gupta',
    monthly_salary: 26000,
    basic: 13000,
    joined_on: '2018-06-01',
    pl_quota: 15,
    cl_quota: 12,
  });
  assert.equal(employee.status, 201);
  employeeId = employee.body.id;
  const period = await api('POST', '/api/periods', { year: 2026, month: 10 });
  periodId = period.body.id;
  await api('GET', `/api/periods/${periodId}/payroll`); // opens the row
});

/* ---------------- warnings and appreciations ---------------- */

test('a warning and an appreciation go on the record together', async () => {
  const warning = await api('POST', '/api/people/notes', {
    employee_id: employeeId,
    kind: 'warning',
    severity: 'written',
    dated: '2026-08-14',
    subject: 'Late on eleven days in July',
    issued_by: 'Dinesh',
  });
  assert.equal(warning.status, 201);
  assert.equal(warning.body.severity, 'written');

  const praise = await api('POST', '/api/people/notes', {
    employee_id: employeeId,
    kind: 'appreciation',
    dated: '2026-09-02',
    subject: 'Closed the Surat audit a week early',
  });
  assert.equal(praise.status, 201);
  assert.equal(praise.body.severity, null, 'an appreciation has no severity');

  const { body } = await api('GET', `/api/people/notes?employee_id=${employeeId}`);
  assert.equal(body.notes.length, 2);
  assert.equal(body.notes[0].dated, '2026-09-02', 'newest first');
});

test('a note with nothing said about it is refused', async () => {
  const bad = await api('POST', '/api/people/notes', { employee_id: employeeId, kind: 'warning' });
  assert.equal(bad.status, 400);
});

test('a warning can be acknowledged, which is the point of recording it', async () => {
  const { body } = await api('GET', `/api/people/notes?employee_id=${employeeId}&kind=warning`);
  const patched = await api('PATCH', `/api/people/notes/${body.notes[0].id}`, {
    acknowledged_on: '2026-08-16',
  });
  assert.equal(patched.body.acknowledged_on, '2026-08-16');
});

/* ---------------- appraisals ---------------- */

let appraisalId;

test('an appraisal is measured off what they are on now', async () => {
  const created = await api('POST', '/api/people/appraisals', {
    employee_id: employeeId,
    cycle: '2026-27',
    reviewed_on: '2026-10-01',
    rating: 'A',
    to_salary: 29000,
    effective_from: '2026-11-01',
  });
  assert.equal(created.status, 201);
  appraisalId = created.body.id;
  assert.equal(created.body.from_salary, 26000, 'their current salary, not a typed one');
});

test('an appraisal does not change anybody’s pay until it is applied', async () => {
  const employee = await api('GET', `/api/employees/${employeeId}`);
  assert.equal(employee.body.monthly_salary, 26000);
  const { body } = await api('GET', `/api/people/appraisals?employee_id=${employeeId}`);
  assert.equal(body.appraisals[0].applied, false);
  assert.equal(body.appraisals[0].increment, 3000);
  assert.equal(body.appraisals[0].increment_pct, 11.5);
});

test('applying it writes the new salary and lands in the employee history', async () => {
  const applied = await api('POST', `/api/people/appraisals/${appraisalId}/apply`);
  assert.equal(applied.status, 200);
  assert.equal(applied.body.applied, true);
  assert.equal(applied.body.employee.monthly_salary, 29000);

  const record = await api('GET', `/api/employees/${employeeId}/record`);
  const salaryLine = record.body.history.find((h) => h.field === 'monthly_salary');
  assert.ok(salaryLine, 'the salary change is on the record');
  assert.match(salaryLine.note || '', /Appraisal 2026-27/);
});

test('applying it twice does not give a second rise', async () => {
  const again = await api('POST', `/api/people/appraisals/${appraisalId}/apply`);
  assert.equal(again.body.applied, false);
  const employee = await api('GET', `/api/employees/${employeeId}`);
  assert.equal(employee.body.monthly_salary, 29000);
});

test('an applied increment cannot be edited or deleted away', async () => {
  const edit = await api('PATCH', `/api/people/appraisals/${appraisalId}`, { to_salary: 40000 });
  assert.equal(edit.status, 400);
  const gone = await api('DELETE', `/api/people/appraisals/${appraisalId}`);
  assert.equal(gone.status, 400);
});

test('an appraisal with no new salary is a review, not a rise', async () => {
  const created = await api('POST', '/api/people/appraisals', {
    employee_id: employeeId,
    reviewed_on: '2026-10-02',
    rating: 'B',
    summary: 'doing well, revisit in April',
  });
  const applied = await api('POST', `/api/people/appraisals/${created.body.id}/apply`);
  assert.equal(applied.status, 400);
  assert.match(applied.body.error, /set the new salary/);
});

/* ---------------- assets ---------------- */

let assetId;

test('an asset is issued, is out, and comes back', async () => {
  const created = await api('POST', '/api/people/assets', {
    company_id: companyId,
    kind: 'Laptop',
    label: 'Dell Latitude 3420',
    identifier: 'SN-884421',
    value: 42000,
  });
  assert.equal(created.status, 201);
  assetId = created.body.id;
  assert.equal(created.body.employee_id, null, 'in the office, not lost');

  const issued = await api('POST', `/api/people/assets/${assetId}/issue`, {
    employee_id: employeeId,
    issued_on: '2026-07-01',
  });
  assert.equal(issued.body.employee_id, employeeId);
  assert.equal(issued.body.returned_on, null);

  const out = await api('GET', '/api/people/assets?out=true');
  assert.equal(out.body.assets.length, 1);

  const back = await api('POST', `/api/people/assets/${assetId}/return`, {
    returned_on: '2026-10-31',
    condition: 'screen scratched',
  });
  assert.equal(back.body.returned_on, '2026-10-31');
  const stillOut = await api('GET', '/api/people/assets?out=true');
  assert.equal(stillOut.body.assets.length, 0);
});

test('issuing and returning is on the audit trail, by name not by id', async () => {
  const { body } = await api('GET', `/api/people/audit?entity=assets&entity_id=${assetId}`);
  const actions = body.entries.map((e) => e.action);
  assert.ok(actions.includes('issued'));
  assert.ok(actions.includes('returned'));
  const issue = body.entries.find((e) => e.action === 'issued');
  assert.equal(issue.to_value, 'Vaibhav Gupta');
});

test('an asset with no name is refused', async () => {
  const bad = await api('POST', '/api/people/assets', { kind: 'SIM card' });
  assert.equal(bad.status, 400);
});

/* ---------------- expense claims ---------------- */

let claimId;

test('a claim starts pending and changes nobody’s pay', async () => {
  const before = await api('GET', `/api/periods/${periodId}/payroll`);
  const was = before.body.rows.find((r) => r.employee_id === employeeId);

  const created = await api('POST', '/api/people/claims', {
    employee_id: employeeId,
    kind: 'Petrol',
    spent_on: '2026-10-12',
    amount: 1450,
    detail: 'Vadodara to Surat, client visit',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'pending');
  claimId = created.body.id;

  const after = await api('GET', `/api/periods/${periodId}/payroll`);
  const now = after.body.rows.find((r) => r.employee_id === employeeId);
  assert.equal(now.addition, was.addition, 'a pending claim is not in the payroll');
});

test('a pending claim cannot be paid', async () => {
  const paid = await api('POST', `/api/people/claims/${claimId}/pay`, { period_id: periodId });
  assert.equal(paid.status, 400);
  assert.match(paid.body.error, /approve the claim/);
});

test('approving then paying posts it as an addition on that month', async () => {
  const decided = await api('POST', `/api/people/claims/${claimId}/decide`, {
    status: 'approved',
    by: 'Dinesh',
  });
  assert.equal(decided.body.status, 'approved');

  const paid = await api('POST', `/api/people/claims/${claimId}/pay`, { period_id: periodId });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.status, 'paid');

  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = body.rows.find((r) => r.employee_id === employeeId);
  assert.equal(row.addition, 1450);
  assert.match(row.adjustment_note, /Petrol claim/);
});

test('paying it twice is refused, so a double click cannot pay a bill twice', async () => {
  const again = await api('POST', `/api/people/claims/${claimId}/pay`, { period_id: periodId });
  assert.equal(again.status, 400);
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.rows.find((r) => r.employee_id === employeeId).addition, 1450);
});

test('a decided claim is not decided again', async () => {
  const flip = await api('POST', `/api/people/claims/${claimId}/decide`, { status: 'rejected' });
  assert.equal(flip.status, 400);
});

test('a paid claim stays on the record', async () => {
  const gone = await api('DELETE', `/api/people/claims/${claimId}`);
  assert.equal(gone.status, 400);
});

test('a rejection writes nothing beyond the decision', async () => {
  const created = await api('POST', '/api/people/claims', {
    employee_id: employeeId,
    kind: 'Food',
    amount: 300,
  });
  const rejected = await api('POST', `/api/people/claims/${created.body.id}/decide`, {
    status: 'rejected',
    note: 'already covered by the per diem',
  });
  assert.equal(rejected.body.status, 'rejected');
  const { body } = await api('GET', `/api/periods/${periodId}/payroll`);
  assert.equal(body.rows.find((r) => r.employee_id === employeeId).addition, 1450, 'unchanged');
});

test('a claim with no amount is refused', async () => {
  const bad = await api('POST', '/api/people/claims', { employee_id: employeeId, kind: 'Travel' });
  assert.equal(bad.status, 400);
});

/* ---------------- leaving ---------------- */

test('nothing is recorded until somebody records it', async () => {
  const none = await api('GET', `/api/people/exits/${employeeId}`);
  assert.equal(none.status, 404);
});

test('a resignation is recorded and the settlement assembles from the real month', async () => {
  const saved = await api('PUT', `/api/people/exits/${employeeId}`, {
    type: 'resigned',
    resigned_on: '2026-09-20',
    notice_days: 30,
    last_working_day: '2026-10-31',
    reason: 'moving to Ahmedabad',
  });
  assert.equal(saved.status, 200);

  const { settlement: s, final_month: month } = saved.body;
  assert.ok(month, 'October is open, so the final month is real');
  // The settlement must print the same net the payslip does.
  const payroll = await api('GET', `/api/periods/${periodId}/payroll`);
  const row = payroll.body.rows.find((r) => r.employee_id === employeeId);
  assert.equal(month.net_salary, row.net_salary);

  assert.equal(s.notice.short, 0, '41 days of notice against 30');
  assert.equal(s.gratuity.eligible, true, 'joined 2018');
  assert.equal(s.encashment.days, 15, 'the whole PL quota, none taken');
  assert.equal(s.payable - s.recoverable, s.net);
});

test('leaving marks them inactive, which is what the other tabs read', async () => {
  const employee = await api('GET', `/api/employees/${employeeId}`);
  assert.equal(employee.body.left_on, '2026-10-31');
  assert.equal(employee.body.active, 0);
});

test('short notice is recovered, and a negotiated notice period is honoured', async () => {
  await api('PUT', `/api/people/exits/${employeeId}`, { resigned_on: '2026-10-21' });
  let { body } = await api('GET', `/api/people/exits/${employeeId}`);
  assert.equal(body.settlement.notice.short, 20);
  assert.ok(body.settlement.recovers.some((l) => l.label.startsWith('Short notice')));

  await api('PUT', `/api/people/exits/${employeeId}`, { notice_days: 7 });
  ({ body } = await api('GET', `/api/people/exits/${employeeId}`));
  assert.equal(body.settlement.notice.short, 0);
  await api('PUT', `/api/people/exits/${employeeId}`, { resigned_on: '2026-09-20', notice_days: 30 });
});

test('an asset still out is named on the settlement, never deducted from it', async () => {
  await api('POST', `/api/people/assets/${assetId}/issue`, { employee_id: employeeId });
  const { body } = await api('GET', `/api/people/exits/${employeeId}`);
  assert.equal(body.settlement.assets_value, 42000);
  assert.equal(
    body.settlement.recovers.some((l) => /Dell/.test(l.label)),
    false,
  );
  assert.match(body.settlement.open.join(' '), /asset is still out/);
  await api('POST', `/api/people/assets/${assetId}/return`, {});
});

test('a settlement is paid once, and then the dates are fixed', async () => {
  const before = await api('GET', `/api/people/exits/${employeeId}`);
  const settled = await api('POST', `/api/people/exits/${employeeId}/settle`, {
    amount: before.body.settlement.net,
    settled_on: '2026-11-07',
    by: 'Dinesh',
  });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.exit.settled_amount, before.body.settlement.net);

  const again = await api('POST', `/api/people/exits/${employeeId}/settle`, { amount: 1 });
  assert.equal(again.status, 400);

  const moved = await api('PUT', `/api/people/exits/${employeeId}`, { last_working_day: '2026-12-31' });
  assert.equal(moved.status, 400, 'the dates behind a paid settlement do not move');

  const removed = await api('DELETE', `/api/people/exits/${employeeId}`);
  assert.equal(removed.status, 400);
});

test('the exits list shows who is settled and who is not', async () => {
  const unsettled = await api('GET', '/api/people/exits?settled=false');
  assert.equal(unsettled.body.exits.length, 0);
  const settled = await api('GET', '/api/people/exits?settled=true');
  assert.equal(settled.body.exits.length, 1);
  assert.equal(settled.body.exits[0].employee_name, 'Vaibhav Gupta');
});

/* ---------------- audit trail ---------------- */

test('the trail carries every decision, newest first, readable without joins', async () => {
  const { body } = await api('GET', '/api/people/audit?limit=100');
  const actions = body.entries.map((e) => e.action);
  for (const action of ['created', 'applied', 'approved', 'paid', 'settled', 'issued', 'returned']) {
    assert.ok(actions.includes(action), `the trail should carry "${action}"`);
  }
  // Every line says what it was about in words, not just an id.
  assert.ok(body.entries.every((e) => e.label));
  const settledLine = body.entries.find((e) => e.action === 'settled');
  assert.match(settledLine.label, /Vaibhav Gupta/);
  assert.equal(settledLine.who, 'Dinesh');
});

test('the trail can be read for one record', async () => {
  const { body } = await api('GET', `/api/people/audit?entity=expense_claims&entity_id=${claimId}`);
  assert.ok(body.entries.length >= 3, 'raised, approved, paid');
  assert.ok(body.entries.every((e) => e.entity === 'expense_claims'));
});

/* ---------------- the trail over the payroll itself ---------------- */

let traceId;
let tracePeriodId;

test('a corrected attendance mark is on the trail; filling a blank day is not', async () => {
  const employee = await api('POST', '/api/employees', {
    company_id: companyId,
    name: 'Riya Pal',
    monthly_salary: 24000,
  });
  traceId = employee.body.id;
  const period = await api('POST', '/api/periods', { year: 2026, month: 11 });
  tracePeriodId = period.body.id;
  await api('GET', `/api/periods/${tracePeriodId}/payroll`);

  // Filling blanks - what "Mark everyone Present" and the punch import do.
  await api('POST', `/api/periods/${tracePeriodId}/attendance`, {
    entries: [
      { employee_id: traceId, day: 3, code: 'P' },
      { employee_id: traceId, day: 4, code: 'A' },
    ],
  });
  let { body } = await api('GET', `/api/people/audit?entity=attendance&entity_id=${traceId}`);
  assert.equal(body.entries.length, 0, 'filling blank days is not a correction');

  // Now a real correction: the absence turns out to have been sick leave.
  await api('POST', `/api/periods/${tracePeriodId}/attendance`, {
    entries: [{ employee_id: traceId, day: 4, code: 'SL', by: 'Dinesh' }],
  });
  ({ body } = await api('GET', `/api/people/audit?entity=attendance&entity_id=${traceId}`));
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].from_value, 'A');
  assert.equal(body.entries[0].to_value, 'SL');
  assert.match(body.entries[0].label, /Riya Pal/);
  assert.match(body.entries[0].label, /day 4/);
  assert.equal(body.entries[0].who, 'Dinesh');
});

test('writing the same mark again records nothing', async () => {
  await api('POST', `/api/periods/${tracePeriodId}/attendance`, {
    entries: [{ employee_id: traceId, day: 4, code: 'SL' }],
  });
  const { body } = await api('GET', `/api/people/audit?entity=attendance&entity_id=${traceId}`);
  assert.equal(body.entries.length, 1, 'still just the one correction');
});

test('a figure typed over the salary sheet is on the trail, by name and column', async () => {
  const payroll = await api('GET', `/api/periods/${tracePeriodId}/payroll`);
  const row = payroll.body.rows.find((r) => r.employee_id === traceId);
  await api('PATCH', `/api/periods/${tracePeriodId}/rows/${row.id}`, { addition: 2363, by: 'Dinesh' });

  const { body } = await api('GET', `/api/people/audit?entity=payroll_rows&entity_id=${row.id}`);
  const line = body.entries.find((e) => e.field === 'addition');
  assert.ok(line, 'the addition is on the trail');
  assert.equal(line.to_value, '2363');
  assert.match(line.label, /Riya Pal/);

  // Typing the same figure again is not a change.
  await api('PATCH', `/api/periods/${tracePeriodId}/rows/${row.id}`, { addition: 2363 });
  const after = await api('GET', `/api/people/audit?entity=payroll_rows&entity_id=${row.id}`);
  assert.equal(after.body.entries.filter((e) => e.field === 'addition').length, 1);
});

test('an override going back to the formula says so, rather than reading as zero', async () => {
  const payroll = await api('GET', `/api/periods/${tracePeriodId}/payroll`);
  const row = payroll.body.rows.find((r) => r.employee_id === traceId);
  await api('PATCH', `/api/periods/${tracePeriodId}/rows/${row.id}`, { absent_days_override: 3 });
  await api('PATCH', `/api/periods/${tracePeriodId}/rows/${row.id}`, { absent_days_override: '' });
  const { body } = await api('GET', `/api/people/audit?entity=payroll_rows&entity_id=${row.id}`);
  const lines = body.entries.filter((e) => e.field === 'absent_days_override');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].to_value, '(formula)');
  assert.equal(lines[1].from_value, '(formula)');
});

test('closing a month is on the trail as closing it', async () => {
  await api('PATCH', `/api/periods/${tracePeriodId}`, { locked: true, by: 'Dinesh' });
  const { body } = await api('GET', `/api/people/audit?entity=periods&entity_id=${tracePeriodId}`);
  const closed = body.entries.find((e) => e.action === 'closed');
  assert.ok(closed);
  assert.match(closed.label, /November 2026/);
  await api('PATCH', `/api/periods/${tracePeriodId}`, { locked: false });
  const after = await api('GET', `/api/people/audit?entity=periods&entity_id=${tracePeriodId}`);
  assert.ok(after.body.entries.some((e) => e.action === 'reopened'));
});

test('switching the late/early rule is on the trail - it changes what people are paid', async () => {
  await api('PATCH', `/api/periods/${tracePeriodId}`, { late_policy: 'concession', by: 'Dinesh' });
  const { body } = await api('GET', `/api/people/audit?entity=periods&entity_id=${tracePeriodId}`);
  const line = body.entries.find((e) => e.field === 'late_policy');
  assert.ok(line);
  assert.equal(line.from_value, 'hours');
  assert.equal(line.to_value, 'concession');
});
